import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { TREE_LOD_FAR, type TreeVariant as BaseTreeVariant } from './TreeLibraryBase';

/** Paper-birch inspired summer foliage; seasonal tinting is applied later per instance. */
export const BIRCH_FOLIAGE_COLOUR = '#82a65b';

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
    // Birch should stay elegant, but the previous 0.72 lower bound became sub-pixel too quickly.
    trunkWidth: random.range(0.8, 0.92),
    height: random.range(1.12, 1.21),
    crownWidth: random.range(0.75, 0.88),
    crownHeight: random.range(1.05, 1.14),
    crownLift: random.range(0.05, 0.085),
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
 * The far tree skeleton deliberately keeps a slightly stronger bole. This is perceptual LOD rather
 * than a different species shape: thin bright trunks otherwise disappear before the crown does.
 */
function isFarSkeleton(source: BaseTreeVariant): boolean {
  const indexCount = source.bark.getIndex()?.count ?? 0;
  const farCeiling = TREE_LOD_FAR.maxSegments * TREE_LOD_FAR.sides * 6 + 24;
  return indexCount <= farCeiling;
}

/**
 * Turn a separately cloned broadleaf skeleton into a recognisable birch without adding triangles.
 * The polished deciduous branch/canopy generator remains the source of truth; this adapter gives
 * birch a tall pale bole, fine silver scaffold, open lower crown and distance-safe bark identity.
 */
export function createBirchVariant(source: BaseTreeVariant, seed: string, variant: number): BirchVariantGeometry {
  const birch = profile(seed, variant);
  const farSkeleton = isFarSkeleton(source);
  const bark = source.bark.clone();
  const foliage = source.foliage.clone();

  const barkPosition = bark.getAttribute('position');
  const barkColour = bark.getAttribute('color');
  const barkBounds = bounds(bark);
  const ivory = new THREE.Color('#eee9dc');
  const silver = new THREE.Color('#d4cfc3');
  const twig = new THREE.Color('#7d766b');
  const charcoal = new THREE.Color('#45413c');
  const working = new THREE.Color();

  for (let index = 0; index < barkPosition.count; index += 1) {
    let x = barkPosition.getX(index);
    let y = barkPosition.getY(index);
    let z = barkPosition.getZ(index);
    const normalizedY = clamp01((y - barkBounds.minY) / Math.max(1e-4, barkBounds.maxY - barkBounds.minY));
    const radial = clamp01(Math.hypot(x, z) / barkBounds.radius);

    // Preserve an unmistakable lower bole, then let the upper scaffold become progressively finer.
    // Far LOD gets only a small lower-trunk compensation; crown dimensions and metadata stay exact.
    const lowerBole = 1 - smoothstep(0.42, 0.82, normalizedY);
    const branchRelease = 1 + smoothstep(0.34, 0.96, normalizedY) * 0.08;
    const bolePresence = 1 + lowerBole * 0.055 + (farSkeleton ? lowerBole * 0.085 : 0);
    x *= birch.trunkWidth * branchRelease * bolePresence;
    z *= birch.trunkWidth * branchRelease * bolePresence;
    y *= birch.height;
    barkPosition.setXYZ(index, x, y, z);

    // The whole scaffold stays silver-grey enough to read in forest shade. Two bark frequencies do
    // different jobs: fine lenticels reward close views while sparse broader scars survive distance.
    const branchiness = smoothstep(0.2, 0.78, radial) * smoothstep(0.18, 0.92, normalizedY);
    working.copy(ivory).lerp(silver, normalizedY * 0.12 + branchiness * 0.26).lerp(twig, branchiness * 0.42);
    const angle = Math.atan2(z, x);
    const fineWave = 0.5 + 0.5 * Math.sin(normalizedY * 70 + angle * 1.35 + birch.bandPhase);
    const fineBand = Math.pow(fineWave, 12) * (1 - smoothstep(0.28, 0.58, radial)) * (0.06 + normalizedY * 0.08);
    const broadWave = 0.5 + 0.5 * Math.sin(normalizedY * 18 + angle * 0.72 + birch.bandPhase * 0.67);
    const broadBand = Math.pow(broadWave, 18) * (1 - smoothstep(0.2, 0.5, radial))
      * smoothstep(0.08, 0.82, normalizedY) * 0.16;
    working.lerp(charcoal, clamp01(fineBand + broadBand));

    // A restrained baked curvature cue keeps pale bark dimensional in flat or heavily overcast light.
    const roundness = 0.965 + (0.5 + 0.5 * Math.cos(angle + birch.phase)) * 0.07;
    working.multiplyScalar(roundness);
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

    // A birch crown is light and vertically layered rather than a dense broadleaf ball. The lower
    // foliage is eased outward and upward so flashes of white trunk remain visible through the crown.
    const crownProfile = 0.72 + Math.sin(normalizedY * Math.PI) * 0.28;
    const lowerOpening = 1 - smoothstep(0.08, 0.52, normalizedY);
    const width = birch.crownWidth * crownProfile * (1 + lowerOpening * 0.11);
    x *= width;
    z *= width;
    y = foliageBounds.minY + (y - foliageBounds.minY) * birch.crownHeight + source.height * birch.crownLift;

    // Small coherent bends keep silhouettes alive without making the tree look wind-blown at rest.
    const sway = Math.sin(normalizedY * 5.2 + birch.phase) * source.height * 0.017 * smoothstep(0.22, 1, normalizedY);
    x += sway;
    z += Math.cos(normalizedY * 4.6 + birch.phase) * sway * 0.58;
    foliagePosition.setXYZ(index, x, y, z);
  }
  foliagePosition.needsUpdate = true;
  foliage.computeVertexNormals();
  foliage.computeBoundingBox();
  foliage.computeBoundingSphere();

  // Metadata intentionally ignores far-only bole compensation so near/far culling and identity stay
  // deterministic. Perceptual LOD affects only a few pixels of trunk thickness at distance.
  return {
    bark,
    foliage,
    height: source.height * birch.height * birch.crownHeight,
    radius: source.radius * birch.crownWidth,
  };
}
