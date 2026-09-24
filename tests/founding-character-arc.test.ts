import { describe, expect, it } from 'vitest';
import { foundingDocumentaryCast, type FoundingCastMember } from '../src/historian/FoundingCast';
import {
  chooseFoundingCharacterEndingScene,
  foundingCharacterArcCandidate,
  foundingCharacterArcStatus,
  restoreFoundingCharacterArcs,
} from '../src/historian/FoundingCharacterArc';
import { observeFoundingCharacterScene } from '../src/historian/FoundingCharacterMemory';
import { Historian } from '../src/historian/Historian';
import type { CandidateScoreBreakdown, ObservationCandidate } from '../src/historian/types';
import { killPeople } from '../src/sim/people/PersonLifecycle';
import { Simulation } from '../src/sim/Simulation';

const BREAKDOWN: CandidateScoreBreakdown = {
  novelty: 0.5,
  magnitude: 0.2,
  populationAffected: 0.02,
  rarity: 0.4,
  technological: 0,
  political: 0,
  cultural: 0.2,
  consequence: 0.2,
  continuity: 0.6,
  repetitionPenalty: 0,
};

function completedArrival(seed: string): Simulation {
  // Arc tests need stable five-pod geography so failures reflect narrative logic, not world placement.
  const simulation = new Simulation({ seed, startMode: 'arrival', world: { size: 64 } });
  simulation.advanceArrival(80);
  expect(simulation.historyRunning).toBe(true);
  return simulation;
}

function firstMember(simulation: Simulation): FoundingCastMember {
  const member = foundingDocumentaryCast(simulation.state)[0];
  if (!member) throw new Error('Expected founding documentary cast member');
  return member;
}

function sceneFor(simulation: Simulation, member: FoundingCastMember, id: string): ObservationCandidate {
  const person = simulation.state.people.find(candidate => candidate.id === member.personId);
  const home = simulation.state.settlements.find(candidate => candidate.id === person?.homeId);
  const arrival = simulation.state.history.find(event => event.type === 'ARRIVAL_DAY');
  if (!person || !home || !arrival) throw new Error('Expected founder, home, and Arrival Day');
  return {
    id,
    subjectId: person.id,
    kind: 'worker-follow',
    position: person.position,
    title: person.name,
    statement: {
      id: `statement:${id}`,
      month: simulation.state.month,
      text: `${person.name} is observed at ${home.name}.`,
      epistemicStatus: 'recorded-fact',
      sourceEventIds: [arrival.id],
      sourceEntityIds: [person.id, home.id],
      sourceArchiveIds: [],
      claims: { entityIds: [person.id, home.id], eventType: 'ARRIVAL_DAY' },
    },
    score: 0.5,
    interest: 0.4,
    audioCategory: 'settlement',
    breakdown: { ...BREAKDOWN },
  };
}

function rememberedScenes(simulation: Simulation, member: FoundingCastMember): ObservationCandidate[] {
  const historian = new Historian(simulation.config);
  const intro = observeFoundingCharacterScene(
    historian,
    simulation.state,
    sceneFor(simulation, member, `founding-cast:introduction:${member.personId}`),
  );
  const person = simulation.state.people.find(candidate => candidate.id === member.personId);
  const otherHome = simulation.state.settlements.find(candidate => candidate.id !== person?.homeId);
  if (!person || !otherHome) throw new Error('Expected founder and alternate home');
  simulation.state.month = 18;
  person.homeId = otherHome.id;
  person.role = 'scholar';
  person.occupation = 'keeper';
  const returnScene = observeFoundingCharacterScene(
    historian,
    simulation.state,
    sceneFor(simulation, member, `return:${member.personId}:18`),
  );
  return [intro, returnScene];
}

describe('Founding character life arcs 2c', () => {
  it('keeps the documentary cast identity stable after a watched founder dies', () => {
    const simulation = completedArrival('founding-arc-cast-stability');
    const before = foundingDocumentaryCast(simulation.state).map(member => member.personId);
    const selected = simulation.state.people.find(person => person.id === before[0]);
    if (!selected) throw new Error('Expected selected founder');
    simulation.state.month = 36;
    killPeople(simulation.state, [selected], 'age');
    const after = foundingDocumentaryCast(simulation.state).map(member => member.personId);
    expect(after).toEqual(before);
    expect(selected.alive).toBe(false);
    expect(selected.diedMonth).toBe(36);
  });

  it('recognizes a genuine trajectory across remembered appearances without mutating the person', () => {
    const simulation = completedArrival('founding-arc-trajectory');
    const member = firstMember(simulation);
    const scenes = rememberedScenes(simulation, member);
    const historian = new Historian(simulation.config);
    restoreFoundingCharacterArcs(historian, simulation.state, scenes.map(scene => scene.statement));
    const person = simulation.state.people.find(candidate => candidate.id === member.personId);
    if (!person) throw new Error('Expected founder');
    const before = {
      homeId: person.homeId,
      role: person.role,
      occupation: person.occupation,
      prestige: person.prestige,
      children: [...person.children],
      historical: person.historical?.status,
    };

    const candidate = foundingCharacterArcCandidate(historian, simulation.state, member.personId);
    const after = {
      homeId: person.homeId,
      role: person.role,
      occupation: person.occupation,
      prestige: person.prestige,
      children: [...person.children],
      historical: person.historical?.status,
    };

    expect(candidate).toBeDefined();
    expect(candidate?.title).toContain('A LIFE IN MOTION');
    expect(candidate?.statement.text).toContain('no longer lives where I first met');
    expect(candidate?.statement.text).toContain('role attached');
    expect(candidate && historian.validateStatement(candidate.statement, simulation.state)).toBe(true);
    expect(after).toEqual(before);
  });

  it('lets a dedicated arc own its narration instead of receiving a duplicate 2b callback', () => {
    const simulation = completedArrival('founding-arc-owned-narrative');
    const member = firstMember(simulation);
    const scenes = rememberedScenes(simulation, member);
    const historian = new Historian(simulation.config);
    restoreFoundingCharacterArcs(historian, simulation.state, scenes.map(scene => scene.statement));
    const candidate = foundingCharacterArcCandidate(historian, simulation.state, member.personId);
    if (!candidate) throw new Error('Expected arc candidate');

    const narrated = observeFoundingCharacterScene(historian, simulation.state, candidate);
    expect(narrated.statement.text).not.toContain('When I last watched');
    expect(narrated.statement.observerMemory?.kind).toBe('founding-character');
  });

  it('gives a watched founder a grounded one-time ending when the life ends', () => {
    const simulation = completedArrival('founding-arc-ending');
    const member = firstMember(simulation);
    const scenes = rememberedScenes(simulation, member);
    const historian = new Historian(simulation.config);
    restoreFoundingCharacterArcs(historian, simulation.state, scenes.map(scene => scene.statement));
    const person = simulation.state.people.find(candidate => candidate.id === member.personId);
    if (!person) throw new Error('Expected founder');
    simulation.state.month = 54;
    killPeople(simulation.state, [person], 'age');

    const ending = chooseFoundingCharacterEndingScene(historian, simulation.state);
    expect(ending).toBeDefined();
    expect(ending?.title).toContain(person.name);
    expect(ending?.statement.text).toContain('This life is complete in the record');
    expect(ending?.statement.sourceEventIds.some(id => simulation.state.history.find(event => event.id === id)?.type === 'death')).toBe(true);
    expect(ending && historian.validateStatement(ending.statement, simulation.state)).toBe(true);
    expect(foundingCharacterArcStatus(historian, person.id)?.completed).toBe(true);
    expect(chooseFoundingCharacterEndingScene(historian, simulation.state)).toBeUndefined();
  });

  it('preserves an ending across archive restoration so a reload does not replay the memorial', () => {
    const simulation = completedArrival('founding-arc-ending-restore');
    const member = firstMember(simulation);
    const scenes = rememberedScenes(simulation, member);
    const historian = new Historian(simulation.config);
    restoreFoundingCharacterArcs(historian, simulation.state, scenes.map(scene => scene.statement));
    const person = simulation.state.people.find(candidate => candidate.id === member.personId);
    if (!person) throw new Error('Expected founder');
    simulation.state.month = 60;
    killPeople(simulation.state, [person], 'age');
    const ending = chooseFoundingCharacterEndingScene(historian, simulation.state);
    if (!ending) throw new Error('Expected ending');

    const restored = new Historian(simulation.config);
    restoreFoundingCharacterArcs(restored, simulation.state, [...scenes.map(scene => scene.statement), ending.statement]);
    expect(foundingCharacterArcStatus(restored, person.id)?.completed).toBe(true);
    expect(chooseFoundingCharacterEndingScene(restored, simulation.state)).toBeUndefined();
  });

  it('can close an ordinary watched life without manufacturing fame or simulation importance', () => {
    const simulation = completedArrival('founding-arc-ordinary-ending');
    const member = firstMember(simulation);
    const historian = new Historian(simulation.config);
    const intro = observeFoundingCharacterScene(
      historian,
      simulation.state,
      sceneFor(simulation, member, `founding-cast:introduction:${member.personId}`),
    );
    restoreFoundingCharacterArcs(historian, simulation.state, [intro.statement]);
    const person = simulation.state.people.find(candidate => candidate.id === member.personId);
    if (!person) throw new Error('Expected founder');
    const statusBefore = person.historical?.status ?? 'ordinary';
    simulation.state.month = 42;
    killPeople(simulation.state, [person], 'age');

    const ending = chooseFoundingCharacterEndingScene(historian, simulation.state);
    expect(ending).toBeDefined();
    expect((person.historical?.status ?? 'ordinary')).toBe(statusBefore);
    expect(ending?.statement.text).toContain('I had watched this life once before its ending');
  });
});
