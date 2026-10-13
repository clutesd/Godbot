import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { HistoryEvidence } from '../src/historian/HistoryEvidence';
import { Historian } from '../src/historian/Historian';
import { DocumentaryMemory } from '../src/historian/DocumentaryMemory';
import { personStory } from '../src/historian/Narrative';
import { CameraDirector } from '../src/render/CameraDirector';
import { Simulation } from '../src/sim/Simulation';
import type { HistoricalEvent } from '../src/sim/types';
import type { HistorianStatement } from '../src/historian/types';

function fixture() {
  const sim = new Simulation({ seed: 'editorial-prose', startMode: 'established',
    startingPopulation: 24, settlementCount: [1, 1], world: { size: 20 } });
  sim.state.arrival = undefined; sim.state.month = 100; sim.state.history = [];
  return sim;
}
function event(id: string, month = 100, type: HistoricalEvent['type'] = 'discovery'): HistoricalEvent {
  return { id, month, type, actors: ['world'], causes: [], context: {}, summary: 'A new method is discovered.',
    outcome: 'Trials confirm it.', affectedPopulation: 24, magnitude: 0.8, significance: 0.9, tags: [] };
}

describe('incremental historical evidence', () => {
  it('reads only the appended prefix on a growing archive', () => {
    let reads = 0;
    const records = Array.from({ length: 5000 }, (_, i) => event(`record-${i}`, i, 'birth'));
    const history = new Proxy(records, { get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    } });
    const index = new HistoryEvidence().read(history, 5000);
    expect(index.count('birth')).toBe(5000);
    reads = 0; records.push(event('new-discovery', 5000));
    index.read(history, 5000);
    expect(reads).toBeLessThan(10);
    expect(index.count('birth')).toBe(5000);
    expect(index.event('new-discovery')?.id).toBe('new-discovery');
  });

  it('rebuilds after compaction and equal-length history replacement', () => {
    const history = [event('first', 1), event('second', 2)];
    const index = new HistoryEvidence().read(history, 100);
    history.shift(); history.push(event('third', 3));
    index.read(history, 100);
    expect(index.event('first')).toBeUndefined();
    expect(index.isFirst(history[0]!)).toBe(true);
    expect(index.count('discovery')).toBe(2);
    index.read(Object.freeze([event('replacement')]), 100);
    expect(index.event('second')).toBeUndefined();
    expect(index.count('discovery')).toBe(1);
  });

  it('excludes future evidence from counts and firsts, including on replay rewind', () => {
    const future = event('future', 101), current = event('current', 100);
    const history = Object.freeze([future, current]);
    const index = new HistoryEvidence().read(history, 100);
    expect(index.count('discovery')).toBe(1);
    expect(index.isFirst(current)).toBe(true);
    index.read(history, 101);
    expect(index.count('discovery')).toBe(2);
    index.read(history, 99);
    expect(index.count('discovery')).toBe(0);
    expect(index.isFirst(current)).toBe(false);
  });

  it('recognizes new historical actors appended within the same authoritative month', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const statement: HistorianStatement = { id: 'actor-evidence', month: 100, text: 'A new method is discovered.',
      epistemicStatus: 'recorded-fact', sourceEventIds: ['new'], sourceEntityIds: ['new-actor'], sourceArchiveIds: [], claims: {} };
    expect(historian.validateStatement(statement, sim.state)).toBe(false);
    sim.state.history.push({ ...event('new'), actors: ['new-actor'] });
    expect(historian.validateStatement(statement, sim.state)).toBe(true);
    sim.state.history.push(event('future', 101));
    expect(historian.validateStatement({ ...statement, sourceEventIds: ['future'] }, sim.state)).toBe(false);
  });
});

describe('readable, grounded documentary storytelling', () => {
  it('connects visible work to a named teacher and the skills surviving their death', () => {
    const sim = fixture(), learner = sim.state.people[0]!, teacher = sim.state.people[1]!;
    learner.activity = 'farm'; learner.expertise = [{ domain: 'agriculture', competence: 0.65, teacherId: teacher.id, lastPractisedMonth: 100 }];
    const home = sim.state.settlements[0]!;
    const alive = personStory(learner, home, sim.state.people, false, 100);
    expect(alive.text).toContain('working the fields');
    expect(alive.text).toContain(`${teacher.name} taught them farming.`);
    expect(alive.sourceIds).toContain(teacher.id);
    expect(alive.text).not.toContain('competence');
    teacher.alive = false;
    const legacy = personStory(learner, home, sim.state.people, true, 100);
    expect(legacy.text).toContain(`Their teacher, ${teacher.name}, has died`);
    expect(legacy.text).toContain('what they learned about farming remains');
    expect(legacy.text.split(/\s+/).length).toBeLessThan(55);
  });

  it('does not expose a missing teacher ID or repeat an age introduction after narration', () => {
    const sim = fixture(), person = sim.state.people[0]!, historian = new Historian(sim.config);
    person.expertise = [{ domain: 'agriculture', competence: 0.5, teacherId: 'missing-teacher-id', lastPractisedMonth: 100 }];
    const scene = () => historian.candidates(sim.state).find(c => c.id === `person:${person.id}`)!;
    const age = `${person.name}, ${Math.floor(person.ageMonths / 12)}`;
    expect(scene().statement.text).not.toContain('missing-teacher-id');
    historian.acquireScene(scene(), sim.state, false);
    expect(scene().statement.text).toContain(age);
    historian.acquireScene(scene(), sim.state, true);
    expect(scene().statement.text).not.toContain(age);
  });

  it('describes an abandoned town as uninhabited, rather than a person who has died', () => {
    const sim = fixture(), memory = new DocumentaryMemory(), town = sim.state.settlements[0]!;
    memory.observe(sim.state); town.alive = false; sim.state.month++;
    memory.observe(sim.state);
    const caption = memory.candidates(sim.state).find(c => c.subjectId === town.id)!;
    expect(caption.statement.text).toContain(`${town.name} is no longer inhabited.`);
    expect(caption.statement.text).not.toContain('has died');
  });

  it('gives a fresh crisis priority over a recent unfinished founding milestone', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const town = sim.state.settlements[0]!;
    const shelter = { ...event('shelter', 95, 'infrastructure-built'), significance: 0.8,
      locationId: town.id, location: town.position, context: { need: 'housing', temporary: true } };
    const crisis = { ...event('crisis', 100, 'atomic-threshold'), significance: 1, locationId: town.id, location: town.position };
    sim.state.history.push(shelter, crisis);
    const director = new CameraDirector(new PerspectiveCamera(38, 1.6, 0.01, 200), sim.config, historian);
    const find = () => (director as unknown as { findMajorEvent(state: Simulation['state']): HistoricalEvent | undefined }).findMajorEvent(sim.state);
    expect(find()?.id).toBe(crisis.id);
    expect(find()?.id).toBe(crisis.id);
    historian.acquireScene(historian.chooseScene(sim.state, crisis.id), sim.state, true);
    expect(find()?.id).toBe(shelter.id);
  });

  it('uses one editorial pass for selection and sequence planning, then refreshes changed evidence', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const build = vi.spyOn(historian, 'candidates');
    const anchor = historian.chooseScene(sim.state);
    expect(historian.planningCandidates(sim.state, anchor)).toBe(build.mock.results[0]!.value);
    expect(build).toHaveBeenCalledTimes(1);
    historian.planningCandidates(sim.state, anchor);
    expect(build).toHaveBeenCalledTimes(2);
    const next = historian.chooseScene(sim.state);
    sim.state.history.push(event('new'));
    historian.planningCandidates(sim.state, next);
    expect(build).toHaveBeenCalledTimes(4);
    const following = historian.chooseScene(sim.state);
    sim.state.month++;
    historian.planningCandidates(sim.state, following);
    expect(build).toHaveBeenCalledTimes(6);
  });
});
