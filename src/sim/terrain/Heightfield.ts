import { beltSeeded, clamp01, domainWarpSeeded, fbm, fbmSeeded, octaveSeeds, ridgedSeeded, smoothstep, type OctaveSeeds } from './noise';
import { geologySampler } from '../environment/GeologySystem';

export interface HeightfieldOptions {
  readonly seed: string;
  /** Simulation grid cells per side. */
  readonly size: number;
  readonly cellSize: number;
  /** Field samples per simulation cell edge. */
  readonly subdivision: number;
  readonly noiseScale: number;
  readonly seaLevel: number;
  readonly mountainLevel: number;
  readonly offsetX: number;
  readonly offsetZ: number;
}

export interface RawHeightfield {
  readonly resolution: number;
  readonly step: number;
  readonly originX: number;
  readonly originZ: number;
  readonly height: Float32Array;
}

const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount;
const read = (values: Float32Array, index: number): number => values[index] ?? 0;

interface GeologySeeds {
  warpX: OctaveSeeds;
  warpZ: OctaveSeeds;
  shore: OctaveSeeds;
  continent: OctaveSeeds;
  regional: OctaveSeeds;
  belt: OctaveSeeds;
  alpine: OctaveSeeds;
  massif: OctaveSeeds;
  massifRelief: OctaveSeeds;
  plateau: OctaveSeeds;
  hills: OctaveSeeds;
  grain: OctaveSeeds;
  canyon: OctaveSeeds;
}

function geologySeeds(seed: string): GeologySeeds {
  return {
    warpX: octaveSeeds(seed, 'warp-x', 3),
    warpZ: octaveSeeds(seed, 'warp-z', 3),
    shore: octaveSeeds(seed, 'shore', 4),
    continent: octaveSeeds(seed, 'continent', 4),
    regional: octaveSeeds(seed, 'regional', 4),
    belt: octaveSeeds(seed, 'belt', 3),
    alpine: octaveSeeds(seed, 'alpine', 6),
    massif: octaveSeeds(seed, 'massif', 3),
    massifRelief: octaveSeeds(seed, 'massif-relief', 5),
    plateau: octaveSeeds(seed, 'plateau', 3),
    hills: octaveSeeds(seed, 'hills', 4),
    grain: octaveSeeds(seed, 'grain', 3),
    canyon: octaveSeeds(seed, 'canyon', 3),
  };
}

/**
 * Layered geology for a single sample. Every term is a different spatial scale: continent, then
 * tectonic belts, then massifs and plateaus, then hills, then surface grain. Feeding one noise
 * field through a redistribution curve gives lumps; stacking scales gives landscape.
 */
function rawElevation(seeds: GeologySeeds, nx: number, nz: number, u: number, v: number): number {
  const warped = domainWarpSeeded(seeds.warpX, seeds.warpZ, nx, nz, 1.35, 0.5);
  const px = warped.x;
  const pz = warped.z;

  // Continental mass. The mask decides where the sea is, not how tall the interior gets: pulling
  // height toward the centre would rebuild the dome-shaped island this pass exists to kill.
  const dx = u * 2 - 1;
  const dz = v * 2 - 1;
  const radial = Math.hypot(dx, dz) * 0.64 + Math.max(Math.abs(dx), Math.abs(dz)) * 0.36;
  const shoreWobble = (fbmSeeded(seeds.shore, px * 1.12 + 5.3, pz * 1.12 - 8.1) - 0.5) * 0.4;
  const landMask = 1 - smoothstep(0.72 + shoreWobble, 1.14 + shoreWobble, radial);

  const continent = fbmSeeded(seeds.continent, px * 0.5, pz * 0.5);
  const regional = fbmSeeded(seeds.regional, px * 1.22 + 17.2, pz * 1.22 + 4.6);
  let height = continent * 0.66 + regional * 0.34;
  height = height * (0.8 + landMask * 0.24) - (1 - landMask) * 0.62;

  // Mountain chains: ridged relief confined to long belts traced along a low-frequency contour.
  // The belt is deliberately broad, because a range of massifs reads better than a field of spikes.
  const belt = beltSeeded(seeds.belt, px * 0.32 + 11.7, pz * 0.32 - 7.3, 2.6);
  const beltStrength = smoothstep(0.1, 0.72, belt) * smoothstep(0.24, 0.56, continent);
  height += ridgedSeeded(seeds.alpine, px * 0.78, pz * 0.78) * beltStrength * 0.72;

  // Isolated massifs, so the skyline carries singular peaks and not only chains.
  const massif = smoothstep(0.72, 0.92, fbmSeeded(seeds.massif, px * 0.6 - 29.4, pz * 0.6 + 13.8));
  height += ridgedSeeded(seeds.massifRelief, px * 1.05, pz * 1.05) * massif * 0.28 * landMask;

  // Plateaus, quantised into terraces and blended back in so the edges stay soft.
  const plateau = smoothstep(0.6, 0.84, fbmSeeded(seeds.plateau, px * 0.44 - 23.1, pz * 0.44 + 31.7)) * landMask;
  if (plateau > 0.001) height = lerp(height, Math.round(height * 6) / 6, plateau * 0.68);

  height += (fbmSeeded(seeds.hills, px * 2.4 + 63.2, pz * 2.4 - 41.5) - 0.5) * 0.14 * landMask;
  height += (fbmSeeded(seeds.grain, px * 6.7 - 12.4, pz * 6.7 + 88.1) - 0.5) * 0.036 * landMask;

  // Canyons: narrow belts incised into dry high ground only, so they stay rare and memorable.
  const canyon = beltSeeded(seeds.canyon, px * 0.74 + 61.4, pz * 0.74 - 31.9, 21);
  height -= canyon * smoothstep(0.34, 0.66, height) * landMask * 0.21;

  return height;
}

/**
 * Remaps the synthesised distribution onto fixed quantiles so every seed yields a world with a
 * comparable amount of ocean, lowland and high country. The upper control points matter most:
 * give the mountain band too little area and the range collapses into isolated needles.
 */
function redistribute(height: Float32Array, seaLevel: number, mountainLevel: number): void {
  const sorted = Float32Array.from(height);
  sorted.sort();
  const last = sorted.length - 1;
  const quantile = (fraction: number): number => read(sorted, Math.min(last, Math.max(0, Math.round(fraction * last))));

  const source = [quantile(0), quantile(0.16), quantile(0.4), quantile(0.5), quantile(0.68), quantile(0.87), quantile(0.95), quantile(1)];
  const target = [0, seaLevel * 0.4, seaLevel, seaLevel + 0.03, seaLevel + 0.13, mountainLevel - 0.14, mountainLevel, 0.94];
  for (let index = 1; index < source.length; index += 1) {
    const previous = source[index - 1] ?? 0;
    if ((source[index] ?? 0) <= previous) source[index] = previous + 1e-6;
  }

  for (let index = 0; index < height.length; index += 1) {
    const value = read(height, index);
    let segment = 0;
    while (segment < source.length - 2 && value > (source[segment + 1] ?? 0)) segment += 1;
    const a = source[segment] ?? 0;
    const b = source[segment + 1] ?? 1;
    const t = clamp01((value - a) / (b - a));
    height[index] = clamp01(lerp(target[segment] ?? 0, target[segment + 1] ?? 1, t));
  }
}

/**
 * Talus erosion. Material slides off anything steeper than the repose angle, which rounds
 * shoulders, builds scree aprons and leaves the ridge crests sharp.
 */
function thermalErosion(height: Float32Array, resolution: number, talus: number, iterations: number): void {
  const delta = new Float32Array(height.length);
  for (let pass = 0; pass < iterations; pass += 1) {
    delta.fill(0);
    for (let z = 1; z < resolution - 1; z += 1) {
      for (let x = 1; x < resolution - 1; x += 1) {
        const index = z * resolution + x;
        const centre = read(height, index);
        let lowestIndex = -1;
        let lowestDrop = talus;
        for (const offset of [-1, 1, -resolution, resolution]) {
          const drop = centre - read(height, index + offset);
          if (drop > lowestDrop) {
            lowestDrop = drop;
            lowestIndex = index + offset;
          }
        }
        if (lowestIndex < 0) continue;
        const moved = (lowestDrop - talus) * 0.42;
        delta[index] = read(delta, index) - moved;
        delta[lowestIndex] = read(delta, lowestIndex) + moved;
      }
    }
    for (let index = 0; index < height.length; index += 1) height[index] = read(height, index) + read(delta, index);
  }
}

/**
 * Depositional smoothing weighted toward low ground. Basins and floodplains flatten into land a
 * civilisation would actually farm, while the high country keeps its edges.
 */
function depositionalSmoothing(height: Float32Array, resolution: number, seaLevel: number, iterations: number): void {
  const source = new Float32Array(height.length);
  for (let pass = 0; pass < iterations; pass += 1) {
    source.set(height);
    for (let z = 1; z < resolution - 1; z += 1) {
      for (let x = 1; x < resolution - 1; x += 1) {
        const index = z * resolution + x;
        const centre = read(source, index);
        const average = (
          read(source, index - 1) + read(source, index + 1) +
          read(source, index - resolution) + read(source, index + resolution) +
          read(source, index - resolution - 1) + read(source, index - resolution + 1) +
          read(source, index + resolution - 1) + read(source, index + resolution + 1)
        ) / 8;
        const lowland = smoothstep(seaLevel + 0.26, seaLevel - 0.04, centre);
        height[index] = lerp(centre, average, lowland * 0.55);
      }
    }
  }
}

export function synthesizeHeightfield(options: HeightfieldOptions): RawHeightfield {
  const { seed, size, cellSize, subdivision, noiseScale, seaLevel, mountainLevel, offsetX, offsetZ } = options;
  const resolution = (size - 1) * subdivision + 1;
  const step = cellSize / subdivision;
  const originX = (-size / 2) * cellSize;
  const originZ = (-size / 2) * cellSize;
  const height = new Float32Array(resolution * resolution);
  const seeds = geologySeeds(seed);
  const parentRock = geologySampler(seed);
  const span = size - 1;

  for (let z = 0; z < resolution; z += 1) {
    const gz = z / subdivision;
    const nz = gz * noiseScale + offsetZ;
    const v = gz / span;
    for (let x = 0; x < resolution; x += 1) {
      const gx = x / subdivision;
      height[z * resolution + x] = rawElevation(seeds, gx * noiseScale + offsetX, nz, gx / span, v) + parentRock(gx, gz).uplift;
    }
  }

  redistribute(height, seaLevel, mountainLevel);
  thermalErosion(height, resolution, 0.05, 22);
  depositionalSmoothing(height, resolution, seaLevel, 3);
  redistribute(height, seaLevel, mountainLevel);

  return { resolution, step, originX, originZ, height };
}

/** Exposed rock from steepness, altitude and a patchy lithology field. */
export function computeRockiness(seed: string, raw: RawHeightfield, mountainLevel: number, verticalScale: number): Float32Array {
  const { resolution, step, height } = raw;
  const rock = new Float32Array(height.length);
  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      const east = read(height, z * resolution + Math.min(resolution - 1, x + 1));
      const west = read(height, z * resolution + Math.max(0, x - 1));
      const south = read(height, Math.min(resolution - 1, z + 1) * resolution + x);
      const north = read(height, Math.max(0, z - 1) * resolution + x);
      const gradient = Math.hypot((east - west) * verticalScale, (south - north) * verticalScale) / (2 * step);
      const steepness = smoothstep(0.35, 1.15, gradient);
      const altitude = smoothstep(mountainLevel - 0.2, mountainLevel + 0.06, read(height, index));
      const lithology = fbm(`${seed}:lithology`, x * 0.06, z * 0.06, 3);
      rock[index] = clamp01(steepness * 0.72 + altitude * 0.5 + (lithology - 0.5) * 0.3);
    }
  }
  return rock;
}
