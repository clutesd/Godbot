import { describe, expect, it } from 'vitest';
import type { ResolvedTreeLifecycle, TreePlacement } from '../src/render/vegetation/ForestPlanner';
import {
  resolveStructuralTreeCondition,
  resolveTreeVisualCondition,
  treeBarkBreakFraction,
  treeConditionFoliageVitality,
  treeLikelyUprooted,
} from '../src/render/vegetation/TreeCondition';
import { resolveTreeMorphology, resolveTreePhenotype } from '../src/render/vegetation/TreeMorphology';
import type { TreeFamily } from '../src/render/vegetation/TreeLibrary';

const FAMILIES: readonly TreeFamily[] = ['cherry', 'broadleaf', 'conifer', 'dry', 'riverbank', 'alpine', 'ancient'];
const DECIDUOUS: readonly TreeFamily[] = ['cherry', 'broadleaf', 'dry', 'riverbank'];

const lifecycle = (overrides: Partial<ResolvedTreeLifecycle> = {}): ResolvedTreeLifecycle => ({
  stage: 'mature',
  scale: 2.5,
  foliageVisible: true,
  fallen: false,
  maturity: 0.5,
  ageYears: 50,
  mortalityAge: 140,
  veteranAge: 90,
  ...overrides,
});

const placement = (family: TreeFamily): TreePlacement => ({
  worldX: 4.25,
  worldZ: -8.5,
  y: 0,
  family,
  variant: 1,
  scale: 2.5,
  rotation: 0,
  age: 0.5,
  establishedYear: -40,
  lifespanYears: family === 'ancient' ? 700 : 140,
  regrowth: 0.8,
});

describe('Tree condition presentation', () => {
  it('separates healthy winter deciduous trees from evergreen winter trees and death', () => {
    for (const family of DECIDUOUS) {
      expect(resolveTreeVisualCondition(family, lifecycle(), 11)).toBe('winter-bare');
    }
    expect(resolveTreeVisualCondition('conifer', lifecycle(), 11)).toBe('evergreen-winter');
    expect(resolveTreeVisualCondition('alpine', lifecycle(), 11)).toBe('evergreen-winter');

    const dead = lifecycle({ stage: 'dead-standing', foliageVisible: false, maturity: 1, ageYears: 145 });
    for (const family of FAMILIES) {
      expect(resolveTreeVisualCondition(family, dead, 11)).toBe('dead-standing');
      expect(treeConditionFoliageVitality('dead-standing')).toBe(0);
    }
  });

  it('distinguishes disturbance falls from old-age fallen deadwood without camera state', () => {
    const disturbed = lifecycle({ stage: 'fallen', foliageVisible: false, fallen: true, maturity: 1,
      ageYears: 140, mortalityAge: 140 });
    const natural = lifecycle({ stage: 'fallen', foliageVisible: false, fallen: true, maturity: 1,
      ageYears: 166, mortalityAge: 140 });
    for (const family of FAMILIES) {
      expect(resolveStructuralTreeCondition(family, disturbed)).toBe('fallen-disturbance');
      expect(resolveStructuralTreeCondition(family, natural)).toBe('fallen-natural');
    }
  });

  it('uses family-specific snag rules and keeps uprooted storm trees structurally intact', () => {
    for (const family of FAMILIES) {
      expect(treeBarkBreakFraction(family, 'dead-standing', 1, false, 0)).toBe(0);
      const decayed = treeBarkBreakFraction(family, 'dead-standing', 1, false, 1);
      expect(decayed).toBeGreaterThanOrEqual(0.63);
      expect(decayed).toBeLessThan(0.91);

      const snapped = treeBarkBreakFraction(family, 'fallen-disturbance', 1, false, 1);
      const uprooted = treeBarkBreakFraction(family, 'fallen-disturbance', 1, true, 1);
      expect(snapped).toBeGreaterThan(0.55);
      expect(snapped).toBeLessThan(0.85);
      expect(uprooted).toBe(0);
    }
    expect(treeBarkBreakFraction('conifer', 'dead-standing', 1, false, 1))
      .toBeLessThan(treeBarkBreakFraction('ancient', 'dead-standing', 1, false, 1));
  });

  it('keeps root-failure identity family-aware', () => {
    expect(treeLikelyUprooted('conifer', 0.5)).toBe(true);
    expect(treeLikelyUprooted('dry', 0.5)).toBe(false);
    for (const family of FAMILIES) {
      expect(treeLikelyUprooted(family, 0)).toBe(false);
      expect(treeLikelyUprooted(family, 1)).toBe(true);
    }
  });

  it('lets deadwood decay alter silhouettes gradually across every family', () => {
    for (const family of FAMILIES) {
      const phenotype = { ...resolveTreePhenotype('condition-silhouette', placement(family)), breakage: 1 };
      const fresh = resolveTreeMorphology(phenotype, lifecycle({
        stage: 'dead-standing', foliageVisible: false, maturity: 1, ageYears: 140, mortalityAge: 140,
      }));
      const weathered = resolveTreeMorphology(phenotype, lifecycle({
        stage: 'dead-standing', foliageVisible: false, maturity: 1, ageYears: 152, mortalityAge: 140,
      }));
      expect(weathered.trunkHeight).toBeLessThan(fresh.trunkHeight);
      expect(weathered.foliageDensity).toBe(0);
    }
  });

  it('makes snapped and uprooted storm failures visibly different while preserving deterministic fall direction', () => {
    for (const family of FAMILIES) {
      const base = resolveTreePhenotype('storm-condition', placement(family));
      const state = lifecycle({ stage: 'fallen', foliageVisible: false, fallen: true, maturity: 1,
        ageYears: 140, mortalityAge: 140 });
      const snapped = resolveTreeMorphology({ ...base, breakage: 1, uprooting: 0 }, state);
      const uprooted = resolveTreeMorphology({ ...base, breakage: 1, uprooting: 1 }, state);
      expect(snapped.trunkHeight).toBeLessThan(uprooted.trunkHeight);
      expect(snapped.fallAngle).toBeCloseTo(uprooted.fallAngle, 12);
    }
  });
});
