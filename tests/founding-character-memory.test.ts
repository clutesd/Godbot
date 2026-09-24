import { describe, expect, it } from 'vitest';
import { foundingDocumentaryCast, type FoundingCastMember } from '../src/historian/FoundingCast';
import {
  foundingCharacterNarrativeMemory,
  installFoundingCharacterMemory,
  observeFoundingCharacterScene,
  restoreFoundingCharacterMemory,
} from '../src/historian/FoundingCharacterMemory';
import { Historian } from '../src/historian/Historian';
import type { CandidateScoreBreakdown, ObservationCandidate } from '../src/historian/types';
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
  const simulation = new Simulation({ seed, startMode: 'arrival' });
  simulation.advanceArrival(80);
  expect(simulation.historyRunning).toBe(true);
  return simulation;
}

function firstMember(simulation: Simulation): FoundingCastMember {
  const member = foundingDocumentaryCast(simulation.state)[0];
  if (!member) throw new Error('Expected a founding documentary cast member');
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

function introduce(simulation: Simulation, historian: Historian, member: FoundingCastMember): ObservationCandidate {
  const scene = sceneFor(simulation, member, `founding-cast:introduction:${member.personId}`);
  return observeFoundingCharacterScene(historian, simulation.state, scene);
}

describe('Founding character memory 2b', () => {
  it('turns the first cast introduction into a factual observer-memory baseline', () => {
    const simulation = completedArrival('founding-memory-baseline');
    const historian = new Historian(simulation.config);
    const member = firstMember(simulation);
    const scene = introduce(simulation, historian, member);
    const memory = foundingCharacterNarrativeMemory(historian, member.personId);

    expect(scene.statement.observerMemory?.kind).toBe('founding-character');
    expect(scene.statement.observerMemory?.introduction).toBe(true);
    expect(scene.statement.observerMemory?.callbackApplied).toBe(false);
    expect(memory?.appearances).toBe(1);
    expect(memory?.callbacks).toBe(0);
    expect(memory?.lastObservedMonth).toBe(0);
  });

  it('recalls meaningful home and role changes on the next watched appearance', () => {
    const simulation = completedArrival('founding-memory-change');
    const historian = new Historian(simulation.config);
    const member = firstMember(simulation);
    introduce(simulation, historian, member);

    const person = simulation.state.people.find(candidate => candidate.id === member.personId);
    const otherHome = simulation.state.settlements.find(candidate => candidate.id !== person?.homeId);
    if (!person || !otherHome) throw new Error('Expected founder and alternate settlement');
    simulation.state.month = 6;
    person.homeId = otherHome.id;
    person.role = 'scholar';
    person.occupation = 'keeper';
    person.activity = 'study';

    const scene = observeFoundingCharacterScene(historian, simulation.state, sceneFor(simulation, member, `return:${member.personId}:6`));
    expect(scene.statement.text).toContain('When I last watched');
    expect(scene.statement.text).toContain('now lives at');
    expect(scene.statement.text).toContain('recorded role has changed');
    expect(scene.statement.observerMemory?.callbackApplied).toBe(true);
    expect(scene.statement.epistemicStatus).toBe('derived-statistic');
    expect(historian.validateStatement(scene.statement, simulation.state)).toBe(true);
    expect(foundingCharacterNarrativeMemory(historian, member.personId)?.callbacks).toBe(1);
  });

  it('treats occupation changes as meaningful even when a specific role label stays the same', () => {
    const simulation = completedArrival('founding-memory-occupation');
    const historian = new Historian(simulation.config);
    const member = firstMember(simulation);
    const person = simulation.state.people.find(candidate => candidate.id === member.personId);
    if (!person) throw new Error('Expected founder');
    person.role = 'builder';
    introduce(simulation, historian, member);

    simulation.state.month = 8;
    person.occupation = person.occupation === 'builder' ? 'artisan' : 'builder';
    const scene = observeFoundingCharacterScene(historian, simulation.state, sceneFor(simulation, member, `return:${member.personId}:8`));
    expect(scene.statement.text).toContain('recorded occupation has changed');
    expect(scene.statement.observerMemory?.callbackApplied).toBe(true);
  });

  it('does not turn ordinary activity churn into a character-development callback', () => {
    const simulation = completedArrival('founding-memory-noise');
    const historian = new Historian(simulation.config);
    const member = firstMember(simulation);
    introduce(simulation, historian, member);
    const person = simulation.state.people.find(candidate => candidate.id === member.personId);
    if (!person) throw new Error('Expected founder');

    simulation.state.month = 6;
    person.activity = person.activity === 'farm' ? 'gather' : 'farm';
    const early = observeFoundingCharacterScene(historian, simulation.state, sceneFor(simulation, member, `return:${member.personId}:6`));
    expect(early.statement.observerMemory?.callbackApplied).toBe(false);
    expect(early.statement.text).not.toContain('When I last watched');

    simulation.state.month = 18;
    person.activity = 'craft';
    const later = observeFoundingCharacterScene(historian, simulation.state, sceneFor(simulation, member, `return:${member.personId}:18`));
    expect(later.statement.observerMemory?.callbackApplied).toBe(true);
    expect(later.statement.text).toContain('I last watched');
    expect(later.statement.text).not.toContain('immediate activity has changed');
  });

  it('remembers a person-linked historical event and carries its provenance into the callback', () => {
    const simulation = completedArrival('founding-memory-event');
    const historian = new Historian(simulation.config);
    const member = firstMember(simulation);
    introduce(simulation, historian, member);
    const person = simulation.state.people.find(candidate => candidate.id === member.personId);
    if (!person) throw new Error('Expected founder');

    simulation.state.history.push({
      id: 'memory-test-discovery',
      month: 4,
      type: 'discovery',
      locationId: person.homeId,
      location: { ...person.position },
      actors: [person.id],
      causes: ['practice'],
      context: { name: 'memory-test-practice' },
      outcome: 'A practical insight entered the record.',
      affectedPopulation: 1,
      magnitude: 0.45,
      significance: 0.72,
      tags: ['knowledge'],
      summary: `${person.name} records a practical discovery.`,
    });
    simulation.state.month = 7;

    const scene = observeFoundingCharacterScene(historian, simulation.state, sceneFor(simulation, member, `return:${member.personId}:7`));
    expect(scene.statement.text).toContain('The interval also records');
    expect(scene.statement.text).toContain('practical discovery');
    expect(scene.statement.sourceEventIds).toContain('memory-test-discovery');
    expect(scene.statement.observerMemory?.callbackApplied).toBe(true);
  });

  it('rebuilds observer memory idempotently without changing the simulated person', () => {
    const simulation = completedArrival('founding-memory-restore');
    const originalHistorian = new Historian(simulation.config);
    const member = firstMember(simulation);
    const intro = introduce(simulation, originalHistorian, member);
    const person = simulation.state.people.find(candidate => candidate.id === member.personId);
    if (!person) throw new Error('Expected founder');

    simulation.state.month = 12;
    person.role = 'builder';
    const returnScene = observeFoundingCharacterScene(originalHistorian, simulation.state, sceneFor(simulation, member, `return:${member.personId}:12`));
    const before = { homeId: person.homeId, role: person.role, occupation: person.occupation, prestige: person.prestige, historical: person.historical?.status };

    const restoredHistorian = new Historian(simulation.config);
    const archive = [intro.statement, returnScene.statement];
    restoreFoundingCharacterMemory(restoredHistorian, simulation.state, archive);
    restoreFoundingCharacterMemory(restoredHistorian, simulation.state, archive);
    const restored = foundingCharacterNarrativeMemory(restoredHistorian, member.personId);
    const after = { homeId: person.homeId, role: person.role, occupation: person.occupation, prestige: person.prestige, historical: person.historical?.status };

    expect(restored?.appearances).toBe(2);
    expect(restored?.lastObservedMonth).toBe(12);
    expect(restored?.lastObservation.role).toBe('builder');
    expect(after).toEqual(before);
  });

  it('does not double-count the same live scene if a wrapper sees it twice', () => {
    const simulation = completedArrival('founding-memory-duplicate-scene');
    const historian = new Historian(simulation.config);
    const member = firstMember(simulation);
    const intro = introduce(simulation, historian, member);
    observeFoundingCharacterScene(historian, simulation.state, intro);
    expect(foundingCharacterNarrativeMemory(historian, member.personId)?.appearances).toBe(1);
  });

  it('keeps an archived cast member eligible for later person-follow scenes after resume', () => {
    const simulation = completedArrival('founding-memory-recurring');
    const originalHistorian = new Historian(simulation.config);
    const member = firstMember(simulation);
    const intro = introduce(simulation, originalHistorian, member);
    simulation.state.month = 18;

    const restoredHistorian = new Historian(simulation.config);
    restoreFoundingCharacterMemory(restoredHistorian, simulation.state, [intro.statement]);
    installFoundingCharacterMemory();
    const candidates = restoredHistorian.candidates(simulation.state);

    expect(candidates.some(candidate => candidate.subjectId === member.personId)).toBe(true);
    expect(foundingCharacterNarrativeMemory(restoredHistorian, member.personId)?.appearances).toBe(1);
  });
});
