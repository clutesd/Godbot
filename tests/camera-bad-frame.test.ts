import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CameraDirector } from '../src/render/CameraDirector';
import { CameraObstacleField, assessFrame, type CameraObstacleBox } from '../src/render/CameraObstacleField';
import { Historian } from '../src/historian/Historian';
import { Simulation } from '../src/sim/Simulation';
import type { ObservationCandidate, ObservationKind } from '../src/historian/types';

const flat = (): number => 0;
const FPS = 30;

const solid = (over: Partial<CameraObstacleBox> & { id: string }): CameraObstacleBox => ({
  kind: 'building', worldX: 0, worldZ: 0, halfWidth: 2, halfDepth: 1.5, rotationY: 0,
  baseY: 0, eaveY: 2.2, topY: 3.4, overhang: 0.5, entrance: true, ...over,
});
/** A free-standing wall segment whose long axis is perpendicular to `direction`. */
const wallAcross = (id: string, center: THREE.Vector3, direction: THREE.Vector3, halfWidth = 6): CameraObstacleBox => solid({
  id, kind: 'prop', worldX: center.x, worldZ: center.z, halfWidth, halfDepth: 0.2, overhang: 0,
  rotationY: Math.atan2(direction.x, direction.z), eaveY: 3.5, topY: 3.6, entrance: false,
});

interface Harness {
  sim: Simulation;
  camera: THREE.PerspectiveCamera;
  director: CameraDirector;
  historian: Historian;
  field: CameraObstacleField;
  scenes: Record<string, ObservationCandidate>;
  clock: { t: number };
  /** Advance the director, tracking the safety invariants every frame. */
  run(seconds: number): void;
  /** Change which scenes the (mocked) Historian proposes, in priority order. */
  propose(ids: readonly string[]): void;
  stats: { maxStep: number; insideFrames: number; badFrames: number; positions: number[][] };
}

interface HarnessOptions {
  seed?: string;
  scenes: ReadonlyArray<{ id: string; kind: ObservationKind; x: number; z: number; subject?: string }>;
  boxes?: readonly CameraObstacleBox[];
  subject?: (id: string) => { x: number; z: number; footY: number } | undefined;
}

function harness(options: HarnessOptions): Harness {
  const sim = new Simulation({ seed: options.seed ?? 'bad-frame', startMode: 'established', startingPopulation: 40, settlementCount: [2, 2], world: { size: 20 } });
  sim.state.arrival = undefined;
  sim.state.history = [];
  for (const cell of sim.state.world.cells) cell.wood = 0;
  for (const settlement of sim.state.settlements) settlement.structurePlots = [];
  const historian = new Historian(sim.config);
  const base = historian.chooseScene(sim.state);
  const scenes: Record<string, ObservationCandidate> = {};
  for (const spec of options.scenes) {
    scenes[spec.id] = {
      ...base, id: spec.id, kind: spec.kind, position: { x: spec.x, z: spec.z }, subjectId: spec.subject ?? `subject:${spec.id}`,
      title: spec.id, event: undefined, score: 0.6, interest: 0.6,
      editorial: { ...(base.editorial ?? {} as never), completion: 'timed', narration: 'silent', preferredScale: 'medium', activityMeaning: 0.4, threadId: 'test-thread' } as never,
    };
  }
  let ordered = options.scenes.map(spec => scenes[spec.id]!);
  vi.spyOn(historian, 'chooseScene').mockImplementation(() =>
    ordered.find(scene => !historian.isSubjectDeferred(scene.subjectId)) ?? ordered[0]!);
  vi.spyOn(historian, 'candidates').mockImplementation(() => ordered);

  const field = new CameraObstacleField();
  field.set(options.boxes ?? []);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.01, 200);
  const person = options.subject;
  const director = new CameraDirector(camera, sim.config, historian,
    person ? id => person(id) : undefined, person ? () => [sim.state.people.find(p => p.alive)!.id] : undefined,
    undefined, undefined, field);

  const stats = { maxStep: 0, insideFrames: 0, badFrames: 0, positions: [] as number[][] };
  const clock = { t: 0 };
  const h: Harness = {
    sim, camera, director, historian, field, scenes, clock, stats,
    propose(ids) { ordered = ids.map(id => scenes[id]!); },
    run(seconds) {
      const previous = new THREE.Vector3();
      for (let frame = 0; frame < Math.round(seconds * FPS); frame += 1) {
        previous.copy(camera.position);
        director.update(1 / FPS, clock.t, sim.state, flat);
        clock.t += 1 / FPS;
        stats.maxStep = Math.max(stats.maxStep, camera.position.distanceTo(previous));
        if (field.probe(camera.position, 0) > 0) stats.insideFrames += 1;
        const seen = assessFrame(field, camera.position, director.framingTarget(), { fovDegrees: camera.fov, aspect: camera.aspect });
        if (seen.dominated || seen.obstructed) stats.badFrames += 1;
        if (frame % 15 === 0) stats.positions.push(camera.position.toArray().map(value => Math.round(value * 1e6) / 1e6));
      }
    },
  };
  return h;
}

const viewDirection = (h: Harness): THREE.Vector3 => h.director.framingTarget().sub(h.camera.position).setY(0).normalize();
const frameOf = (h: Harness) => assessFrame(h.field, h.camera.position, h.director.framingTarget(), { fovDegrees: h.camera.fov, aspect: h.camera.aspect });
const priv = (h: Harness): { shotDuration: number; currentMotion: string; motionGain: number; currentAnchor?: { feature: string; boxId: string } } =>
  h.director as unknown as { shotDuration: number; currentMotion: string; motionGain: number; currentAnchor?: { feature: string; boxId: string } };

const hall = solid({ id: 'hall', worldX: 0, worldZ: 0 });
function withMotion(motion: 'hold' | 'truck', prefix: string): { h: Harness; id: string } {
  for (let index = 0; index < 80; index += 1) {
    const id = `${prefix}-${index}`;
    const h = harness({ scenes: [{ id, kind: 'institution-exterior', x: 0, z: 0 }], boxes: [hall] });
    h.run(1 / FPS);
    if (priv(h).currentMotion === motion) return { h, id };
  }
  throw new Error(`no scene id produced ${motion}`);
}
const institution = { id: 'institution', kind: 'institution-exterior' as const, x: 0, z: 0 };

describe('camera bad-frame handling', () => {
  it('escapes a wall that appears directly in front of the lens without cutting or entering it', () => {
    const h = harness({ scenes: [institution], boxes: [hall] });
    h.run(8);
    expect(h.director.current()?.id).toBe('institution');
    expect(frameOf(h).dominated).toBe(false);

    const direction = viewDirection(h);
    const wall = wallAcross('sudden-wall', h.camera.position.clone().addScaledVector(direction, 1.1), direction);
    h.field.set([hall, wall]);
    expect(frameOf(h).dominated).toBe(true);
    h.stats.maxStep = 0;
    h.stats.badFrames = 0;

    h.run(16);
    // It leaves the composition within a few seconds, by ordinary flight, and never touches geometry.
    expect(h.stats.badFrames / FPS).toBeLessThan(4.5);
    expect(h.stats.insideFrames).toBe(0);
    expect(h.stats.maxStep).toBeLessThan(0.45);
    const frame = frameOf(h);
    expect(frame.dominated).toBe(false);
    expect(frame.obstructed).toBe(false);
  });

  it('gets out from under an overhang pressed against a wall with a nearby reframe', () => {
    const h = harness({ scenes: [institution], boxes: [hall] });
    h.run(8);
    const direction = viewDirection(h);
    const right = new THREE.Vector3(-direction.z, 0, direction.x);
    // A long building alongside the lens: wall 0.5 away, roof cap reaching over the camera.
    const alongside = solid({
      id: 'alongside', worldX: 0, worldZ: 0, halfWidth: 2, halfDepth: 8, overhang: 1.4, eaveY: 5.2, topY: 6.4,
      rotationY: Math.atan2(direction.x, direction.z), entrance: false,
    });
    const placed: CameraObstacleBox = {
      ...alongside,
      worldX: h.camera.position.x + right.x * (0.5 + alongside.halfWidth),
      worldZ: h.camera.position.z + right.z * (0.5 + alongside.halfWidth),
    };
    h.field.set([hall, placed]);
    const before = frameOf(h);
    expect(before.covered).toBe(true);
    expect(before.quality).toBeLessThan(0.78);
    h.stats.maxStep = 0;
    h.stats.badFrames = 0;

    h.run(16);
    expect(h.stats.insideFrames).toBe(0);
    expect(h.stats.maxStep).toBeLessThan(0.45);
    // The subject stays visible from here, so only the bad-frame watchdog can notice this trap.
    expect(h.director.frameHealth.reframes + h.director.frameHealth.retirements).toBeGreaterThanOrEqual(1);
    expect(h.stats.badFrames / FPS).toBeLessThan(5);
    const after = frameOf(h);
    expect(after.covered).toBe(false);
    expect(after.dominated).toBe(false);
  });

  it('frames a person standing beside a structure from the side where they can be seen', () => {
    const wall = solid({ id: 'flank', kind: 'building', worldX: 0.95, worldZ: 0, halfWidth: 0.4, halfDepth: 5, overhang: 0.2, eaveY: 3, topY: 3.6, entrance: false });
    const person = { x: 0, z: 0, footY: 0 };
    const h = harness({
      scenes: [{ id: 'worker', kind: 'worker-follow', x: 0, z: 0 }], boxes: [wall],
      subject: () => person,
    });
    const personId = h.sim.state.people.find(p => p.alive)!.id;
    h.scenes['worker']!.subjectId = personId;
    h.run(14);
    expect(h.director.current()?.id).toBe('worker');
    expect(h.stats.insideFrames).toBe(0);
    const subject = new THREE.Vector3(0, 0.17, 0);
    expect(h.field.segmentBlocked(h.camera.position, subject)).toBe(false);
    expect(h.camera.position.x).toBeLessThan(0.5);
    expect(frameOf(h).dominated).toBe(false);
  });

  it('abandons a composition that cannot be made readable and moves smoothly to a better shot', () => {
    // Four tall walls close around the subject; there is no angle from which it can be seen.
    const ring: CameraObstacleBox[] = [0, 1, 2, 3].map(index => {
      const angle = (index * Math.PI) / 2;
      return solid({
        id: `ring-${index}`, kind: 'prop', worldX: 10 + Math.cos(angle) * 1.6, worldZ: 10 + Math.sin(angle) * 1.6,
        halfWidth: 1.9, halfDepth: 0.2, overhang: 0, eaveY: 3.5, topY: 3.6, rotationY: Math.atan2(Math.cos(angle), Math.sin(angle)), entrance: false,
      });
    });
    const h = harness({
      scenes: [
        { id: 'open-a', kind: 'institution-exterior', x: -8, z: -8 },
        { id: 'enclosed', kind: 'institution-exterior', x: 10, z: 10 },
        { id: 'open-b', kind: 'institution-exterior', x: -8, z: 8 },
      ],
      boxes: ring,
    });
    h.propose(['open-a']);
    h.run(6);
    expect(h.director.current()?.id).toBe('open-a');
    // The first shot placed the lens; from here on every move must be a continuous flight.
    h.stats.maxStep = 0;
    h.propose(['enclosed', 'open-b']);
    h.run(90);
    expect(h.director.sceneLifecycle.get('enclosed')).not.toBe('acquired');
    expect(h.director.current()?.id).toBe('open-b');
    expect(h.stats.insideFrames).toBe(0);
    expect(h.stats.maxStep).toBeLessThan(0.45);
  });

  it('holds a strong shot without reframing, retiring or wandering', () => {
    // Choose a scene id whose authored motion is a hold (breathing only). Motion is decided on the first update.
    const { h, id } = withMotion('hold', 'stable');
    h.run(3);
    expect(priv(h).currentMotion).toBe('hold');
    const holdSeconds = Math.min(priv(h).shotDuration * 0.85, 40) - 3;
    const start = h.camera.position.clone();
    h.run(holdSeconds);
    expect(h.director.current()?.id).toBe(id);
    expect(h.director.frameHealth.reframes).toBe(0);
    expect(h.director.frameHealth.retirements).toBe(0);
    expect(h.director.frameHealth.quality).toBeGreaterThan(0.78);
    expect(h.camera.position.distanceTo(start)).toBeLessThan(0.5);
    expect(h.stats.insideFrames).toBe(0);
  });

  it('eases optional trucking/drifting out of a shot whose frame is already strong', () => {
    const { h } = withMotion('truck', 'moving');
    expect(priv(h).currentMotion).toBe('truck');
    h.run(Math.min(priv(h).shotDuration * 0.7, 30));
    expect(priv(h).motionGain).toBeLessThan(0.5);
    expect(h.director.frameHealth.retirements).toBe(0);
  });

  it('targets a readable entrance or façade instead of the plot centre', () => {
    const h = harness({ scenes: [institution], boxes: [hall] });
    h.run(10);
    const anchor = priv(h).currentAnchor;
    expect(anchor).toBeDefined();
    expect(['entrance', 'facade', 'work-yard', 'roofline']).toContain(anchor!.feature);
    const target = h.director.framingTarget();
    expect(Math.hypot(target.x, target.z)).toBeGreaterThan(1.5);
    expect(target.y).toBeGreaterThan(0.5);
    expect(target.y).toBeLessThan(1.8);
    expect(h.stats.insideFrames).toBe(0);
    expect(frameOf(h).dominated).toBe(false);
  });

  it('recovers from a manual pose pressed against a building and returns to a readable composition', () => {
    const h = harness({ scenes: [institution], boxes: [hall] });
    h.run(8);
    // The observer parked the lens 0.5 m from the wall, under the eave, staring at it.
    h.camera.position.set(2.5, 1.0, 0);
    h.camera.lookAt(0, 1, 0);
    h.director.resumeFromExternalPose();
    h.stats.maxStep = 0;
    h.stats.insideFrames = 0;
    h.run(30);
    expect(h.stats.maxStep).toBeLessThan(0.45);
    expect(h.stats.insideFrames).toBe(0);
    expect(h.director.current()?.id).toBe('institution');
    const frame = frameOf(h);
    expect(frame.covered).toBe(false);
    expect(frame.dominated).toBe(false);
    expect(frame.obstructed).toBe(false);
  });

  it('does not repeat the same angle on a place it has just filmed', () => {
    const h = harness({
      scenes: [
        { id: 'pause-one', kind: 'landscape-pause', x: 0, z: 0 },
        { id: 'pause-two', kind: 'landscape-pause', x: 1, z: 0.5 },
      ],
    });
    const seen: string[] = [];
    const azimuths: number[] = [];
    let last = '';
    for (let frame = 0; frame < 30 * 90 && azimuths.length < 2; frame += 1) {
      h.run(1 / FPS);
      const id = h.director.current()?.id ?? '';
      if (id && id !== last && h.director.sceneLifecycle.get(id) === 'acquired') {
        last = id;
        seen.push(id);
        const target = h.director.framingTarget();
        azimuths.push(Math.atan2(h.camera.position.z - target.z, h.camera.position.x - target.x));
      }
      // Alternate the Historian's proposal so the same place is proposed twice.
      if (frame === 30 * 20) vi.spyOn(h.historian, 'chooseScene').mockImplementation(() => h.scenes['pause-two']!);
    }
    expect(seen.length).toBeGreaterThanOrEqual(2);
    let delta = Math.abs(azimuths[0]! - azimuths[1]!) % (Math.PI * 2);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    expect(delta).toBeGreaterThan(0.45);
  });

  it('replays identically: same inputs give the same camera path and the same watchdog decisions', () => {
    const scenario = (): { positions: number[][]; health: string } => {
      const h = harness({ scenes: [institution], boxes: [hall] });
      h.run(8);
      const direction = viewDirection(h);
      h.field.set([hall, wallAcross('replay-wall', h.camera.position.clone().addScaledVector(direction, 1.1), direction)]);
      h.run(16);
      return { positions: h.stats.positions, health: JSON.stringify(h.director.frameHealth) };
    };
    const first = scenario();
    const second = scenario();
    expect(second.health).toBe(first.health);
    expect(second.positions).toEqual(first.positions);
    expect(JSON.parse(first.health).quality).toBeGreaterThan(0);
  });
});

describe('historian sequencing support', () => {
  it('lets a retired subject sit out a few selections, then return', () => {
    const sim = new Simulation({ seed: 'bad-frame-defer', startMode: 'established', startingPopulation: 40, settlementCount: [2, 2], world: { size: 20 } });
    sim.state.arrival = undefined;
    const historian = new Historian(sim.config);
    const first = historian.chooseScene(sim.state);
    historian.deferSubject(first.subjectId, 2);
    expect(historian.isSubjectDeferred(first.subjectId)).toBe(true);
    const second = historian.chooseScene(sim.state);
    expect(second.subjectId).not.toBe(first.subjectId);
    expect(historian.isSubjectDeferred(first.subjectId)).toBe(true);
    historian.chooseScene(sim.state);
    expect(historian.isSubjectDeferred(first.subjectId)).toBe(false);
  });
});

describe('work-yard framing', () => {
  it('leans a construction shot toward the builder working the yard instead of an empty patch of ground', () => {
    const site = solid({ id: 'site', kind: 'scaffold', worldX: 0, worldZ: 0, activity: 1, entrance: false });
    const empty = harness({ scenes: [{ id: 'yard', kind: 'infrastructure-scene', x: 0, z: 0 }], boxes: [site] });
    empty.run(2);
    expect(priv(empty).currentAnchor?.feature).toBe('work-yard');
    const bare = empty.director.framingTarget();

    const staffed = harness({ scenes: [{ id: 'yard', kind: 'infrastructure-scene', x: 0, z: 0 }], boxes: [site] });
    const builder = staffed.sim.state.people.find(person => person.alive)!;
    builder.activity = 'construct';
    builder.position.x = 2;
    builder.position.z = 3.5;
    staffed.run(2);
    const framed = staffed.director.framingTarget();
    expect(Math.hypot(framed.x - 2, framed.z - 3.5)).toBeLessThan(Math.hypot(bare.x - 2, bare.z - 3.5) - 0.5);
    expect(staffed.stats.insideFrames).toBe(0);
  });
});
