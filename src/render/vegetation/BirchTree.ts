import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import type { TreeVariant as BaseTreeVariant } from './TreeLibraryBase';

/** Paper-birch inspired summer foliage; seasonal tinting is applied later per instance. */
export const BIRCH_FOLIAGE_COLOUR = '#73934f';

export interface BirchVariantGeometry {
  bark: THREE.BufferGeometry;
  foliage: THREE.BufferGeometry;
  height: number;
  radius: number;
}

interface BirchProfile {
  trunkWidth: number;
  height: number;
  crownWidth: number;
  crownHeight: number;
  crownLift: number;
  phase: number;
  bandPhase: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function profile(seed: string, variant: number): BirchProfile {
  const random = new SeededRandom(`${seed}:birch-presentation:${variant}`);
  return {
    trunkWidth: random.range(0.72, 0.84),
    height: random.range(1.08, 1.17),
    crownWidth: random.range(0.78, 0.91),
    crownHeight: random.range(1.02, 1.11),
    crownLift: random.range(0.015, 0.045),
    phase: random.range(0, Math.PI * 2),
    bandPhase: random.range(0, Math.PI * 2),
  };
}

function bounds(geometry: THREE.BufferGeometry): { minY: number; maxY: number; radius: number } {
  const position = geometry.getAttribute('position');
  let minY = Infinity;
  let maxY = -Infinity;
  let radius = 0;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    radius = Math.max(radius, Math.hypot(x, z));
  }
  return { minY, maxY, radius: Math.max(1e-4, radius) };
}

/**
 * Turn a separately cloned broadleaf skeleton into a recognisable birch without adding triangles.
 * The polished deciduous branch/canopy generator remains the source of truth; this adapter makes the
 * tree taller/slender, opens the crown, and authors pale bark with restrained dark lenticel bands.
 */
export function createBirchVariant(source: BaseTreeVariant, seed: string, variant: number): BirchVariantGeometry {
  const birch = profile(seed, variant);
  const bark = source.bark.clone();
  const foliage = source.foliage.clone();

  const barkPosition = bark.getAttribute('position');
  const barkColour = bark.getAttribute('color');
  const barkBounds = bounds(bark);
  const ivory = new THREE.Color('#d8d2c0');
  const silver = new THREE.Color('#b8b3a5');
  const twig = new THREE.Color('#5c554c');
  const charcoal = new THREE.Color('#3d3934');
  const working = new THREE.Color();

  for (let index = 0; index < barkPosition.count; index += 1) {
    let x = barkPosition.getX(index);
    let y = barkPosition.getY(index);
    let z = barkPosition.getZ(index);
    const normalizedY = clamp01((y - barkBounds.minY) / Math.max(1e-4, barkBounds.maxY - barkBounds.minY));
    const radial = clamp01(Math.hypot(x, z) / barkBounds.radius);

    // Birch reads as a tall, comparatively slender tree. Higher branches stay a little less
    // compressed than the lower bole so the crown still connects naturally to the skeleton.
    const branchRelease = 1 + smoothstep(0.34, 0.96, normalizedY) * 0.08;
    x *= birch.trunkWidth * branchRelease;
    z *= birch.trunkWidth * branchRelease;
    y *= birch.height;
    barkPosition.setXYZ(index, x, y, z);

    // Pale lower/central bark transitions toward grey-brown fine branches. Horizontal lenticel-like
    // marks are deliberately subtle: enough to read as birch, not enough to become zebra striping.
    const branchiness = smoothstep(0.2, 0.78, radial) * smoothstep(0.18, 0.92, normalizedY);
    working.copy(ivory).lerp(silver, normalizedY * 0.18 + branchiness * 0.42).lerp(twig, branchiness * 0.68);
    const angle = Math.atan2(z, x);
    const bandWave = 0.5 + 0.5 * Math.sin(normalizedY * 72 + angle * 1.4 + birch.bandPhase);
    const band = Math.pow(bandWave, 11) * (1 - smoothstep(0.28, 0.56, radial)) * (0.08 + normalizedY * 0.12);
    working.lerp(charcoal, band);
    barkColour.setXYZ(index, working.r, working.g, working.b);
  }
  barkPosition.needsUpdate = true;
  barkColour.needsUpdate = true;
  bark.computeVertexNormals();
  bark.computeBoundingBox();
  bark.computeBoundingSphere();

  const foliagePosition = foliage.getAttribute('position');
  const foliageBounds = bounds(foliage);
  const span = Math.max(1e-4, foliageBounds.maxY - foliageBounds.minY);
  for (let index = 0; index < foliagePosition.count; index += 1) {
    let x = foliagePosition.getX(index);
    let y = foliagePosition.getY(index);
    let z = foliagePosition.getZ(index);
    const normalizedY = clamp01((y - foliageBounds.minY) / span);
    // Narrow, airy, lightly tapered crowns separate birch from the heavier broadleaf family.
    const crownProfile = 0.78 + Math.sin(normalizedY * Math.PI) * 0.22;
    const width = birch.crownWidth * crownProfile;
    x *= width;
    z *= width;
    y = foliageBounds.minY + (y - foliageBounds.minY) * birch.crownHeight + source.height * birch.crownLift;
    const sway = Math.sin(normalizedY * 5.2 + birch.phase) * source.height * 0.014 * smoothstep(0.25, 1, normalizedY);
    x += sway;
    z += Math.cos(normalizedY * 4.6 + birch.phase) * sway * 0.55;
    foliagePosition.setXYZ(index, x, y, z);
  }
  foliagePosition.needsUpdate = true;
  foliage.computeVertexNormals();
  foliage.computeBoundingBox();
  foliage.computeBoundingSphere();

  // Derive metadata only from the base contract and deterministic profile so near/far LOD tiers
  // remain numerically identical even though their sampled geometry is cheaper at distance.
  return {
    bark,
    foliage,
    height: source.height * birch.height * birch.crownHeight,
    radius: source.radius * birch.crownWidth,
  };
}
