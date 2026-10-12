import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';

describe('Simulation determinism', () => {
  // The fast guard runs on every change; the decades-long versions below run in the soak suite.
  it('replays the first five years exactly and lets a different seed diverge', () => {
    const config = { seed: 'deterministic-terraces', startingPopulation: 180, settlementCount: [4, 4] as const };
    const first = new Simulation(config);
    const second = new Simulation(config);
    const other = new Simulation({ ...config, seed: 'deterministic-other' });
    for (const simulation of [first, second, other]) simulation.step(5 * 12);
    expect(first.summary()).toEqual(second.summary());
    expect(first.state.history).toEqual(second.state.history);
    expect(first.state.settlements).toEqual(second.state.settlements);
    expect(other.summary()).not.toEqual(first.summary());
  });

  it('produces the same meaningful history from identical inputs', { tags: ['soak'] }, () => {
    const config = { seed: 'deterministic-terraces', startingPopulation: 180, settlementCount: [4, 4] as const };
    const first = new Simulation(config);
    const second = new Simulation(config);
    first.step(60 * 12);
    second.step(60 * 12);
    expect(first.summary()).toEqual(second.summary());
    expect(first.state.history.slice(-120)).toEqual(second.state.history.slice(-120));
  });

  it('allows seeds to produce structurally different histories', { tags: ['soak'] }, () => {
    const first = new Simulation({ seed: 'indigo-rain', startingPopulation: 180 });
    const second = new Simulation({ seed: 'ochre-moon', startingPopulation: 180 });
    first.step(70 * 12);
    second.step(70 * 12);
    expect(first.summary()).not.toEqual(second.summary());
    expect(first.state.world.cells.map((cell) => cell.biome)).not.toEqual(second.state.world.cells.map((cell) => cell.biome));
  });
});

describe('Population and resources', () => {
  it('ages survivors and changes stored resources on discrete ticks', () => {
    const simulation = new Simulation({ seed: 'age-and-harvest', startingPopulation: 180 });
    const initialAges = new Map(simulation.state.people.map((person) => [person.id, person.ageMonths]));
    const initialFood = simulation.state.settlements.reduce((sum, settlement) => sum + settlement.resources.food, 0);
    simulation.step(12);
    const survivor = simulation.state.people.find((person) => initialAges.has(person.id));
    expect(survivor).toBeDefined();
    expect(survivor?.ageMonths).toBe((initialAges.get(survivor?.id ?? '') ?? 0) + 12);
    expect(simulation.state.settlements.reduce((sum, settlement) => sum + settlement.resources.food, 0)).not.toBe(initialFood);
  });

  it('maintains generational continuity through births and deaths', { tags: ['soak'] }, () => {
    const simulation = new Simulation({ seed: 'lineage-test', startingPopulation: 240 });
    simulation.step(80 * 12);
    expect(simulation.state.stats.births).toBeGreaterThan(100);
    expect(simulation.state.stats.deaths).toBeGreaterThan(100);
    expect(simulation.population).toBeGreaterThan(50);
    expect(simulation.state.people.some((person) => person.parents.length > 0)).toBe(true);
  });

  it('allows migration while geography can prevent early trade infrastructure', { tags: ['soak'] }, () => {
    const simulation = new Simulation({ seed: 'lineage-test', startingPopulation: 240 });
    simulation.step(80 * 12);
    expect(simulation.state.stats.migrations).toBeGreaterThan(0);
    expect(simulation.state.stats.trades).toBe(0);
    expect(simulation.state.tradeRoutes).toHaveLength(0);
    // MovementRoadAuthority now owns early circulation: repeated walking creates tracks,
    // while engineered transport segments require later infrastructure and connected freight.
    expect(simulation.state.world.cells.some(cell => !cell.water && (cell.modifications?.track?.intensity ?? 0) > 0.1)).toBe(true);
    expect(simulation.state.world.cells.some(cell => {
      const path = cell.modifications?.footpath;
      return path && path.lastMonth > path.firstMonth && path.ownerId !== undefined;
    })).toBe(true);
    expect(simulation.state.settlements.some((settlement) => Object.keys(settlement.cultureShares).length > 1)).toBe(true);
  });
});

describe('Long-run stability', () => {
  it('survives centuries without numerical or population divergence', { tags: ['soak'] }, () => {
    const simulation = new Simulation({ seed: 'lineage-test', startingPopulation: 360 });
    simulation.step(300 * 12);
    const summary = simulation.summary();
    expect(summary.population).toBeGreaterThan(30);
    expect(summary.population).toBeLessThanOrEqual(2650);
    expect(summary.settlements).toBeGreaterThanOrEqual(2);
    expect(summary.migrations).toBeGreaterThan(0);
    // A surviving world can remain geographically isolated. Actual freight delivery and
    // knowledge transmission are asserted in the connected society/transport fixtures.
    expect(summary.births).toBeGreaterThan(100);
    expect(Number.isFinite(summary.totalFood)).toBe(true);
    expect(Number.isFinite(summary.totalWealth)).toBe(true);
    expect(simulation.state.settlements.every((settlement) => Object.values(settlement.resources).every(Number.isFinite))).toBe(true);
  });
});
