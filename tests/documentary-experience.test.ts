// Exercise the same installed layers as the application, including actual physical flights.
import '../godbox.config';
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';
import { CameraDirector } from '../src/render/CameraDirector';
import { CinematicSequencePlanner } from '../src/render/CinematicSequencePlanner';
import type { HistoricalEvent, HistoricalEventType } from '../src/sim/types';

function fixture() {
  const sim = new Simulation({ seed: 'documentary-experience', startMode: 'established',
    startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 } });
  sim.state.arrival = undefined;
  sim.state.month = 100;
  sim.state.history = [];
  for (const cell of sim.state.world.cells) cell.wood = 0;
  for (const place of sim.state.settlements) place.structurePlots = [];
  return sim;
}
function event(sim: Simulation, type: HistoricalEventType, id: string = type, outcome = `Recorded outcome for ${id}.`): HistoricalEvent {
  const place = sim.state.settlements[0]!;
  return { id, type, month: sim.state.month, location: { ...place.position }, locationId: place.id,
    actors: [place.id], causes: [], context: {}, outcome, summary: `A ${type} is recorded in ${place.name}.`,
    affectedPopulation: 12, magnitude: 0.8, significance: 0.84, tags: [] };
}

describe('documentary experience budgets', () => {
  it('acquires and interprets a paused backlog, bounds empty travel/gaps/repetition, and never consumes transit evidence', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const events = ['political-transition', 'major-migration', 'harvest-crisis'].map(type => event(sim, type as HistoricalEventType));
    sim.state.history.push(...events);
    const director = new CameraDirector(new PerspectiveCamera(38, 1.6, 0.01, 200), sim.config, historian);
    const acquired = new Set<string>(), narrated = new Set<string>(), subjects = new Set<string>(), captions: string[] = [];
    let emptyTransit = 0, gap = 0, maxGap = 0, revision = -1, lastSubject = '', streak = 0, maxStreak = 0;
    const before = JSON.stringify(sim.state);
    for (let frame = 0; frame < 6000; frame++) {
      director.update(0.1, frame / 10, sim.state, () => 0);
      const view = director.observation;
      if (view.label === 'Following history') emptyTransit += 0.1;
      const strongSilence = Boolean(view.sceneId && ['landscape-pause', 'night-transition', 'worker-follow', 'street-observation'].includes(view.kind));
      gap = view.narrationVisible || strongSilence ? 0 : gap + 0.1;
      maxGap = Math.max(maxGap, gap);
      if (view.revision === revision) continue;
      revision = view.revision;
      if (view.statement) expect(historian.validateStatement(view.statement, sim.state)).toBe(true);
      if (!view.sceneId) {
        // Transit may remember an acquired event, but never announce the pending one.
        for (const id of view.statement?.sourceEventIds ?? []) expect(acquired.has(id)).toBe(true);
        continue;
      }
      const scene = director.current()!;
      subjects.add(scene.subjectId);
      streak = scene.subjectId === lastSubject ? streak + 1 : 1;
      lastSubject = scene.subjectId; maxStreak = Math.max(maxStreak, streak);
      if (scene.event) {
        acquired.add(scene.event.id);
        if (view.narrationVisible) {
          narrated.add(scene.event.id);
          expect(view.detail).not.toContain('earliest surviving record');
          expect(view.detail).toContain(scene.event.outcome);
        }
      }
      if (view.narrationVisible) captions.push(view.detail);
    }
    expect([...acquired].sort()).toEqual(events.map(e => e.id).sort());
    expect([...narrated].sort()).toEqual(events.map(e => e.id).sort());
    expect(emptyTransit).toBeLessThan(30); // <5% of ten minutes
    expect(maxGap).toBeLessThan(75);
    expect(maxStreak).toBeLessThanOrEqual(6);
    expect(subjects.size).toBeGreaterThanOrEqual(4);
    expect(captions.filter((text, i) => i > 0 && text === captions[i - 1]).length).toBeLessThan(3);
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it.each<HistoricalEventType>(['discovery', 'knowledge-adopted', 'institution-formed', 'major-migration',
    'harvest-crisis', 'infrastructure-built', 'political-transition', 'death', 'recovery', 'industrialization',
    'atomic-threshold', 'first-orbit', 'civilization-collapse', 'civilization-recovery'])('interprets %s using its own recorded predecessor and outcome', type => {
    const sim = fixture(), historian = new Historian(sim.config);
    const previous = { ...event(sim, 'response-attempted', 'previous'), month: 98,
      summary: 'The community attempted to restore its water supply.' };
    const current = { ...event(sim, type), causes: [previous.id], outcome: 'Water service was restored after the recorded attempt.' };
    sim.state.history.push(previous, current);
    const scene = historian.chooseScene(sim.state, current.id);
    historian.acquireScene(scene, sim.state, true);
    expect(scene.statement.text).toContain(previous.summary);
    expect(scene.statement.text).toContain(current.outcome);
    expect(scene.statement.sourceEventIds).toContain(previous.id);
    expect(scene.statement.text).not.toContain('earliest surviving record');
    expect(historian.validateStatement(scene.statement, sim.state)).toBe(true);
  });

  it('stays with the event through reveal despite an unrelated nearby high-scoring event', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const anchorEvent = event(sim, 'infrastructure-built');
    const unrelated = { ...event(sim, 'atomic-threshold'), significance: 0.99 };
    sim.state.history.push(anchorEvent, unrelated);
    const anchor = historian.chooseScene(sim.state, anchorEvent.id);
    const candidates = historian.candidates(sim.state);
    const before = JSON.stringify(candidates);
    const planner = new CinematicSequencePlanner();
    const shots = [planner.plan(sim.state, anchor, candidates)];
    while (planner.hasPlannedShot()) shots.push(planner.takePlannedShot()!);
    expect(shots[0]!.scene.event?.id).toBe(anchorEvent.id);
    expect(shots[0]!.narrate).toBe(true);
    expect(shots.some(s => s.scene.event?.id === unrelated.id)).toBe(false);
    expect(shots.some(s => s.role === 'reveal')).toBe(true);
    expect(shots.every(s => s.threadId === shots[0]!.threadId)).toBe(true);
    expect(shots.filter(s => s.narrate).length).toBeLessThanOrEqual(2);
    expect(shots.some(s => s.scale === 'human' || s.scale === 'detail')).toBe(true);
    expect(JSON.stringify(candidates)).toBe(before);
  });

  it('uses a same-month recorded predecessor without leaking a later same-month event', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const earlier = event(sim, 'response-attempted', 'earlier');
    const current = { ...event(sim, 'recovery'), causes: [earlier.id, 'later'] };
    const later = { ...event(sim, 'discovery', 'later'), significance: 1 };
    sim.state.history.push(earlier, current, later);
    const scene = historian.chooseScene(sim.state, current.id);
    historian.acquireScene(scene, sim.state, true);
    expect(scene.statement.text).toContain(earlier.summary);
    expect(scene.statement.text).not.toContain(later.summary);
    expect(scene.statement.sourceEventIds).not.toContain(later.id);
    expect(historian.validateStatement(scene.statement, sim.state)).toBe(true);
  });

  it('replays the same physical acquisitions and captions while live history advances', () => {
    function replay() {
      const sim = fixture(), historian = new Historian(sim.config);
      const director = new CameraDirector(new PerspectiveCamera(38, 1.6, 0.01, 200), sim.config, historian);
      const trace: unknown[] = [];
      let revision = -1;
      for (let frame = 0; frame < 1200; frame++) {
        if (frame % 40 === 0) sim.step();
        director.update(0.1, frame / 10, sim.state, () => 0);
        const view = director.observation;
        if (view.statement) expect(historian.validateStatement(view.statement, sim.state)).toBe(true);
        if (view.revision !== revision) {
          revision = view.revision;
          trace.push([frame, view.sceneId, view.detail, view.narrationVisible]);
        }
      }
      return { trace, state: sim.state };
    }
    const first = replay(), second = replay();
    expect(second).toEqual(first);
    expect(first.trace.length).toBeGreaterThan(5);
  });

  it('does not treat shared place, a future event, or a semantic cause label as proof of causation', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const previous = { ...event(sim, 'harvest-crisis', 'previous'), month: 90 };
    const future = { ...event(sim, 'discovery', 'future'), month: 101 };
    const current = { ...event(sim, 'recovery'), causes: ['restored-food-stores', future.id] };
    sim.state.history.push(previous, current, future);
    const scene = historian.chooseScene(sim.state, current.id);
    historian.acquireScene(scene, sim.state, true);
    expect(scene.statement.text).not.toContain('roots of this moment');
    expect(scene.statement.sourceEventIds).not.toContain(future.id);
    expect(scene.statement.text).toContain(previous.summary);
    expect(historian.validateStatement(scene.statement, sim.state)).toBe(true);
  });
});
