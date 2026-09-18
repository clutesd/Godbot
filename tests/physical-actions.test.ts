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
import { advanceConstruction, builderCanPresent, constructionBlockedReason, constructionPresentedMaterial, CONSTRUCTION_HANDOFF_SECONDS, createConstructionPlayback, sampleConstructionAction } from '../src/render/construction/ConstructionActionPresentation';
import { constructionChoreography, constructionMaterialColour } from '../src/render/construction/ConstructionChoreography';
import { constructionWorkerLane, sampleConstructionWorkerMotion } from '../src/render/construction/ConstructionWorkerMotion';
import { assignConstructionCrewRoles, constructionHandoffRecipientId, constructionVisibleCrewIds, constructionWorkfaceIndex, reconcileConstructionCrewRoles } from '../src/render/construction/ConstructionCrewPresentation';
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
const anchors = { pickup: { x: 1, z: 0 }, delivery: { x: 0, z: 1 }, handoff: { x: 0, z: 1.22 },
  materialCenter: { x: 0.87, z: 0 }, siteCenter: { x: 0, z: 0 },
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

  it('pairs each hauler with a stable assembler handoff recipient', () => {
    const assignments = assignConstructionCrewRoles('plot', ['a', 'b', 'c', 'd', 'e', 'f']);
    const assemblerIds = new Set([...assignments.entries()]
      .filter(([, assignment]) => assignment.role === 'assembler').map(([id]) => id));
    for (const [id, assignment] of assignments) {
      if (assignment.role !== 'hauler') continue;
      const recipient = constructionHandoffRecipientId(id, assignments);
      expect(recipient).toBeDefined();
      expect(assemblerIds.has(recipient!)).toBe(true);
      expect(constructionHandoffRecipientId(id, assignments)).toBe(recipient);
    }
  });

  it('preserves established roles as crew membership changes during one project', () => {
    const initial = assignConstructionCrewRoles('plot', ['a', 'b', 'c']);
    const before = new Map([...initial].map(([id, assignment]) => [id, assignment.role]));
    const withArrival = reconcileConstructionCrewRoles('plot', ['a', 'b', 'c', 'd'], initial);
    expect(withArrival.get('a')?.role).toBe(before.get('a'));
    expect(withArrival.get('b')?.role).toBe(before.get('b'));
    expect(withArrival.get('c')?.role).toBe(before.get('c'));

    // Removing a duplicate role does not disturb the established core crew.
    const duplicate = [...withArrival.entries()].find(([id, assignment]) =>
      id === 'd' && [...withArrival.values()].filter(value => value.role === assignment.role).length > 1)?.[0] ?? 'd';
    const remaining = ['a', 'b', 'c', 'd'].filter(id => id !== duplicate);
    const afterDeparture = reconcileConstructionCrewRoles('plot', remaining, withArrival);
    for (const id of remaining) expect(afterDeparture.get(id)?.role).toBe(withArrival.get(id)?.role);

    // If the crew truly collapses to one person, only that necessary fallback changes: someone
    // must become the hauler or the visible workflow would be impossible.
    const survivorId = remaining.find(id => afterDeparture.get(id)?.role !== 'hauler')!;
    const solo = reconcileConstructionCrewRoles('plot', [survivorId], afterDeparture);
    expect(solo.get(survivorId)?.role).toBe('hauler');
  });

  it('protects a bounded visible crew for each active construction project', () => {
    const { settlement, person } = setup();
    construction(settlement, person);
    const people = Array.from({ length: 7 }, (_, index) => ({
      ...structuredClone(person),
      id: `visible-builder-${index}`,
      navigation: {
        ...structuredClone(person.navigation!),
        traveling: index >= 5,
      },
    } as Person));
    const protectedIds = constructionVisibleCrewIds(people, [settlement]);
    expect(protectedIds.size).toBe(3);
    expect([...protectedIds].every(id => people.find(person => person.id === id)?.activity === 'construct')).toBe(true);
    // On-site workers are preferred while enough of them exist.
    expect([...protectedIds].every(id => !people.find(person => person.id === id)?.navigation?.traveling)).toBe(true);
  });

  it('does not protect stale or unrelated construction destinations', () => {
    const { settlement, person } = setup();
    construction(settlement, person);
    const valid = { ...structuredClone(person), id: 'valid-builder' } as Person;
    const stale = { ...structuredClone(person), id: 'stale-builder' } as Person;
    stale.navigation!.destinationId = 'old-plot';
    const unrelated = { ...structuredClone(person), id: 'not-building', activity: 'socialize' } as Person;
    const protectedIds = constructionVisibleCrewIds([valid, stale, unrelated], [settlement]);
    expect(protectedIds.has(valid.id)).toBe(true);
    expect(protectedIds.has(stale.id)).toBe(false);
    expect(protectedIds.has(unrelated.id)).toBe(false);
  });

  it('spreads workers across stable workfaces and keeps site preparation at visible furniture', () => {
    const faces = Array.from({ length: 10 }, (_, index) => constructionWorkfaceIndex('plot', `worker-${index}`));
    expect(faces.every(face => face >= 0 && face <= 3)).toBe(true);
    expect(new Set(faces).size).toBeGreaterThan(1);
    const a = constructionWorksiteAnchors(2, 1.5, 'plot', -0.4, 0);
    const b = constructionWorksiteAnchors(2, 1.5, 'plot', 0.4, 1);
    expect(a.delivery).not.toEqual(b.delivery);
    expect(Math.hypot(a.handoff.x, a.handoff.z)).toBeGreaterThan(Math.hypot(a.delivery.x, a.delivery.z));
    expect(a.prep.z).toBeLessThan(a.prepCenter.z);
    expect(constructionWorksiteAnchors(2, 1.5, 'plot', -0.4, 0)).toEqual(a);
  });

  it('reserves roles for traveling crew members so arrivals do not reshuffle workers already on site', () => {
    const { settlement, person, weather } = setup();
    const placement = construction(settlement, person);
    const people = ['stable-a', 'stable-b', 'stable-c'].map((id, index) => ({
      ...structuredClone(person), id, position: { x: 2.2 + index * 0.08, z: -0.4 },
    } as Person));
    people[2]!.navigation!.traveling = true;

    const scene = new PhysicalWorkScene();
    scene.beginFrame(people);
    const before = people.slice(0, 2).map(member =>
      scene.plan(member, settlement, placement, undefined, weather, () => true)!.crewRole);
    scene.endFrame();

    people[2]!.navigation!.traveling = false;
    scene.beginFrame(people);
    const after = people.slice(0, 2).map(member =>
      scene.plan(member, settlement, placement, undefined, weather, () => true)!.crewRole);
    expect(after).toEqual(before);
    const arrived = scene.plan(people[2]!, settlement, placement, undefined, weather, () => true)!;
    expect(new Set([...after, arrived.crewRole])).toEqual(new Set(['hauler', 'assembler', 'site-worker']));
  });

  it('uses the rendered construction footprint for worker/site alignment when available', () => {
    const { settlement, person, weather } = setup();
    const placement = construction(settlement, person);
    placement.constructionWidth = 1.1;
    placement.constructionDepth = 0.9;
    const scene = new PhysicalWorkScene();
    scene.beginFrame([person]);
    const worker = scene.plan(person, settlement, placement, undefined, weather, () => true)!;
    const local = constructionWorksiteAnchors(1.1, 0.9, 'plot', constructionWorkerLane(person.id), constructionWorkfaceIndex('plot', person.id));
    expect(worker.action.locomotionTarget.x).toBeCloseTo(local.pickup.x);
    expect(worker.action.locomotionTarget.z).toBeCloseTo(local.pickup.z);
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

  it('does not mistake earth-building frame stock for the building fabric', () => {
    const { settlement, person } = setup();
    construction(settlement, person);
    settlement.development!.project!.response.material = 'earth';
    settlement.development!.project!.materialRequirements = [
      { id: 'earth-frame', amount: 1, options: ['timber', 'lumber'], reason: 'structural-frame' },
    ];
    settlement.localMaterials.timber = 5;
    expect(constructionPresentedMaterial(settlement)).toBe('earth');
  });

  it('derives material-specific choreography from the same construction stages as the building', () => {
    const timberFrame = constructionChoreography('timber', 0.3);
    const timberRoof = constructionChoreography('timber', 0.85);
    const stoneWalls = constructionChoreography('masonry', 0.6);
    const metalFrame = constructionChoreography('metal', 0.3);
    const earthFoundation = constructionChoreography('earth', 0.1);
    expect(timberFrame.stageName).toBe('frame');
    expect(timberFrame.assemblerVerb).toBe('fasten-frame');
    expect(timberFrame.prepTool).toBe('axe');
    expect(timberRoof.stageName).toBe('roof');
    expect(timberRoof.assemblerVerb).toBe('fix-rafters');
    expect(stoneWalls.assemblerVerb).toBe('lay-stone-course');
    expect(metalFrame.assemblyMotion).toBe('fit');
    expect(earthFoundation.assemblyMotion).toBe('pack');
    expect(earthFoundation.assemblerTool).toBe('none');
    expect(constructionChoreography('ceramic', 0.6).assemblerTool).toBe('none');
    expect(constructionChoreography('metal', 0.96).finishing).toBe(true);
  });

  it('changes worker motion when the same material crosses Step 1 construction stages', () => {
    const { person } = setup();
    const sample = (progress: number) => {
      const motion = createResourceWorkMotion();
      sampleConstructionAction(person, 'plot', { phase: 'assemble', seconds: 0.76, carrying: false },
        anchors, 'timber', motion, undefined, 'assembler', 3, progress);
      return motion;
    };
    const foundation = sample(0.1);
    const frame = sample(0.3);
    const walls = sample(0.6);
    const roof = sample(0.85);
    const finishing = sample(0.96);
    expect(new Set([foundation, frame, walls, roof].map(motion => JSON.stringify(motion))).size).toBe(4);
    expect(roof.handY).toBeGreaterThan(foundation.handY);
    expect(finishing.impact).toBeLessThanOrEqual(roof.impact);
  });

  it('produces visibly distinct assembler motion for different construction materials', () => {
    const { person } = setup();
    const samples = (['earth', 'timber', 'masonry', 'ceramic', 'metal'] as const).map(material => {
      const motion = createResourceWorkMotion();
      const action = sampleConstructionAction(person, 'plot', { phase: 'assemble', seconds: 0.82, carrying: false },
        anchors, material, motion, undefined, 'assembler', 3, 0.6);
      return { material, motion: { ...motion }, tool: action.activeTool };
    });
    expect(new Set(samples.map(sample => JSON.stringify(sample.motion))).size).toBe(5);
    expect(samples.find(sample => sample.material === 'earth')!.tool).toBe('none');
    expect(samples.find(sample => sample.material === 'timber')!.tool).toBe('hammer');
    expect(samples.find(sample => sample.material === 'ceramic')!.tool).toBe('none');
  });

  it('turns the site-worker prep station into material-specific work', () => {
    const { person } = setup();
    const timberMotion = createResourceWorkMotion();
    const stoneMotion = createResourceWorkMotion();
    const timber = sampleConstructionAction(person, 'plot', { phase: 'inspect', seconds: 0.7, carrying: false },
      anchors, 'timber', timberMotion, undefined, 'site-worker', 3, 0.3);
    const stone = sampleConstructionAction(person, 'plot', { phase: 'inspect', seconds: 0.7, carrying: false },
      anchors, 'masonry', stoneMotion, undefined, 'site-worker', 3, 0.6);
    expect(timber.activeTool).toBe('axe');
    expect(stone.activeTool).toBe('hammer');
    expect(timberMotion).not.toEqual(stoneMotion);
    expect(timber.targetKind).toBe('site-prep');
  });

  it('uses readable material colours for carried construction loads', () => {
    expect(new Set((['earth', 'timber', 'masonry', 'ceramic', 'metal'] as const).map(constructionMaterialColour)).size).toBe(5);
  });

  it('keeps a delivered load visible until the middle of the handoff beat', () => {
    const playback = { phase: 'deliver', seconds: 0, carrying: true } as ReturnType<typeof createConstructionPlayback>;
    for (let i = 0; i < 6; i++) advanceConstruction(playback, 0.1, true, false, 'hauler', 3);
    expect(playback.phase).toBe('handoff');
    expect(playback.carrying).toBe(true);
    while (playback.seconds < CONSTRUCTION_HANDOFF_SECONDS * 0.45) {
      advanceConstruction(playback, 0.1, true, false, 'hauler', 3);
    }
    expect(playback.carrying).toBe(true);
    while (playback.seconds < CONSTRUCTION_HANDOFF_SECONDS * 0.6) {
      advanceConstruction(playback, 0.1, true, false, 'hauler', 3);
    }
    expect(playback.carrying).toBe(false);
    expect(playback.phase).toBe('handoff');
  });

  it('gives the assembler an explicit receive/placement beat during handoff', () => {
    const { person } = setup();
    const motion = createResourceWorkMotion();
    const action = sampleConstructionAction(person, 'plot', { phase: 'assemble', seconds: 0.6, carrying: false },
      anchors, 'timber', motion, undefined, 'assembler', 3, 0.3,
      { sourcePersonId: 'hauler', progress: 0.62, material: 'timber' });
    expect(action.phase).toBe('receive');
    expect(action.actionKind).toBe('construction-receive');
    expect(action.targetKind).toBe('handoff');
    expect(action.activeTool).toBe('none');
    expect(action.carriedObject).toBe('timber');
    expect(action.locomotionTarget).toEqual(anchors.delivery);
    expect(action.interactionAnchor.z).toBeGreaterThan(anchors.delivery.z);
  });

  it('aligns a paired hauler and assembler to the same physical handoff workface', () => {
    const { settlement, person, weather } = setup();
    const placement = construction(settlement, person);
    const people = ['handoff-a', 'handoff-b'].map((id, index) => ({
      ...structuredClone(person), id, position: { x: 2.2 + index * 0.04, z: -0.4 },
    } as Person));
    const scene = new PhysicalWorkScene();
    scene.beginFrame(people);
    const workers = people.map(member => scene.plan(member, settlement, placement, undefined, weather, () => true)!);
    const hauler = workers.find(worker => worker.crewRole === 'hauler')!;
    const assembler = workers.find(worker => worker.crewRole === 'assembler')!;
    const assemblerPerson = people.find(member => member.id === assembler.action.personId)!;
    expect(hauler.handoffRecipientId).toBe(assembler.action.personId);
    expect(hauler.anchors!.delivery).toEqual(assembler.anchors!.delivery);
    expect(hauler.anchors!.handoff).toEqual(assembler.anchors!.handoff);

    hauler.playback!.phase = 'handoff';
    hauler.playback!.seconds = CONSTRUCTION_HANDOFF_SECONDS * 0.62;
    hauler.playback!.carrying = false;
    const receiving = scene.plan(assemblerPerson, settlement, placement, undefined, weather, () => true)!;
    expect(receiving.action.phase).toBe('receive');
    expect(receiving.action.carriedObject).toBe('timber');
  });

  it('requires an active safe project and the matching destination', () => {
    const { settlement, person, weather } = setup(); construction(settlement, person);
    expect(builderCanPresent(person, settlement, weather)).toBe(true);
    person.navigation!.destinationId = 'cancelled-plot'; expect(builderCanPresent(person, settlement, weather)).toBe(false);
    person.navigation!.destinationId = 'plot'; settlement.development!.project!.progress = 1;
    expect(builderCanPresent(person, settlement, weather)).toBe(false);
    settlement.development!.project = undefined; expect(builderCanPresent(person, settlement, weather)).toBe(false);
  });
  it('keeps dedicated haulers out of assembler phases and tools', () => {
    const { person } = setup();
    const playback = createConstructionPlayback();
    const seen = new Set<string>();
    for (let step = 0; step < 120; step++) {
      advanceConstruction(playback, 0.1, true, false, 'hauler', 3);
      seen.add(playback.phase);
      const action = sampleConstructionAction(person, 'plot', playback, anchors, 'timber', createResourceWorkMotion(), undefined, 'hauler', 3);
      expect(action.activeTool).toBe('none');
      expect(action.actionKind).toBe('construction-haul');
    }
    expect(seen.has('assemble')).toBe(false);
    expect([...seen]).toEqual(expect.arrayContaining(['pickup', 'carry', 'deliver', 'handoff', 'return']));
  });

  it('keeps a true one-person construction crew as an explicit generalist fallback', () => {
    const { person } = setup();
    const playback = createConstructionPlayback();
    let assembled = false;
    for (let step = 0; step < 120; step++) {
      advanceConstruction(playback, 0.1, true, false, 'hauler', 1);
      const action = sampleConstructionAction(person, 'plot', playback, anchors, 'timber', createResourceWorkMotion(), undefined, 'hauler', 1);
      if (playback.phase === 'assemble') {
        assembled = true;
        expect(action.actionKind).toBe('construction-generalist');
        expect(action.activeTool).toBe('hammer');
      }
    }
    expect(assembled).toBe(true);
  });

  it('drops the legacy assemble beat immediately when a solo generalist gains a crew mate', () => {
    const playback = { phase: 'assemble', seconds: 0.8, carrying: false } as const;
    const mutable = { ...playback };
    advanceConstruction(mutable, 0, false, false, 'hauler', 2);
    expect(mutable.phase).toBe('return');
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
    for (let i = 0; i < 6; i++) advanceConstruction(playback, 0.1, true, false);
    expect(playback.phase).toBe('handoff'); expect(playback.carrying).toBe(true);
    for (let i = 0; i < 5; i++) advanceConstruction(playback, 0.1, true, false);
    expect(playback.carrying).toBe(false);
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
    expect([...phases]).toEqual(expect.arrayContaining(['return', 'pickup', 'carry', 'deliver', 'handoff', 'assemble']));
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
