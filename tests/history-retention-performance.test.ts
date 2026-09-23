import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import type { HistoricalEvent } from '../src/sim/types';

function legacyTrim(events: HistoricalEvent[], limit: number): HistoricalEvent[] {
  let excess = events.length - limit;
  const kept: HistoricalEvent[] = [];
  for (const event of events) {
    if (excess > 0 && event.significance < 0.3) {
      excess -= 1;
      continue;
    }
    kept.push(event);
  }
  const anchors = kept.filter((event) => event.type === 'ARRIVAL_DAY');
  const ordinary = kept.filter((event) => event.type !== 'ARRIVAL_DAY');
  return [...anchors, ...ordinary.slice(-Math.max(1, limit - anchors.length))];
}

function invokeTrim(simulation: Simulation): void {
  (simulation as unknown as { trimHistory(): void }).trimHistory();
}

describe('history retention compaction', () => {
  it('preserves the previous retention result while compacting routine history', () => {
    const simulation = new Simulation({
      seed: 'history-compaction',
      startMode: 'established',
      startingPopulation: 30,
      settlementCount: [2, 2],
      world: { size: 20 },
      simulation: { historyLimit: 6 },
    });
    const template = simulation.state.history[0]!;
    simulation.state.history = Array.from({ length: 10 }, (_, index) => ({
      ...structuredClone(template),
      id: `event-${index + 1}`,
      sequence: index + 1,
      significance: index % 2 === 0 ? 0.1 : 0.8,
    }));
    const expected = legacyTrim(structuredClone(simulation.state.history), 6).map((event) => event.id);

    invokeTrim(simulation);

    expect(simulation.state.history.map((event) => event.id)).toEqual(expected);
    expect(simulation.state.history).toHaveLength(6);
  });

  it('preserves permanent Arrival Day anchors in the rare hard-cap fallback', () => {
    const simulation = new Simulation({
      seed: 'history-compaction-anchor',
      startMode: 'established',
      startingPopulation: 30,
      settlementCount: [2, 2],
      world: { size: 20 },
      simulation: { historyLimit: 4 },
    });
    const template = simulation.state.history[0]!;
    simulation.state.history = Array.from({ length: 7 }, (_, index) => ({
      ...structuredClone(template),
      id: `event-${index + 1}`,
      sequence: index + 1,
      type: index === 1 ? 'ARRIVAL_DAY' : template.type,
      significance: 0.9,
    })) as HistoricalEvent[];
    const expected = legacyTrim(structuredClone(simulation.state.history), 4).map((event) => event.id);

    invokeTrim(simulation);

    expect(simulation.state.history.map((event) => event.id)).toEqual(expected);
    expect(simulation.state.history.some((event) => event.type === 'ARRIVAL_DAY')).toBe(true);
  });
});
