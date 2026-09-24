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
import { Historian } from '../src/historian/Historian';
import { PresentationDirector } from '../src/historian/PresentationDirector';
import { Simulation } from '../src/sim/Simulation';

function completedArrival(seed: string): Simulation {
  const simulation = new Simulation({ seed, startMode: 'arrival' });
  simulation.advanceArrival(80);
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

  it('makes the cast the immediate human climax, then returns the world to motion', () => {
    const simulation = completedArrival('founding-cast-introduction');
    const historian = new Historian(simulation.config);
    completeOrientation(simulation, historian);
    const cast = foundingDocumentaryCast(simulation.state);
    const baseline = foundingChapterBaseline(simulation.state);
    if (!baseline) throw new Error('Expected founding baseline');

    expect(cast).toHaveLength(2);
    expect(simulation.state.month).toBe(baseline.eventMonth);

    const introduced: string[] = [];
    for (let index = 0; index < cast.length; index += 1) {
      const scene = chooseFoundingCastScene(historian, simulation.state);
      const member = cast[index]!;
      expect(scene?.id).toBe(`founding-cast:introduction:${index}:${member.personId}`);
      expect(scene?.subjectId).toBe(member.personId);
      expect(scene?.title).toContain(member.name);
      expect(scene?.title).toContain(member.settlementName);
      expect(scene?.statement.text).toContain(`${member.arrivalAgeYears} on Arrival Day`);
      expect(scene?.statement.text).not.toContain(member.name);
      expect(scene?.statement.text).not.toContain('We will return to');
      expect(scene?.statement.text.length).toBeLessThan(140);
      expect(historian.validateStatement(scene!.statement, simulation.state)).toBe(true);
      introduced.push(scene!.subjectId);
    }

    expect(introduced).toEqual(cast.map(member => member.personId));
    expect(foundingCastProgress(historian, simulation.state).phase).toBe('introducing');

    const release = chooseFoundingCastScene(historian, simulation.state);
    expect(release?.id).toContain('founding-release:');
    expect(release?.title).toBe('THE FIRST DAY');
    expect(release?.statement.text).toBe('The first day continues.');
    expect(release?.kind).toBe('street-observation');
    expect(foundingCastProgress(historian, simulation.state).phase).toBe('complete');
  });

  it('keeps portraits cinematic while authoritative history continues underneath', () => {
    const simulation = completedArrival('founding-cast-pacing');
    const historian = new Historian(simulation.config);
    const originalAutoRun = simulation.config.autoRun;
    installFoundingCastPacing();
    const presentation = new PresentationDirector(simulation.config);
    completeOrientation(simulation, historian);

    const cast = foundingDocumentaryCast(simulation.state);
    for (let index = 0; index < cast.length; index += 1) {
      const portrait = chooseFoundingCastScene(historian, simulation.state);
      expect(portrait?.id).toContain(`founding-cast:introduction:${index}:`);
      expect(simulation.config.autoRun).toBe(originalAutoRun);
      expect(presentation.tickBudget(simulation.state)).toBeGreaterThan(0);
      expect(presentation.targetSpeed(simulation.state, {
        kind: portrait!.kind,
        interest: portrait!.interest,
        eventType: portrait!.event?.type,
        eventMonth: portrait!.event?.month,
      })).toBeCloseTo(0.08, 5);
    }

    const release = chooseFoundingCastScene(historian, simulation.state);
    expect(release?.id).toContain('founding-release:');
    expect(simulation.config.autoRun).toBe(originalAutoRun);
    expect(presentation.tickBudget(simulation.state)).toBeGreaterThan(0);
    expect(presentation.targetSpeed(simulation.state, {
      kind: release!.kind,
      interest: release!.interest,
      eventType: release!.event?.type,
      eventMonth: release!.event?.month,
    })).toBeCloseTo(0.16, 5);
  });

  it('uses one truthful anchor fact without assigning documentary importance inside the simulation', () => {
    const simulation = completedArrival('founding-cast-grounding');
    const historian = new Historian(simulation.config);
    completeOrientation(simulation, historian);
    const cast = foundingDocumentaryCast(simulation.state);
    const statuses = new Map(cast.map(member => [
      member.personId,
      simulation.state.people.find(person => person.id === member.personId)?.historical?.status,
    ]));

    const scene = chooseFoundingCastScene(historian, simulation.state);
    const person = simulation.state.people.find(candidate => candidate.id === scene?.subjectId);
    expect(person).toBeDefined();
    expect(scene?.statement.text).toContain('on Arrival Day');
    const strongest = [...(person!.expertise ?? [])].sort((a, b) => b.competence - a.competence || a.domain.localeCompare(b.domain))[0];
    if (strongest) {
      expect(scene?.statement.text).toContain(strongest.domain.replaceAll('-', ' '));
      expect(scene?.statement.text).toContain('strongest recorded skill');
    } else {
      expect(scene?.statement.text).toContain((person!.role ?? person!.occupation).replaceAll('-', ' '));
      expect(scene?.statement.text).toContain('works as a');
    }
    for (const member of cast) {
      expect(simulation.state.people.find(candidate => candidate.id === member.personId)?.historical?.status).toBe(statuses.get(member.personId));
    }
  });

  it('does nothing for a non-arrival start', () => {
    const simulation = new Simulation({ seed: 'founding-cast-established', startMode: 'established' });
    const historian = new Historian(simulation.config);
    expect(foundingDocumentaryCast(simulation.state)).toHaveLength(0);
    expect(foundingCastProgress(historian, simulation.state).phase).toBe('unavailable');
    expect(chooseFoundingCastScene(historian, simulation.state)).toBeUndefined();
  });
});
