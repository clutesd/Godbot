import { beforeAll, describe, expect, it } from 'vitest';
import { vegetationFixture } from './fixtures/vegetation';
import type { Person, Settlement, WeatherCellState } from '../src/sim/types';
import type { DevelopmentResponse, StructureMaterial } from '../src/sim/development/types';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { BUILD_STAGE } from '../src/render/assets/BuildingComposer';
import { ConstructionAssembly } from '../src/render/construction/ConstructionAssembly';
import { assignConstructionCrewRoles } from '../src/render/construction/ConstructionCrewPresentation';
import { facingTarget } from '../src/render/people/PhysicalActionPresentation';
import {
  CONSTRUCTION_WORKFACE_CLEARANCE, PhysicalWorkScene, constructionSitePlacement, constructionWorkfaceStand,
  type PhysicalWorker, type WorkPlacement,
} from '../src/render/people/PhysicalWorkScene';
import { PeopleVisualStateStore, visualRouteClear, type PersonVisualGround } from '../src/render/people/PeopleVisualState';
import { StructureNavigation } from '../src/sim/people/StructureNavigation';
import * as THREE from 'three';
import { advanceConstructionPresentation } from '../src/render/construction/ConstructionPresentation';
import { constructionActiveWorkZone } from '../src/render/construction/ConstructionAssembly';
import { constructionVisibleCrewIds } from '../src/render/construction/ConstructionCrewPresentation';
import { ResourceWorkerRenderer } from '../src/render/resources/ResourceWorkerRenderer';
import { constructionMaterialColour } from '../src/render/construction/ConstructionChoreography';
import { GodboxRenderer } from '../src/render/GodboxRenderer';
import { ConstructionRuntime } from '../src/render/construction/ConstructionRuntime';
import { Simulation } from '../src/sim/Simulation';
import { developmentBuildingRole, developmentPresentationEra } from '../src/render/assets/BuildingGrammar';

/**
 * Real structure collision path: a composed building's plot footprint feeds the same
 * StructureNavigation the renderer uses for pedestrians, and the same visual mover resolves every
 * frame. Targets are approved with `visualRouteClear`, the renderer's own route authority. Nothing
 * here approves a target with `() => true`, and the building itself stays solid.
 */

let fixture: ReturnType<typeof vegetationFixture>;
beforeAll(() => { fixture = vegetationFixture('construction-workface-access'); });

const FRAME_SECONDS = 1 / 30;
const SECONDS_BUDGET = 60;
const ROTATION = 0.3;

interface Site {
  settlement: Settlement;
  weather: WeatherCellState;
  crew: Person[];
  placement: WorkPlacement;
  nav: StructureNavigation;
  ground: PersonVisualGround;
  assembly: ConstructionAssembly;
  source: THREE.Object3D;
}

function site(plotMargin: number, material: StructureMaterial = 'timber'): Site {
  const settlement = structuredClone(fixture.simulation.state.settlements[0]!);
  settlement.alive = true;
  const weather = { ...fixture.simulation.state.weather.cells[settlement.cellIndex]!, snowpack: 0, wind: 0, blizzard: 0, floodDepth: 0, cropDamage: 0, kind: 'clear' } as WeatherCellState;
  const style = fixture.simulation.state.cultures[0]!.style;
  const response: DevelopmentResponse = { need: 'housing', form: 'dwelling', name: 'house', level: 2, material, cultureId: fixture.simulation.state.people[0]!.cultureId,
    style, services: { housing: 2 }, reasons: [], capabilities: [], cost: { food: 0, wood: 4, minerals: 0, goods: 0, wealth: 0 }, labor: 4 };
  const builder = new AssetBuilder('construction-workface-access');
  const source = builder.getAsset('building', { seed: 'workface-house', culture: style, era: 'early', development: response, variant: `house#${BUILD_STAGE.FINISH}` }).mesh;
  const footprintWidth = Number(source.userData['footprintWidth']);
  const footprintDepth = Number(source.userData['footprintDepth']);
  const fit = 2.4 / footprintWidth;
  const plotWidth = 2.4 * (1 + plotMargin);
  const plotDepth = footprintDepth * fit * (1 + plotMargin);
  const assembly = new ConstructionAssembly(source, fit, 'plot', material);
  assembly.update(0.5);
  builder.dispose();
  const placement: WorkPlacement = { key: 'plot', worldX: 0, worldZ: 0, width: plotWidth, depth: plotDepth, rotationY: ROTATION,
    constructionWidth: footprintWidth * fit, constructionDepth: footprintDepth * fit, constructionPlan: assembly.plan };
  settlement.structurePlots = [{ id: 'plot', worldX: 0, worldZ: 0, width: plotWidth, depth: plotDepth, height: 1,
    radius: Math.hypot(plotWidth, plotDepth) / 2, condition: 1, foundedMonth: 0 }];
  settlement.resources = { food: 20, wood: 20, minerals: 20, goods: 20, wealth: 20 };
  settlement.development = { pressures: {}, unmet: {}, informal: {}, providers: {}, evaluatedMonth: 6, nextAttemptMonth: 12, revision: 1,
    project: { plotId: 'plot', response, action: 'founded', startedMonth: 0, progress: 0.5,
      spent: { food: 0, wood: 1, minerals: 0, goods: 0, wealth: 0 }, blockedReasons: [] } };
  const crew: Person[] = ['builder-a', 'builder-b', 'builder-c'].map((id, index) => ({
    ...structuredClone(fixture.simulation.state.people[0]!), id, alive: true, health: 1, displacedSinceMonth: undefined,
    homeId: settlement.id, occupation: 'builder', role: 'builder', activity: 'construct',
    position: { x: 2.6 + index * 0.05, z: -0.9 + index * 0.1 },
    navigation: { destinationKind: 'construction-site', destinationId: 'plot', traveling: false, schedulePhase: 'work', reason: 'test', waypoints: [], waypointIndex: 0 },
  } as Person));
  // The same footprint the renderer feeds StructureNavigation from its settlement placements.
  const nav = new StructureNavigation();
  nav.set([{ key: 'plot', worldX: 0, worldZ: 0, width: plotWidth, depth: plotDepth, rotationY: ROTATION }]);
  const ground: PersonVisualGround = {
    heightAt: () => 0,
    isStandable: () => true,
    safeSegment: (a, b) => nav.clear(a, b),
    detour: (a, b) => nav.detour(a, b, (p, q) => nav.clear(p, q)),
  };
  return { settlement, weather, crew, placement, nav, ground, assembly, source };
}

/** Runs the renderer's per-frame order for every crew member: plan, resolve, advance. */
function simulate(s: Site, seconds: number, onFrame?: (workers: Map<string, PhysicalWorker>, scene: PhysicalWorkScene) => void) {
  const scene = new PhysicalWorkScene();
  const visuals = new PeopleVisualStateStore();
  const safe = (a: { x: number; z: number }, b: { x: number; z: number }) => visualRouteClear(a, b, s.ground);
  const workers = new Map<string, PhysicalWorker>();
  for (let t = 0; t < seconds; t += FRAME_SECONDS) {
    scene.beginFrame(s.crew, [s.settlement]);
    visuals.beginFrame();
    for (const person of s.crew) {
      const worker = scene.plan(person, s.settlement, s.placement, undefined, s.weather, safe);
      if (!worker) { workers.delete(person.id); continue; }
      // Mirrors GodboxRenderer: physical work faces its interaction anchor while resting.
      const visual = visuals.resolve(person.id, {
        destination: worker.action.locomotionTarget,
        restFacing: facingTarget(worker.action.locomotionTarget, worker.action.interactionAnchor),
        arrivalEase: true,
      }, FRAME_SECONDS, s.ground);
      scene.advance(person, worker, visual, FRAME_SECONDS);
      workers.set(person.id, worker);
    }
    scene.endFrame();
    onFrame?.(workers, scene);
  }
  return { scene, workers };
}

describe('construction workface contract', () => {
  it('keeps the building solid while exposing stand points just outside it', () => {
    const s = site(0);
    const half = { x: s.placement.width / 2, z: s.placement.depth / 2 };
    const centre = { x: 0, z: 0 };
    expect(s.nav.clear(centre, centre)).toBe(false);
    for (const face of [0, 1, 2, 3]) {
      const stand = constructionWorkfaceStand({ x: 0, z: 0 }, face, { x: half.x + CONSTRUCTION_WORKFACE_CLEARANCE, z: half.z + CONSTRUCTION_WORKFACE_CLEARANCE });
      const rotated = { x: Math.cos(ROTATION) * stand.x + Math.sin(ROTATION) * stand.z, z: -Math.sin(ROTATION) * stand.x + Math.cos(ROTATION) * stand.z };
      expect(s.nav.clear(rotated, rotated)).toBe(true);
    }
  });

  it('pushes an interior work point onto the requested face without moving it along that face', () => {
    const footprint = { x: 1.2, z: 0.8 };
    expect(constructionWorkfaceStand({ x: 0.3, z: 0.1 }, 0, footprint)).toEqual({ x: 1.2, z: 0.1 });
    expect(constructionWorkfaceStand({ x: -0.3, z: -0.1 }, 2, footprint)).toEqual({ x: -1.2, z: -0.1 });
    expect(constructionWorkfaceStand({ x: 0.2, z: 0.5 }, 1, footprint)).toEqual({ x: 0.2, z: 0.8 });
    expect(constructionWorkfaceStand({ x: 0.2, z: -0.5 }, 3, footprint)).toEqual({ x: 0.2, z: -0.8 });
    // Already-outside points are untouched.
    expect(constructionWorkfaceStand({ x: 2, z: 0 }, 0, footprint)).toEqual({ x: 2, z: 0 });
  });

  it('resolves the active site by plot id, never by placement order', () => {
    const decoy = { key: 'other-plot', worldX: 9, worldZ: 9 };
    const active = { key: 'plot', worldX: 0, worldZ: 0 };
    const project = { plotId: 'plot' } as Parameters<typeof constructionSitePlacement>[1];
    expect(constructionSitePlacement([decoy, active], project)).toBe(active);
    expect(constructionSitePlacement([active, decoy], project)).toBe(active);
    expect(constructionSitePlacement([decoy], project)).toBeUndefined();
    expect(constructionSitePlacement([active], undefined)).toBeUndefined();
  });
});

describe('construction workers reach the real workface through the structure collision path', () => {
  for (const margin of [0, 0.25]) {
    it(`brings every assigned builder to ready and performs contact work with a ${margin * 100}% spare plot`, () => {
      const s = site(margin);
      const roles = assignConstructionCrewRoles(s.placement.key, s.crew.map(p => p.id));
      const assembler = s.crew.find(p => roles.get(p.id)?.role === 'assembler')!;
      expect(assembler).toBeDefined();
      expect(s.crew.map(p => roles.get(p.id)?.role).sort()).toEqual(['assembler', 'hauler', 'site-worker']);

      const everReady = new Set<string>();
      let assemblerContact = false;
      let assemblerTool = false;
      let carriedLoad = false;
      let installation = false;
      simulate(s, SECONDS_BUDGET, (workers, scene) => {
        for (const [id, worker] of workers) {
          if (worker.ready) everReady.add(id);
          if (worker.action.carriedObject && !worker.action.blockedReason) carriedLoad = true;
        }
        const worker = workers.get(assembler.id);
        if (worker?.ready && worker.action.targetKind === 'workface') {
          if (worker.action.contactStrength > 0.03) assemblerContact = true;
          if (worker.action.activeTool) assemblerTool = true;
        }
        if (scene.installationContact(s.placement.key)) installation = true;
      });

      // Every assigned builder reaches a physically valid stand, not just the one that installs.
      expect([...everReady].sort()).toEqual(s.crew.map(p => p.id).sort());
      expect(carriedLoad).toBe(true);
      expect(assemblerTool).toBe(true);
      expect(assemblerContact).toBe(true);
      expect(installation).toBe(true);
    });
  }
});

/** Same mover -> physical action -> instanced props -> reveal path as GodboxRenderer. */
function runtime(s: Site, visuals = new PeopleVisualStateStore()) {
  const scene = new PhysicalWorkScene();
  const renderer = new ResourceWorkerRenderer();
  const visible = constructionVisibleCrewIds(s.crew, [s.settlement]);
  for (const person of s.crew) if (!visuals.get(person.id)) visuals.resolve(person.id, { destination: person.position }, 0, s.ground);
  const tick = () => {
    const dt = 0.1;
    scene.beginFrame(s.crew, [s.settlement]); visuals.beginFrame(); renderer.beginFrame();
    const active: PhysicalWorker[] = [];
    for (const person of s.crew.filter(p => visible.has(p.id))) {
      const worker = scene.plan(person, s.settlement, s.placement, undefined, s.weather,
        (a, b) => visualRouteClear(a, b, s.ground), visuals.get(person.id));
      if (!worker) continue;
      const visual = visuals.resolve(person.id, { destination: worker.action.locomotionTarget,
        restFacing: facingTarget(worker.action.locomotionTarget, worker.action.interactionAnchor), arrivalEase: true }, dt, s.ground);
      scene.advance(person, worker, visual, dt);
      renderer.drawPhysical(worker.motion, worker.action.interactionAnchor, worker.ready ? worker.action.activeTool : 'none',
        worker.action.carriedObject, constructionMaterialColour(worker.material), worker.action.carriedObject ? 1 : worker.blend,
        visual.x, visual.footY + (worker.elevation ?? 0), visual.z, 0.28, visual.facing, new THREE.Color('#b4573a'),
        false, worker.ready, visual.traveling, worker.action.contactEffect ?? 'none',
        worker.action.contactHeight === undefined ? undefined : (worker.workBaseY ?? visual.footY) + worker.action.contactHeight);
      active.push(worker);
    }
    scene.endFrame(); renderer.endFrame();
    const cue = scene.installationPresentation(s.placement.key, s.assembly.plan);
    advanceConstructionPresentation(s.assembly, scene, s.placement.key, s.settlement.development!.project!.progress, dt);
    return { active, cue };
  };
  return { tick, scene, visuals, renderer, visible };
}

function fabricSnapshot(assembly: ConstructionAssembly) {
  return { progress: assembly.plan.progress, meshes: assembly.group.children.map(child => child instanceof THREE.Mesh
    ? { visible: child.visible, count: child.geometry.drawRange.count, position: child.position.toArray(), scale: child.scale.toArray() } : {}) };
}

describe('human-caused construction through the runtime presentation path', () => {
  it('connects a real Simulation paid workforce and completed receipt to worker-led canonical assembly', () => {
    const sim = new Simulation({ seed: 'construction-runtime-live', startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 } });
    const bridge = new ConstructionRuntime();
    bridge.sync(sim.state);
    let raw: Settlement | undefined;
    for (let month = 0; month < 180 && !raw; month++) {
      sim.step(); bridge.sync(sim.state);
      raw = sim.state.settlements.find(s => bridge.settlement(s).development?.project?.progress === 1);
    }
    expect(raw, 'the real monthly simulation completes paid construction').toBeDefined();
    const settlement = bridge.settlement(raw!);
    const project = settlement.development!.project!;
    expect(project.workerIds!.length).toBeGreaterThan(0);
    expect(project.labourSpent).toBeCloseTo(project.response.labor);
    expect(raw!.development?.project).not.toBe(project);
    expect(bridge.holds(project.plotId)).toBe(true);
    const crew = sim.state.people.filter(p => project.workerIds!.includes(p.id)).map(p => bridge.person(p));
    expect(crew.length).toBeGreaterThan(0);
    expect(crew.every(p => p.activity === 'construct' && p.navigation?.destinationId === project.plotId)).toBe(true);
    const rawCrew = sim.state.people.filter(p => project.workerIds!.includes(p.id));
    expect(rawCrew.some(p => p.activity !== 'construct' || p.navigation?.destinationId !== project.plotId)).toBe(true);
    const plot = settlement.structurePlots!.find(p => p.id === project.plotId)!;
    const assetBuilder = new AssetBuilder('real-paid-construction');
    const source = assetBuilder.getAsset('building', { seed: 'real-paid-construction', culture: project.response.style,
      development: project.response, era: developmentPresentationEra(project.response),
      variant: `${developmentBuildingRole(project.response)}#${BUILD_STAGE.FINISH}` }).mesh;
    const width = Number(source.userData['footprintWidth']), depth = Number(source.userData['footprintDepth']);
    const fit = Math.min(plot.width / width, plot.depth / depth) * Math.min(1, 0.64 + project.response.level * 0.12);
    const assembly = new ConstructionAssembly(source, fit, plot.id, project.response.material);
    assembly.update(0);
    const placement: WorkPlacement = { key: plot.id, worldX: plot.worldX, worldZ: plot.worldZ,
      width: plot.width, depth: plot.depth, rotationY: 0, constructionWidth: width * fit, constructionDepth: depth * fit, constructionPlan: assembly.plan };
    const nav = new StructureNavigation(); nav.set([placement]);
    const ground: PersonVisualGround = { heightAt: () => 0, isStandable: () => true,
      safeSegment: (a, b) => nav.clear(a, b), detour: (a, b) => nav.detour(a, b, (p, q) => nav.clear(p, q)) };
    const weather = { ...sim.state.weather.cells[settlement.cellIndex]!, wind: 0, blizzard: 0, floodDepth: 0, kind: 'clear' } as WeatherCellState;
    const s: Site = { settlement, weather, crew: [], placement, nav, ground, assembly, source };
    const snapshot = structuredClone({ people: sim.state.people, settlement: raw });
    const unattended = runtime(s);
    for (let frame = 0; frame < 20; frame++) unattended.tick();
    expect(assembly.plan.progress).toBe(0);
    s.crew = crew;
    const visuals = new PeopleVisualStateStore();
    for (const [index, person] of crew.entries()) visuals.resolve(person.id, {
      destination: { x: plot.worldX + plot.width / 2 + 0.4 + index * 0.15, z: plot.worldZ + plot.depth / 2 + 0.4 },
    }, 0, ground);
    const run = runtime(s, visuals);
    let ready = false, pickup = false, carry = false, contact = false, tool = false, fragments = false;
    for (let frame = 0; frame < 20000 && assembly.plan.progress! < 1; frame++) {
      const { active, cue } = run.tick();
      ready ||= active.some(w => w.ready && w.accessReady);
      pickup ||= active.some(w => w.ready && w.action.phase === 'pickup');
      carry ||= active.some(w => w.action.carriedObject !== undefined && w.action.phase === 'carry');
      contact ||= cue.contact;
      fragments ||= (run.renderer.group.getObjectByName('Resource and construction contact fragments') as THREE.InstancedMesh).count > 0;
      if (active.some(w => w.ready && w.action.activeTool !== 'none')) {
        const shafts = run.renderer.group.getObjectByName('Resource worker tool shafts') as THREE.InstancedMesh;
        const matrix = new THREE.Matrix4();
        for (let index = 0; index < shafts.count; index++) {
          shafts.getMatrixAt(index, matrix);
          tool ||= new THREE.Vector3().setFromMatrixScale(matrix).length() > 0.01;
        }
      }
    }
    expect({ ready, pickup, carry, contact }).toEqual({ ready: true, pickup: true, carry: true, contact: true });
    expect(tool || fragments).toBe(true);
    expect(assembly.plan.progress).toBe(1);
    expect({ people: sim.state.people, settlement: raw }).toEqual(snapshot);
    bridge.finish(raw!, project);
    expect(bridge.holds(project.plotId)).toBe(false);
    expect(raw!.structurePlots!.find(p => p.id === project.plotId)!.development!.status).toBe('active');
    assetBuilder.dispose();
  }, 20000);
  it('starts builders from the renderer grounded position when the logical destination is inside the active plot', () => {
    const s = site(0);
    s.crew = s.crew.slice(0, 2);
    for (const person of s.crew) person.position = { x: s.placement.worldX, z: s.placement.worldZ };
    const authority = structuredClone(s.crew);
    const unsafeStart = new PhysicalWorkScene();
    unsafeStart.beginFrame(s.crew, [s.settlement]);
    expect(unsafeStart.plan(s.crew[0]!, s.settlement, s.placement, undefined, s.weather,
      (a, b) => visualRouteClear(a, b, s.ground), s.crew[0]!.position)).toBeUndefined();
    const visuals = new PeopleVisualStateStore();
    const methods = GodboxRenderer.prototype as unknown as {
      personDisplayTarget(person: Person, group: undefined): { x: number; z: number };
      workPresentationPosition(person: Person, base: { x: number; z: number }): { x: number; z: number };
    };
    const context = {
      state: { settlements: [s.settlement] }, peopleVisuals: visuals, personGround: s.ground,
      // The obsolete placement-index fallback would send workers to this unrelated building.
      settlementBuildingPlacements: new Map([[s.settlement.id, [{ ...s.placement, key: 'decoy', worldX: 20, worldZ: 20 }, s.placement]]]),
      lastPersonGroundPosition: new Map(), assignedPostFor: () => undefined, shownBuildingCount: () => 0,
      personCollisionFree: (x: number, z: number) => s.nav.clear({ x, z }),
      nearestRenderableGround: () => { throw new Error('active plot perimeter should already be grounded'); },
    } as unknown as GodboxRenderer;
    for (const person of s.crew) {
      const base = methods.personDisplayTarget.call(context, person, undefined);
      expect(Math.hypot(base.x - s.placement.worldX, base.z - s.placement.worldZ)).toBeLessThan(5);
      expect(s.nav.clear(base)).toBe(true);
      const start = methods.workPresentationPosition.call(context, person, base);
      expect(start).toMatchObject({ x: base.x, z: base.z });
      // Repeated calls preserve an existing visual position, including after authority moves.
      expect(methods.workPresentationPosition.call(context, person, { x: 30, z: 30 })).toBe(start);
    }
    const run = runtime(s, visuals);
    let reached = false, received = false, contact = false;
    const before = s.assembly.plan.progress!;
    s.settlement.development!.project!.progress = 0.65;
    for (let frame = 0; frame < 2000 && !contact; frame++) {
      const { active, cue } = run.tick();
      reached ||= active.some(w => w.ready && w.accessReady);
      received ||= active.some(w => w.action.phase === 'receive' && w.action.carriedObject !== undefined);
      contact ||= cue.contact;
    }
    expect({ reached, received, contact }).toEqual({ reached: true, received: true, contact: true });
    for (let frame = 0; frame < 15; frame++) run.tick();
    expect(s.assembly.plan.progress).toBeGreaterThan(before);
    expect(s.crew).toEqual(authority);
  });
  it.each(['timber', 'masonry', 'ceramic', 'earth', 'metal'] as const)('seats %s with a solo generalist and a paired crew, including hand placement without a tool', material => {
    for (const size of [1, 2]) {
      const s = site(0, material);
      s.crew = s.crew.slice(0, size);
      s.settlement.development!.project!.progress = 0.65;
      const run = runtime(s);
      const start = s.assembly.plan.progress!;
      let struck = false;
      for (let frame = 0; frame < 2000 && s.assembly.plan.progress === start; frame++) {
        const { cue } = run.tick();
        struck ||= cue.contact;
        if (!struck) expect(s.assembly.plan.progress).toBe(start);
      }
      expect(struck).toBe(true);
      expect(s.assembly.plan.progress).toBeGreaterThan(start);
      expect(s.assembly.plan.progress).toBeLessThanOrEqual(0.65);
    }
  });
  it('protects real labour, shows pickup/carry/handoff/tool/contact, and freezes reveal when access is lost mid-seat', () => {
    const s = site(0.25);
    s.settlement.development!.project!.progress = 0.65;
    const authority = structuredClone(s.settlement);
    const run = runtime(s);
    expect(run.visible.size).toBe(3);
    let pickup = false, carry = false, handoff = false, received = false, contact = false, tool = false;
    let advanced = false;
    for (let frame = 0; frame < 1600; frame++) {
      const before = s.assembly.plan.progress!;
      const { active, cue } = run.tick();
      if (s.assembly.plan.progress! > before) {
        expect(cue.valid).toBe(true);
        expect(active.some(w => w.ready && w.action.targetKind === 'workface')).toBe(true);
        advanced = true;
      }
      for (const w of active) {
        expect(w.action.targetId).toBe(s.settlement.development!.project!.plotId);
        expect(s.nav.clear(w.action.locomotionTarget, w.action.locomotionTarget)).toBe(true);
        if (w.ready && w.action.phase === 'pickup') {
          pickup = true;
          expect(Math.hypot(w.action.interactionAnchor.x - w.anchors!.materialCenter.x,
            w.action.interactionAnchor.z - w.anchors!.materialCenter.z)).toBeLessThan(0.55);
        }
        if (w.action.phase === 'carry' && w.action.carriedObject) {
          carry = true;
          expect((run.renderer.group.getObjectByName('Carried timber') as THREE.InstancedMesh).count).toBeGreaterThan(0);
        }
        if (w.ready && w.action.phase === 'handoff') handoff = true;
        if (w.action.phase === 'receive' && w.action.carriedObject) received = true;
        if (w.ready && w.action.activeTool !== 'none') {
          const shafts = run.renderer.group.getObjectByName('Resource worker tool shafts') as THREE.InstancedMesh;
          const matrix = new THREE.Matrix4();
          for (let i = 0; i < shafts.count; i++) {
            shafts.getMatrixAt(i, matrix);
            if (new THREE.Vector3().setFromMatrixScale(matrix).length() > 0.01) tool = true;
          }
        }
        if (cue.contact && w.action.contactEffect) {
          const fragments = run.renderer.group.getObjectByName('Resource and construction contact fragments') as THREE.InstancedMesh;
          expect(fragments.count).toBeGreaterThan(0);
          contact = true;
        }
      }
      if (advanced && contact && received) break;
    }
    expect({ pickup, carry, handoff, received, contact, tool, advanced }).toEqual({
      pickup: true, carry: true, handoff: true, received: true, contact: true, tool: true, advanced: true,
    });
    const held = fabricSnapshot(s.assembly);
    s.ground.safeSegment = () => false;
    s.ground.detour = () => [];
    for (let frame = 0; frame < 30; frame++) {
      const { cue, active } = run.tick();
      expect(cue).toEqual({ valid: false, contact: false });
      expect(active).toHaveLength(0);
      expect(fabricSnapshot(s.assembly)).toEqual(held);
    }
    // No simulation progress, paid inputs, material stocks or plot data were rewritten by presentation.
    expect(s.settlement).toEqual(authority);
    s.ground.safeSegment = (a, b) => s.nav.clear(a, b);
    s.ground.detour = (a, b) => s.nav.detour(a, b, (p, q) => s.nav.clear(p, q));
    for (let frame = 0; frame < 1600 && s.assembly.plan.progress === held.progress; frame++) run.tick();
    expect(s.assembly.plan.progress).toBeGreaterThan(held.progress!);
    expect(s.assembly.plan.progress).toBeLessThanOrEqual(s.settlement.development!.project!.progress);
  });

  it('holds a newly presented paid site without labour, rejects a decoy plot, and ignores stale contact', () => {
    const s = site(0);
    s.assembly.update(0);
    const run = runtime(s);
    const before = fabricSnapshot(s.assembly);
    s.crew.forEach(person => { person.activity = 'rest'; });
    for (let frame = 0; frame < 20; frame++) run.tick();
    expect(fabricSnapshot(s.assembly)).toEqual(before);
    s.crew.forEach(person => { person.activity = 'construct'; });
    expect(run.scene.plan(s.crew[0]!, s.settlement, { ...s.placement, key: 'decoy' }, undefined, s.weather,
      (a, b) => visualRouteClear(a, b, s.ground))).toBeUndefined();
    for (let frame = 0; frame < 1600 && !run.scene.installationContact(s.placement.key); frame++) run.tick();
    expect(run.scene.installationContact(s.placement.key)).toBe(true);
    run.scene.beginFrame();
    const held = fabricSnapshot(s.assembly);
    advanceConstructionPresentation(s.assembly, run.scene, s.placement.key, 0.9, 0.1);
    expect(fabricSnapshot(s.assembly)).toEqual(held);
  });

  it('crosses each canonical stage deterministically and completes with every original target triangle', () => {
    const traces: number[][] = [];
    for (let replay = 0; replay < 2; replay++) {
      const s = site(0);
      const sourceSnapshot = s.source.toJSON();
      const trace: number[] = [];
      // Resume from already-established fabric just before each stage boundary. Each new stage
      // still has to be placed by the live mover and choreography, without a stage-sized jump.
      for (const stage of [BUILD_STAGE.FOUNDATION, BUILD_STAGE.FRAME, BUILD_STAGE.WALLS, BUILD_STAGE.ROOF, BUILD_STAGE.UTILITIES, BUILD_STAGE.FITOUT, BUILD_STAGE.FINISH]) {
        const first = s.assembly.plan.pieces.find(p => p.stage === stage && p.endProgress > p.startProgress);
        if (!first) continue;
        s.assembly.update(first.startProgress);
        s.settlement.development!.project!.progress = Math.min(0.9999, first.endProgress + 0.01);
        const run = runtime(s);
        let placed = false;
        for (let frame = 0; frame < 2000; frame++) {
          const before = s.assembly.plan.progress!;
          const zone = constructionActiveWorkZone(s.assembly.plan, before);
          const { cue } = run.tick();
          const after = s.assembly.plan.progress!;
          trace.push(after);
          if (after > before) {
            expect(cue.valid).toBe(true);
            expect(after).toBeLessThanOrEqual(s.assembly.plan.pieces[zone.piece]!.endProgress);
          }
          if (after >= Math.min(0.9999, first.endProgress)) { placed = true; break; }
        }
        expect(placed, `stage ${stage} reaches installation contact`).toBe(true);
      }
      s.assembly.update(1);
      const full = s.source instanceof THREE.LOD ? s.source.levels[0]!.object : s.source;
      const targetMeshes: THREE.Mesh[] = [];
      full.traverse(object => { if (object instanceof THREE.Mesh) targetMeshes.push(object); });
      const finalMeshes = s.assembly.group.children.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh && object.name !== 'Member being seated');
      expect(finalMeshes.map(mesh => mesh.geometry.drawRange.count)).toEqual(targetMeshes.map(mesh => mesh.geometry.index!.count));
      expect(s.assembly.group.getObjectByName('Member being seated')!.visible).toBe(false);
      expect(s.source.toJSON()).toEqual(sourceSnapshot);
      traces.push(trace);
    }
    expect(traces[0]).toEqual(traces[1]);
  }, 20000);
});
