import { stableHash } from '../../sim/prng';
import { clamp01, smoothstep } from '../../sim/terrain/noise';
import type { ResolvedTreeLifecycle, TreePlacement } from './ForestPlanner';
import type { TreeFamily } from './TreeLibrary';
import {
  resolveStructuralTreeCondition,
  treeBarkBreakFraction,
  treeBarkHeightScale,
  treeConditionFoliageVitality,
  treeLikelyUprooted,
} from './TreeCondition';

/** Stable per-tree visual biology. These traits never consume simulation PRNG or depend on camera state. */
export interface TreePhenotype {
  family: TreeFamily;
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
  /** Stable presentation tendency for storm-felled trees to uproot rather than snap. */
  uprooting: number;
  /** Stable presentation tendency for old/dead/storm-damaged crowns to lose their leader. */
  breakage: number;
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
  birch: { lean: 0.052, crownOffset: 0.105, girth: [0.76, 1.02], stature: [0.98, 1.16], crownWidth: [0.8, 1.08], crownDepth: [0.96, 1.12] },
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
    family: tree.family,
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
    uprooting: trait(seed, tree, 'uprooting'),
    breakage: trait(seed, tree, 'breakage'),
  };
}

interface FormProfile {
  trunkRadius: number;
  trunkHeight: number;
  crownWidth: number;
  crownHeight: number;
  crownLift: number;
  asymmetry: number;
  foliage: number;
  lean: number;
}

const SEEDLING: FormProfile = {
  trunkRadius: 0.5, trunkHeight: 1.08, crownWidth: 0.48, crownHeight: 0.72,
  crownLift: 0.08, asymmetry: 0.42, foliage: 0.78, lean: 0.55,
};
const YOUNG: FormProfile = {
  trunkRadius: 0.68, trunkHeight: 1.03, crownWidth: 0.7, crownHeight: 0.86,
  crownLift: 0.05, asymmetry: 0.5, foliage: 0.9, lean: 0.78,
};
const MATURE: FormProfile = {
  trunkRadius: 0.95, trunkHeight: 1, crownWidth: 0.98, crownHeight: 1,
  crownLift: 0.015, asymmetry: 0.75, foliage: 1, lean: 1,
};
const VETERAN: FormProfile = {
  trunkRadius: 1.08, trunkHeight: 0.98, crownWidth: 1.08, crownHeight: 0.96,
  crownLift: -0.01, asymmetry: 1.05, foliage: 0.97, lean: 1,
};
const OLD: FormProfile = {
  trunkRadius: 1.2, trunkHeight: 0.94, crownWidth: 1.16, crownHeight: 0.88,
  crownLift: -0.02, asymmetry: 1.35, foliage: 0.9, lean: 1.02,
};
const SENESCENT: FormProfile = {
  trunkRadius: 1.26, trunkHeight: 0.88, crownWidth: 0.98, crownHeight: 0.74,
  crownLift: -0.025, asymmetry: 1.6, foliage: 0.5, lean: 1.05,
};

function blendProfile(from: FormProfile, to: FormProfile, amount: number): FormProfile {
  return {
    trunkRadius: lerp(from.trunkRadius, to.trunkRadius, amount),
    trunkHeight: lerp(from.trunkHeight, to.trunkHeight, amount),
    crownWidth: lerp(from.crownWidth, to.crownWidth, amount),
    crownHeight: lerp(from.crownHeight, to.crownHeight, amount),
    crownLift: lerp(from.crownLift, to.crownLift, amount),
    asymmetry: lerp(from.asymmetry, to.asymmetry, amount),
    foliage: lerp(from.foliage, to.foliage, amount),
    lean: lerp(from.lean, to.lean, amount),
  };
}

function fallbackProfile(lifecycle: ResolvedTreeLifecycle): FormProfile {
  switch (lifecycle.stage) {
    case 'sapling': return blendProfile(SEEDLING, YOUNG, smoothstep(0, 0.14, lifecycle.maturity));
    case 'young': return blendProfile(YOUNG, MATURE, smoothstep(0.1, 0.36, lifecycle.maturity));
    case 'mature': return blendProfile(MATURE, VETERAN, smoothstep(0.28, 0.72, lifecycle.maturity));
    case 'old': return blendProfile(VETERAN, OLD, smoothstep(0.62, 0.9, Math.max(0.68, lifecycle.maturity)));
    case 'declining': return blendProfile(OLD, SENESCENT, smoothstep(0.82, 1, lifecycle.maturity));
    case 'dead-standing': return { ...SENESCENT, foliage: 0 };
    case 'fallen': return { ...SENESCENT, trunkRadius: 1.16, trunkHeight: 0.96, crownWidth: 0.92, crownHeight: 0.8, foliage: 0 };
  }
}

/**
 * Use actual biological age when available so age-class labels never create a visible transform pop.
 * The named stages remain semantic; the silhouette follows one continuous growth/senescence curve.
 */
function stageProfile(lifecycle: ResolvedTreeLifecycle): FormProfile {
  if (lifecycle.stage === 'dead-standing') return { ...SENESCENT, foliage: 0 };
  if (lifecycle.stage === 'fallen') {
    return { ...SENESCENT, trunkRadius: 1.16, trunkHeight: 0.96, crownWidth: 0.92, crownHeight: 0.8, foliage: 0 };
  }
  const age = lifecycle.ageYears;
  const mortality = lifecycle.mortalityAge;
  const veteranAge = lifecycle.veteranAge;
  if (age === undefined || mortality === undefined || veteranAge === undefined) return fallbackProfile(lifecycle);

  const youngAge = Math.min(15, mortality * 0.25);
  const matureAge = Math.max(youngAge + 0.001, Math.min(35, mortality * 0.5));
  const veteran = Math.max(matureAge + 0.001, veteranAge);
  const declineAge = Math.max(veteran + 0.001, mortality * 0.82);

  if (age <= youngAge) return blendProfile(SEEDLING, YOUNG, smoothstep(0, youngAge, age));
  if (age <= matureAge) return blendProfile(YOUNG, MATURE, smoothstep(youngAge, matureAge, age));
  if (age <= veteran) return blendProfile(MATURE, VETERAN, smoothstep(matureAge, veteran, age));
  if (age <= declineAge) return blendProfile(VETERAN, OLD, smoothstep(veteran, declineAge, age));
  return blendProfile(OLD, SENESCENT, smoothstep(declineAge, mortality, age));
}

interface MorphologyCacheEntry {
  stage: ResolvedTreeLifecycle['stage'];
  maturity: number;
  ageYears: number | undefined;
  mortalityAge: number | undefined;
  veteranAge: number | undefined;
  value: TreeMorphology;
}

const MORPHOLOGY_CACHE = new WeakMap<TreePhenotype, MorphologyCacheEntry>();

/**
 * Age changes proportions, not only scale: juveniles are slender/narrow; veterans thicken, spread
 * and become asymmetrical; declining crowns contract before death. Condition then adds deterministic
 * deadwood/storm breakage without perturbing any living age-class boundary.
 */
export function resolveTreeMorphology(phenotype: TreePhenotype, lifecycle: ResolvedTreeLifecycle): TreeMorphology {
  const cached = MORPHOLOGY_CACHE.get(phenotype);
  if (cached
    && cached.stage === lifecycle.stage
    && cached.maturity === lifecycle.maturity
    && cached.ageYears === lifecycle.ageYears
    && cached.mortalityAge === lifecycle.mortalityAge
    && cached.veteranAge === lifecycle.veteranAge) return cached.value;

  const stage = stageProfile(lifecycle);
  const condition = resolveStructuralTreeCondition(phenotype.family, lifecycle);
  const uprooted = condition === 'fallen-disturbance' && treeLikelyUprooted(phenotype.family, phenotype.uprooting);
  const yearsDead = lifecycle.stage === 'dead-standing'
    && lifecycle.ageYears !== undefined
    && lifecycle.mortalityAge !== undefined
    ? Math.max(0, lifecycle.ageYears - lifecycle.mortalityAge)
    : 0;
  const deadwoodProgress = clamp01(yearsDead / 12);
  const breakFraction = treeBarkBreakFraction(
    phenotype.family,
    condition,
    phenotype.breakage,
    uprooted,
    deadwoodProgress,
  );
  const structuralHeight = treeBarkHeightScale(condition) * (breakFraction > 0 ? breakFraction : 1);
  const ellipse = phenotype.crownEllipticity;
  const asymmetry = stage.asymmetry;
  const value: TreeMorphology = {
    trunkRadiusX: stage.trunkRadius * phenotype.girth * (1 + ellipse * 0.18),
    trunkRadiusZ: stage.trunkRadius * phenotype.girth * (1 - ellipse * 0.18),
    trunkHeight: stage.trunkHeight * phenotype.stature * structuralHeight,
    crownWidthX: stage.crownWidth * phenotype.crownWidth * (1 + ellipse),
    crownWidthZ: stage.crownWidth * phenotype.crownWidth * (1 - ellipse),
    crownHeight: stage.crownHeight * phenotype.crownDepth * phenotype.stature * structuralHeight,
    crownOffsetX: phenotype.crownOffsetX * asymmetry,
    crownOffsetZ: phenotype.crownOffsetZ * asymmetry,
    crownLift: stage.crownLift,
    leanX: phenotype.leanX * stage.lean,
    leanZ: phenotype.leanZ * stage.lean,
    foliageDensity: clamp01(stage.foliage * phenotype.fullness * treeConditionFoliageVitality(condition)),
    fallAngle: Math.PI * (0.44 + phenotype.fallBias * 0.035),
  };
  MORPHOLOGY_CACHE.set(phenotype, {
    stage: lifecycle.stage,
    maturity: lifecycle.maturity,
    ageYears: lifecycle.ageYears,
    mortalityAge: lifecycle.mortalityAge,
    veteranAge: lifecycle.veteranAge,
    value,
  });
  return value;
}
