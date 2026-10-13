import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';
import { CameraDirector } from '../src/render/CameraDirector';
import type { ObservationCandidate } from '../src/historian/types';
import type { PhysicalActionPresentation } from '../src/render/people/PhysicalActionPresentation';

function harness() {
  const sim = new Simulation({ seed: 'construction-camera-story', startMode: 'established', startingPopulation: 24,
    settlementCount: [1, 1], world: { size: 20 } });
  sim.state.arrival = undefined;
  sim.state.history = [];
  for (const settlement of sim.state.settlements) settlement.structurePlots = [];
  const actor = sim.state.people.find(p => p.alive)!;
  actor.activity = 'construct';
  const historian = new Historian(sim.config);
  const base = historian.chooseScene(sim.state);
  const scene: ObservationCandidate = { ...base, id: `person:${actor.id}:construct`, subjectId: actor.id,
    kind: 'worker-follow', position: actor.position, event: undefined,
    statement: { ...base.statement, sourceEntityIds: [actor.id], sourceEventIds: [], claims: {} },
    editorial: { subjectId: 'shelter', threadId: 'shelter', why: 'Observe recorded construction', activityMeaning: 0.8,
      desiredActivity: 'construct', preferredScale: 'human', narration: 'silent', completion: 'subject-action' } };
  vi.spyOn(historian, 'chooseScene').mockReturnValue(scene);
  vi.spyOn(historian, 'planningCandidates').mockReturnValue([scene]);
  vi.spyOn(historian, 'refreshScene').mockImplementation(s => s);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.01, 200);
  let time = 0;
  let target = 'shelter';
  let contact = true;
  const action = (): PhysicalActionPresentation => ({ personId: actor.id, actionKind: 'construction-assemble',
    authoritativeActivity: 'construct', sourceAuthority: 'test labour', targetId: target, targetKind: 'workface',
    interactionAnchor: { x: actor.position.x + 0.35, z: actor.position.z }, locomotionTarget: actor.position,
    phase: 'assemble', phaseProgress: time % 2 / 2, activeTool: 'hammer', contactStrength: contact && time % 2 < 0.4 ? 1 : 0 });
  const director = new CameraDirector(camera, { ...sim.config, camera: { ...sim.config.camera, shotSeconds: [8, 10] } }, historian,
    id => id === actor.id ? { x: actor.position.x, z: actor.position.z, footY: 0, action: action() } : undefined);
  const debug = director as unknown as { activeSequence?: { id: string; ordinal: number; role: string }; shotAge: number; flight?: unknown };
  return { sim, camera, director, actor, debug,
    changeTarget() { target = 'other-project'; },
    stopContact() { contact = false; },
    step() { time += 1 / 30; director.update(1 / 30, time, sim.state, () => 0); } };
}

describe('construction camera story', () => {
  it('performs three readable scales on one side of the work without changing history or cutting', () => {
    const h = harness();
    const before = JSON.stringify(h.sim.state);
    const frames = new Map<string, { radius: number; direction: THREE.Vector3 }>();
    let firstSequence: string | undefined;
    let maxStep = 0;
    for (let i = 0; i < 30 * 100; i++) {
      const previous = h.camera.position.clone();
      h.step();
      if (i > 0) maxStep = Math.max(maxStep, previous.distanceTo(h.camera.position));
      firstSequence ??= h.debug.activeSequence?.id;
      if (h.debug.activeSequence?.id !== firstSequence && frames.size === 3) break;
      if (!h.debug.flight && h.debug.shotAge >= 6 && h.debug.activeSequence) {
        const direction = h.camera.position.clone().sub(new THREE.Vector3(h.actor.position.x, 0, h.actor.position.z)).setY(0);
        frames.set(h.debug.activeSequence.role, { radius: direction.length(), direction: direction.normalize() });
      }
    }
    expect([...frames.keys()]).toEqual(['observe', 'detail', 'reveal']);
    expect(frames.get('detail')!.radius).toBeLessThan(frames.get('observe')!.radius);
    expect(frames.get('observe')!.radius).toBeLessThan(frames.get('reveal')!.radius);
    expect(frames.get('observe')!.direction.dot(frames.get('detail')!.direction)).toBeGreaterThan(0.9);
    expect(frames.get('detail')!.direction.dot(frames.get('reveal')!.direction)).toBeGreaterThan(0.9);
    expect(maxStep).toBeLessThan(0.45);
    expect(JSON.stringify(h.sim.state)).toBe(before);
  });

  it('drops the old reveal when the builder switches projects', () => {
    const h = harness();
    for (let i = 0; i < 30 * 60; i++) {
      h.step();
      if (!h.debug.flight && h.debug.activeSequence?.ordinal === 1 && h.debug.shotAge >= 6) break;
    }
    expect(h.debug.activeSequence?.ordinal).toBe(1);
    const old = h.debug.activeSequence!.id;
    h.changeTarget();
    for (let i = 0; i < 30 * 8 && h.debug.activeSequence?.id === old; i++) h.step();
    expect(h.debug.activeSequence?.id).not.toBe(old);
    expect(h.debug.activeSequence?.ordinal).toBe(0);
  });

  it('does not earn a reveal from a detail that times out without witnessed work', () => {
    const h = harness();
    h.stopContact();
    let firstSequence: string | undefined;
    const roles = new Set<string>();
    let finished = false;
    for (let i = 0; i < 30 * 100; i++) {
      h.step();
      firstSequence ??= h.debug.activeSequence?.id;
      if (h.debug.activeSequence?.id !== firstSequence) { finished = true; break; }
      if (h.debug.activeSequence) roles.add(h.debug.activeSequence.role);
    }
    expect(finished).toBe(true);
    expect([...roles]).toEqual(['observe', 'detail']);
  });
});
