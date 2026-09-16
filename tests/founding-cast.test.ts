import { describe, expect, it } from 'vitest';
import {
  chooseFoundingCastScene,
  FOUNDING_CAST_TARGET_SIZE,
  foundingCastProgress,
  foundingDocumentaryCast,
  installFoundingCastPacing,
} from '../src/historian/FoundingCast';
import {
  chooseFoundingChapterScene,
  foundingChapterBaseline,
  foundingChapterProgress,
} from '../src/historian/FoundingChapter';
import {
  chooseFoundingContinuityScene,
  foundingContinuityProgress,
} from '../src/historian/FoundingContinuity';
import { Historian } from '../src/historian/Historian';
import { PresentationDirector } from '../src/historian/PresentationDirector';
import { Simulation } from '../src/sim/Simulation';

function completedArrival(seed: string): Simulation {
  const simulation = new Simulation({ seed, startMode: 'arrival' });
  simulation.advanceArrival(60);
  expect(simulation.historyRunning).toBe(true);
  return simulation;
}

function completeOrientation(simulation: Simulation, historian: Historian): void {
  const baseline = foundingChapterBaseline(simulation.state);
  if (!baseline) throw new Error('Expected founding baseline');
  let guard = baseline.communities.length + 2;
  while (foundingChapterProgress(historian, simulation.state).phase !== 'complete' && guard-- > 0) {
    expect(chooseFoundingChapterScene(historian, simulation.state)).toBeDefined();
  }
  expect(foundingChapterProgress(historian, simulation.state).phase).toBe('complete');
  expect(chooseFoundingChapterScene(historian, simulation.state)).toBeUndefined();
}

describe('Founding documentary cast 2a', () => {
  it('selects a small deterministic cast across distinct founding communities', () => {
    const simulation = completedArrival('founding-cast-selection');
    const first = foundingDocumentaryCast(simulation.state);
    const second = foundingDocumentaryCast(simulation.state);

    expect(first).toHaveLength(FOUNDING_CAST_TARGET_SIZE);
    expect(second.map(member => member.personId)).toEqual(first.map(member => member.personId));
    expect(new Set(first.map(member => member.personId)).size).toBe(first.length);
    expect(new Set(first.map(member => member.settlementId)).size).toBe(first.length);
    expect(first.every(member => member.arrivalAgeYears >= 18 && member.arrivalAgeYears <= 50)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('keeps cast identity stable when mutable careers, prestige, and expertise change', () => {
    const simulation = completedArrival('founding-cast-stability');
    const before = foundingDocumentaryCast(simulation.state).map(member => member.personId);
    const founder = simulation.state.people.find(person => person.id === before[0]);
    if (!founder) throw new Error('Expected selected founder');
    founder.prestige = 1;
    founder.occupation = 'keeper';
    founder.role = 'scholar';
    for (const expertise of founder.expertise ?? []) expertise.competence = 1;

    const after = foundingDocumentaryCast(simulation.state).map(member => member.personId);
    expect(after).toEqual(before);
  });

  it('introduces a cast member only after the Historian has revisited that landing community', () => {
    const simulation = completedArrival('founding-cast-introduction');
    const historian = new Historian(simulation.config);
    completeOrientation(simulation, historian);
    const cast = foundingDocumentaryCast(simulation.state);
    expect(chooseFoundingContinuityScene(historian, simulation.state)?.title).toBe('THE FIRST SEASONS');
    expect(chooseFoundingCastScene(historian, simulation.state)).toBeUndefined();

    const introduced: string[] = [];
    const baseline = foundingChapterBaseline(simulation.state);
    if (!baseline) throw new Error('Expected founding baseline');
    for (let index = 0; index < baseline.communities.length; index += 1) {
      simulation.step(1);
      const communityScene = chooseFoundingContinuityScene(historian, simulation.state);
      expect(communityScene).toBeDefined();
      const castScene = chooseFoundingCastScene(historian, simulation.state);
      if (!castScene) continue;
      introduced.push(castScene.subjectId);
      const member = cast.find(candidate => candidate.personId === castScene.subjectId);
      expect(member).toBeDefined();
      expect(foundingContinuityProgress(historian, simulation.state).visitedSettlementIds).toContain(member?.settlementId);
      expect(castScene.statement.text).toContain('I will remember this name');
      expect(historian.validateStatement(castScene.statement, simulation.state)).toBe(true);
    }

    expect(introduced).toEqual(cast.map(member => member.personId));
    expect(foundingCastProgress(historian, simulation.state).phase).toBe('complete');
  });

  it('holds authoritative time while a person is introduced and restores the prior auto-run state', () => {
    const simulation = completedArrival('founding-cast-pacing');
    const historian = new Historian(simulation.config);
    const originalAutoRun = simulation.config.autoRun;
    installFoundingCastPacing();
    const presentation = new PresentationDirector(simulation.config);
    completeOrientation(simulation, historian);
    expect(chooseFoundingContinuityScene(historian, simulation.state)).toBeDefined();

    let castScene = undefined as ReturnType<typeof chooseFoundingCastScene>;
    while (!castScene) {
      simulation.step(1);
      expect(chooseFoundingContinuityScene(historian, simulation.state)).toBeDefined();
      castScene = chooseFoundingCastScene(historian, simulation.state);
    }
    expect(simulation.config.autoRun).toBe(false);
    expect(presentation.tickBudget(simulation.state)).toBe(0);

    // The next cast lookup releases the presentation hold before any later layer proceeds.
    chooseFoundingCastScene(historian, simulation.state);
    expect(simulation.config.autoRun).toBe(originalAutoRun);
    expect(presentation.tickBudget(simulation.state)).toBeGreaterThan(0);
  });

  it('uses real current work and expertise without changing the person simulation chose to make important', () => {
    const simulation = completedArrival('founding-cast-grounding');
    const historian = new Historian(simulation.config);
    completeOrientation(simulation, historian);
    expect(chooseFoundingContinuityScene(historian, simulation.state)).toBeDefined();
    const castIds = new Set(foundingDocumentaryCast(simulation.state).map(member => member.personId));

    let scene = undefined as ReturnType<typeof chooseFoundingCastScene>;
    let statusBefore: string | undefined;
    while (!scene) {
      simulation.step(1);
      expect(chooseFoundingContinuityScene(historian, simulation.state)).toBeDefined();
      const progress = foundingContinuityProgress(historian, simulation.state);
      const nextMember = foundingDocumentaryCast(simulation.state).find(member => progress.visitedSettlementIds.includes(member.settlementId));
      if (nextMember) statusBefore = simulation.state.people.find(person => person.id === nextMember.personId)?.historical?.status;
      scene = chooseFoundingCastScene(historian, simulation.state);
    }
    const person = simulation.state.people.find(candidate => candidate.id === scene?.subjectId);
    expect(person).toBeDefined();
    expect(castIds.has(person!.id)).toBe(true);
    expect(scene?.statement.text).toContain(person!.name);
    expect(scene?.statement.text).toContain((person!.role ?? person!.occupation).replaceAll('-', ' '));
    expect(person?.historical?.status).toBe(statusBefore);
  });

  it('does nothing for a non-arrival start', () => {
    const simulation = new Simulation({ seed: 'founding-cast-established', startMode: 'established' });
    const historian = new Historian(simulation.config);
    expect(foundingDocumentaryCast(simulation.state)).toHaveLength(0);
    expect(foundingCastProgress(historian, simulation.state).phase).toBe('unavailable');
    expect(chooseFoundingCastScene(historian, simulation.state)).toBeUndefined();
  });
});
