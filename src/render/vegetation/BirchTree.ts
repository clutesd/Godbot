import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { type TreeLod, type TreeVariant as BaseTreeVariant } from './TreeLibraryBase';

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
    // Preserve a graceful tree, but keep the bole above the sub-pixel danger zone at documentary range.
    trunkWidth: random.range(0.84, 0.96),
    height: random.range(1.15, 1.24),
    crownWidth: random.range(0.7, 0.84),
    crownHeight: random.range(1.06, 1.15),
    crownLift: random.range(0.115, 0.165),
    phase: random.range(0, Math.PI * 2),
    bandPhase: random.range(0, Math.PI * 2),
  };
}

/**
 * Turn a separately cloned broadleaf skeleton into a recognisable birch without adding triangles.
 * The polished deciduous branch/canopy generator remains the source of truth; this adapter gives
 * birch a tall pale bole, fine silver scaffold, open lower crown and distance-safe bark identity.
 */
export function createBirchVariant(source: BaseTreeVariant, seed: string, variant: number, lod: TreeLod): BirchVariantGeometry {
  const birch = profile(seed, variant);
  const farSkeleton = lod.sides <= 3;
  const bark = source.bark.clone();
  const foliage = source.foliage.clone();

  const barkPosition = bark.getAttribute('position');
  const barkColour = bark.getAttribute('color');
  const barkBounds = { minY: 0, maxY: source.height, radius: source.radius };
  const ivory = new THREE.Color('#f5f1e8');
  const silver = new THREE.Color('#ded8cc');
  const twig = new THREE.Color('#847b6e');
  const charcoal = new THREE.Color('#45413c');
  const working = new THREE.Color();

  for (let index = 0; index < barkPosition.count; index += 1) {
    let x = barkPosition.getX(index);
    let y = barkPosition.getY(index);
    let z = barkPosition.getZ(index);
    const normalizedY = clamp01((y - barkBounds.minY) / Math.max(1e-4, barkBounds.maxY - barkBounds.minY));
    const radial = clamp01(Math.hypot(x, z) / barkBounds.radius);

    // Hold a readable lower/central bole for longer, then release naturally into the fine scaffold.
    // Far LOD receives stronger perceptual compensation only on the bole, never on crown metadata.
    const lowerBole = 1 - smoothstep(0.46, 0.84, normalizedY);
    const branchRelease = 1 - smoothstep(0.28, 0.65, normalizedY) * (1 - birch.crownWidth * 0.84);
    const bolePresence = 1 + lowerBole * 0.08 + (farSkeleton ? lowerBole * 0.14 : 0);
    x *= birch.trunkWidth * branchRelease * bolePresence;
    z *= birch.trunkWidth * branchRelease * bolePresence;
    y *= birch.height;
    barkPosition.setXYZ(index, x, y, z);

    // Keep the dominant bole a warm paper silver while the upper scaffold transitions through silver
    // into warm grey. Fine and broad markings operate at different viewing distances.
    const branchiness = Math.max(smoothstep(0.1, 0.5, radial) * smoothstep(0.2, 0.85, normalizedY),
      smoothstep(0.62, 0.95, normalizedY) * 0.8);
    working.copy(ivory).lerp(silver, normalizedY * 0.1 + branchiness * 0.24).lerp(twig, branchiness * 0.38);
    const angle = Math.atan2(z, x);
    const fineWave = 0.5 + 0.5 * Math.sin(normalizedY * 70 + angle * 1.35 + birch.bandPhase);
    const fineBand = Math.pow(fineWave, 12) * (1 - smoothstep(0.28, 0.58, radial)) * (0.055 + normalizedY * 0.075);
    const broadWave = 0.5 + 0.5 * Math.sin(normalizedY * 18 + angle * 0.72 + birch.bandPhase * 0.67);
    const broadBand = Math.pow(broadWave, 18) * (1 - smoothstep(0.2, 0.5, radial))
      * smoothstep(0.08, 0.82, normalizedY) * 0.15;
    working.lerp(charcoal, clamp01(fineBand + broadBand));

    // Pale bark loses form quickly in flat light, so retain a restrained curvature cue. The bole gets
    // bounded albedo compensation at distance; real lighting still shades it.
    const roundness = 0.965 + (0.5 + 0.5 * Math.cos(angle + birch.phase)) * 0.07;
    const boleSignal = (1 - smoothstep(0.5, 0.86, normalizedY)) * (1 - smoothstep(0.16, 0.46, radial));
    const distanceLift = farSkeleton ? 0.025 : 0;
    working.multiplyScalar(roundness * (1 + boleSignal * distanceLift));
    working.r = Math.min(0.98, working.r);
    working.g = Math.min(0.98, working.g);
    working.b = Math.min(0.98, working.b);
    barkColour.setXYZ(index, working.r, working.g, working.b);
  }
  barkPosition.needsUpdate = true;
  barkColour.needsUpdate = true;
  bark.computeVertexNormals();
  bark.computeBoundingBox();
  bark.computeBoundingSphere();

  for (const name of ['position', 'canopyAnchor']) {
    const foliagePosition = foliage.getAttribute(name);
    if (!foliagePosition) continue;
    const foliageBounds = { minY: source.height * 0.26, maxY: source.height, radius: source.radius };
    const span = Math.max(1e-4, foliageBounds.maxY - foliageBounds.minY);
    for (let index = 0; index < foliagePosition.count; index += 1) {
      let x = foliagePosition.getX(index);
      let y = foliagePosition.getY(index);
      let z = foliagePosition.getZ(index);
      const normalizedY = clamp01((y - foliageBounds.minY) / span);

      // Birch crowns should frame their pale stems, not bury them. Lower foliage is pushed outward and
      // slightly upward, producing windows through which the bole remains visible in a mixed stand.
      const crownProfile = 0.68 + Math.sin(normalizedY * Math.PI) * 0.32;
      const lowerOpening = 1 - smoothstep(0.12, 0.58, normalizedY);
      const width = birch.crownWidth * crownProfile * (1 + lowerOpening * 0.18);
      x *= width;
      z *= width;
      y = foliageBounds.minY + (y - foliageBounds.minY) * birch.crownHeight
        + source.height * (birch.crownLift + lowerOpening * 0.035);

      // Small coherent bends keep silhouettes alive without making the tree look permanently wind-blown.
      const sway = Math.sin(normalizedY * 5.2 + birch.phase) * source.height * 0.018 * smoothstep(0.22, 1, normalizedY);
      x += sway;
      z += Math.cos(normalizedY * 4.6 + birch.phase) * sway * 0.58;
      foliagePosition.setXYZ(index, x, y, z);
    }
    foliagePosition.needsUpdate = true;
  }
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
