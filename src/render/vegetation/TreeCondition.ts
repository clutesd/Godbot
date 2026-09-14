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

/** Disturbance falls are emitted by the lifecycle resolver at the effective mortality age. */
function isDisturbanceFall(lifecycle: ResolvedTreeLifecycle): boolean {
  return lifecycle.stage === 'fallen'
    && lifecycle.ageYears !== undefined
    && lifecycle.mortalityAge !== undefined
    && lifecycle.ageYears <= lifecycle.mortalityAge + 1e-6;
}

/**
 * Presentation condition is derived only from authoritative lifecycle, family and season. It never
 * mutates simulation state and remains stable across camera/LOD changes and replay.
 */
export function resolveTreeVisualCondition(
  family: TreeFamily,
  lifecycle: ResolvedTreeLifecycle,
  month: number,
): TreeVisualCondition {
  if (lifecycle.stage === 'fallen') return isDisturbanceFall(lifecycle) ? 'fallen-disturbance' : 'fallen-natural';
  if (lifecycle.stage === 'dead-standing') return 'dead-standing';
  if (lifecycle.stage === 'declining') return 'declining';
  if (treeSeason(month) === 'winter') return isEvergreenFamily(family) ? 'evergreen-winter' : 'winter-bare';
  if (lifecycle.stage === 'old' || family === 'ancient') return 'veteran';
  return 'healthy';
}

interface BreakRule {
  threshold: number;
  intactFloor: number;
}

/** Family structure matters: upright needle trees lose leaders more readily than massive veterans. */
const DEAD_BREAK: Record<TreeFamily, BreakRule> = {
  cherry: { threshold: 0.48, intactFloor: 0.75 },
  broadleaf: { threshold: 0.42, intactFloor: 0.72 },
  conifer: { threshold: 0.34, intactFloor: 0.66 },
  dry: { threshold: 0.38, intactFloor: 0.68 },
  riverbank: { threshold: 0.44, intactFloor: 0.7 },
  alpine: { threshold: 0.32, intactFloor: 0.64 },
  ancient: { threshold: 0.56, intactFloor: 0.74 },
};

/**
 * Fraction of original structural height retained after leader loss. A zero value means the tree
 * keeps its intact skeleton. Uprooted disturbance trees remain intact because the roots, not trunk,
 * failed. The renderer can later use the same value for true shader clipping; morphology already
 * uses it to distinguish snag/broken silhouettes without adding geometry or draw calls.
 */
export function treeBarkBreakFraction(
  family: TreeFamily,
  condition: TreeVisualCondition,
  breakage: number,
  uprooted = false,
): number {
  const damage = clamp01(breakage);
  const rule = DEAD_BREAK[family];
  if (condition === 'dead-standing') {
    if (damage < rule.threshold) return 0;
    const severity = (damage - rule.threshold) / Math.max(1e-6, 1 - rule.threshold);
    return 0.9 - severity * (0.9 - rule.intactFloor);
  }
  if (condition === 'fallen-disturbance') {
    if (uprooted) return 0;
    const familyFloor = Math.max(0.58, rule.intactFloor - 0.08);
    return 0.84 - damage * (0.84 - familyFloor);
  }
  if (condition === 'fallen-natural' && damage > 0.76) {
    return 0.84 - (damage - 0.76) / 0.24 * 0.1;
  }
  return 0;
}

/** Small whole-structure adjustments preserve identity while making condition readable. */
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

/** Living foliage vitality layered on top of seasonal phenology and continuous age morphology. */
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

/** Relative crown width response to condition; dead/fallen values affect branch silhouette only. */
export function treeConditionCrownSpread(condition: TreeVisualCondition, family: TreeFamily): number {
  switch (condition) {
    case 'veteran': return family === 'ancient' ? 1.06 : 1.025;
    case 'declining': return family === 'riverbank' ? 0.94 : 0.96;
    case 'dead-standing': return isEvergreenFamily(family) ? 0.84 : 0.9;
    case 'fallen-natural': return 0.91;
    case 'fallen-disturbance': return 0.94;
    default: return 1;
  }
}
