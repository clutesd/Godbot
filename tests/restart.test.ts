import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';

const CONFIG = { seed: 'restart-audit', startingPopulation: 180, settlementCount: [4, 4] as const };

describe('Observation restart', () => {
  it('resets all simulation state with no leakage from the prior run', () => {
    const simulation = new Simulation(CONFIG);
    simulation.step(40 * 12);
    // The prior run accumulated meaningful state.
    expect(simulation.state.month).toBe(40 * 12);
    expect(simulation.state.stats.births).toBeGreaterThan(0);
    expect(simulation.state.stats.deaths).toBeGreaterThan(0);
    expect(simulation.state.history.length).toBeGreaterThan(1);

    simulation.restart();

    expect(simulation.state.month).toBe(0);
    expect(simulation.year).toBe(0);
    expect(simulation.state.history).toHaveLength(1);
    expect(simulation.state.history[0]?.type).toBe('world-awakening');
    expect(simulation.state.stats.births).toBe(0);
    expect(simulation.state.stats.deaths).toBe(0);
    expect(simulation.state.stats.discoveries).toBe(0);
    expect(simulation.state.stats.peakPopulation).toBe(simulation.population);
    // Full reset: indistinguishable from a freshly constructed run of the same seed.
    const fresh = new Simulation(CONFIG);
    expect(simulation.state).toEqual(fresh.state);
    expect(simulation.summary()).toEqual(fresh.summary());
  }, 30_000);

  it('replays the current seed from Year 0 with identical history', () => {
    const simulation = new Simulation(CONFIG);
    simulation.step(25 * 12);
    simulation.restart();
    simulation.step(25 * 12);
    const fresh = new Simulation(CONFIG);
    fresh.step(25 * 12);
    expect(simulation.summary()).toEqual(fresh.summary());
    expect(simulation.state.history).toEqual(fresh.state.history);
    expect(simulation.state.people).toEqual(fresh.state.people);
    expect(simulation.state.settlements).toEqual(fresh.state.settlements);
  });

  it('restarts from a specified seed deterministically', () => {
    const simulation = new Simulation(CONFIG);
    simulation.step(10 * 12);
    simulation.restart('another-world');
    expect(simulation.config.seed).toBe('another-world');
    expect(simulation.state.seed).toBe('another-world');
    const fresh = new Simulation({ ...CONFIG, seed: 'another-world' });
    expect(simulation.state).toEqual(fresh.state);
    simulation.step(30 * 12);
    fresh.step(30 * 12);
    expect(simulation.summary()).toEqual(fresh.summary());
    expect(simulation.state.history.slice(-200)).toEqual(fresh.state.history.slice(-200));
  }, 15_000);

  it('initializes deterministically for the same seed and config', () => {
    expect(new Simulation(CONFIG).state).toEqual(new Simulation(CONFIG).state);
  });

  it('does not leak prior-run history into a restarted deep-time record', () => {
    const simulation = new Simulation(CONFIG);
    simulation.step(30 * 12);
    const priorEvents = simulation.state.history.length;
    expect(priorEvents).toBeGreaterThan(1);
    simulation.restart('clean-world');
    expect(simulation.state.history.every((event) => event.month === 0)).toBe(true);
    simulation.step(5 * 12);
    expect(simulation.state.history.every((event) => event.month <= 5 * 12)).toBe(true);
  });
});
