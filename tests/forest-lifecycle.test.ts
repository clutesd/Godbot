import { describe, expect, it } from 'vitest';
import {
  resolveForestSuccession,
  resolveTreeLifecycle,
  treeSeason,
  type TreePlacement,
} from '../src/render/vegetation/ForestPlanner';

function tree(overrides: Partial<TreePlacement> = {}): TreePlacement {
  return {
    worldX: 0,
    worldZ: 0,
    y: 0,
    family: 'broadleaf',
    variant: 0,
    scale: 2.5,
    rotation: 0,
    age: 0,
    establishedYear: 0,
    lifespanYears: 120,
    regrowth: 0.8,
    ...overrides,
  };
}

describe('Forest lifecycle', () => {
  it('uses sparse, deterministic age-class transitions', () => {
    const placement = tree();
    expect(resolveTreeLifecycle(placement, 5).stage).toBe('sapling');
    expect(resolveTreeLifecycle(placement, 15).stage).toBe('young');
    expect(resolveTreeLifecycle(placement, 35).stage).toBe('mature');
    expect(resolveTreeLifecycle(placement, 90).stage).toBe('old');
  });

  it('leaves deadwood after deterministic mortality', () => {
    const placement = tree({ lifespanYears: 100 });
    expect(resolveTreeLifecycle(placement, 100).stage).toBe('dead-standing');
    expect(resolveTreeLifecycle(placement, 122).stage).toBe('fallen');
    expect(resolveTreeLifecycle(placement, 100).foliageVisible).toBe(false);
  });

  it('re-establishes ordinary forest slots as a new generation', () => {
    const placement = tree({ lifespanYears: 100, regrowth: 0.8 });
    expect(resolveTreeLifecycle(placement, 128).stage).toBe('fallen');
    expect(resolveTreeLifecycle(placement, 129).stage).toBe('sapling');
    expect(resolveTreeLifecycle(placement, 144).stage).toBe('young');
  });

  it('maps seasonal display phases, including the cherry blossom spring', () => {
    expect(treeSeason(0)).toBe('winter');
    expect(treeSeason(2)).toBe('spring');
    expect(treeSeason(5)).toBe('summer');
    expect(treeSeason(8)).toBe('autumn');
  });

  it('regenerates disturbed woodland in coarse regional stages', () => {
    expect(resolveForestSuccession(0, 0.8)).toBe('cleared');
    expect(resolveForestSuccession(8, 0.8)).toBe('regrowth');
    expect(resolveForestSuccession(22, 0.8)).toBe('young-woodland');
    expect(resolveForestSuccession(80, 0.8)).toBe('mature-forest');
  });

  it('preserves an ancient tree through ordinary clearing mortality', () => {
    const ancient = tree({ id: 'tree:seed:1', family: 'ancient', lifespanYears: 600 });
    expect(resolveTreeLifecycle(ancient, 80, true).stage).toBe('old');
    expect(ancient.id).toBe('tree:seed:1');
  });

  it('does not recycle a stable significant-tree identity into a new individual', () => {
    const ancient = tree({ id: 'tree:seed:2', family: 'ancient', lifespanYears: 100, regrowth: 1 });
    expect(resolveTreeLifecycle(ancient, 200).stage).toBe('fallen');
  });
});
