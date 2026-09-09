import { describe, expect, it } from 'vitest';
import { NarrativeThreadEngine } from '../src/historian/NarrativeThreadEngine';
import type { ObservationCandidate } from '../src/historian/types';
import type { HistoricalEvent, HistoricalEventType, SimulationState } from '../src/sim/types';

function event(id: string, month: number, type: HistoricalEventType, overrides: Partial<HistoricalEvent> = {}): HistoricalEvent {
  return {
    id,
    month,
    type,
    actors: [],
    causes: [],
    context: {},
    outcome: '',
    affectedPopulation: 100,
    magnitude: 0.6,
    significance: 0.7,
    tags: [],
    summary: type.replaceAll('-', ' '),
    ...overrides,
  };
}

function state(history: HistoricalEvent[], month = 2400): SimulationState {
  return {
    month,
    history,
    settlements: [
      { id: 'a', name: 'Aven' },
      { id: 'b', name: 'Serath' },
    ],
  } as unknown as SimulationState;
}

function scene(observed: HistoricalEvent, subjectId = 'a'): ObservationCandidate {
  return {
    id: `scene:${observed.id}`,
    subjectId,
    kind: 'historian-context',
    position: { x: 0, z: 0 },
    title: observed.summary,
    statement: {
      id: `statement:${observed.id}`,
      month: observed.month,
      text: observed.summary,
      epistemicStatus: 'recorded-fact',
      sourceEventIds: [observed.id],
      sourceEntityIds: observed.actors.filter((id) => id === 'a' || id === 'b'),
      sourceArchiveIds: [],
      claims: { eventType: observed.type },
    },
    score: 0.7,
    interest: 0.7,
    audioCategory: 'historian',
    breakdown: {
      novelty: 0.5,
      magnitude: 0.6,
      populationAffected: 0.4,
      rarity: 0.5,
      technological: 0,
      political: 0.6,
      cultural: 0,
      consequence: 0.5,
      continuity: 0.2,
      repetitionPenalty: 0,
    },
    event: observed,
  };
}

describe('NarrativeThreadEngine', () => {
  it('recognizes a rivalry as one story rather than isolated wars', () => {
    const history = [
      event('war-start-1', 120, 'war-declared', { actors: ['war-1', 'a', 'b'], locationId: 'a', significance: 0.75 }),
      event('war-end-1', 180, 'war-ended', { actors: ['war-1', 'a', 'b'], locationId: 'a', significance: 0.62 }),
      event('war-start-2', 1320, 'war-declared', { actors: ['war-2', 'a', 'b'], locationId: 'b', significance: 0.82 }),
    ];
    const world = state(history, 1320);
    const engine = new NarrativeThreadEngine();
    const thread = engine.threads(world).find((candidate) => candidate.kind === 'rivalry');
    const context = engine.contextFor(scene(history[2] as HistoricalEvent, 'b'), world);

    expect(thread).toBeDefined();
    expect(thread?.eventCount).toBe(3);
    expect(thread?.reversals).toBeGreaterThanOrEqual(1);
    expect(context?.text).toContain('rivalry between Aven and Serath');
    expect(context?.sourceEventIds).toContain('war-start-1');
    expect(context?.sourceEventIds).toContain('war-start-2');
  });

  it('turns crisis and recovery into a settlement arc with remembered consequences', () => {
    const history = [
      event('founded', 0, 'settlement-founded', { actors: ['a'], locationId: 'a' }),
      event('harvest', 360, 'harvest-crisis', { actors: ['a'], locationId: 'a', significance: 0.8 }),
      event('recovered', 480, 'recovery', { actors: ['a'], locationId: 'a', significance: 0.65 }),
      event('industry', 1440, 'industrialization', { actors: ['a'], locationId: 'a', significance: 0.9 }),
    ];
    const world = state(history, 1440);
    const engine = new NarrativeThreadEngine();
    const settlement = engine.threads(world).find((candidate) => candidate.kind === 'settlement-arc');
    const crisis = engine.threads(world).find((candidate) => candidate.kind === 'crisis-cycle');

    expect(settlement?.eventCount).toBe(4);
    expect(settlement?.reversals).toBeGreaterThanOrEqual(1);
    expect(crisis?.eventCount).toBe(2);
    expect(engine.contextFor(scene(history[3] as HistoricalEvent), world)?.text).toContain('Aven');
  });

  it('remembers knowledge that was lost and rediscovered as a lineage', () => {
    const history = [
      event('discover-writing', 100, 'discovery', { actors: ['a'], locationId: 'a', context: { knowledge: 'durable-records' } }),
      event('lose-writing', 800, 'knowledge-lost', { actors: ['a'], locationId: 'a', context: { knowledge: 'durable-records' }, significance: 0.8 }),
      event('find-writing', 1400, 'knowledge-rediscovered', { actors: ['a'], locationId: 'a', context: { knowledge: 'durable-records' }, significance: 0.85 }),
    ];
    const world = state(history, 1400);
    const engine = new NarrativeThreadEngine();
    const thread = engine.threads(world).find((candidate) => candidate.kind === 'knowledge-lineage');
    const context = engine.contextFor(scene(history[2] as HistoricalEvent), world);

    expect(thread?.eventCount).toBe(3);
    expect(thread?.reversals).toBeGreaterThanOrEqual(1);
    expect(context?.text).toContain('discovered, lost, and found again');
  });

  it('does not manufacture a long-running story from a single event', () => {
    const history = [event('one-crisis', 100, 'harvest-crisis', { actors: ['a'], locationId: 'a' })];
    const engine = new NarrativeThreadEngine();
    expect(engine.threads(state(history, 100))).toHaveLength(0);
  });
});
