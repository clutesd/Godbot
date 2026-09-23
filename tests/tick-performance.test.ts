import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';

describe('tick performance instrumentation', () => {
  it('observes monthly work without changing deterministic simulation state', () => {
    const config = {
      seed: 'tick-profiler-read-only',
      startMode: 'established' as const,
      startingPopulation: 60,
      settlementCount: [2, 2] as const,
      world: { size: 20 },
      simulation: { populationSoftCap: 120, historyLimit: 5_000 },
    };

    const observed = new Simulation(config);
    const control = new Simulation(config);
    observed.setTickProfiling(true);

    observed.step(36);
    control.step(36);

    expect(observed.state).toEqual(control.state);

    const profile = observed.tickPerformance();
    expect(profile.enabled).toBe(true);
    expect(profile.tickCount).toBe(36);
    expect(profile.total.count).toBe(36);
    expect(profile.ordinary.count).toBe(33);
    expect(profile.annual.count).toBe(3);
    expect(profile.phases.weather?.count).toBe(36);
    expect(profile.phases.people?.count).toBe(36);
    expect(profile.phases['annual-society']?.count).toBe(3);
    expect(profile.slowestTicks.length).toBeGreaterThan(0);
  });
});
