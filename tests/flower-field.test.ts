import { describe, expect, it } from 'vitest';
import { resolveFlowerGrowth } from '../src/render/vegetation/FlowerField';

describe('Flower growth cycle', () => {
  it('dies back completely through winter', () => {
    expect(resolveFlowerGrowth(0).stage).toBe('dormant');
    expect(resolveFlowerGrowth(0).visible).toBe(false);
    expect(resolveFlowerGrowth(11).visible).toBe(false);
  });

  it('progresses from spring growth into bloom', () => {
    expect(resolveFlowerGrowth(1.5).stage).toBe('sprout');
    expect(resolveFlowerGrowth(2.6).stage).toBe('bud');
    const summer = resolveFlowerGrowth(5);
    expect(summer.stage).toBe('bloom');
    expect(summer.bloom).toBe(1);
    expect(summer.scale).toBeGreaterThan(0.8);
  });

  it('sets seed and senesces before winter dormancy', () => {
    const seed = resolveFlowerGrowth(8);
    expect(seed.stage).toBe('seed');
    expect(seed.seed).toBeGreaterThan(0);
    expect(resolveFlowerGrowth(9.4).stage).toBe('senescent');
    expect(resolveFlowerGrowth(10.2).stage).toBe('dormant');
  });

  it('uses small deterministic phase offsets without allowing midwinter growth', () => {
    expect(resolveFlowerGrowth(0, 0).visible).toBe(false);
    expect(resolveFlowerGrowth(0, 1).visible).toBe(false);
    expect(resolveFlowerGrowth(4.5, 0.2).stage).toBe('bloom');
    expect(resolveFlowerGrowth(4.5, 0.8).stage).toBe('bloom');
  });
});
