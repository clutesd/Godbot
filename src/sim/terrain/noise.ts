import { hashedLattice, seedHash, stableHash } from '../prng';

const smooth = (value: number): number => value * value * (3 - 2 * value);
const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount;

export const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Smooth 0..1 ramp. Reversed edges ramp downward, which is how most of the blending is written. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  return smooth(clamp01((value - edge0) / (edge1 - edge0)));
}

/**
 * One pre-hashed seed per octave. Terrain synthesis evaluates dozens of noise layers per sample,
 * and re-hashing the seed string on every lattice lookup dominated world generation.
 */
export type OctaveSeeds = readonly number[];

export function octaveSeeds(seed: string, label: string, octaves: number): OctaveSeeds {
  const seeds: number[] = [];
  for (let octave = 0; octave < octaves; octave += 1) seeds.push(seedHash(`${seed}:${label}:${octave}`));
  return seeds;
}

function latticeNoise(seed: number, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hashedLattice(seed, ix, iz);
  const b = hashedLattice(seed, ix + 1, iz);
  const c = hashedLattice(seed, ix, iz + 1);
  const d = hashedLattice(seed, ix + 1, iz + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

export function valueNoise(seed: string, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = stableHash(seed, ix, iz);
  const b = stableHash(seed, ix + 1, iz);
  const c = stableHash(seed, ix, iz + 1);
  const d = stableHash(seed, ix + 1, iz + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

/** Standard fractal noise in 0..1 over pre-hashed octave seeds. */
export function fbmSeeded(seeds: OctaveSeeds, x: number, z: number): number {
  let value = 0;
  let amplitude = 0.54;
  let frequency = 1;
  let total = 0;
  for (const seed of seeds) {
    value += latticeNoise(seed, x * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return total > 0 ? value / total : 0;
}

/** Standard fractal noise in 0..1. Octave seeds are salted so layers never correlate. */
export function fbm(seed: string, x: number, z: number, octaves = 5): number {
  let value = 0;
  let amplitude = 0.54;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise(`${seed}:${octave}`, x * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / total;
}

/**
 * Ridged multifractal in 0..1. Successive octaves are gated by the previous one, which is what
 * turns soft noise blobs into knife-edge ridgelines and alpine spurs.
 */
export function ridgedSeeded(seeds: OctaveSeeds, x: number, z: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let weight = 1;
  let total = 0;
  for (const seed of seeds) {
    const raw = 1 - Math.abs(latticeNoise(seed, x * frequency, z * frequency) * 2 - 1);
    const sharpened = raw * raw * weight;
    value += sharpened * amplitude;
    total += amplitude;
    weight = clamp01(0.35 + sharpened * 1.1);
    amplitude *= 0.48;
    frequency *= 2.07;
  }
  return total > 0 ? clamp01(value / total) : 0;
}

/**
 * Distance to the zero-contour of a low-frequency field, inverted. Produces long connected
 * bands rather than islands, which is how mountain chains and canyon systems are laid out.
 */
export function beltSeeded(seeds: OctaveSeeds, x: number, z: number, sharpness: number): number {
  return clamp01(1 - Math.abs(fbmSeeded(seeds, x, z) - 0.5) * sharpness);
}

/** Offsets a sample position by a low-frequency vector field so features stop looking axis-aligned. */
export function domainWarpSeeded(
  xSeeds: OctaveSeeds,
  zSeeds: OctaveSeeds,
  x: number,
  z: number,
  amount: number,
  scale: number,
): { x: number; z: number } {
  const wx = fbmSeeded(xSeeds, x * scale, z * scale) - 0.5;
  const wz = fbmSeeded(zSeeds, x * scale + 37.4, z * scale - 19.1) - 0.5;
  return { x: x + wx * amount, z: z + wz * amount };
}
