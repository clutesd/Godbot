import { describe, expect, it } from 'vitest';
import { Historian } from '../src/historian/Historian';
import { PresentationDirector } from '../src/historian/PresentationDirector';
import type { HistorianStatement } from '../src/historian/types';
import { Simulation } from '../src/sim/Simulation';
import { settlementRepresentedPopulation } from '../src/sim/advanced/AdvancedCivilizationSystem';
import { timePresetConfig } from '../src/presets';

function statement(overrides: Partial<HistorianStatement> = {}): HistorianStatement {
  return {
    id: 'test-statement',
    month: 0,
    text: 'A grounded statement.',
    epistemicStatus: 'recorded-fact',
    sourceEventIds: [],
    sourceEntityIds: [],
    sourceArchiveIds: [],
    claims: {},
    ...overrides,
  };
}

describe('Historian grounding', () => {
  const simulation = new Simulation({ seed: 'historian-grounding', startingPopulation: 240 });
  simulation.step(120 * 12);
  const historian = new Historian(simulation.config);

  it('accepts generated statements only when their sources exist at observation time', () => {
    const scenes = Array.from({ length: 32 }, () => historian.chooseScene(simulation.state));
    expect(scenes.every((scene) => historian.validateStatement(scene.statement, simulation.state))).toBe(true);
    expect(new Set(scenes.map((scene) => scene.subjectId)).size).toBeGreaterThan(5);
    expect(scenes.some((scene) => scene.kind === 'worker-follow' || scene.kind === 'traveler-follow')).toBe(true);
    expect(scenes.some((scene) => scene.statement.sourceEventIds.length > 0)).toBe(true);
  });

  it('can focus a newly detected major event without changing its factual source', () => {
    const event = historian.candidates(simulation.state).find((candidate) => candidate.event)?.event;
    if (!event) throw new Error('Expected an observable historical event');
    const scene = historian.chooseScene(simulation.state, event.id);
    expect(scene.event?.id).toBe(event.id);
    expect(scene.statement.sourceEventIds).toContain(event.id);
    expect(historian.validateStatement(scene.statement, simulation.state)).toBe(true);
  });

  it('rejects nonexistent wars', () => {
    expect(historian.validateStatement(statement({ month: simulation.state.month, sourceEntityIds: [simulation.state.settlements[0]?.id ?? ''], claims: { warId: 'war-that-never-existed' } }), simulation.state)).toBe(false);
  });

  it('rejects nonexistent entities', () => {
    expect(historian.validateStatement(statement({ month: simulation.state.month, sourceEntityIds: ['person-that-never-existed'], claims: { entityIds: ['person-that-never-existed'] } }), simulation.state)).toBe(false);
  });

  it('rejects nonexistent discoveries', () => {
    expect(historian.validateStatement(statement({ month: simulation.state.month, sourceEntityIds: [simulation.state.settlements[0]?.id ?? ''], claims: { knowledgeId: 'impossible-perpetual-motion' } }), simulation.state)).toBe(false);
  });

  it('rejects impossible population claims', () => {
    const settlementId = simulation.state.settlements[0]?.id ?? '';
    expect(historian.validateStatement(statement({ month: simulation.state.month, epistemicStatus: 'derived-statistic', sourceEntityIds: [settlementId], claims: { population: { month: simulation.state.month, value: simulation.population + 1_000_000 } } }), simulation.state)).toBe(false);
  });

  it('validates settlement population claims against their stated scope', () => {
    const settlement = simulation.state.settlements.find((candidate) => candidate.alive);
    if (!settlement) throw new Error('Expected a living settlement');
    const localPopulation = settlementRepresentedPopulation(simulation.state, settlement.id);
    const localClaim = statement({
      month: simulation.state.month,
      epistemicStatus: 'derived-statistic',
      sourceEntityIds: [settlement.id],
      claims: { population: { month: simulation.state.month, value: localPopulation, scopeEntityId: settlement.id } },
    });
    expect(historian.validateStatement(localClaim, simulation.state)).toBe(true);
    expect(historian.validateStatement({ ...localClaim, claims: { population: { month: simulation.state.month, value: localPopulation + 1, scopeEntityId: settlement.id } } }, simulation.state)).toBe(false);
  });

  it('rejects future events and future-dated observations', () => {
    const latest = [...simulation.state.history].sort((a, b) => b.month - a.month)[0];
    expect(latest).toBeDefined();
    if (!latest) return;
    expect(historian.validateStatement(statement({ month: latest.month - 1, sourceEventIds: [latest.id], claims: { eventType: latest.type } }), simulation.state)).toBe(false);
    expect(historian.validateStatement(statement({ month: simulation.state.month + 1, sourceEventIds: [latest.id] }), simulation.state)).toBe(false);
  });

  it('labels uncertainty and records predictions for later calibration', () => {
    for (const war of simulation.state.wars) war.active = false;
    const living = new Set(simulation.state.settlements.filter((settlement) => settlement.alive).map((settlement) => settlement.id));
    const relation = simulation.state.relations.find((candidate) => living.has(candidate.a) && living.has(candidate.b));
    if (!relation) throw new Error('Expected a relation between living settlements');
    relation.contact = true;
    relation.hostility = 1;
    relation.territorialTension = 1;
    relation.grievances = 1;
    // Earlier candidate-generation tests may already have recorded this exact relation. Make this
    // assertion about fresh inference creation rather than depending on cross-test prediction state.
    for (const prediction of historian.predictions) {
      if (prediction.subjectIds.includes(relation.id)) prediction.resolved = true;
    }
    const inference = historian.candidates(simulation.state).find((candidate) => candidate.statement.epistemicStatus === 'probabilistic-inference');
    expect(inference).toBeDefined();
    expect(inference && historian.validateStatement(inference.statement, simulation.state)).toBe(true);
    expect(historian.predictions.some((prediction) => prediction.sourceEntityIds.includes(relation.id) && !prediction.resolved)).toBe(true);
  });
});

describe('Presentation independence', () => {
  it('changes viewing speed without changing deterministic history', () => {
    // Preserve the 80-year comparison with a bounded multi-settlement world.
    const config = { seed: 'presentation-is-read-only', startingPopulation: 120, simulation: { populationSoftCap: 240 }, world: { size: 24 }, settlementCount: [3, 3] as const };
    const observed = new Simulation(config);
    const control = new Simulation(config);
    expect(observed.state.settlements.length).toBeGreaterThan(1);
    const historian = new Historian(observed.config);
    const presentation = new PresentationDirector(observed.config);
    observed.step(80 * 12);
    const scene = historian.chooseScene(observed.state);
    presentation.update(1 / 60, observed.state, scene);
    control.step(80 * 12);
    expect(observed.summary()).toEqual(control.summary());
    expect(observed.state.history).toEqual(control.state.history);
  }, 40_000);

  it('accelerates quiet views and slows significant events', () => {
    const simulation = new Simulation({ seed: 'presentation-pacing', startingPopulation: 180 });
    const director = new PresentationDirector(simulation.config);
    const quiet = director.targetSpeed(simulation.state, { kind: 'landscape-pause', interest: 0.1 });
    const significant = director.targetSpeed(simulation.state, { kind: 'discovery-scene', interest: 0.95 });
    expect(quiet).toBeGreaterThan(significant);
    expect(significant).toBe(simulation.config.presentation.significantMonthsPerSecond);
  });

  it('does not mistake an interesting city view for a major event', () => {
    const simulation = new Simulation({ seed: 'presentation-city-life', startingPopulation: 180 });
    // Isolate the classification from the intentional seasonal-transition hold and founding-event memory.
    simulation.state.month = 2;
    simulation.state.history.length = 0;
    const director = new PresentationDirector(simulation.config);
    director.update(1, simulation.state, { kind: 'settlement-approach', interest: 0.95 });
    expect(director.mode).toBe('city-life');
    expect(director.targetSpeed(simulation.state, { kind: 'settlement-approach', interest: 0.95 })).toBe(simulation.config.presentation.ordinaryMonthsPerSecond);
  });

  it('keeps authoritative history identical across documentary and accelerated presentation presets', () => {
    const fixture = { seed: 'presentation-presets-read-only', startingPopulation: 120, simulation: { populationSoftCap: 240 }, world: { size: 24 }, settlementCount: [3, 3] as const };
    const documentary = new Simulation({ ...timePresetConfig('documentary'), ...fixture });
    const accelerated = new Simulation({ ...timePresetConfig('accelerated-experiment'), ...fixture });
    expect(documentary.state.settlements.length).toBeGreaterThan(1);
    const years = 60;
    documentary.step(years * 12);
    accelerated.step(years * 12);
    expect(documentary.state.history).toEqual(accelerated.state.history);
    expect(documentary.summary()).toEqual(accelerated.summary());
  }, 90_000);

  it('ramps quiet history up and important history down without abrupt target jumps', () => {
    const simulation = new Simulation({ ...timePresetConfig('documentary'), seed: 'presentation-ramp' });
    const director = new PresentationDirector(simulation.config);
    for (let second = 0; second < 90; second += 1) director.update(1, simulation.state, { kind: 'landscape-pause', interest: 0.1 });
    const quietSpeed = director.monthsPerSecond;
    const firstSlowFrame = director.update(1 / 60, simulation.state, { kind: 'battle-overview', interest: 1, eventType: 'battle', eventMonth: simulation.state.month });
    expect(quietSpeed).toBeGreaterThan(simulation.config.presentation.ordinaryMonthsPerSecond);
    expect(firstSlowFrame).toBeLessThan(quietSpeed);
    expect(firstSlowFrame).toBeGreaterThan(simulation.config.presentation.momentousMonthsPerSecond);
    expect(director.targetSpeed(simulation.state, { kind: 'worker-follow', interest: 0.2 })).toBeLessThanOrEqual(simulation.config.presentation.personalMonthsPerSecond);
  });
});


describe('documentary editorial judgment', () => {
  it('prefers meaningful visible activity without falling back to a fixed aerial cadence', () => {
    const sim = new Simulation({ seed: 'documentary-sequence', startMode: 'established', startingPopulation: 120 });
    sim.state.history = [];
    for (const person of sim.state.people.filter(person => person.alive)) person.activity = 'construct';
    const before = JSON.stringify(sim.state);
    const historian = new Historian(sim.config);
    const scenes = Array.from({ length: 8 }, () => historian.chooseScene(sim.state));

    expect(['worker-follow', 'traveler-follow', 'street-observation']).toContain(scenes[0]!.kind);
    expect(scenes[0]!.editorial?.activityMeaning).toBeGreaterThanOrEqual(0.8);
    expect(scenes.every(scene => scene.editorial?.why.trim())).toBe(true);

    const scales = scenes.map(scene => scene.editorial?.preferredScale);
    expect(scales.filter(scale => scale === 'wide').length).toBeLessThan(scenes.length);
    expect(scenes.some(scene => scene.editorial?.preferredScale === 'human' || scene.editorial?.preferredScale === 'detail')).toBe(true);
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it('selects the same documentary subjects for the same seed and immutable state', () => {
    const sim = new Simulation({ seed: 'documentary-determinism', startMode: 'established', startingPopulation: 120 });
    sim.state.history = [];
    const before = JSON.stringify(sim.state);
    const a = new Historian(sim.config);
    const b = new Historian(sim.config);
    const first = Array.from({ length: 12 }, () => a.chooseScene(sim.state)).map(scene => ({
      id: scene.id,
      subjectId: scene.subjectId,
      scale: scene.editorial?.preferredScale,
      threadId: scene.editorial?.threadId,
    }));
    const second = Array.from({ length: 12 }, () => b.chooseScene(sim.state)).map(scene => ({
      id: scene.id,
      subjectId: scene.subjectId,
      scale: scene.editorial?.preferredScale,
      threadId: scene.editorial?.threadId,
    }));

    expect(first).toEqual(second);
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it('keeps consecutive documentary attention in a community thread when that deepens the story', () => {
    const sim = new Simulation({ seed: 'documentary-thread', startMode: 'established', startingPopulation: 120 });
    sim.state.history = [];
    const historian = new Historian(sim.config);
    const scenes = Array.from({ length: 10 }, () => historian.chooseScene(sim.state));
    const threadedPair = scenes.some((scene, index) => {
      const next = scenes[index + 1];
      return Boolean(next
        && scene.subjectId !== next.subjectId
        && scene.editorial?.threadId
        && scene.editorial.threadId === next.editorial?.threadId);
    });

    expect(threadedPair).toBe(true);
  });
});
