import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import {
  buildTreeLibrary as buildBaseTreeLibrary,
  TREE_LOD_FAR,
  TREE_LOD_NEAR,
  speciesFoliageColour,
  type TreeFamily,
  type TreeLod,
  type TreeVariant,
} from './TreeLibraryBase';

export { TREE_LOD_FAR, TREE_LOD_NEAR, speciesFoliageColour };
export type { TreeFamily, TreeLod, TreeVariant };

type Range = readonly [number, number];

interface CrownRhythmGrammar {
  width: Range;
  depthBias: Range;
  height: Range;
  offset: Range;
  lobeStrength: Range;
  lobeCount: readonly [number, number];
  topVariation: Range;
  notchDepth: Range;
  notchWidth: Range;
}

/**
 * Whole-crown silhouette grammar layered over the branch-anchored canopy generator. The underlying
 * library controls local leaf masses and gaps; this pass makes entire crowns differ in width,
 * height, lobing and directional balance so a stand stops averaging into one hedge-like skyline.
 */
const CROWN_RHYTHM: Record<TreeFamily, CrownRhythmGrammar> = {
  cherry: {
    width: [1.01, 1.14], depthBias: [-0.09, 0.1], height: [0.98, 1.08], offset: [0.015, 0.055],
    lobeStrength: [0.055, 0.13], lobeCount: [3, 5], topVariation: [-0.035, 0.035],
    notchDepth: [0, 0.07], notchWidth: [0.18, 0.34],
  },
  broadleaf: {
    width: [1.01, 1.12], depthBias: [-0.08, 0.08], height: [1, 1.1], offset: [0.012, 0.05],
    lobeStrength: [0.045, 0.105], lobeCount: [4, 6], topVariation: [-0.02, 0.05],
    notchDepth: [0, 0.05], notchWidth: [0.16, 0.3],
  },
  conifer: {
    width: [1, 1.08], depthBias: [-0.04, 0.04], height: [1, 1.08], offset: [0.004, 0.022],
    lobeStrength: [0.015, 0.045], lobeCount: [5, 7], topVariation: [-0.01, 0.02],
    notchDepth: [0, 0.018], notchWidth: [0.12, 0.22],
  },
  dry: {
    width: [1.04, 1.18], depthBias: [-0.12, 0.12], height: [0.98, 1.05], offset: [0.025, 0.075],
    lobeStrength: [0.07, 0.15], lobeCount: [3, 5], topVariation: [-0.055, 0.018],
    notchDepth: [0.04, 0.12], notchWidth: [0.22, 0.4],
  },
  riverbank: {
    width: [1, 1.1], depthBias: [-0.08, 0.08], height: [1.02, 1.13], offset: [0.02, 0.065],
    lobeStrength: [0.05, 0.11], lobeCount: [3, 5], topVariation: [-0.03, 0.025],
    notchDepth: [0, 0.06], notchWidth: [0.18, 0.34],
  },
  alpine: {
    width: [1, 1.1], depthBias: [-0.06, 0.06], height: [1, 1.07], offset: [0.012, 0.045],
    lobeStrength: [0.025, 0.07], lobeCount: [4, 6], topVariation: [-0.02, 0.02],
    notchDepth: [0.01, 0.06], notchWidth: [0.16, 0.3],
  },
  ancient: {
    width: [1.05, 1.2], depthBias: [-0.13, 0.13], height: [1, 1.09], offset: [0.035, 0.095],
    lobeStrength: [0.08, 0.17], lobeCount: [3, 5], topVariation: [-0.05, 0.05],
    notchDepth: [0.05, 0.14], notchWidth: [0.24, 0.44],
  },
};

interface CrownRhythmProfile {
  widthX: number;
  widthZ: number;
  height: number;
  offsetX: number;
  offsetZ: number;
  lobeStrength: number;
  lobeCount: number;
  lobePhase: number;
  topVariation: number;
  topPhase: number;
  notchDepth: number;
  notchAngle: number;
  notchWidth: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const angularDistance = (a: number, b: number): number => {
  const difference = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(difference, Math.PI * 2 - difference);
};

function rhythmProfile(seed: string, family: TreeFamily, variant: number): CrownRhythmProfile {
  const grammar = CROWN_RHYTHM[family];
  const random = new SeededRandom(`${seed}:crown-rhythm:${family}:${variant}`);
  const width = random.range(grammar.width[0], grammar.width[1]);
  const depthBias = random.range(grammar.depthBias[0], grammar.depthBias[1]);
  const offsetMagnitude = random.range(grammar.offset[0], grammar.offset[1]);
  const offsetAngle = random.range(0, Math.PI * 2);
  return {
    widthX: width * (1 + depthBias),
    widthZ: width * (1 - depthBias),
    height: random.range(grammar.height[0], grammar.height[1]),
    offsetX: Math.cos(offsetAngle) * offsetMagnitude,
    offsetZ: Math.sin(offsetAngle) * offsetMagnitude,
    lobeStrength: random.range(grammar.lobeStrength[0], grammar.lobeStrength[1]),
    lobeCount: random.int(grammar.lobeCount[0], grammar.lobeCount[1] + 1),
    lobePhase: random.range(0, Math.PI * 2),
    topVariation: random.range(grammar.topVariation[0], grammar.topVariation[1]),
    topPhase: random.range(0, Math.PI * 2),
    notchDepth: random.range(grammar.notchDepth[0], grammar.notchDepth[1]),
    notchAngle: random.range(0, Math.PI * 2),
    notchWidth: random.range(grammar.notchWidth[0], grammar.notchWidth[1]),
  };
}

function foliageBounds(geometry: THREE.BufferGeometry): { minY: number; maxY: number; radius: number } {
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
  return { minY, maxY, radius };
}

function applyCrownRhythm(tree: TreeVariant, profile: CrownRhythmProfile): void {
  const position = tree.foliage.getAttribute('position');
  if (position.count === 0) return;
  const bounds = foliageBounds(tree.foliage);
  const verticalSpan = Math.max(1e-4, bounds.maxY - bounds.minY);
  const baseRadius = Math.max(1e-4, bounds.radius);

  for (let index = 0; index < position.count; index += 1) {
    let x = position.getX(index);
    let y = position.getY(index);
    let z = position.getZ(index);
    const normalizedY = clamp01((y - bounds.minY) / verticalSpan);
    const radius = Math.hypot(x, z);
    const radial = clamp01(radius / baseRadius);
    const angle = Math.atan2(z, x);

    // Lobing grows toward the crown perimeter and breaks the smooth hedge-like outline.
    const lobe = 1 + Math.sin(angle * profile.lobeCount + profile.lobePhase)
      * profile.lobeStrength * smoothstep(0.22, 0.92, radial);
    x *= profile.widthX * lobe;
    z *= profile.widthZ * lobe;

    // High foliage carries more directional bias, producing off-centre crowns without detaching the
    // lower canopy from its supporting branches.
    const bias = smoothstep(0.12, 0.92, normalizedY);
    x += profile.offsetX * tree.height * bias;
    z += profile.offsetZ * tree.height * bias;

    // Gentle azimuth-dependent crown height creates peaks and dips instead of a level tree-line.
    const topWeight = smoothstep(0.5, 1, normalizedY);
    const topWave = Math.sin(angle * 2 + profile.topPhase) * profile.topVariation * tree.height * topWeight;
    y = bounds.minY + (y - bounds.minY) * profile.height + topWave;

    // Dry/ancient crowns can carry a stable missing sector, while healthy families keep this subtle.
    if (profile.notchDepth > 0 && angularDistance(angle, profile.notchAngle) < profile.notchWidth) {
      const notch = 1 - profile.notchDepth * smoothstep(0.45, 1, normalizedY) * smoothstep(0.3, 1, radial);
      x *= notch;
      z *= notch;
      y -= profile.notchDepth * tree.height * 0.35 * smoothstep(0.55, 1, normalizedY);
    }

    position.setXYZ(index, x, y, z);
  }

  position.needsUpdate = true;
  tree.foliage.computeVertexNormals();
  tree.foliage.computeBoundingBox();
  tree.foliage.computeBoundingSphere();

  // Keep metadata deterministic and identical across near/far tiers. The values are conservative so
  // culling never clips a lobe or an offset crown even though the two LOD geometries differ.
  const horizontal = Math.max(profile.widthX, profile.widthZ) * (1 + Math.abs(profile.lobeStrength));
  const offset = Math.hypot(profile.offsetX, profile.offsetZ) * tree.height;
  tree.radius = tree.radius * horizontal + offset;
  tree.height = tree.height * profile.height + Math.abs(profile.topVariation) * tree.height;
}

/**
 * Build the existing deterministic tree library, then add whole-crown rhythm without changing the
 * branch, leaf-site or triangle budgets. Near and far tiers use the same profile for every variant.
 */
export function buildTreeLibrary(seed: string, variantsPerFamily: number, lod: TreeLod): Map<TreeFamily, TreeVariant[]> {
  const library = buildBaseTreeLibrary(seed, variantsPerFamily, lod);
  for (const [family, variants] of library) {
    for (let variant = 0; variant < variants.length; variant += 1) {
      const tree = variants[variant];
      if (!tree) continue;
      applyCrownRhythm(tree, rhythmProfile(seed, family, variant));
    }
  }
  return library;
}
