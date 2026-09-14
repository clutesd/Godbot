import { describe, expect, it } from 'vitest';
import { PresentationDirector } from '../src/historian/PresentationDirector';
import { Simulation } from '../src/sim/Simulation';

describe('Cinematic presentation pacing', () => {
  it('lingers on a momentous event before returning toward deep time', () => {
    const simulation = new Simulation({ seed: 'cinematic-linger', startingPopulation: 180 });
    const director = new PresentationDirector(simulation.config);
    const quiet = { interest: 0.1, kind: 'landscape-pause' as const };

    for (let second = 0; second < 90; second += 1) director.update(1, simulation.state, quiet);
    const accelerated = director.monthsPerSecond;

    director.update(1, simulation.state, {
      interest: 0.95,
      kind: 'battle-overview',
      eventType: 'battle',
      eventMonth: simulation.state.month,
    });

    expect(director.monthsPerSecond).toBeLessThan(accelerated);
    expect(director.telemetry().tempo).toBe('linger');
    expect(director.telemetry().holdSecondsRemaining).toBeGreaterThan(0);

    for (let second = 0; second < 5; second += 1) director.update(1, simulation.state, quiet);
    expect(director.telemetry().tempo).toBe('linger');
    expect(director.monthsPerSecond).toBeLessThan(simulation.config.presentation.ordinaryMonthsPerSecond);

    for (let second = 0; second < 18; second += 1) director.update(1, simulation.state, quiet);
    expect(director.telemetry().holdSecondsRemaining).toBe(0);
    expect(director.monthsPerSecond).toBeGreaterThan(simulation.config.presentation.momentousMonthsPerSecond);
  });

  it('slows an increasingly busy world before a specific event must be selected', () => {
    const simulation = new Simulation({ seed: 'cinematic-pressure', startingPopulation: 180 });
    const director = new PresentationDirector(simulation.config);
    const quiet = { interest: 0.1, kind: 'landscape-pause' as const };

    for (let second = 0; second < 90; second += 1) director.update(1, simulation.state, quiet);
    const calm = director.targetSpeed(simulation.state, quiet);

    for (let index = 0; index < 4; index += 1) {
      simulation.state.history.push({
        id: `cinematic-event-${index}`,
        month: simulation.state.month,
        type: 'infrastructure-built',
        actors: [],
        causes: [],
        context: {},
        outcome: 'test',
        affectedPopulation: 0,
        magnitude: 0.6,
        significance: 0.82,
        tags: [],
        summary: 'test milestone',
      });
    }

    const busy = director.targetSpeed(simulation.state, quiet);
    expect(busy).toBeLessThan(calm);
    expect(busy).toBeGreaterThanOrEqual(simulation.config.presentation.significantMonthsPerSecond);
  });

  it('pre-arms an unmistakable seasonal breathing window before catch-up can skip the boundary', () => {
    const simulation = new Simulation({ seed: 'cinematic-season-transition', startingPopulation: 180 });
    const director = new PresentationDirector(simulation.config);
    const quiet = { interest: 0.1, kind: 'landscape-pause' as const };

    // Warm past the initial Late Winter -> Early Spring opening hold without advancing the fixture month.
    for (let second = 0; second < 30; second += 1) director.update(1, simulation.state, quiet);
    const ordinaryBudget = director.tickBudget(simulation.state);
    expect(ordinaryBudget).toBeGreaterThan(1);

    // Month 3 is LATE SPRING. EARLY SUMMER is month 4, so the director must slow before the
    // authoritative simulation can run a multi-month catch-up loop across that boundary.
    simulation.state.month = 3;
    const before = director.monthsPerSecond;
    director.update(0.25, simulation.state, quiet);

    expect(director.telemetry().seasonalTransition).toBe(true);
    expect(director.telemetry().seasonalHoldSecondsRemaining).toBeGreaterThan(9);
    expect(director.telemetry().tempo).toBe('linger');
    expect(director.tickBudget(simulation.state)).toBe(1);
    expect(director.monthsPerSecond).toBeLessThan(before);

    // Within a few real seconds the requested pace should be close to the engine's 0.1 month/sec
    // floor: visibly slower than the ordinary 2-second-ish month cadence.
    for (let step = 0; step < 10; step += 1) director.update(0.5, simulation.state, quiet);
    expect(director.monthsPerSecond).toBeLessThan(0.2);

    // Entering EARLY SUMMER uses the same transition key and must not reset/extend the hold.
    const remaining = director.telemetry().seasonalHoldSecondsRemaining;
    simulation.state.month = 4;
    director.update(0.5, simulation.state, quiet);
    expect(director.telemetry().seasonalTransition).toBe(true);
    expect(director.telemetry().seasonalHoldSecondsRemaining).toBeLessThan(remaining);
    expect(director.tickBudget(simulation.state)).toBe(1);

    for (let second = 0; second < 10; second += 1) director.update(1, simulation.state, quiet);
    expect(director.telemetry().seasonalTransition).toBe(false);
    expect(director.tickBudget(simulation.state)).toBeGreaterThan(1);
  });
});
