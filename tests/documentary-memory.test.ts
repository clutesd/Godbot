import { observeScene } from './observe-scene';
import { describe, expect, it } from 'vitest';
import { DocumentaryMemory } from '../src/historian/DocumentaryMemory';
import { Historian } from '../src/historian/Historian';
import { Simulation } from '../src/sim/Simulation';
import type { HistoricalEvent } from '../src/sim/types';

const simulation = new Simulation({ seed: 'documentary-memory', startingPopulation: 48 });
function fixture() {
  const state = structuredClone(simulation.state);
  state.month = 100;
  state.history = [];
  return state;
}
function event(state: ReturnType<typeof fixture>, id: string, significance: number, causes: string[] = []): HistoricalEvent {
  return { id, type: 'discovery', month: state.month, actors: [state.people[0]!.id], causes,
    locationId: state.settlements[0]!.id, context: {}, outcome: 'A recorded change', summary: id,
    affectedPopulation: 12, significance, magnitude: significance, tags: [] };
}

describe('documentary observation memory', () => {
  it('follows construction progress, acceleration, blockage and disappearance without inventing completion', () => {
    const state = fixture(), memory = new DocumentaryMemory(), s = state.settlements[0]!;
    s.development = { pressures: {}, unmet: {}, informal: {}, providers: {}, evaluatedMonth: state.month, nextAttemptMonth: state.month, revision: 1,
      project: { plotId: 'observed-project', action: 'founded', startedMonth: state.month, progress: 0.1, spent: { ...s.resources },
        response: { need: 'housing', form: 'dwelling', name: 'New housing', level: 1, material: 'timber', cultureId: state.cultures[0]!.id,
          style: state.cultures[0]!.style, services: { housing: 1 }, reasons: [], capabilities: [], cost: { ...s.resources }, labor: 10 } } };
    memory.observe(state);
    const start = memory.candidates(state).find(c => c.subjectId === 'observed-project')!;
    expect(start.statement.text).toContain('under construction');
    memory.remember(start, state.month);
    const project = s.development.project!;
    state.month++;
    project.progress = 0.2;
    memory.observe(state);
    state.month++;
    project.progress = 0.5;
    memory.observe(state);
    expect(memory.candidates(state).find(c => c.subjectId === project.plotId)!.statement.text).toContain('twice as fast');
    state.month += 12;
    project.blockedReasons = ['insufficient-wood'];
    memory.observe(state);
    expect(memory.candidates(state).find(c => c.subjectId === project.plotId)!.statement.text).toContain('insufficient wood');
    delete s.development.project;
    state.month++;
    memory.observe(state);
    const disappeared = memory.candidates(state).find(c => c.subjectId === project.plotId)!;
    expect(disappeared.statement.text).toContain('completion is not confirmed');
    expect(new Historian(simulation.config).validateStatement(disappeared.statement, state)).toBe(true);
  });

  it('detects environmental deterioration rather than repeatedly reacting to a high level', () => {
    const state = fixture(), memory = new DocumentaryMemory();
    state.settlements[0]!.pollution = 0.8;
    memory.observe(state);
    expect(memory.candidates(state)).toEqual([]);
    state.month++;
    state.settlements[0]!.pollution = 0.2;
    memory.observe(state);
    expect(memory.candidates(state)[0]!.statement.text).toContain('pollution has fallen into the 20–40% range');
  });

  it('notices relationships, migration and death from copied evidence', () => {
    const state = fixture(), memory = new DocumentaryMemory();
    const person = state.people[0]!;
    memory.observe(state);
    state.month++;
    person.partnerId = state.people[1]!.id;
    person.homeId = state.settlements[1]!.id;
    memory.observe(state);
    const changed = memory.candidates(state).find(c => c.subjectId === person.id)!;
    expect(changed.statement.text).toContain(`partnership with ${state.people[1]!.name}`);
    expect(changed.statement.text).toContain(`has moved from ${state.settlements[0]!.name} to ${state.settlements[1]!.name}`);
    memory.remember(changed, state.month);
    state.month++;
    person.alive = false;
    memory.observe(state);
    const death = memory.candidates(state).find(c => c.editorial?.subjectId === person.id)!;
    expect(death.interest).toBeGreaterThan(changed.interest);
    expect(death.kind).toBe('street-observation');
    expect(state.people.find(candidate => candidate.id === death.subjectId)?.alive).toBe(true);
    expect(death.statement.text).toContain('has died');
  });

  it('does not consume a development through candidate enumeration and returns silently to unresolved lives', () => {
    const state = fixture(), memory = new DocumentaryMemory();
    memory.observe(state);
    state.month++;
    state.people[0]!.occupation = 'keeper';
    state.people[0]!.children.push('recorded-child');
    memory.observe(state);
    const first = memory.candidates(state)[0]!;
    expect(memory.candidates(state)).toEqual(memory.candidates(state));
    memory.remember(first, state.month);
    expect(memory.candidates(state).some(c => c.id === first.id)).toBe(false);
    state.month += 120;
    memory.observe(state);
    const followup = memory.candidates(state).find(c => c.subjectId === first.subjectId)!;
    expect(followup.editorial?.threadId).toBe(first.editorial?.threadId);
    expect(followup.editorial?.shotPurpose).toBe('follow-up');
    expect(followup.editorial?.narration).toBe('silent');
  });

  it('prioritizes unseen significant events and recorded causal consequences', () => {
    const state = fixture(), historian = new Historian(simulation.config), memory = new DocumentaryMemory();
    const root = event(state, 'root', 0.95);
    state.history.push(root, event(state, 'routine', 0.1));
    const scenes = historian.candidates(state);
    const first = scenes.find(c => c.event?.id === 'root')!;
    const routine = scenes.find(c => c.event?.id === 'routine')!;
    expect(memory.score(first, state)).toBeGreaterThan(memory.score(routine, state));
    memory.remember(first, state.month);
    const consequence = event(state, 'consequence', 0.7, ['root']);
    state.history.push(consequence);
    const followup = historian.candidates(state).find(c => c.event?.id === 'consequence')!;
    expect(memory.score(followup, state)).toBeGreaterThan(memory.score(first, state));
    expect(memory.decorate(followup, state).statement.sourceEventIds).toContain('root');
    expect(followup.editorial?.why).toContain('Recorded consequence');
  });

  it('keeps quiet mature years human, varied, and silent on repeated evidence', () => {
    const state = fixture(), historian = new Historian(simulation.config);
    const scenes = Array.from({ length: 30 }, () => observeScene(historian, state));
    expect(scenes.filter(c => c.kind === 'worker-follow' || c.kind === 'traveler-follow').length).toBeGreaterThan(20);
    expect(new Set(scenes.map(c => c.subjectId)).size).toBeGreaterThan(4);
    const focusedEvent = event(state, 'repeat', 0.9);
    state.history.push(focusedEvent);
    observeScene(historian, state, focusedEvent.id);
    expect(observeScene(historian, state, focusedEvent.id).editorial?.narration).toBe('silent');
  });

  it('selects deterministically without mutating frozen simulation evidence', () => {
    const state = fixture(), a = new Historian(simulation.config), b = new Historian(simulation.config);
    const freeze = (value: unknown): void => {
      if (!value || typeof value !== 'object' || Object.isFrozen(value) || ArrayBuffer.isView(value)) return;
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    };
    const before = JSON.stringify(state);
    freeze(state);
    expect(Array.from({ length: 15 }, () => observeScene(a, state).id))
      .toEqual(Array.from({ length: 15 }, () => observeScene(b, state).id));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('does not silence evidence that a sequence observed without showing its caption', () => {
    const state = fixture(), historian = new Historian(simulation.config), memory = new DocumentaryMemory();
    const source = event(state, 'observed-without-speech', 0.95);
    state.history.push(source);
    const candidate = historian.candidates(state).find(c => c.event?.id === source.id)!;
    memory.remember(candidate, state.month, false);
    expect(memory.decorate(structuredClone(candidate), state).editorial?.narration).toBe('required');
    memory.remember(candidate, state.month, true);
    expect(memory.decorate(structuredClone(candidate), state).editorial?.narration).toBe('silent');
  });

  it('does not change subsequent simulation evolution or random consumption', () => {
    const watched = new Simulation({ seed: 'documentary-isolation', startingPopulation: 24 });
    const control = new Simulation({ seed: 'documentary-isolation', startingPopulation: 24 });
    const historian = new Historian(watched.config);
    for (let i = 0; i < 3; i++) { observeScene(historian, watched.state); watched.step(1); control.step(1); }
    expect(watched.state).toEqual(control.state);
  });
});
