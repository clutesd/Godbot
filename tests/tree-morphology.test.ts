import { describe, expect, it } from 'vitest';
import type { ResolvedTreeLifecycle, TreePlacement } from '../src/render/vegetation/ForestPlanner';
import { resolveTreeMorphology, resolveTreePhenotype } from '../src/render/vegetation/TreeMorphology';

const placement = (overrides: Partial<TreePlacement> = {}): TreePlacement => ({
  worldX: 4.25,
  worldZ: -8.5,
  y: 0,
  family: 'broadleaf',
  variant: 1,
  scale: 2.5,
  rotation: 0,
  age: 0.5,
  establishedYear: -40,
  lifespanYears: 160,
  regrowth: 0.8,
  ...overrides,
});

const lifecycle = (overrides: Partial<ResolvedTreeLifecycle> = {}): ResolvedTreeLifecycle => ({
  stage: 'mature',
  scale: 2.5,
  foliageVisible: true,
  fallen: false,
  maturity: 0.5,
  ...overrides,
});

describe('Tree morphology', () => {
  it('derives stable biological traits independently of yaw', () => {
    const tree = placement();
    const first = resolveTreePhenotype('morphology', tree);
    const rotated = resolveTreePhenotype('morphology', { ...tree, rotation: Math.PI });
    expect(rotated).toEqual(first);
    expect(resolveTreePhenotype('morphology', placement({ worldX: 4.35 }))).not.toEqual(first);
  });

  it('keeps phenotype ranges biologically restrained', () => {
    for (const family of ['cherry', 'broadleaf', 'conifer', 'dry', 'riverbank', 'alpine', 'ancient'] as const) {
      const phenotype = resolveTreePhenotype('ranges', placement({ family }));
      expect(phenotype.stature).toBeGreaterThan(0.75);
      expect(phenotype.stature).toBeLessThan(1.15);
      expect(phenotype.girth).toBeGreaterThan(0.8);
      expect(phenotype.girth).toBeLessThan(1.3);
      expect(phenotype.crownWidth).toBeGreaterThan(0.75);
      expect(phenotype.crownWidth).toBeLessThan(1.3);
      expect(Math.hypot(phenotype.leanX, phenotype.leanZ)).toBeLessThan(0.13);
      expect(phenotype.pigment).toBeGreaterThanOrEqual(0);
      expect(phenotype.pigment).toBeLessThanOrEqual(1);
      expect(phenotype.phenology).toBeGreaterThanOrEqual(0);
      expect(phenotype.phenology).toBeLessThanOrEqual(1);
    }
  });

  it('changes silhouette with age instead of only uniformly scaling an adult tree', () => {
    const phenotype = resolveTreePhenotype('age-form', placement());
    const sapling = resolveTreeMorphology(phenotype, lifecycle({ stage: 'sapling', maturity: 0.05 }));
    const mature = resolveTreeMorphology(phenotype, lifecycle({ stage: 'mature', maturity: 0.5 }));
    const old = resolveTreeMorphology(phenotype, lifecycle({ stage: 'old', maturity: 0.8 }));
    const declining = resolveTreeMorphology(phenotype, lifecycle({ stage: 'declining', maturity: 0.95 }));

    expect(sapling.trunkRadiusX).toBeLessThan(mature.trunkRadiusX);
    expect(sapling.crownWidthX).toBeLessThan(mature.crownWidthX);
    expect(old.trunkRadiusX).toBeGreaterThan(mature.trunkRadiusX);
    expect(old.crownWidthX).toBeGreaterThan(mature.crownWidthX);
    expect(declining.crownHeight).toBeLessThan(old.crownHeight);
    expect(declining.foliageDensity).toBeLessThan(old.foliageDensity);
  });

  it('keeps individual asymmetry and fall direction deterministic across lifecycle stages', () => {
    const phenotype = resolveTreePhenotype('identity', placement());
    const mature = resolveTreeMorphology(phenotype, lifecycle());
    const old = resolveTreeMorphology(phenotype, lifecycle({ stage: 'old', maturity: 0.8 }));
    const fallen = resolveTreeMorphology(phenotype, lifecycle({ stage: 'fallen', maturity: 1, foliageVisible: false, fallen: true }));

    expect(Math.sign(old.crownOffsetX)).toBe(Math.sign(mature.crownOffsetX));
    expect(Math.sign(old.crownOffsetZ)).toBe(Math.sign(mature.crownOffsetZ));
    expect(Math.abs(old.crownOffsetX)).toBeGreaterThanOrEqual(Math.abs(mature.crownOffsetX) - 1e-9);
    expect(Math.abs(old.crownOffsetZ)).toBeGreaterThanOrEqual(Math.abs(mature.crownOffsetZ) - 1e-9);
    expect(fallen.fallAngle).toBeGreaterThan(Math.PI * 0.4);
    expect(fallen.fallAngle).toBeLessThan(Math.PI * 0.5);
  });
});