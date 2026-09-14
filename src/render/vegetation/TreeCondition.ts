import { clamp01 } from '../../sim/terrain/noise';
import { treeSeason, type ResolvedTreeLifecycle } from './ForestPlanner';
import type { TreeFamily } from './TreeLibrary';

export type TreeVisualCondition =
  | 'healthy'
  | 'winter-bare'
  | 'evergreen-winter'
  | 'veteran'
  | 'declining'
  | 'dead-standing'
  | 'fallen-natural'
  | 'fallen-disturbance';

export function isEvergreenFamily(family: TreeFamily): boolean {
  return family === 'conifer' || family === 'alpine';
}

/**
 * Presentation condition is derived only from authoritative lifecycle, family, season and retained
 * disturbance history. It never mutates simulation state and is stable across camera/LOD changes.
 */
export function resolveTreeVisualCondition(
  family: TreeFamily,
  lifecycle: ResolvedTreeLifecycle,
  month: number,
  disturbedYear?: number,
): TreeVisualCondition {
  if (lifecycle.stage === 'fallen') return disturbedYear === undefined ? 'fallen-natural' : 'fallen-disturbance';
  if (lifecycle.stage === 'dead-standing') return 'dead-standing';
  if (lifecycle.stage === 'declining') return 'declining';
  if (treeSeason(month) === 'winter') return isEvergreenFamily(family) ? 'evergreen-winter' : 'winter-bare';
  if (lifecycle.stage === 'old' || family === 'ancient') return 'veteran';
  return 'healthy';
}

/** Neutral instance tint multiplied by the family's authored bark colour. */
export function treeBarkConditionTint(condition: TreeVisualCondition): readonly [number, number, number] {
  switch (condition) {
    case 'winter-bare': return [0.95, 0.98, 1];
    case 'evergreen-winter': return [0.94, 0.98, 0.98];
    case 'veteran': return [0.94, 0.92, 0.88];
    case 'declining': return [0.92, 0.88, 0.82];
    case 'dead-standing': return [0.82, 0.84, 0.86];
    case 'fallen-natural': return [0.78, 0.76, 0.73];
    case 'fallen-disturbance': return [1, 0.92, 0.82];
    default: return [1, 1, 1];
  }
}

/**
 * Shader-side weathering desaturates old/dead wood without requiring separate materials. Values are
 * deliberately lower on fresh storm failures and highest on long-dead standing/fallen wood.
 */
export function treeBarkWeathering(condition: TreeVisualCondition, lifecycle: ResolvedTreeLifecycle): number {
  switch (condition) {
    case 'winter-bare': return 0.06;
    case 'evergreen-winter': return 0.04;
    case 'veteran': return 0.2;
    case 'declining': return 0.34;
    case 'fallen-disturbance': return 0.26;
    case 'fallen-natural': return 0.9;
    case 'dead-standing': {
      const yearsDead = lifecycle.ageYears !== undefined && lifecycle.mortalityAge !== undefined
        ? Math.max(0, lifecycle.ageYears - lifecycle.mortalityAge)
        : 8;
      return 0.68 + clamp01(yearsDead / 18) * 0.25;
    }
    default: return 0;
  }
}

/**
 * Fraction of local bark height retained before shader clipping creates a snapped leader. A zero
 * cutoff means the tree remains structurally intact. Uprooted storm trees stay intact by design.
 */
export function treeBarkBreakFraction(
  condition: TreeVisualCondition,
  breakage: number,
  uprooted = false,
): number {
  const damage = clamp01(breakage);
  if (condition === 'dead-standing') {
    if (damage < 0.42) return 0;
    return 0.9 - (damage - 0.42) * 0.28;
  }
  if (condition === 'fallen-disturbance') {
    if (uprooted) return 0;
    return 0.68 + (1 - damage) * 0.16;
  }
  if (condition === 'fallen-natural' && damage > 0.75) {
    return 0.82 - (damage - 0.75) * 0.28;
  }
  return 0;
}

export function treeBarkHeightScale(condition: TreeVisualCondition): number {
  switch (condition) {
    case 'veteran': return 0.99;
    case 'declining': return 0.985;
    case 'dead-standing': return 0.98;
    case 'fallen-disturbance': return 0.96;
    case 'fallen-natural': return 0.97;
    default: return 1;
  }
}

/** Living foliage vitality layered on top of seasonal phenology and age morphology. */
export function treeConditionFoliageVitality(condition: TreeVisualCondition): number {
  switch (condition) {
    case 'evergreen-winter': return 0.97;
    case 'veteran': return 0.94;
    case 'declining': return 0.78;
    case 'dead-standing':
    case 'fallen-natural':
    case 'fallen-disturbance': return 0;
    default: return 1;
  }
}

export function treeConditionFoliageTint(condition: TreeVisualCondition): readonly [number, number, number] {
  switch (condition) {
    case 'evergreen-winter': return [0.93, 0.99, 1.04];
    case 'veteran': return [0.96, 0.94, 0.9];
    case 'declining': return [0.92, 0.84, 0.74];
    default: return [1, 1, 1];
  }
}

/**
 * Dead conifers often retain a sparse brown needle mass for several years. Deciduous families never
 * use this path, keeping healthy winter-bare crowns visually distinct from true death.
 */
export function retainedDeadEvergreenCanopy(family: TreeFamily, lifecycle: ResolvedTreeLifecycle): number {
  if (!isEvergreenFamily(family) || lifecycle.stage !== 'dead-standing') return 0;
  const yearsDead = lifecycle.ageYears !== undefined && lifecycle.mortalityAge !== undefined
    ? Math.max(0, lifecycle.ageYears - lifecycle.mortalityAge)
    : 3;
  return 0.34 * (1 - clamp01(yearsDead / 9));
}

export function deadEvergreenFoliageColour(family: TreeFamily): readonly [number, number, number] {
  return family === 'alpine' ? [0.39, 0.36, 0.25] : [0.34, 0.29, 0.19];
}
