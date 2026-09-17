import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vegetationFixture, instanceMeshes } from './fixtures/vegetation';
import type { Person, Settlement, WeatherCellState } from '../src/sim/types';
import { atInteraction, workInterruption } from '../src/render/people/PhysicalActionPresentation';
import { PhysicalWorkScene } from '../src/render/people/PhysicalWorkScene';
import { PeopleVisualStateStore } from '../src/render/people/PeopleVisualState';
import { travelAnimationFor } from '../src/render/people/PeoplePresentation';
import { farmAnchor, farmGeometry } from '../src/shared/FarmGeometry';
import { farmPresentationState, farmerCanPresent, sampleFarmAction } from '../src/render/farming/FarmActionPresentation';
import { FarmFieldRenderer } from '../src/render/farming/FarmFieldRenderer';
import { advanceConstruction, builderCanPresent, constructionBlockedReason, constructionPresentedMaterial, createConstructionPlayback, sampleConstructionAction } from '../src/render/construction/ConstructionActionPresentation';
import { constructionWorkerLane, sampleConstructionWorkerMotion } from '../src/render/construction/ConstructionWorkerMotion';
import { assignConstructionCrewRoles, constructionWorkfaceIndex } from '../src/render/construction/ConstructionCrewPresentation';
import { constructionWorksiteAnchors, createConstructionWorksite } from '../src/render/construction/ConstructionWorksite';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import { createResourceWorkMotion, sampleResourceWorkMotion } from '../src/render/animation/ResourceWorkMotion';
import { resourceWorkProfile, resourceWorkerVariation } from '../src/sim/resources/ResourceWorkPresentation';
import { ResourceWorkerRenderer } from '../src/render/resources/ResourceWorkerRenderer';

let fixture: ReturnType<typeof vegetationFixture>;
beforeAll(() => { fixture = vegetationFixture('physical-action-reference'); });
function setup() {
  const settlement = structuredClone(fixture.simulation.state.settlements[0]!);
  settlement.alive = true;
  settlement.agriculture = { month: 6, labour: 5, yieldPerWorker: 2, production: 10, irrigation: 0.6 };
  settlement.resources = { food: 20, wood: 20, minerals: 20, goods: 20, wealth: 20 };
  settlement.structurePlots = [];
  const weather = { ...fixture.simulation.state.weather.cells[settlement.cellIndex]!, snowpack: 0, wind: 0, blizzard: 0, floodDepth: 0, cropDamage: 0, kind: 'clear' } as WeatherCellState;
  const field = farmGeometry(settlement)!;
  const person = { ...structuredClone(fixture.simulation.state.people[0]!), alive: true, health: 1,
    id: 'physical-worker', homeId: settlement.id, occupation: 'farmer', activity: 'farm', role: 'farmer',
    displacedSinceMonth: undefined, position: farmAnchor(field, 'physical-worker').anchor,
    navigation: { destinationKind: 'field', destinationId: field.id, traveling: false, schedulePhase: 'work', reason: 'test', waypoints: [], waypointIndex: 0 } } as Person;
  return { settlement, weather, person, field };
}
function construction(settlement: Settlement, person: Person) {
  const response = { need: 'housing', form: 'dwelling', name: 'house', level: 1, material: 'timber', cultureId: person.cultureId,
    style: fixture.simulation.state.cultures[0]!.style, services: { housing: 1 }, reasons: [], capabilities: [],
    cost: { food: 0, wood: 4, minerals: 0, goods: 0, wealth: 0 }, labor: 4 } as const;
  const project = { plotId: 'plot', response, action: 'founded', startedMonth: 0, progress: 0.3,
    spent: { food: 0, wood: 1.2, minerals: 0, goods: 0, wealth: 0 }, blockedReasons: [] } as const;
  settlement.development = { pressures: {}, unmet: {}, informal: {}, providers: {}, evaluatedMonth: 6, nextAttemptMonth: 12, revision: 1,
    project: structuredClone(project) };
  settlement.structurePlots = [{ id: 'plot', worldX: 0, worldZ: 0, width: 2, depth: 1.5, height: 1, radius: 1, condition: 1, foundedMonth: 0 }];
  person.activity = 'construct'; person.occupation = 'builder'; person.role = 'builder';
  person.navigation!.destinationKind = 'construction-site'; person.navigation!.destinationId = 'plot'; person.position = { x: 2.2, z: -0.4 };
  return { key: 'plot', worldX: 0, worldZ: 0, width: 2, depth: 1.5, rotationY: 0 };
}
const anchors = { pickup: { x: 1, z: 0 }, delivery: { x: 0, z: 1 }, materialCenter: { x: 0.87, z: 0 }, siteCenter: { x: 0, z: 0 },
  prep: { x: -0.3, z: 0.8 }, prepCenter: { x: -0.3, z: 1 } };

describe('physical authority and interruption', () => {
  it('prioritizes emergency, displacement, migration, weather and visible travel', () => {
    const { person, weather } = setup();
    expect(workInterruption(person, weather)).toBeUndefined();
    expect(workInterruption(person, weather, 0.2)).toBe('travel');
    person.navigation!.traveling = true;
    expect(travelAnimationFor(0, person)).toBe('walk');
    expect(workInterruption(person)).toBe('travel');
    person.activity = 'migrate'; expect(workInterruption(person)).toBe('migration');
    person.displacedSinceMonth = 2; expect(workInterruption(person)).toBe('displaced');
    person.activity = 'flee'; expect(workInterruption(person)).toBe('emergency');
    person.alive = false; expect(workInterruption(person)).toBe('inactive');
  });
  it('requires arrival and target orientation for contact', () => {
    expect(atInteraction({ x: 0, z: 0 }, { x: 0, z: 0 }, 0, 0, 0)).toBe(true);
    expect(atInteraction({ x: 0, z: 0 }, { x: 0, z: 0 }, Math.PI, 0, 0)).toBe(false);
    expect(atInteraction({ x: 0.1, z: 0 }, { x: 0, z: 0 }, 0, 0, 0)).toBe(false);
    expect(atInteraction({ x: 0, z: 0 }, { x: 0, z: 0 }, 0, 0, 0.1)).toBe(false);
  });
  it('never creates bindings without a safe path, and clears invalidated authority', () => {
    const { settlement, person, field, weather } = setup();
    const farm = { geometry: field, state: farmPresentationState(settlement, 6, weather) };
    const scene = new PhysicalWorkScene(); scene.beginFrame([person]);
    expect(scene.plan(person, settlement, undefined, farm, weather, () => false)).toBeUndefined();
    expect(scene.plan(person, settlement, undefined, farm, weather, () => true)).toBeDefined();
    person.navigation!.destinationId = 'elsewhere';
    expect(scene.plan(person, settlement, undefined, farm, weather, () => true)).toBeUndefined();
    expect(scene.inspect(person.id)).toBeUndefined();
  });
});

describe('construction workflow', () => {
  it('assigns deterministic visible crew roles with coverage for organized crews', () => {
    const ids = ['worker-c', 'worker-a', 'worker-b'];
    const first = assignConstructionCrewRoles('plot', ids);
    const second = assignConstructionCrewRoles('plot', [...ids].reverse());
    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(new Set([...first.values()].map(assignment => assignment.role))).toEqual(new Set(['hauler', 'assembler', 'site-worker']));
    expect(assignConstructionCrewRoles('solo', ['one']).get('one')?.role).toBe('hauler');
    expect(new Set([...assignConstructionCrewRoles('pair', ['one', 'two']).values()].map(a => a.role)))
      .toEqual(new Set(['hauler', 'assembler']));
  });

  it('spreads workers across stable workfaces and keeps site preparation at visible furniture', () => {
    const faces = Array.from({ length: 10 }, (_, index) => constructionWorkfaceIndex('plot', `worker-${index}`));
    expect(faces.every(face => face >= 0 && face <= 3)).toBe(true);
    expect(new Set(faces).size).toBeGreaterThan(1);
    const a = constructionWorksiteAnchors(2, 1.5, 'plot', -0.4, 0);
    const b = constructionWorksiteAnchors(2, 1.5, 'plot', 0.4, 1);
    expect(a.delivery).not.toEqual(b.delivery);
    expect(a.prep.z).toBeLessThan(a.prepCenter.z);
    expect(constructionWorksiteAnchors(2, 1.5, 'plot', -0.4, 0)).toEqual(a);
  });

  it('gives a three-person project distinct role-specific movement targets without changing authority', () => {
    const { settlement, person, weather } = setup();
    const placement = construction(settlement, person);
    const people = ['crew-a', 'crew-b', 'crew-c'].map((id, index) => ({
      ...structuredClone(person), id, position: { x: 2.2 + index * 0.08, z: -0.4 },
    } as Person));
    // Both navigation forms are legal for the same funded project and must remain one crew.
    people[1]!.navigation!.destinationId = `${settlement.id}:construction-site`;
    const before = JSON.stringify(settlement);
    const scene = new PhysicalWorkScene();
    scene.beginFrame(people);
    const workers = people.map(member => scene.plan(member, settlement, placement, undefined, weather, () => true)!);
    expect(new Set(workers.map(worker => worker.crewRole))).toEqual(new Set(['hauler', 'assembler', 'site-worker']));
    const byRole = new Map(workers.map(worker => [worker.crewRole, worker]));
    expect(byRole.get('hauler')!.action.targetKind).toBe('material-pile');
    expect(byRole.get('assembler')!.action.targetKind).toBe('workface');
    expect(byRole.get('site-worker')!.action.targetKind).toBe('site-prep');
    expect(byRole.get('hauler')!.action.locomotionTarget).not.toEqual(byRole.get('site-worker')!.action.locomotionTarget);
    expect(JSON.stringify(settlement)).toBe(before);
  });

  it('requires an active safe project and the matching destination', () => {
    const { settlement, person, weather } = setup(); construction(settlement, person);
    expect(builderCanPresent(person, settlement, weather)).toBe(true);
    person.navigation!.destinationId = 'cancelled-plot'; expect(builderCanPresent(person, settlement, weather)).toBe(false);
    person.navigation!.destinationId = 'plot'; settlement.development!.project!.progress = 1;
    expect(builderCanPresent(person, settlement, weather)).toBe(false);
    settlement.development!.project = undefined; expect(builderCanPresent(person, settlement, weather)).toBe(false);
  });
  it('cannot acquire in transit, retains a load through delayed travel and releases after placement', () => {
    const playback = createConstructionPlayback();
    for (let i = 0; i < 100; i++) advanceConstruction(playback, 0.1, false, false);
    expect(playback).toEqual(createConstructionPlayback());
    advanceConstruction(playback, 0.1, true, false); expect(playback.phase).toBe('pickup');
    for (let i = 0; i < 5; i++) advanceConstruction(playback, 0.1, true, false);
    expect(playback.carrying).toBe(false);
    advanceConstruction(playback, 0.1, true, false); expect(playback.carrying).toBe(true);
    for (let i = 0; i < 5; i++) advanceConstruction(playback, 0.1, true, false);
    expect(playback.phase).toBe('deliver'); // ready is supplied only at delivery in the real coordinator
    playback.phase = 'carry'; playback.seconds = 0;
    for (let i = 0; i < 100; i++) advanceConstruction(playback, 0.1, false, false);
    expect(playback.carrying).toBe(true); expect(playback.phase).toBe('carry');
    advanceConstruction(playback, 0.1, true, false); expect(playback.phase).toBe('deliver');
    for (let i = 0; i < 5; i++) advanceConstruction(playback, 0.1, true, false);
    expect(playback.carrying).toBe(true);
    advanceConstruction(playback, 0.1, true, false); expect(playback.carrying).toBe(false);
  });
  it('blocks both modern material bills and legacy resource budgets without spending anything', () => {
    const { settlement, person } = setup(); construction(settlement, person);
    expect(constructionBlockedReason(settlement)).toBeUndefined();
    settlement.resources.wood = 0; expect(constructionBlockedReason(settlement)).toBe('missing:wood');
    settlement.resources.wood = 10;
    settlement.development!.project!.materialRequirements = [{ id: 'wall', amount: 2, options: ['brick', 'stone'], reason: 'wall' }];
    settlement.localMaterials.brick = 0; settlement.localMaterials.stone = 0;
    expect(constructionBlockedReason(settlement)).toBe('missing:wall');
    settlement.localMaterials.brick = 2;
    expect(constructionPresentedMaterial(settlement)).toBe('ceramic');
    expect(constructionBlockedReason(settlement)).toBeUndefined();
    const before = JSON.stringify(settlement); const playback = createConstructionPlayback(); playback.carrying = true;
    advanceConstruction(playback, 1, true, true);
    expect(playback.phase).toBe('inspect'); expect(playback.carrying).toBe(false); expect(JSON.stringify(settlement)).toBe(before);
  });
  it('removes unavailable staging geometry and keeps lane/cycle sampling deterministic', () => {
    const { settlement, person } = setup(); construction(settlement, person);
    const response = settlement.development!.project!.response;
    const palette = new MaterialPalette({ culture: response.style, era: 'early' });
    const group = createConstructionWorksite({ width: 2, depth: 2, progress: 0.5, seedKey: 'plot', response, materialsAvailable: false }, palette);
    const staging: THREE.Object3D[] = []; group.traverse(o => { if (o.userData['constructionCue'] === 'staged-material') staging.push(o); });
    expect(staging).toHaveLength(0);
    expect(constructionWorkerLane('one')).toBe(constructionWorkerLane('one'));
    expect(constructionWorkerLane('one')).not.toBe(constructionWorkerLane('two'));
    expect(sampleConstructionWorkerMotion('one', 7, anchors, 'timber')).toEqual(sampleConstructionWorkerMotion('one', 7, anchors, 'timber'));
  });
  it('runs a complete integrated journey without changing progress or inventories', () => {
    const { settlement, person, weather } = setup(); const placement = construction(settlement, person);
    const before = JSON.stringify({ settlement, person });
    const scene = new PhysicalWorkScene(), visuals = new PeopleVisualStateStore();
    const phases = new Set<string>(); let acquired = false;
    for (let frame = 0; frame < 1800; frame++) {
      scene.beginFrame([person]); visuals.beginFrame();
      const worker = scene.plan(person, settlement, placement, undefined, weather, () => true)!;
      const a = worker.action;
      const visual = visuals.resolve(person.id, { destination: a.locomotionTarget, restFacing: Math.atan2(a.interactionAnchor.x - a.locomotionTarget.x, a.interactionAnchor.z - a.locomotionTarget.z) }, 1 / 60, { heightAt: () => 0, isStandable: () => true });
      scene.advance(person, worker, visual, 1 / 60); phases.add(worker.action.phase);
      if (worker.action.carriedObject) { acquired = true; expect(['pickup', 'carry', 'deliver']).toContain(worker.action.phase); }
      if (visual.traveling) expect(worker.ready).toBe(false);
      scene.endFrame();
    }
    expect([...phases]).toEqual(expect.arrayContaining(['return', 'pickup', 'carry', 'deliver', 'assemble']));
    expect(acquired).toBe(true); expect(JSON.stringify({ settlement, person })).toBe(before);
    settlement.development!.project = undefined;
    expect(scene.plan(person, settlement, placement, undefined, weather, () => true)).toBeUndefined();
  });
});

describe('agricultural presentation', () => {
  it('derives seasonal field stages from current productive agriculture', () => {
    const { settlement, weather } = setup();
    const stages = Array.from({ length: 12 }, (_, month) => { settlement.agriculture!.month = month; return farmPresentationState(settlement, month, weather).stage; });
    expect(stages).toEqual(['dormant', 'prepared', 'planted', 'young', 'growing', 'mature', 'harvest', 'harvest', 'stubble', 'stubble', 'dormant', 'dormant']);
    expect(farmPresentationState(settlement, 99, weather).productive).toBe(false);
  });
  it.each(['snow', 'flood', 'storm', 'damage', 'low-output', 'no-labour'] as const)('prevents inappropriate harvest under %s', cause => {
    const { settlement, weather, person, field } = setup();
    if (cause === 'snow') weather.snowpack = 0.7;
    if (cause === 'flood') weather.floodDepth = 0.3;
    if (cause === 'storm') weather.wind = 0.9;
    if (cause === 'damage') weather.cropDamage = 0.98;
    if (cause === 'low-output') { settlement.agriculture!.yieldPerWorker = 0.001; settlement.agriculture!.production = 0.005; }
    if (cause === 'no-labour') settlement.agriculture!.labour = 0;
    const state = farmPresentationState(settlement, 6, weather);
    expect(state.harvestable).toBe(false);
    if (cause !== 'damage') expect(farmerCanPresent(person, field, state, weather)).toBe(false);
    const action = sampleFarmAction(person, field, state, 3, createResourceWorkMotion()); expect(action.carriedObject).toBeUndefined();
  });
  it('requires farmer work at the real field and produces stable safe row anchors', () => {
    const { settlement, person, weather, field } = setup(); const state = farmPresentationState(settlement, 6, weather);
    expect(farmerCanPresent(person, field, state, weather)).toBe(true);
    person.activity = 'travel'; expect(farmerCanPresent(person, field, state, weather)).toBe(false);
    for (let step = 0; step < 12; step++) {
      const a = farmAnchor(field, person.id, step); expect(a).toEqual(farmAnchor(field, person.id, step));
      expect(Math.abs(a.target.x - field.center.x)).toBeLessThan(field.width / 2);
      expect(Math.abs(a.anchor.z - field.center.z)).toBeLessThan(field.depth / 2);
    }
  });
  it('shows crop props only after contact and varies individual cadence', () => {
    const { settlement, person, weather, field } = setup(); const state = farmPresentationState(settlement, 6, weather);
    let contact = false, held = false;
    for (let i = 0; i < 450; i++) {
      const action = sampleFarmAction(person, field, state, i / 100, createResourceWorkMotion());
      if (action.phase === 'contact') contact = true;
      if (action.carriedObject) { expect(contact).toBe(true); held = true; }
      expect(action).toEqual(sampleFarmAction(person, field, state, i / 100, createResourceWorkMotion()));
    }
    expect(held).toBe(true);
    expect(sampleFarmAction(person, field, state, 2, createResourceWorkMotion()).phaseProgress)
      .not.toBe(sampleFarmAction({ ...person, id: 'other' }, field, state, 2, createResourceWorkMotion()).phaseProgress);
  });
  it('uses the same field geometry for crop instances and interaction anchors without state mutation', () => {
    const { settlement, weather, field } = setup();
    const state = { ...fixture.simulation.state, month: 6, settlements: [settlement], weather: { ...fixture.simulation.state.weather, cells: [...fixture.simulation.state.weather.cells] } };
    state.weather.cells[settlement.cellIndex] = weather;
    const before = JSON.stringify(state); const renderer = new FarmFieldRenderer(); renderer.update(state, () => 0, () => true);
    expect(renderer.fields.get(settlement.id)?.geometry).toEqual(field);
    expect(instanceMeshes(renderer.group).every(m => m.count <= m.instanceMatrix.count)).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
    weather.cropDamage = 0.99; renderer.update(state, () => 0, () => true);
    expect(renderer.fields.get(settlement.id)?.state.stage).toBe('damaged');
  });
});

describe('resource contact and bounded articulation', () => {
  it('keeps a gathered object absent until the pluck and generates distinct work motions', () => {
    const assignment = { month: 1, source: 'world-resource' as const, settlementId: 's', siteId: 'site', resourceId: 'plant-fiber', worldPosition: { x: 0, z: 0 }, gatherOccupations: ['forager' as const], labourByOccupation: { forager: 3 }, amountExtracted: 3, labourUsed: 3 };
    const variation = { phaseOffset: 0, cycleSpeed: 1, recovery: 1, strikeStrength: 1 };
    const profile = resourceWorkProfile(assignment); let contact = false, held = false;
    for (let i = 0; i < 600; i++) {
      const m = sampleResourceWorkMotion(profile, variation, i / 100, createResourceWorkMotion());
      if (m.impact > 0) contact = true;
      if (m.held) { expect(contact).toBe(true); held = true; }
    }
    expect(held).toBe(true);
    const results = ['plant-fiber', 'timber', 'stone'].map(resourceId => sampleResourceWorkMotion(resourceWorkProfile({ ...assignment, resourceId }), resourceWorkerVariation('seed', 'p', 'site'), 1, createResourceWorkMotion()));
    expect(new Set(results.map(m => JSON.stringify(m))).size).toBe(3);
    const rig = new ResourceWorkerRenderer(); rig.beginFrame();
    const { person } = setup();
    const action = sampleConstructionAction(person, 'plot', { phase: 'deliver', seconds: 0.8, carrying: false }, anchors, 'timber', results[0]!);
    rig.drawPhysical(results[0]!, action.interactionAnchor, 'hammer', action.carriedObject, '#887744', 1, 0, 0, 0, 0.28, 0, new THREE.Color('#aa8855'));
    rig.endFrame(); expect(instanceMeshes(rig.group).every(m => m.count <= m.instanceMatrix.count)).toBe(true);
  });
});
