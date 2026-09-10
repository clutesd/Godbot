import { describe, expect, it } from 'vitest';
import { resolveFlowerGrowth } from '../src/render/vegetation/FlowerField';

describe('Flower lifecycle', () => {
  it('grows from spring sprouts into summer bloom and autumn seed', () => {
    expect(resolveFlowerGrowth(1).stage).toBe('sprout');
    expect(resolveFlowerGrowth(3).stage).toBe('bud');
    expect(resolveFlowerGrowth(5).stage).toBe('bloom');
    expect(resolveFlowerGrowth(8).stage).toBe('seed');
    expect(resolveFlowerGrowth(9.5).stage).toBe('senescent');
  });

  it('dies back completely in winter regardless of individual phase', () => {
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

  it('staggers emergence inside spring without allowing winter carryover', () => {
    expect(resolveFlowerGrowth(2.1, 0).stage).toBe('sprout');
    expect(resolveFlowerGrowth(2.1, 1).stage).toBe('bud');
    expect(resolveFlowerGrowth(10, 0).stage).toBe('dormant');
    expect(resolveFlowerGrowth(10, 1).stage).toBe('dormant');
  });

  it('senesces gradually instead of disappearing straight after bloom', () => {
    const summer = resolveFlowerGrowth(5);
    const earlyAutumn = resolveFlowerGrowth(8);
    const lateAutumn = resolveFlowerGrowth(9.5);
    expect(summer.bloom).toBe(1);
    expect(earlyAutumn.seed).toBeGreaterThan(0);
    expect(lateAutumn.seed).toBe(1);
    expect(lateAutumn.scale).toBeLessThan(earlyAutumn.scale);
  });
});
