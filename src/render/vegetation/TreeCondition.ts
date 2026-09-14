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

/** Structural state is season-independent and is safe to use in cached morphology. */
export function resolveStructuralTreeCondition(
  family: TreeFamily,
  lifecycle: ResolvedTreeLifecycle,
): TreeVisualCondition {
  if (lifecycle.stage === 'fallen') return isDisturbanceFall(lifecycle) ? 'fallen-disturbance' : 'fallen-natural';
  if (lifecycle.stage === 'dead-standing') return 'dead-standing';
  if (lifecycle.stage === 'declining') return 'declining';
  if (lifecycle.stage === 'old' || family === 'ancient') return 'veteran';
  return 'healthy';
}

/**
 * Full presentation condition adds seasonal interpretation without overriding mortality or decline.
 * A healthy winter broadleaf is therefore never mistaken for a dead snag, while needle trees remain
 * explicitly evergreen through winter.
 */
export function resolveTreeVisualCondition(
  family: TreeFamily,
  lifecycle: ResolvedTreeLifecycle,
  month: number,
): TreeVisualCondition {
  const structural = resolveStructuralTreeCondition(family, lifecycle);
  if (structural !== 'healthy') return structural;
  if (treeSeason(month) === 'winter') return isEvergreenFamily(family) ? 'evergreen-winter' : 'winter-bare';
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
  birch: { threshold: 0.39, intactFloor: 0.7 },
  conifer: { threshold: 0.34, intactFloor: 0.66 },
  dry: { threshold: 0.38, intactFloor: 0.68 },
  riverbank: { threshold: 0.44, intactFloor: 0.7 },
  alpine: { threshold: 0.32, intactFloor: 0.64 },
  ancient: { threshold: 0.56, intactFloor: 0.74 },
};

const UPROOTING_THRESHOLD: Record<TreeFamily, number> = {
  cherry: 0.5,
  broadleaf: 0.54,
  birch: 0.48,
  conifer: 0.42,
  dry: 0.64,
  riverbank: 0.48,
  alpine: 0.52,
  ancient: 0.58,
};

/** Mirrors root-plate presentation so uprooted and snapped storm failures tell different stories. */
export function treeLikelyUprooted(family: TreeFamily, uprooting: number): boolean {
  return clamp01(uprooting) > UPROOTING_THRESHOLD[family];
}

/**
 * Fraction of original structural height retained after leader loss. A zero value means the tree
 * keeps its intact skeleton. Uprooted disturbance trees remain intact because the roots, not trunk,
 * failed. Dead-standing breakage ramps in with decayProgress so death itself never causes a pop.
 */
export function treeBarkBreakFraction(
  family: TreeFamily,
  condition: TreeVisualCondition,
  breakage: number,
  uprooted = false,
  decayProgress = 1,
): number {
  const damage = clamp01(breakage);
  const rule = DEAD_BREAK[family];
  if (condition === 'dead-standing') {
    if (damage < rule.threshold) return 0;
    const severity = (damage - rule.threshold) / Math.max(1e-6, 1 - rule.threshold);
    const target = 0.9 - severity * (0.9 - rule.intactFloor);
    const decay = clamp01(decayProgress);
    if (decay <= 0) return 0;
    return 1 - decay * (1 - target);
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

/** Event-driven height changes only; living age transitions remain on the continuous morphology curve. */
export function treeBarkHeightScale(condition: TreeVisualCondition): number {
  switch (condition) {
    case 'fallen-disturbance': return 0.96;
    case 'fallen-natural': return 0.97;
    default: return 1;
  }
}

/** Living foliage decline is already continuous in TreeMorphology; death/fall simply remove it. */
export function treeConditionFoliageVitality(condition: TreeVisualCondition): number {
  switch (condition) {
    case 'dead-standing':
    case 'fallen-natural':
    case 'fallen-disturbance': return 0;
    default: return 1;
  }
}
