import { describe, expect, it } from 'vitest';
import { flowerDistanceScale, resolveFlowerGrowth } from '../src/render/vegetation/FlowerField';

describe('Flower growth cycle', () => {
  it('does not pop in size or bloom at lifecycle boundaries', () => {
    for (const month of [2.1, 3.2, 6.8, 8.8]) {
      const before = resolveFlowerGrowth(month - 0.0001);
      const after = resolveFlowerGrowth(month + 0.0001);
      expect(Math.abs(after.scale - before.scale)).toBeLessThan(0.001);
      expect(Math.abs(after.bloom - before.bloom)).toBeLessThan(0.001);
    }
  });
  it('dies back completely through winter for every phase offset', () => {
    for (const month of [0, 10, 11, 12, 22, 23]) {
      for (const phase of [0, 0.5, 1]) {
        const state = resolveFlowerGrowth(month, phase);
        expect(state.stage).toBe('dormant');
        expect(state.visible).toBe(false);
        expect(state.scale).toBe(0);
        expect(state.bloom).toBe(0);
      }
    }
  });

  it('progresses from spring growth into summer bloom', () => {
    expect(resolveFlowerGrowth(1.5).stage).toBe('sprout');
    expect(resolveFlowerGrowth(2.6).stage).toBe('bud');
    const summer = resolveFlowerGrowth(5);
    expect(summer.stage).toBe('bloom');
    expect(summer.bloom).toBe(1);
    expect(summer.scale).toBeGreaterThan(0.8);
  });

  it('sets seed and senesces gradually before winter dormancy', () => {
    const earlyAutumn = resolveFlowerGrowth(8);
    const lateAutumn = resolveFlowerGrowth(9.4);
    expect(earlyAutumn.stage).toBe('seed');
    expect(earlyAutumn.seed).toBeGreaterThan(0);
    expect(lateAutumn.stage).toBe('senescent');
    expect(lateAutumn.seed).toBe(1);
    expect(lateAutumn.scale).toBeLessThan(earlyAutumn.scale);
    expect(resolveFlowerGrowth(10.2).stage).toBe('dormant');
  });

  it('uses deterministic phase offsets only inside the growing season', () => {
    expect(resolveFlowerGrowth(2.1, 0).stage).toBe('sprout');
    expect(resolveFlowerGrowth(2.1, 1).stage).toBe('bud');
    expect(resolveFlowerGrowth(4.5, 0.2).stage).toBe('bloom');
    expect(resolveFlowerGrowth(4.5, 0.8).stage).toBe('bloom');
    expect(resolveFlowerGrowth(10, 0).visible).toBe(false);
    expect(resolveFlowerGrowth(10, 1).visible).toBe(false);
  });

  it('keeps flowers readable through documentary framing before fading them out', () => {
    for (const distance of [0, 13, 31, 45, 62, 66, 68]) {
      expect(flowerDistanceScale(distance)).toBe(1);
    }
    expect(flowerDistanceScale(79)).toBeGreaterThan(0);
    expect(flowerDistanceScale(79)).toBeLessThan(1);
    expect(flowerDistanceScale(90)).toBe(0);
    expect(flowerDistanceScale(200)).toBe(0);
  });
});
