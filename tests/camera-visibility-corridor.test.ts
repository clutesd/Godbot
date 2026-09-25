import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CameraDirector, CameraVisibilityHysteresis, cameraFlightCorridorSafe, cameraShotValidity, cameraSubjectVisibility, cameraVisibilityCorridor, resolveCameraSafety } from '../src/render/CameraDirector';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';

const ground = (): number => 0;
function scene() {
  const sim = new Simulation({ seed: 'visibility-corridor', startMode: 'established', startingPopulation: 40, settlementCount: [2, 2], world: { size: 20 } });
  sim.state.arrival = undefined;
  sim.state.history = [];
  for (const cell of sim.state.world.cells) cell.wood = 0;
  for (const settlement of sim.state.settlements) settlement.structurePlots = [];
  return sim;
}
const subject = new THREE.Vector3(0, 0.17, 0);
const authored = new THREE.Vector3(3, 0.8, 0);
const crown = (p: THREE.Vector3): number => Math.abs(p.x - 1.5) < 0.3 && Math.abs(p.z) < 0.3 && p.y < 2 ? 4 : 0;

describe('continuous documentary visibility', () => {
  it('rejects an outside lens when rendered foliage hides its subject and recovers without climbing', () => {
    const sim = scene();
    expect(crown(authored)).toBe(0);
    expect(cameraSubjectVisibility(sim.state, authored, subject, ground, crown)).toBe(0);
    const safe = resolveCameraSafety(sim.state, authored, subject, ground, { environmentProbe: crown, previousPosition: authored });
    expect(safe.valid).toBe(true);
    expect(safe.subjectVisibility).toBeGreaterThanOrEqual(0.67);
    expect(safe.requiresCut).toBe(true);
    expect(safe.position.y).toBe(authored.y);
  });

  it('does not accept a tiny central foliage gap or skip a close foreground crown', () => {
    const sim = scene();
    const close = new THREE.Vector3(1, 0.8, 0);
    const gap = (p: THREE.Vector3): number => p.x > 0.3 && p.x < 0.8 && Math.abs(p.z) > 0.008 ? 4 : 0;
    expect(cameraSubjectVisibility(sim.state, close, subject, ground, gap)).toBeLessThan(0.5);
  });

  it('separates documentary sightline continuity from physical flight safety', () => {
    const sim = scene();
    const a = new THREE.Vector3(3, 0.8, -2), b = new THREE.Vector3(3, 0.8, 2);
    const options = { environmentProbe: crown };
    expect(cameraShotValidity(sim.state, a, subject, ground, options).valid).toBe(true);
    expect(cameraShotValidity(sim.state, b, subject, ground, options).valid).toBe(true);
    // Keeping the same subject readable for the entire move is impossible...
    expect(cameraVisibilityCorridor(sim.state, a, b, subject, ground, options)).toBe(false);
    // ...but the lens itself can still travel safely. A seamless drone is allowed to lose sight of
    // the next subject while crossing the world instead of treating that as a reason to cut.
    expect(cameraFlightCorridorSafe(sim.state, a, b, ground, 0.42, crown)).toBe(true);
  });


  it('lets a low manual pose climb continuously into the autonomous safety envelope', () => {
    const sim = scene();
    const low = new THREE.Vector3(0, 0.35, 0);
    const improving = new THREE.Vector3(0.02, 0.42, 0);
    const worse = new THREE.Vector3(0.02, 0.28, 0);

    expect(cameraFlightCorridorSafe(sim.state, low, improving, ground, 1.2)).toBe(false);
    expect(cameraFlightCorridorSafe(
      sim.state,
      low,
      improving,
      ground,
      1.2,
      undefined,
      { allowUnsafeDeparture: true },
    )).toBe(true);
    expect(cameraFlightCorridorSafe(
      sim.state,
      low,
      worse,
      ground,
      1.2,
      undefined,
      { allowUnsafeDeparture: true },
    )).toBe(false);
  });

  it('returns to strict flight safety as soon as a recovery frame starts from normal clearance', () => {
    const sim = scene();
    const safe = new THREE.Vector3(0, 1.25, 0);
    const unsafe = new THREE.Vector3(0.02, 1.05, 0);

    expect(cameraFlightCorridorSafe(
      sim.state,
      safe,
      unsafe,
      ground,
      1.2,
      undefined,
      { allowUnsafeDeparture: true },
    )).toBe(false);
  });

  it('allows brief occlusion, resets after recovery, and fails within a quarter second', () => {
    const sim = scene(), hysteresis = new CameraVisibilityHysteresis();
    const blocked = cameraShotValidity(sim.state, authored, subject, ground, { environmentProbe: crown });
    const clear = cameraShotValidity(sim.state, authored, subject, ground, { environmentProbe: () => 0 });
    expect(hysteresis.update(blocked, 0.1)).toBe(false);
    expect(hysteresis.update(clear, 0.1)).toBe(false);
    expect(hysteresis.update(blocked, 0.15)).toBe(false);
    expect(hysteresis.update(blocked, 0.1)).toBe(true);
    expect(hysteresis.score).toBeLessThan(0.5);
  });


  it('uses elapsed occlusion time rather than frame count at 30, 60 and 144 Hz', () => {
    const sim = scene();
    const blocked = cameraShotValidity(sim.state, authored, subject, ground, { environmentProbe: crown });
    const failureTimes = [30, 60, 144].map(fps => {
      const hysteresis = new CameraVisibilityHysteresis();
      let elapsed = 0;
      while (elapsed < 1) {
        elapsed += 1 / fps;
        if (hysteresis.update(blocked, 1 / fps)) return elapsed;
      }
      throw new Error(`Visibility hysteresis never failed at ${fps} Hz`);
    });

    for (const time of failureTimes) {
      expect(time).toBeGreaterThanOrEqual(0.24);
      expect(time).toBeLessThan(0.29);
    }
    expect(Math.max(...failureTimes) - Math.min(...failureTimes)).toBeLessThan(1 / 30 + 1e-6);
  });

  it('ignores invalid timing samples instead of poisoning visibility state', () => {
    const sim = scene();
    const blocked = cameraShotValidity(sim.state, authored, subject, ground, { environmentProbe: crown });
    const hysteresis = new CameraVisibilityHysteresis();

    expect(hysteresis.update(blocked, Number.NaN)).toBe(false);
    expect(Number.isFinite(hysteresis.score)).toBe(true);
    expect(hysteresis.update(blocked, Number.POSITIVE_INFINITY)).toBe(false);
    expect(Number.isFinite(hysteresis.score)).toBe(true);

    expect(hysteresis.update(blocked, 0.24)).toBe(false);
    expect(hysteresis.update(blocked, 0.02)).toBe(true);
  });

  it('protects each subject rather than only the empty midpoint', () => {
    const sim = scene();
    const person = new THREE.Vector3(0, 0.17, 1);
    const probe = (p: THREE.Vector3): number => Math.abs(p.x - 1.5) < 0.3 && Math.abs(p.z - 0.5) < 0.25 ? 4 : 0;
    expect(cameraShotValidity(sim.state, authored, subject, ground, { environmentProbe: probe }).valid).toBe(true);
    expect(cameraShotValidity(sim.state, authored, subject, ground, { environmentProbe: probe, subjects: [subject, person] }).valid).toBe(false);
  });

  it('recovers from rendered-camera occlusion without any hard relocation', () => {
    const sim = scene(), historian = new Historian(sim.config);
    const person = sim.state.people[0]!;
    vi.spyOn(historian, 'chooseScene').mockReturnValue({ ...historian.chooseScene(sim.state),
      id: 'founding-cast:introduction:0:test', kind: 'worker-follow', subjectId: person.id, position: { x: 0, z: 0 } });
    const obstacle = new THREE.Vector3(1000, 0, 1000);
    const probe = (p: THREE.Vector3): number => Math.hypot(p.x - obstacle.x, p.z - obstacle.z) < 0.35 && p.y < 2 ? 4 : 0;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
    const director = new CameraDirector(camera, sim.config, historian, () => ({ x: 0, z: 0, footY: 0 }), undefined, probe);
    director.update(1 / 30, 0, sim.state, ground);
    obstacle.copy(camera.position).lerp(subject, 0.5);
    let maximumStep = 0;
    let finalVisibility = 0;
    for (let frame = 1; frame < 180; frame++) {
      const before = camera.position.clone();
      director.update(1 / 30, frame / 30, sim.state, ground);
      maximumStep = Math.max(maximumStep, camera.position.distanceTo(before));
      expect(probe(camera.position)).toBe(0);
      finalVisibility = cameraSubjectVisibility(sim.state, camera.position, subject, ground, probe);
    }
    expect(maximumStep).toBeLessThan(0.24);
    expect(finalVisibility).toBeGreaterThanOrEqual(0.5);
  });

  it('reports failure explicitly when every candidate is inside vegetation', () => {
    const sim = scene();
    expect(resolveCameraSafety(sim.state, authored, subject, ground, { environmentProbe: () => 4 }).valid).toBe(false);
  });
});
