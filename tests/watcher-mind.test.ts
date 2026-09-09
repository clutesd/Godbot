import { describe, expect, it } from 'vitest';
import { RunRecordBuilder, createRunIdentity } from '../src/historian/RunArchive';
import { WATCHER_MEMORY_LIMITS, WatcherMind, type WatcherMemorySnapshot } from '../src/historian/WatcherMind';
import { registerWatcherMemory, watcherMemoryForState } from '../src/historian/WatcherMemoryRegistry';
import type { HistoricalEvent, ObservationCandidate } from '../src/historian/types';
import { Simulation } from '../src/sim/Simulation';
import type { TradeRoute, War } from '../src/sim/types';

const breakdown = { novelty: 0, magnitude: 0, populationAffected: 0, rarity: 0, technological: 0, political: 0, cultural: 0, consequence: 0, continuity: 0, repetitionPenalty: 0 };

function event(id: string, month: number, type: HistoricalEvent['type'], locationId: string, extras: Partial<HistoricalEvent> = {}): HistoricalEvent {
  return {
    id, month, type, locationId, actors: [locationId], causes: ['test-evidence'], context: {}, outcome: 'Recorded test outcome.',
    affectedPopulation: 10, magnitude: 0.6, significance: 0.7, tags: ['test'], summary: `${type} at ${locationId}`,
    ...extras,
  };
}

function scene(subjectId: string, title: string, month: number, sourceEventIds: string[] = [], observedEvent?: HistoricalEvent): ObservationCandidate {
  return {
    id: `scene:${subjectId}:${month}`, subjectId, kind: 'historian-context', position: { x: 0, z: 0 }, title,
    statement: { id: `statement:${subjectId}:${month}`, month, text: 'Grounded observation.', epistemicStatus: 'recorded-fact', sourceEventIds, sourceEntityIds: [subjectId], sourceArchiveIds: [], claims: {} },
    score: 0.7, interest: 0.72, audioCategory: 'historian', breakdown, ...(observedEvent ? { event: observedEvent } : {}),
  };
}

describe('Persistent Watcher mind', () => {
  it('creates a grounded historical question and resolves it from later evidence', () => {
    const simulation = new Simulation({ seed: 'watcher-question', startingPopulation: 120 });
    const settlement = simulation.state.settlements[0]!;
    const crisis = event('watcher-crisis', 12, 'harvest-crisis', settlement.id);
    simulation.state.month = 12;
    simulation.state.history.push(crisis);
    const mind = new WatcherMind();
    mind.observe(scene(settlement.id, settlement.name, 12, [crisis.id], crisis), simulation.state, []);
    expect(mind.snapshot().questions.some((question) => question.kind === 'settlement-recovery' && question.status === 'open')).toBe(true);

    const recovery = event('watcher-recovery', 12 * 18, 'recovery', settlement.id);
    simulation.state.month = recovery.month;
    simulation.state.history.push(recovery);
    mind.observe(scene(settlement.id, settlement.name, recovery.month, [recovery.id], recovery), simulation.state, []);
    const resolved = mind.snapshot().questions.find((question) => question.kind === 'settlement-recovery');
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.evidenceEventIds).toEqual(expect.arrayContaining([crisis.id, recovery.id]));
    expect(resolved?.entityIds).toContain(settlement.id);
  });

  it('revises a trade-cohesion belief when conflict contradicts it', () => {
    const simulation = new Simulation({ seed: 'watcher-belief', startingPopulation: 180, settlementCount: [3, 3] });
    const [a, b] = simulation.state.settlements;
    if (!a || !b) throw new Error('Expected two settlements');
    const relation = simulation.state.relations.find((item) => (item.a === a.id && item.b === b.id) || (item.a === b.id && item.b === a.id));
    if (!relation) throw new Error('Expected a relation');
    relation.contact = true; relation.allied = true; relation.tradeDependency = 0.7;
    const route: TradeRoute = { id: 'watcher-route', a: a.id, b: b.id, volume: 12, ageMonths: 30, caravanProgress: 0, caravanDirection: 1, mode: 'land', knowledgeFlow: 0, cumulativeKnowledge: 0, active: true };
    simulation.state.tradeRoutes.push(route);
    const mind = new WatcherMind();
    mind.observe(scene(a.id, a.name, simulation.state.month), simulation.state, []);
    expect(mind.snapshot().beliefs.some((belief) => belief.kind === 'trade-cohesion' && belief.status === 'tentative')).toBe(true);

    const war: War = { id: 'watcher-war', attacker: a.id, defender: b.id, cause: 'territorial-dispute', startMonth: 24, strengthA: 1, strengthB: 1, casualtiesA: 0, casualtiesB: 0, progress: 0, phase: 'mobilizing', marchProgress: 0, moraleA: 0.8, moraleB: 0.8, organizationA: 0.7, organizationB: 0.7, leadershipA: 0.7, leadershipB: 0.7, technologyA: 0.5, technologyB: 0.5, active: true };
    simulation.state.wars.push(war);
    const declaration = event('watcher-war-event', 24, 'war-declared', a.id, { actors: [war.id, a.id, b.id] });
    simulation.state.month = 24;
    simulation.state.history.push(declaration);
    mind.observe(scene(a.id, a.name, 24, [declaration.id], declaration), simulation.state, []);
    const belief = mind.snapshot().beliefs.find((item) => item.kind === 'trade-cohesion');
    expect(belief?.status).toBe('revised');
    expect(belief?.contradictingEventIds).toContain(declaration.id);
    expect(belief?.revisionText).toMatch(/Trade survived/);
  });

  it('is deterministic and never invents evidence references', () => {
    const simulation = new Simulation({ seed: 'watcher-determinism', startingPopulation: 120 });
    const settlement = simulation.state.settlements[0]!;
    const crisis = event('deterministic-crisis', 6, 'harvest-crisis', settlement.id);
    simulation.state.month = 6; simulation.state.history.push(crisis);
    const first = new WatcherMind(); const second = new WatcherMind();
    const observation = scene(settlement.id, settlement.name, 6, [crisis.id], crisis);
    first.observe(observation, simulation.state, []); second.observe(observation, simulation.state, []);
    expect(first.snapshot()).toEqual(second.snapshot());
    const knownEvents = new Set(simulation.state.history.map((item) => item.id));
    const knownEntities = new Set([...simulation.state.settlements.map((item) => item.id), ...simulation.state.institutions.map((item) => item.id), ...simulation.state.polities.map((item) => item.id), ...simulation.state.people.map((item) => item.id)]);
    for (const question of first.snapshot().questions) {
      expect(question.evidenceEventIds.every((id) => knownEvents.has(id))).toBe(true);
      expect(question.entityIds.every((id) => knownEntities.has(id))).toBe(true);
    }
  });

  it('does not mutate authoritative history, stats, resources, relations, or wars', () => {
    const simulation = new Simulation({ seed: 'watcher-read-only', startingPopulation: 180 });
    simulation.step(24);
    const settlement = simulation.state.settlements.find((item) => item.alive)!;
    const before = {
      history: structuredClone(simulation.state.history),
      stats: structuredClone(simulation.state.stats),
      settlements: structuredClone(simulation.state.settlements),
      relations: structuredClone(simulation.state.relations),
      wars: structuredClone(simulation.state.wars),
    };
    const mind = new WatcherMind();
    mind.observe(scene(settlement.id, settlement.name, simulation.state.month), simulation.state, []);
    expect(simulation.state.history).toEqual(before.history);
    expect(simulation.state.stats).toEqual(before.stats);
    expect(simulation.state.settlements).toEqual(before.settlements);
    expect(simulation.state.relations).toEqual(before.relations);
    expect(simulation.state.wars).toEqual(before.wars);
  });

  it('round-trips through the run archive and restores memory for a resumed state', () => {
    const simulation = new Simulation({ seed: 'watcher-resume', startingPopulation: 120 });
    const settlement = simulation.state.settlements[0]!;
    const mind = new WatcherMind();
    mind.observe(scene(settlement.id, settlement.name, 0), simulation.state, []);
    const snapshot = mind.snapshot();
    registerWatcherMemory(simulation.state, snapshot);
    const identity = createRunIdentity(simulation.config, simulation.state, 1, '2026-01-01T00:00:00.000Z');
    const record = new RunRecordBuilder(identity, simulation.config, simulation.state).update(simulation.state);
    expect(record.watcherMemory).toEqual(snapshot);

    const resumed = new Simulation(record.configuration);
    new RunRecordBuilder(identity, resumed.config, resumed.state, record);
    expect(watcherMemoryForState(resumed.state)).toEqual(snapshot);
  });

  it('keeps memory growth within explicit bounds', () => {
    const oversized: WatcherMemorySnapshot = {
      version: 1, observationSequence: 10_000, lastProcessedMonth: 0, processedEventIdsAtMonth: [],
      subjects: Array.from({ length: WATCHER_MEMORY_LIMITS.subjects + 100 }, (_, index) => ({ id: `subject-${index}`, kind: 'other' as const, label: `Subject ${index}`, firstObservedMonth: 0, lastObservedMonth: index, meaningfulObservations: 1, attachment: 0.2, interestReasons: ['test'], sourceEventIds: [] })),
      questions: Array.from({ length: WATCHER_MEMORY_LIMITS.questions + 20 }, (_, index) => ({ id: `question-${index}`, kind: 'institution-survival' as const, text: 'Will it last?', openedMonth: 0, lastEvaluatedMonth: index, status: 'open' as const, entityIds: [], evidenceEventIds: [] })),
      beliefs: Array.from({ length: WATCHER_MEMORY_LIMITS.beliefs + 20 }, (_, index) => ({ id: `belief-${index}`, kind: 'settlement-resilience' as const, thesis: 'It may recover.', formedMonth: 0, lastEvaluatedMonth: index, confidence: 0.5, status: 'tentative' as const, entityIds: [], supportingEventIds: [], contradictingEventIds: [] })),
      predictions: Array.from({ length: WATCHER_MEMORY_LIMITS.predictions + 20 }, (_, index) => ({ predictionId: `prediction-${index}`, madeMonth: index, horizonMonth: index + 12, subjectIds: [], resolved: false })),
    };
    const bounded = new WatcherMind(oversized).snapshot();
    expect(bounded.subjects.length).toBeLessThanOrEqual(WATCHER_MEMORY_LIMITS.subjects);
    expect(bounded.questions.length).toBeLessThanOrEqual(WATCHER_MEMORY_LIMITS.questions);
    expect(bounded.beliefs.length).toBeLessThanOrEqual(WATCHER_MEMORY_LIMITS.beliefs);
    expect(bounded.predictions.length).toBeLessThanOrEqual(WATCHER_MEMORY_LIMITS.predictions);
  });
});
