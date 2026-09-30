import { describe, expect, it } from 'vitest';
import { firstMilestones, MilestoneIndex } from '../src/historian/Milestones';
import type { HistoricalEvent } from '../src/sim/types';

function event(id: string, type: HistoricalEvent['type'] = 'death'): HistoricalEvent {
  return { id, type, month: 1, actors: ['world'], causes: [], context: {}, outcome: 'Recorded action',
    affectedPopulation: 1, magnitude: 0.7, significance: 0.7, tags: [], summary: 'Recorded action' };
}

describe('incremental milestone history', () => {
  it('preserves first-event order and category semantics while history grows', () => {
    const index = new MilestoneIndex(), history: HistoricalEvent[] = [];
    const events = [event('death-1'), event('death-2'), event('discovery', 'resource-deposit-discovered'),
      { ...event('shelter', 'infrastructure-built'), context: { need: 'housing', temporary: false } },
      { ...event('shelter-2', 'infrastructure-built'), context: { need: 'housing', temporary: false } }];
    for (const entry of events) {
      history.push(entry);
      expect(index.read(history)).toEqual(firstMilestones(history));
    }
  });

  it('does no history traversal for held frames or clock-only changes and inspects only appended records', () => {
    let reads = 0;
    const history = Array.from({ length: 50_000 }, (_, i) => new Proxy(event(`death-${i}`), {
      get(target, key, receiver) { if (key === 'type') reads++; return Reflect.get(target, key, receiver); },
    }));
    const index = new MilestoneIndex();
    index.read(history);
    reads = 0;
    for (let frame = 0; frame < 600; frame++) index.read(history);
    expect(reads).toBe(0);
    history.push(event('new-category', 'recipe-learned'));
    expect(index.read(history).map(e => e.id)).toEqual(['death-0', 'new-category']);
    expect(reads).toBe(0);
  });

  it('rebuilds after capped history compaction even when array identity and length stay unchanged', () => {
    const index = new MilestoneIndex(), history = [event('old'), event('next')];
    index.read(history);
    history.shift(); history.push(event('new-category', 'recipe-learned'));
    expect(index.read(history)).toEqual(firstMilestones(history));
    expect(index.read(history).map(e => e.id)).toEqual(['next', 'new-category']);
  });

  it('forgets the old prefix after archive replacement, truncation and restart', () => {
    const index = new MilestoneIndex(), history = [event('a'), event('b', 'recipe-learned')];
    index.read(history);
    history.pop();
    expect(index.read(history)).toEqual(firstMilestones(history));
    const restored = [event('restored', 'resource-deposit-discovered')];
    expect(index.read(restored)).toEqual(firstMilestones(restored));
    expect(index.read([])).toEqual([]);
    expect(index.read(history)).toEqual(firstMilestones(history));
  });
});
