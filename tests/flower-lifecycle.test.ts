import { describe, expect, it } from 'vitest';
import { resolveFlowerSeason } from '../src/render/terrain/TerrainDecor';

describe('Flower lifecycle', () => {
  it('grows from spring sprouts into summer bloom and autumn seed', () => {
    expect(resolveFlowerSeason(1).stage).toBe('sprout');
    expect(resolveFlowerSeason(3).stage).toBe('bud');
    expect(resolveFlowerSeason(5).stage).toBe('bloom');
    expect(resolveFlowerSeason(8).stage).toBe('seed');
  });

  it('dies back completely in winter', () => {
    for (const month of [0, 10, 11, 12, 22, 23]) {
      const state = resolveFlowerSeason(month, -0.48);
      expect(state.stage).toBe('dormant');
      expect(state.stemScale).toBe(0);
      expect(state.bloomScale).toBe(0);
    }
  });

  it('staggers emergence without allowing winter carryover', () => {
    expect(resolveFlowerSeason(2.2, -0.4).stage).toBe('sprout');
    expect(resolveFlowerSeason(2.2, 0.4).stage).toBe('bud');
    expect(resolveFlowerSeason(10, -0.48).stage).toBe('dormant');
  });

  it('senesces through autumn instead of vanishing abruptly', () => {
    const summer = resolveFlowerSeason(5);
    const earlyAutumn = resolveFlowerSeason(8);
    const lateAutumn = resolveFlowerSeason(9.5);
    expect(summer.senescence).toBe(0);
    expect(earlyAutumn.senescence).toBeGreaterThan(0);
    expect(lateAutumn.senescence).toBeGreaterThan(earlyAutumn.senescence);
    expect(lateAutumn.bloomScale).toBeLessThan(earlyAutumn.bloomScale);
  });
});
