import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { FoundingFirstFirePresentation, FIRST_FIRE_CAMERA_GRACE_SECONDS } from '../src/render/founding/FoundingFirstFirePresentation';
import { survivalState } from '../src/sim/pressures/Survival';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';
import { chooseFoundingChapterScene, foundingChapterProgress } from '../src/historian/FoundingChapter';
import { firstMilestones } from '../src/historian/Milestones';
import { CameraDirector, cameraLensObstruction, cameraShotValidity, resolveCameraSafety } from '../src/render/CameraDirector';
import { arrivalSequenceFocus } from '../src/render/founding/ArrivalPresentation';
import type { HistoricalEvent } from '../src/sim/types';

const simulation = new Simulation({ seed: 'arrival-render-budget', startMode: 'arrival' });
function event(id: string, type: HistoricalEvent['type'], context: HistoricalEvent['context'] = {}): HistoricalEvent {
  return { id, type, context, month: 0, actors: [], causes: [], tags: [], summary: id,
    outcome: id, significance: 0.1, magnitude: 0.1, affectedPopulation: 0 } as HistoricalEvent;
}

describe('documentary witnessing', () => {
  it('retains firsts independently of significance, including shelter, permanent construction and burial', () => {
    const history = [event('s', 'infrastructure-built', { need: 'housing', temporary: true }),
      event('p', 'infrastructure-built', { need: 'housing', temporary: false }),
      event('d', 'death'), event('d2', 'death'), event('r', 'resource-deposit-discovered'),
      event('b', 'infrastructure-built', { burials: 1 }), event('b2', 'infrastructure-built', { burials: 2 })];
    expect(firstMilestones(history).map(e => e.id)).toEqual(['s', 'p', 'd', 'r', 'b']);
  });

  it('does not archive a proposal; only acquisition records its statement', () => {
    const historian = new Historian(simulation.config);
    const scene = historian.chooseScene(simulation.state);
    expect(historian.statements).toHaveLength(0);
    historian.acquireScene(scene, simulation.state);
    expect(historian.statements).toContain(scene.statement);
  });

  it('keeps the founding cursor pending until the opening scene is acquired', () => {
    const sim = new Simulation({ seed: 'arrival-render-budget', startMode: 'arrival' });
    sim.advanceArrival(80);
    const historian = new Historian(sim.config);
    const proposal = chooseFoundingChapterScene(historian, sim.state)!;
    expect(proposal).toBeDefined();
    expect(foundingChapterProgress(historian, sim.state).phase).toBe('orientation');
    expect(chooseFoundingChapterScene(historian, sim.state)?.id).toBe(proposal.id);
    expect(historian.statements).toHaveLength(0);
    historian.acquireScene(proposal, sim.state);
    expect(foundingChapterProgress(historian, sim.state).phase).toBe('complete');
  });

  it('keeps dense vegetation soft while terrain remains a hard lens floor', () => {
    const state = simulation.state;
    const point = new Vector3(0, 1, 0), target = new Vector3(0, 0.3, -2);
    expect(cameraLensObstruction(state, point, () => 0)).toBe(0);
    const safe = resolveCameraSafety(state, point, target, () => 0, { lensClearance: 0.42 });
    expect(safe.position.distanceTo(point)).toBeLessThan(0.001);
    expect(cameraShotValidity(state, new Vector3(0, -1, 0), target, () => 0).valid).toBe(false);
  });

  it('does not acknowledge an old low-significance milestone until the physical flight acquires it', () => {
    const sim = new Simulation({ seed: 'visibility-corridor', startMode: 'established', startingPopulation: 40,
      settlementCount: [2, 2], world: { size: 20 } });
    sim.state.history = [];
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];
    const historian = new Historian(sim.config);
    const template = historian.chooseScene(sim.state);
    const departure = { ...template, id: 'departure', subjectId: 'departure', position: { x: 0, z: 0 }, kind: 'street-observation' as const };
    const milestone = { ...event('must-see', 'resource-deposit-discovered'), location: { x: 12, z: 0 } };
    const destination = { ...departure, id: 'event:must-see', subjectId: 'discovery', position: milestone.location,
      title: 'FIRST MATERIAL', event: milestone,
      statement: { ...template.statement, id: 'witness:must-see', sourceEventIds: [milestone.id] } };
    vi.spyOn(historian, 'chooseScene').mockImplementation((_state, focus) => focus ? destination : departure);
    const camera = new PerspectiveCamera(38, 1, 0.01, 500);
    const director = new CameraDirector(camera, sim.config, historian);
    director.update(0, 0, sim.state, () => 0);
    sim.state.history.push(milestone);
    sim.state.month = 100; // Outside both ordinary event memory and significance windows.
    for (let frame = 0; frame < 300 && director.sceneLifecycle.get(destination.id) !== 'traveling'; frame++) {
      director.update(0.1, frame * 0.1, sim.state, () => 0);
    }
    expect(director.sceneLifecycle.get(destination.id)).toBe('traveling');
    expect(director.observation.label).not.toBe(destination.title);
    expect(historian.statements.some(statement => statement.id === destination.statement.id)).toBe(false);
    for (let frame = 0; frame < 600 && director.sceneLifecycle.get(destination.id) !== 'acquired'; frame++) {
      director.update(0.1, 30 + frame * 0.1, sim.state, () => 0);
    }
    expect(director.sceneLifecycle.get(destination.id)).toBe('acquired');
    expect(director.sceneTransitions.filter(transition => transition.sceneId === destination.id).map(transition => transition.phase))
      .toEqual(['proposed', 'reserved', 'traveling', 'acquired']);
    expect(director.observation.label).toBe(destination.title);
    expect(historian.statements).toContain(destination.statement);
  });

  it('keeps First Fire pending during travel, then performs it from the beginning', () => {
    const sim = new Simulation({ seed: 'first-fire-presentation' });
    const settlement = sim.state.settlements[0]!;
    const performance = new FoundingFirstFirePresentation(sim.state);
    survivalState(settlement).firstFire = { month: 0, eventId: 'pending-fire' };
    performance.update(sim.state, 0, '');
    performance.update(sim.state, FIRST_FIRE_CAMERA_GRACE_SECONDS - 1, '');
    expect(performance.isPerforming(settlement.id)).toBe(false);
    performance.update(sim.state, FIRST_FIRE_CAMERA_GRACE_SECONDS - 0.5, 'pending-fire');
    expect(performance.isPerforming(settlement.id)).toBe(true);
    expect(performance.sample(settlement.id).stonesPlaced).toBe(0);
    expect(performance.sample(settlement.id).flameScale).toBe(0);
  });

  it('keeps hero identity and physical pose continuous across every arrival beat', () => {
    const arrival = simulation.state.arrival!;
    const camera = new PerspectiveCamera(38, 1, 0.01, 500);
    const director = new CameraDirector(camera, simulation.config, new Historian(simulation.config));
    const prior = new Vector3();
    for (let frame = 0; frame <= 38 * 30; frame++) {
      arrival.elapsedSeconds = frame / 30;
      arrival.phase = 'ARRIVAL_SEQUENCE';
      expect(arrivalSequenceFocus(arrival).siteIndex).toBe(0);
      director.update(1 / 30, frame / 30, simulation.state, () => -10);
      if (frame) expect(camera.position.distanceTo(prior)).toBeLessThan(1.5);
      prior.copy(camera.position);
      expect(director.foundingPresentationComplete()).toBe(false);
    }
  });
});
