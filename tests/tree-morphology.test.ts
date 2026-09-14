import { describe, expect, it } from 'vitest';
import { resolveTreeLifecycle, type ResolvedTreeLifecycle, type TreePlacement } from '../src/render/vegetation/ForestPlanner';
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

const morphologyValues = (tree: ReturnType<typeof resolveTreeMorphology>): number[] => [
  tree.trunkRadiusX, tree.trunkRadiusZ, tree.trunkHeight,
  tree.crownWidthX, tree.crownWidthZ, tree.crownHeight,
  tree.crownOffsetX, tree.crownOffsetZ, tree.crownLift,
  tree.leanX, tree.leanZ, tree.foliageDensity,
];

describe('Tree morphology', () => {
  it('derives stable biological traits independently of yaw', () => {
    const tree = placement();
    const first = resolveTreePhenotype('morphology', tree);
    const rotatedTree = { ...tree, rotation: Math.PI };
    const rotated = resolveTreePhenotype('morphology', rotatedTree);
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
      expect(phenotype.uprooting).toBeGreaterThanOrEqual(0);
      expect(phenotype.uprooting).toBeLessThanOrEqual(1);
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

  it('stays continuous across every living age-class boundary, including ancient veterans', () => {
    const trees = [
      placement({ family: 'cherry', lifespanYears: 70, establishedYear: 0 }),
      placement({ family: 'broadleaf', lifespanYears: 160, establishedYear: 0 }),
      placement({ id: 'ancient:continuity', family: 'ancient', lifespanYears: 700, establishedYear: 0 }),
    ];
    for (const tree of trees) {
      const phenotype = resolveTreePhenotype('continuity', tree);
      const veteranAge = Math.min(tree.id ? 55 : 90, tree.lifespanYears * 0.75);
      const boundaries = [15, 35, veteranAge, tree.lifespanYears * 0.82]
        .filter((value, index, values) => value > 0 && value < tree.lifespanYears && values.indexOf(value) === index);
      for (const boundary of boundaries) {
        const before = resolveTreeMorphology(phenotype, resolveTreeLifecycle(tree, boundary - 0.001));
        const after = resolveTreeMorphology(phenotype, resolveTreeLifecycle(tree, boundary + 0.001));
        const deltas = morphologyValues(before).map((value, index) => Math.abs(value - morphologyValues(after)[index]!));
        expect(Math.max(...deltas)).toBeLessThan(0.002);
      }
    }
  });

  it('reuses an unchanged tree form instead of allocating it on every LOD refresh', () => {
    const tree = placement({ establishedYear: 0 });
    const phenotype = resolveTreePhenotype('cache', tree);
    const state = resolveTreeLifecycle(tree, 40);
    const first = resolveTreeMorphology(phenotype, state);
    expect(resolveTreeMorphology(phenotype, { ...state })).toBe(first);
    expect(resolveTreeMorphology(phenotype, resolveTreeLifecycle(tree, 41))).not.toBe(first);
  });
});
