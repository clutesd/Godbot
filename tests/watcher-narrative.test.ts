import * as THREE from 'three';
import { CameraDirector } from '../src/render/CameraDirector';
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
  it('restores watcher narration after a queued settlement is refreshed, without duplicating it', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const settlement = sim.state.settlements[0]!;
    const scene = () => historian.candidates(sim.state).find(c => c.id === `settlement:${settlement.id}`)!;
    for (let i = 0; i < 5; i++) historian.acquireScene(scene(), sim.state, false);
    sim.state.month = 220;
    const refreshed = historian.refreshScene(scene(), sim.state)!;
    expect(refreshed.statement.text).not.toContain('I first observed');
    historian.acquireScene(refreshed, sim.state, true);
    expect(refreshed.statement.text).toContain(`I first observed ${settlement.name} 10 years ago.`);
    expect(refreshed.statement.text.match(/I first observed/g)).toHaveLength(1);
    expect(historian.validateStatement(refreshed.statement, sim.state)).toBe(true);
  });

  it('shows grounded watcher text in the actual camera caption at physical arrival', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    sim.state.arrival = undefined;
    const milestone = { ...event(100, 'atomic'), type: 'atomic-threshold' as const,
      location: sim.state.settlements[0]!.position, summary: 'An atomic threshold is recorded.' };
    sim.state.history.push(milestone);
    const director = new CameraDirector(new THREE.PerspectiveCamera(38, 1.6, 0.01, 200), sim.config, historian);
    let caption = '';
    for (let frame = 0; frame < 1800 && !caption; frame++) {
      director.update(0.1, frame / 10, sim.state, () => 0);
      if (director.observation.narrationVisible && director.observation.eventType === 'atomic-threshold') caption = director.observation.detail;
    }
    expect(caption).toContain('earliest surviving record');
    expect(caption).not.toContain('For generations');
    expect(caption.match(/earliest surviving record/g)).toHaveLength(1);
  });

  it('keeps the causal link when a milestone has other tempting editorial remarks', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    sim.state.history.push(event(98, 'root'), { ...event(100, 'threshold', ['root']), type: 'atomic-threshold' });
    const scene = historian.chooseScene(sim.state, 'threshold');
    historian.acquireScene(historian.refreshScene(scene, sim.state)!, sim.state, true);
    expect(scene.statement.text).toContain('reach back 2 months');
    expect(scene.statement.text).not.toContain('ordinary combustion');
    expect(scene.statement.sourceEventIds).toContain('root');
  });

  it('describes only changed settlement measures rather than repeating a dashboard', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const settlement = sim.state.settlements[0]!;
    const scene = () => historian.candidates(sim.state).find(c => c.id === `settlement:${settlement.id}`)!;
    historian.acquireScene(scene(), sim.state, true);
    sim.state.month++;
    settlement.foodSecurity = Math.max(0, settlement.foodSecurity - 0.1);
    const changed = scene();
    expect(changed.statement.text).toContain('food security fell by 10 percentage points');
    expect(changed.statement.text).not.toContain('population is unchanged');
    expect(changed.statement.text).not.toContain('buildings are recorded here');
    expect(historian.validateStatement(changed.statement, sim.state)).toBe(true);
  });

  it('keeps an unheard warning available through refresh and consumes it only when narrated', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    historian.predictions.push({ id: 'warning', madeMonth: 0, horizonMonth: 96, subjectIds: ['world'],
      sourceEntityIds: ['world'], predictedEventType: 'war-declared', resolved: true, occurred: false });
    sim.state.history.push(event(100, 'context'));
    const context = () => historian.chooseScene(sim.state, 'context');
    const silent = historian.candidates(sim.state).find(c => c.id.startsWith('settlement:'))!;
    historian.acquireScene(historian.refreshScene(context(), sim.state)!, sim.state, false);
    for (let i = 0; i < 3; i++) historian.acquireScene(silent, sim.state, false);
    const voiced = historian.refreshScene(context(), sim.state)!;
    historian.acquireScene(voiced, sim.state, true);
    expect(voiced.statement.text).toContain('An earlier warning passed');
    for (let i = 0; i < 3; i++) historian.acquireScene(silent, sim.state, false);
    expect(context().statement.text).not.toContain('An earlier warning passed');
  });

});
