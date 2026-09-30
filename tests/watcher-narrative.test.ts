import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';
import { installWatcherHistorian } from '../src/historian/WatcherHistorian';
import type { HistoricalEvent } from '../src/sim/types';

installWatcherHistorian();
function fixture() {
  const sim = new Simulation({ seed: 'watcher-narrative', startingPopulation: 24, world: { size: 20 } });
  sim.state.month = 100;
  sim.state.history = [];
  return sim;
}
function event(month: number, id: string, causes: string[] = []): HistoricalEvent {
  return { id, month, type: 'political-transition', actors: ['world'], causes, context: {}, summary: 'Leadership changed.',
    outcome: 'A recorded change', tags: [], significance: 0.8, magnitude: 0.8, affectedPopulation: 12 };
}

describe('watcher narrative grounding', () => {
  it('does not consume a prediction callback while the lens is only considering a scene', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    historian.predictions.push({ id: 'resolved-warning', madeMonth: 0, horizonMonth: 96, subjectIds: ['world'],
      sourceEntityIds: ['world'], predictedEventType: 'war-declared', resolved: true, occurred: false });
    sim.state.history.push(event(100, 'context'));
    const first = historian.chooseScene(sim.state, 'context');
    const second = historian.chooseScene(sim.state, 'context');
    expect(first.statement.text).toContain('An earlier warning passed');
    expect(second.statement.text).toContain('An earlier warning passed');
    historian.acquireScene(second, sim.state);
    expect(historian.statements).toHaveLength(1);
    expect(historian.validateStatement(second.statement, sim.state)).toBe(true);
  });

  it('uses months for a recent causal callback rather than inventing years of history', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    sim.state.history.push(event(98, 'root'), event(100, 'consequence', ['root']));
    const scene = historian.chooseScene(sim.state, 'consequence');
    expect(scene.statement.text).toContain('reach back 2 months');
    expect(scene.statement.text).not.toContain('1 years');
    expect(scene.statement.sourceEventIds).toContain('root');
  });
});
