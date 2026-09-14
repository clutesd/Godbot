import { stableHash } from '../../sim/prng';
import { clamp01, smoothstep } from '../../sim/terrain/noise';
import type { ResolvedTreeLifecycle, TreePlacement } from './ForestPlanner';
import type { TreeFamily } from './TreeLibrary';

/** Stable per-tree visual biology. These traits never consume simulation PRNG or depend on camera state. */
export interface TreePhenotype {
  stature: number;
  girth: number;
  crownWidth: number;
  crownDepth: number;
  crownEllipticity: number;
  crownOffsetX: number;
  crownOffsetZ: number;
  leanX: number;
  leanZ: number;
  fullness: number;
  pigment: number;
  phenology: number;
  stiffness: number;
  fallBias: number;
}

/** Per-instance proportions applied to the shared seeded skeleton. */
export interface TreeMorphology {
  trunkRadiusX: number;
  trunkRadiusZ: number;
  trunkHeight: number;
  crownWidthX: number;
  crownWidthZ: number;
  crownHeight: number;
  crownOffsetX: number;
  crownOffsetZ: number;
  crownLift: number;
  leanX: number;
  leanZ: number;
  foliageDensity: number;
  fallAngle: number;
}

interface FamilyMorphology {
  lean: number;
  crownOffset: number;
  girth: readonly [number, number];
  stature: readonly [number, number];
  crownWidth: readonly [number, number];
  crownDepth: readonly [number, number];
}

const FAMILY: Record<TreeFamily, FamilyMorphology> = {
  cherry: { lean: 0.055, crownOffset: 0.13, girth: [0.84, 1.16], stature: [0.9, 1.08], crownWidth: [0.82, 1.22], crownDepth: [0.9, 1.08] },
  broadleaf: { lean: 0.04, crownOffset: 0.12, girth: [0.84, 1.2], stature: [0.9, 1.12], crownWidth: [0.84, 1.2], crownDepth: [0.88, 1.12] },
  conifer: { lean: 0.025, crownOffset: 0.065, girth: [0.88, 1.14], stature: [0.92, 1.12], crownWidth: [0.86, 1.14], crownDepth: [0.94, 1.08] },
  dry: { lean: 0.075, crownOffset: 0.18, girth: [0.82, 1.22], stature: [0.86, 1.1], crownWidth: [0.78, 1.28], crownDepth: [0.84, 1.08] },
  riverbank: { lean: 0.085, crownOffset: 0.16, girth: [0.82, 1.18], stature: [0.9, 1.12], crownWidth: [0.82, 1.24], crownDepth: [0.92, 1.16] },
  alpine: { lean: 0.12, crownOffset: 0.11, girth: [0.9, 1.2], stature: [0.78, 1.02], crownWidth: [0.82, 1.18], crownDepth: [0.88, 1.06] },
  ancient: { lean: 0.055, crownOffset: 0.2, girth: [0.94, 1.28], stature: [0.94, 1.1], crownWidth: [0.9, 1.26], crownDepth: [0.88, 1.14] },
};

const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;

function trait(seed: string, tree: Pick<TreePlacement, 'family' | 'worldX' | 'worldZ' | 'id' | 'managedBy'>, channel: string): number {
  const identity = tree.id ?? tree.managedBy ?? 'wild';
  return stableHash(`${seed}:tree-phenotype:${tree.family}:${identity}:${channel}`,
    Math.round(tree.worldX * 100), Math.round(tree.worldZ * 100));
}

/**
 * Derive individuality from immutable placement identity instead of abusing yaw as a biology seed.
 * A replay, resume and LOD swap therefore preserve the exact same tree.
 */
export function resolveTreePhenotype(seed: string, tree: Pick<TreePlacement,
  'family' | 'worldX' | 'worldZ' | 'id' | 'managedBy'>): TreePhenotype {
  const family = FAMILY[tree.family];
  const width = trait(seed, tree, 'crown-width');
  const girth = trait(seed, tree, 'girth');
  const stature = trait(seed, tree, 'stature');
  const depth = trait(seed, tree, 'crown-depth');
  const asymmetry = trait(seed, tree, 'asymmetry');
  const offsetAngle = trait(seed, tree, 'offset-angle') * Math.PI * 2;
  const offsetMagnitude = family.crownOffset * (0.25 + asymmetry * 0.75);
  const leanAngle = trait(seed, tree, 'lean-angle') * Math.PI * 2;
  const leanMagnitude = family.lean * (0.2 + trait(seed, tree, 'lean-magnitude') * 0.8);
  return {
    stature: lerp(family.stature[0], family.stature[1], stature),
    girth: lerp(family.girth[0], family.girth[1], girth),
    crownWidth: lerp(family.crownWidth[0], family.crownWidth[1], width),
    crownDepth: lerp(family.crownDepth[0], family.crownDepth[1], depth),
    crownEllipticity: (trait(seed, tree, 'ellipticity') - 0.5) * 0.2,
    crownOffsetX: Math.cos(offsetAngle) * offsetMagnitude,
    crownOffsetZ: Math.sin(offsetAngle) * offsetMagnitude,
    leanX: Math.cos(leanAngle) * leanMagnitude,
    leanZ: Math.sin(leanAngle) * leanMagnitude,
    fullness: 0.88 + trait(seed, tree, 'fullness') * 0.18,
    pigment: trait(seed, tree, 'pigment'),
    phenology: trait(seed, tree, 'phenology'),
    stiffness: 0.72 + trait(seed, tree, 'stiffness') * 0.56,
    fallBias: trait(seed, tree, 'fall-bias') * 2 - 1,
  };
}

interface StageProfile {
  trunkRadius: number;
  trunkHeight: number;
  crownWidth: number;
  crownHeight: number;
  crownLift: number;
  asymmetry: number;
  foliage: number;
}

function stageProfile(lifecycle: ResolvedTreeLifecycle): StageProfile {
  const maturity = clamp01(lifecycle.maturity ?? 0.5);
  switch (lifecycle.stage) {
    case 'sapling': {
      const progress = smoothstep(0, 0.14, maturity);
      return {
        trunkRadius: lerp(0.5, 0.68, progress), trunkHeight: lerp(1.08, 1.03, progress),
        crownWidth: lerp(0.48, 0.7, progress), crownHeight: lerp(0.72, 0.86, progress),
        crownLift: lerp(0.08, 0.05, progress), asymmetry: 0.42, foliage: lerp(0.78, 0.9, progress),
      };
    }
    case 'young': {
      const progress = smoothstep(0.1, 0.36, maturity);
      return {
        trunkRadius: lerp(0.68, 0.9, progress), trunkHeight: 1.03,
        crownWidth: lerp(0.72, 0.94, progress), crownHeight: lerp(0.88, 0.98, progress),
        crownLift: 0.035, asymmetry: lerp(0.5, 0.72, progress), foliage: lerp(0.9, 1, progress),
      };
    }
    case 'mature': {
      const progress = smoothstep(0.28, 0.72, maturity);
      return {
        trunkRadius: lerp(0.92, 1.05, progress), trunkHeight: 1,
        crownWidth: lerp(0.96, 1.06, progress), crownHeight: lerp(1, 0.98, progress),
        crownLift: 0.015, asymmetry: lerp(0.75, 0.95, progress), foliage: 1,
      };
    }
    case 'old': {
      const progress = smoothstep(0.62, 0.9, Math.max(0.68, maturity));
      return {
        trunkRadius: lerp(1.08, 1.22, progress), trunkHeight: lerp(1, 0.95, progress),
        crownWidth: lerp(1.08, 1.16, progress), crownHeight: lerp(0.96, 0.88, progress),
        crownLift: -0.015, asymmetry: lerp(1.05, 1.35, progress), foliage: lerp(0.98, 0.9, progress),
      };
    }
    case 'declining': {
      const progress = smoothstep(0.82, 1, maturity);
      return {
        trunkRadius: lerp(1.18, 1.26, progress), trunkHeight: lerp(0.95, 0.88, progress),
        crownWidth: lerp(1.1, 0.98, progress), crownHeight: lerp(0.86, 0.74, progress),
        crownLift: -0.025, asymmetry: lerp(1.3, 1.6, progress), foliage: lerp(0.78, 0.5, progress),
      };
    }
    case 'dead-standing':
      return { trunkRadius: 1.24, trunkHeight: 0.82, crownWidth: 0.9, crownHeight: 0.72, crownLift: -0.04, asymmetry: 1.5, foliage: 0 };
    case 'fallen':
      return { trunkRadius: 1.16, trunkHeight: 0.96, crownWidth: 0.92, crownHeight: 0.8, crownLift: 0, asymmetry: 1.4, foliage: 0 };
  }
}

/**
 * Age changes proportions, not only scale: juveniles are slender/narrow; veterans thicken, spread
 * and become asymmetrical; declining crowns contract before death. Shared geometry remains instanced.
 */
export function resolveTreeMorphology(phenotype: TreePhenotype, lifecycle: ResolvedTreeLifecycle): TreeMorphology {
  const stage = stageProfile(lifecycle);
  const ellipse = phenotype.crownEllipticity;
  const asymmetry = stage.asymmetry;
  return {
    trunkRadiusX: stage.trunkRadius * phenotype.girth * (1 + ellipse * 0.18),
    trunkRadiusZ: stage.trunkRadius * phenotype.girth * (1 - ellipse * 0.18),
    trunkHeight: stage.trunkHeight * phenotype.stature,
    crownWidthX: stage.crownWidth * phenotype.crownWidth * (1 + ellipse),
    crownWidthZ: stage.crownWidth * phenotype.crownWidth * (1 - ellipse),
    crownHeight: stage.crownHeight * phenotype.crownDepth * phenotype.stature,
    crownOffsetX: phenotype.crownOffsetX * asymmetry,
    crownOffsetZ: phenotype.crownOffsetZ * asymmetry,
    crownLift: stage.crownLift,
    leanX: phenotype.leanX * (lifecycle.stage === 'sapling' ? 0.55 : lifecycle.stage === 'young' ? 0.78 : 1),
    leanZ: phenotype.leanZ * (lifecycle.stage === 'sapling' ? 0.55 : lifecycle.stage === 'young' ? 0.78 : 1),
    foliageDensity: clamp01(stage.foliage * phenotype.fullness),
    fallAngle: Math.PI * (0.44 + phenotype.fallBias * 0.035),
  };
}
