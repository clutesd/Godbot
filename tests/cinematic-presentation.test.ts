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
});
