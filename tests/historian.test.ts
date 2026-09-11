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
    // Use a fresh, living multi-settlement world so this test measures inference grounding rather
    // than depending on whether a 120-year integration fixture happened to retain two survivors.
    const inferenceSimulation = new Simulation({ seed: 'historian-inference', startingPopulation: 180, settlementCount: [4, 4] });
    const inferenceHistorian = new Historian(inferenceSimulation.config);
    for (const war of inferenceSimulation.state.wars) war.active = false;
    const living = new Set(inferenceSimulation.state.settlements.filter((settlement) => settlement.alive).map((settlement) => settlement.id));
    const relation = inferenceSimulation.state.relations.find((candidate) => living.has(candidate.a) && living.has(candidate.b));
    expect(relation).toBeDefined();
    if (!relation) return;
    relation.contact = true;
    relation.hostility = 1;
    relation.territorialTension = 1;
    relation.grievances = 1;
    const inference = inferenceHistorian.candidates(inferenceSimulation.state).find((candidate) => candidate.statement.epistemicStatus === 'probabilistic-inference');
    expect(inference).toBeDefined();
    expect(inference && inferenceHistorian.validateStatement(inference.statement, inferenceSimulation.state)).toBe(true);
    expect(inferenceHistorian.predictions.some((prediction) => prediction.sourceEntityIds.includes(relation.id) && !prediction.resolved)).toBe(true);
  });
});

describe('Presentation independence', () => {
  it('changes viewing speed without changing deterministic history', () => {
    const config = { seed: 'presentation-is-read-only', startingPopulation: 240 };
    const observed = new Simulation(config);
    const control = new Simulation(config);
    const historian = new Historian(observed.config);
    const presentation = new PresentationDirector(observed.config);
    observed.step(80 * 12);
    const scene = historian.chooseScene(observed.state);
    presentation.update(1 / 60, observed.state, scene);
    control.step(80 * 12);
    expect(observed.summary()).toEqual(control.summary());
    expect(observed.state.history).toEqual(control.state.history);
  }, 20_000);

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
    const director = new PresentationDirector(simulation.config);
    director.update(1, simulation.state, { kind: 'settlement-approach', interest: 0.95 });
    expect(director.mode).toBe('city-life');
    const speed = director.targetSpeed(simulation.state, { kind: 'settlement-approach', interest: 0.95 });
    // High-interest city life may receive an anticipatory slowdown, but without an event it must
    // stay above the major-event pace and never accelerate beyond ordinary observation.
    expect(speed).toBeGreaterThan(simulation.config.presentation.significantMonthsPerSecond);
    expect(speed).toBeLessThanOrEqual(simulation.config.presentation.ordinaryMonthsPerSecond);
  });

  it('keeps authoritative history identical across documentary and accelerated presentation presets', () => {
    const seed = 'presentation-presets-read-only';
    const documentary = new Simulation({ ...timePresetConfig('documentary'), seed });
    const accelerated = new Simulation({ ...timePresetConfig('accelerated-experiment'), seed });
    documentary.step(180 * 12);
    accelerated.step(180 * 12);
    expect(documentary.state.history).toEqual(accelerated.state.history);
    expect(documentary.summary()).toEqual(accelerated.summary());
  }, 60_000);

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