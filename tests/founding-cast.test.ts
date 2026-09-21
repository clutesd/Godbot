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

  it('frames the cast once, then introduces only people from communities already revisited', () => {
    const simulation = completedArrival('founding-cast-introduction');
    const historian = new Historian(simulation.config);
    completeOrientation(simulation, historian);
    const cast = foundingDocumentaryCast(simulation.state);
    expect(chooseFoundingContinuityScene(historian, simulation.state)?.title).toBe('THE FIRST SEASONS');
    expect(chooseFoundingCastScene(historian, simulation.state)).toBeUndefined();

    const introduced: string[] = [];
    let framingScenes = 0;
    const baseline = foundingChapterBaseline(simulation.state);
    if (!baseline) throw new Error('Expected founding baseline');
    for (let index = 0; index < baseline.communities.length; index += 1) {
      simulation.step(1);
      const communityScene = chooseFoundingContinuityScene(historian, simulation.state);
      expect(communityScene).toBeDefined();

      let castScene = chooseFoundingCastScene(historian, simulation.state);
      if (castScene?.id.startsWith('founding-cast:framing:')) {
        framingScenes += 1;
        expect(castScene.title).toBe('A FEW LIVES');
        expect(castScene.statement.text).toContain(`Arrival Day began with ${baseline.population.toLocaleString()} lives.`);
        expect(castScene.statement.text).toContain(`We will follow ${cast.length.toLocaleString()} of them.`);
        expect(castScene.statement.text).toContain('Not because they are important. Not yet.');
        expect(historian.validateStatement(castScene.statement, simulation.state)).toBe(true);
        castScene = chooseFoundingCastScene(historian, simulation.state);
      }
      if (!castScene) continue;

      expect(castScene.id).toContain('founding-cast:introduction:');
      introduced.push(castScene.subjectId);
      const member = cast.find(candidate => candidate.personId === castScene.subjectId);
      expect(member).toBeDefined();
      expect(foundingContinuityProgress(historian, simulation.state).visitedSettlementIds).toContain(member?.settlementId);
      expect(castScene.statement.text).toContain(member?.name ?? '');
      expect(castScene.statement.text).toContain(`${member?.arrivalAgeYears} on Arrival Day`);
      expect(castScene.statement.text).toContain(member?.settlementName ?? '');
      expect(castScene.statement.text).toContain('We will return to');
      expect(castScene.statement.text).not.toContain('I will remember this name');
      expect(castScene.statement.text.length).toBeLessThan(220);
      expect(historian.validateStatement(castScene.statement, simulation.state)).toBe(true);
    }

    expect(framingScenes).toBe(1);
    expect(introduced).toEqual(cast.map(member => member.personId));
    expect(foundingCastProgress(historian, simulation.state).phase).toBe('complete');
  });

  it('holds authoritative time for the framing and person beats, then restores the prior auto-run state', () => {
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
      const candidate = chooseFoundingCastScene(historian, simulation.state);
      if (candidate?.id.startsWith('founding-cast:framing:')) {
        expect(simulation.config.autoRun).toBe(false);
        expect(presentation.tickBudget(simulation.state)).toBe(0);
        castScene = chooseFoundingCastScene(historian, simulation.state);
      } else {
        castScene = candidate;
      }
    }
    expect(castScene.id).toContain('founding-cast:introduction:');
    expect(simulation.config.autoRun).toBe(false);
    expect(presentation.tickBudget(simulation.state)).toBe(0);

    // The next cast lookup releases the person hold before any later layer proceeds.
    chooseFoundingCastScene(historian, simulation.state);
    expect(simulation.config.autoRun).toBe(originalAutoRun);
    expect(presentation.tickBudget(simulation.state)).toBeGreaterThan(0);
  });

  it('uses one real current anchor fact without assigning documentary importance inside the simulation', () => {
    const simulation = completedArrival('founding-cast-grounding');
    const historian = new Historian(simulation.config);
    completeOrientation(simulation, historian);
    expect(chooseFoundingContinuityScene(historian, simulation.state)).toBeDefined();
    const cast = foundingDocumentaryCast(simulation.state);
    const castIds = new Set(cast.map(member => member.personId));

    let scene = undefined as ReturnType<typeof chooseFoundingCastScene>;
    let statusBefore: string | undefined;
    while (!scene) {
      simulation.step(1);
      expect(chooseFoundingContinuityScene(historian, simulation.state)).toBeDefined();
      const statuses = new Map(cast.map(member => [
        member.personId,
        simulation.state.people.find(person => person.id === member.personId)?.historical?.status,
      ]));
      const candidate = chooseFoundingCastScene(historian, simulation.state);
      if (candidate?.id.startsWith('founding-cast:framing:')) {
        for (const member of cast) {
          expect(simulation.state.people.find(person => person.id === member.personId)?.historical?.status).toBe(statuses.get(member.personId));
        }
        const personScene = chooseFoundingCastScene(historian, simulation.state);
        if (personScene) {
          statusBefore = statuses.get(personScene.subjectId);
          scene = personScene;
        }
      } else if (candidate) {
        statusBefore = statuses.get(candidate.subjectId);
        scene = candidate;
      }
    }

    const person = simulation.state.people.find(candidate => candidate.id === scene?.subjectId);
    expect(person).toBeDefined();
    expect(castIds.has(person!.id)).toBe(true);
    expect(scene?.statement.text).toContain(person!.name);
    const strongest = [...(person!.expertise ?? [])].sort((a, b) => b.competence - a.competence || a.domain.localeCompare(b.domain))[0];
    if (strongest) {
      expect(scene?.statement.text).toContain(strongest.domain.replaceAll('-', ' '));
    } else {
      expect(scene?.statement.text).toContain((person!.role ?? person!.occupation).replaceAll('-', ' '));
    }
    expect(scene?.statement.text).not.toContain('works as a');
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
