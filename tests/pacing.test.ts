import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { GODBOX_TIME_PRESETS, timePresetConfig } from '../src/presets';
import { PresentationDirector } from '../src/historian/PresentationDirector';
import { Simulation } from '../src/sim/Simulation';
import type { HistoricalEvent } from '../src/sim/types';

const quietObservation = { interest: 0.1, kind: 'landscape-pause' as const };

function milestoneEvent(month: number, index: number): HistoricalEvent {
  return {
    id: `test-milestone-${index}`,
    month,
    type: 'battle',
    actors: [],
    causes: [],
    context: {},
    outcome: 'test',
    affectedPopulation: 0,
    magnitude: 0.6,
    significance: 0.8,
    tags: [],
    summary: 'test milestone',
  };
}

describe('Pacing presets', () => {
  it('offers fast-test, fast, normal, and long-observation cadences', () => {
    for (const name of ['fast-test', 'fast', 'normal', 'long-observation'] as const) {
      expect(GODBOX_TIME_PRESETS).toHaveProperty(name);
    }
    const fastTest = configWith(timePresetConfig('fast-test'));
    const normal = configWith(timePresetConfig('normal'));
    const longObservation = configWith(timePresetConfig('long-observation'));
    expect(fastTest.presentation.quietMonthsPerSecond).toBeGreaterThan(normal.presentation.quietMonthsPerSecond);
    expect(fastTest.simulation.maxTicksPerFrame).toBeGreaterThan(normal.simulation.maxTicksPerFrame);
    expect(longObservation.presentation.ordinaryMonthsPerSecond).toBeLessThan(normal.presentation.ordinaryMonthsPerSecond);
  });

  it('accelerates fast-test execution without changing historical rules', () => {
    const fastTest = configWith(timePresetConfig('fast-test'));
    const normal = configWith(timePresetConfig('normal'));
    // Rules are untouched: knowledge, historical pace, society, and world generation match.
    expect(fastTest.knowledge).toEqual(normal.knowledge);
    expect(fastTest.historicalPace).toEqual(normal.historicalPace);
    expect(fastTest.society).toEqual(normal.society);
    expect(fastTest.world).toEqual(normal.world);
    expect(fastTest.experiment.runYears).toBe(normal.experiment.runYears);

    const overrides = { seed: 'pacing-equality', startingPopulation: 180, settlementCount: [4, 4] as const };
    const fast = new Simulation(timePresetConfig('fast-test', overrides));
    const normalRun = new Simulation(timePresetConfig('normal', overrides));
    const started = performance.now();
    fast.step(40 * 12);
    const elapsedMs = performance.now() - started;
    normalRun.step(40 * 12);
    // Identical history under both pacings.
    expect(fast.summary()).toEqual(normalRun.summary());
    expect(fast.state.history).toEqual(normalRun.state.history);
    // Practical to execute: 40 simulated years well inside a test budget.
    expect(elapsedMs).toBeLessThan(60_000);
  }, 30_000);
});

describe('Adaptive temporal resolution', () => {
  it('moves quiet, structurally simple worlds through deep time faster', () => {
    const simulation = new Simulation({ seed: 'temporal-resolution', startingPopulation: 180, settlementCount: [4, 4] as const });
    const director = new PresentationDirector(simulation.config);
    for (let second = 0; second < 120; second += 1) director.update(1, simulation.state, quietObservation);
    const deepTimeSpeed = director.targetSpeed(simulation.state, quietObservation);
    expect(deepTimeSpeed).toBeGreaterThan(simulation.config.presentation.quietMonthsPerSecond);
    expect(director.tickBudget(simulation.state)).toBeGreaterThan(simulation.config.simulation.maxTicksPerFrame);
  });

  it('returns to fine steps when wars and milestones make the world complex', () => {
    const simulation = new Simulation({ seed: 'temporal-resolution-busy', startingPopulation: 180, settlementCount: [4, 4] as const });
    const director = new PresentationDirector(simulation.config);
    for (let second = 0; second < 120; second += 1) director.update(1, simulation.state, quietObservation);
    const calmSpeed = director.targetSpeed(simulation.state, quietObservation);
    const calmBudget = director.tickBudget(simulation.state);
    for (let index = 0; index < 6; index += 1) simulation.state.history.push(milestoneEvent(simulation.state.month, index));
    const busySpeed = director.targetSpeed(simulation.state, quietObservation);
    expect(busySpeed).toBeLessThan(calmSpeed);
    expect(busySpeed).toBeLessThanOrEqual(simulation.config.presentation.quietMonthsPerSecond);
    expect(director.tickBudget(simulation.state)).toBeLessThan(calmBudget);
  });

  it('drops to momentous pacing during crises regardless of deep-time quiet', () => {
    const simulation = new Simulation({ seed: 'temporal-resolution-crisis', startingPopulation: 180 });
    const director = new PresentationDirector(simulation.config);
    for (let second = 0; second < 120; second += 1) director.update(1, simulation.state, quietObservation);
    const speed = director.targetSpeed(simulation.state, { interest: 0.9, kind: 'battle-overview' });
    expect(speed).toBe(simulation.config.presentation.momentousMonthsPerSecond);
  });
});
