import { describe, expect, it } from 'vitest';
import {
  DEEP_HISTORY_LIMITS,
  DeepHistoricalMemory,
  attachDeepHistory,
  deepHistoryFromWatcherSnapshot,
} from '../src/historian/DeepHistoricalMemory';
import { RunRecordBuilder, createRunIdentity } from '../src/historian/RunArchive';
import { WatcherMind } from '../src/historian/WatcherMind';
import { registerWatcherMemory, watcherMemoryForState } from '../src/historian/WatcherMemoryRegistry';
import type { ObservationCandidate } from '../src/historian/types';
import { Simulation } from '../src/sim/Simulation';
import type { HistoricalEvent, HistoricalEventType, SimulationState } from '../src/sim/types';

const breakdown = { novelty: 0, magnitude: 0, populationAffected: 0, rarity: 0, technological: 0, political: 0, cultural: 0, consequence: 0, continuity: 0, repetitionPenalty: 0 };

function historicalEvent(
  id: string,
  month: number,
  type: HistoricalEventType,
  state: SimulationState,
  options: Partial<HistoricalEvent> = {},
): HistoricalEvent {
  const settlement = state.settlements[0]!;
  return {
    id,
    month,
    type,
    location: { ...settlement.position },
    locationId: settlement.id,
    actors: [settlement.id],
    causes: [],
    context: {},
    outcome: `${type} produced a recorded outcome.`,
    affectedPopulation: 20,
    magnitude: 0.6,
    significance: 0.6,
    tags: ['test'],
    summary: `${type} in ${settlement.name}`,
    ...options,
  };
}

function scene(state: SimulationState): ObservationCandidate {
  const settlement = state.settlements[0]!;
  return {
    id: `scene:${state.month}`,
    subjectId: settlement.id,
    kind: 'historian-context',
    position: { ...settlement.position },
    title: settlement.name,
    statement: {
      id: `statement:${state.month}`,
      month: state.month,
      text: 'Grounded current observation.',
      epistemicStatus: 'derived-statistic',
      sourceEventIds: [],
      sourceEntityIds: [settlement.id],
      sourceArchiveIds: [],
      claims: { entityIds: [settlement.id] },
    },
    score: 0.7,
    interest: 0.7,
    audioCategory: 'historian',
    breakdown,
  };
}

describe('Deep historical memory', () => {
  it('compacts synthetic deep time within explicit bounds while preserving major history', () => {
    const simulation = new Simulation({ seed: 'deep-bounds', startingPopulation: 120 });
    simulation.state.history = [];
    for (let index = 0; index < DEEP_HISTORY_LIMITS.events + 350; index += 1) {
      const significance = index % 11 === 0 ? 0.9 : 0.46;
      simulation.state.history.push(historicalEvent(
        `deep-event-${index}`,
        index * 120,
        index % 11 === 0 ? 'political-transition' : 'infrastructure-built',
        simulation.state,
        { significance, magnitude: significance },
      ));
    }
    const atomic = historicalEvent('deep-atomic', 300_000 * 12, 'atomic-threshold', simulation.state, { significance: 0.99, magnitude: 0.98 });
    simulation.state.history.push(atomic);
    simulation.state.month = atomic.month;

    const memory = new DeepHistoricalMemory();
    memory.observe(simulation.state);
    const snapshot = memory.snapshot();

    expect(snapshot.events.length).toBeLessThanOrEqual(DEEP_HISTORY_LIMITS.events);
    expect(snapshot.episodes.length).toBeLessThanOrEqual(DEEP_HISTORY_LIMITS.episodes);
    expect(snapshot.threads.length).toBeLessThanOrEqual(DEEP_HISTORY_LIMITS.threads);
    expect(snapshot.eras.length).toBeLessThanOrEqual(DEEP_HISTORY_LIMITS.eras);
    expect(snapshot.entities.length).toBeLessThanOrEqual(DEEP_HISTORY_LIMITS.entities);
    expect(snapshot.causalLinks.length).toBeLessThanOrEqual(DEEP_HISTORY_LIMITS.causalLinks);
    expect(memory.eventMemory(atomic.id)).toBeDefined();
  });

  it('discards trivia but promotes an initially minor event when later history explicitly depends on it', () => {
    const simulation = new Simulation({ seed: 'deep-retrospective', startingPopulation: 120 });
    simulation.state.history = [];
    const trivia = historicalEvent('routine-birth', 12, 'birth', simulation.state, { significance: 0.05, magnitude: 0.05 });
    const overlooked = historicalEvent('small-workshop', 24, 'infrastructure-built', simulation.state, { significance: 0.2, magnitude: 0.2, summary: 'A small workshop opened.' });
    simulation.state.history.push(trivia, overlooked);
    simulation.state.month = 24;
    const memory = new DeepHistoricalMemory();
    memory.observe(simulation.state);
    expect(memory.eventMemory(trivia.id)).toBeUndefined();
    expect(memory.eventMemory(overlooked.id)).toBeDefined();
    const before = memory.eventMemory(overlooked.id)!.retrospectiveSignificance;

    const transformation = historicalEvent('industrial-breakthrough', 40 * 12, 'industrialization', simulation.state, {
      significance: 0.95,
      magnitude: 0.9,
      causes: [overlooked.id],
      summary: 'Industrial production transformed the settlement.',
    });
    simulation.state.history.push(transformation);
    simulation.state.month = transformation.month;
    memory.observe(simulation.state);
    const after = memory.eventMemory(overlooked.id)!;
    expect(after.retrospectiveSignificance).toBeGreaterThan(before);
    expect(after.retrospectiveReasons.length).toBeGreaterThan(0);
  });

  it('distinguishes direct causes, causal chains, plausible interpretation, and unknown relationships', () => {
    const simulation = new Simulation({ seed: 'deep-causality', startingPopulation: 180, settlementCount: [2, 2] });
    simulation.state.history = [];
    const first = historicalEvent('cause-a', 12, 'harvest-crisis', simulation.state, { significance: 0.7 });
    const second = historicalEvent('cause-b', 24, 'major-migration', simulation.state, { significance: 0.75, causes: [first.id] });
    const third = historicalEvent('cause-c', 36, 'political-transition', simulation.state, { significance: 0.85, causes: [second.id] });
    const samePlace = historicalEvent('same-place', 48, 'institution-formed', simulation.state, { significance: 0.7 });
    const otherSettlement = simulation.state.settlements[1]!;
    const unrelated = historicalEvent('unrelated', 60, 'discovery', simulation.state, {
      significance: 0.7,
      locationId: otherSettlement.id,
      location: { ...otherSettlement.position },
      actors: [otherSettlement.id],
    });
    simulation.state.history.push(first, second, third, samePlace, unrelated);
    simulation.state.month = 60;
    const memory = new DeepHistoricalMemory();
    memory.observe(simulation.state);

    expect(memory.causalAssessment(first.id, second.id).confidence).toBe('recorded-direct-cause');
    expect(memory.causalAssessment(first.id, third.id).confidence).toBe('strongly-supported-contributor');
    const plausible = memory.causalAssessment(first.id, samePlace.id);
    expect(plausible.confidence).toBe('plausible-interpretation');
    expect(plausible.text).toMatch(/may be related/);
    expect(memory.causalAssessment(first.id, unrelated.id).confidence).toBe('unknown');
  });

  it('does not silently turn correlation into a causal claim', () => {
    const simulation = new Simulation({ seed: 'deep-no-fake-cause', startingPopulation: 120 });
    simulation.state.history = [];
    const crisis = historicalEvent('correlated-crisis', 12, 'harvest-crisis', simulation.state, { significance: 0.75 });
    const transition = historicalEvent('correlated-transition', 18, 'political-transition', simulation.state, { significance: 0.8 });
    simulation.state.history.push(crisis, transition);
    simulation.state.month = 18;
    const memory = new DeepHistoricalMemory();
    memory.observe(simulation.state);
    const assessment = memory.causalAssessment(crisis.id, transition.id);
    expect(assessment.confidence).toBe('plausible-interpretation');
    expect(assessment.text).not.toMatch(/explicitly links|direct cause/i);
  });

  it('creates deep-time callbacks after the raw source event has left active history', () => {
    const simulation = new Simulation({ seed: 'deep-callback', startingPopulation: 120 });
    simulation.state.history = [];
    const founding = historicalEvent('ancient-founding', 12, 'settlement-founded', simulation.state, { significance: 0.8, magnitude: 0.7 });
    simulation.state.history.push(founding);
    simulation.state.month = founding.month;
    const memory = new DeepHistoricalMemory();
    memory.observe(simulation.state);

    simulation.state.history = [];
    simulation.state.month = 20_000 * 12;
    const remark = memory.callbackFor(scene(simulation.state), simulation.state);
    expect(remark).toBeDefined();
    expect(remark?.sourceMemoryIds).toEqual([`deep:event:${founding.id}`]);
    expect(remark?.text).toMatch(/20,?000|19,?999|remember/i);
    expect(memory.hasMemoryId(remark!.sourceMemoryIds[0]!)).toBe(true);
  });

  it('derives eras from structural transitions instead of fixed century boundaries', () => {
    const simulation = new Simulation({ seed: 'deep-eras', startingPopulation: 120 });
    simulation.state.history = [];
    const founding = historicalEvent('era-found', 7 * 12, 'settlement-founded', simulation.state, { significance: 0.7 });
    const industrial = historicalEvent('era-industry', 137 * 12, 'industrialization', simulation.state, { significance: 0.9 });
    const atomic = historicalEvent('era-atomic', 463 * 12, 'atomic-threshold', simulation.state, { significance: 0.95 });
    simulation.state.history.push(founding, industrial, atomic);
    simulation.state.month = atomic.month;
    const memory = new DeepHistoricalMemory();
    memory.observe(simulation.state);
    const eras = memory.snapshot().eras;
    expect(eras.length).toBeGreaterThanOrEqual(2);
    expect(eras.some((era) => era.startMonth === industrial.month || era.startMonth === atomic.month)).toBe(true);
    expect(eras.some((era) => era.boundaryEventId === industrial.id || era.boundaryEventId === atomic.id)).toBe(true);
  });

  it('is deterministic and survives the existing Watcher/RunArchive persistence path', () => {
    const simulation = new Simulation({ seed: 'deep-resume', startingPopulation: 120 });
    simulation.state.history = [];
    const discovery = historicalEvent('archive-discovery', 120, 'discovery', simulation.state, {
      significance: 0.8,
      context: { knowledge: 'durable-records' },
    });
    simulation.state.history.push(discovery);
    simulation.state.month = discovery.month;

    const first = new DeepHistoricalMemory();
    const second = new DeepHistoricalMemory();
    first.observe(simulation.state);
    second.observe(simulation.state);
    expect(first.snapshot()).toEqual(second.snapshot());

    const watcher = new WatcherMind();
    const watcherSnapshot = attachDeepHistory(watcher.snapshot(), first.snapshot());
    registerWatcherMemory(simulation.state, watcherSnapshot);
    const identity = createRunIdentity(simulation.config, simulation.state, 1, '2026-01-01T00:00:00.000Z');
    const builder = new RunRecordBuilder(identity, simulation.config, simulation.state);
    registerWatcherMemory(simulation.state, watcherSnapshot);
    const record = builder.update(simulation.state);
    expect(record.watcherMemory.deepHistory).toEqual(first.snapshot());

    const resumed = new Simulation(record.configuration);
    new RunRecordBuilder(identity, resumed.config, resumed.state, record);
    const restoredWatcher = watcherMemoryForState(resumed.state);
    const restoredDeep = deepHistoryFromWatcherSnapshot(restoredWatcher);
    expect(restoredDeep.snapshot()).toEqual(first.snapshot());
  });
});