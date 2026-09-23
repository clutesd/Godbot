import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { advanceCameraSpring } from '../src/render/CameraSpring';
import { AdaptiveResolution } from '../src/render/AdaptiveResolution';
import { CameraDirector } from '../src/render/CameraDirector';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';

describe('cinematic motion', () => {
  it('glides into a new unobstructed editorial shot instead of cutting on every selection', () => {
    const sim = new Simulation({ seed: 'continuous-camera', startMode: 'established',
      startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 },
      camera: { shotSeconds: [0.3, 0.3], transitionSeconds: 4 } });
    sim.state.arrival = undefined;
    sim.state.history = [];
    for (const cell of sim.state.world.cells) cell.wood = 0;
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];
    const historian = new Historian(sim.config), scene = historian.chooseScene(sim.state);
    vi.spyOn(historian, 'chooseScene')
      .mockReturnValueOnce({ ...scene, id: 'first', kind: 'street-observation', position: { x: 0, z: 0 } })
      .mockReturnValue({ ...scene, id: 'second', kind: 'street-observation', position: { x: 12, z: 0 } });
    const camera = new PerspectiveCamera();
    const director = new CameraDirector(camera, sim.config, historian);
    director.update(1 / 60, 0, sim.state, () => 0);
    let changed = false;
    for (let frame = 1; frame < 120; frame++) {
      const before = camera.position.clone();
      director.update(1 / 60, frame / 60, sim.state, () => 0);
      if (director.current()?.id === 'second') {
        expect(camera.position.distanceTo(before)).toBeLessThan(0.1);
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
  });


  it('keeps exact Arrival camera probing out of the display-frequency hot path', () => {
    const sim = new Simulation({ seed: 'arrival-camera-budget', startMode: 'arrival', world: { size: 20 } });
    const historian = new Historian(sim.config);
    const camera = new PerspectiveCamera();
    let probes = 0;
    const director = new CameraDirector(
      camera,
      sim.config,
      historian,
      undefined,
      undefined,
      () => { probes += 1; return 0; },
    );
    const arrival = sim.state.arrival;
    if (!arrival) throw new Error('Expected Arrival state');
    arrival.phase = 'ARRIVAL_SEQUENCE';

    for (let frame = 0; frame < 120; frame++) {
      arrival.elapsedSeconds = 20 + frame / 60;
      director.update(1 / 60, frame / 60, sim.state, () => 0);
    }

    // A 60 Hz full silhouette/corridor survey would produce tens of thousands more probes.
    // The exact survey should run at ~4 Hz, with only one lens-volume probe on ordinary frames.
    expect(probes).toBeGreaterThan(120);
    expect(probes).toBeLessThan(15000);
  });

  it('settles identically at 30, 60 and 144 Hz without overshooting', () => {
    const results = [30, 60, 144].map(fps => {
      const position = new Vector3(), velocity = new Vector3(), target = new Vector3(10, 5, -8);
      let lastX = 0;
      for (let frame = 0; frame < fps * 4; frame++) {
        advanceCameraSpring(position, velocity, target, 1 / fps, 4);
        expect(position.x).toBeGreaterThanOrEqual(lastX);
        expect(position.x).toBeLessThan(10);
        lastX = position.x;
      }
      return position;
    });
    expect(results[0]!.distanceTo(results[1]!)).toBeLessThan(1e-10);
    expect(results[1]!.distanceTo(results[2]!)).toBeLessThan(1e-10);
    expect(results[0]!.x).toBeGreaterThan(9.5);
  });

  it('eases in from rest and preserves momentum when a new composition is chosen', () => {
    const position = new Vector3(), velocity = new Vector3(), target = new Vector3(20, 0, 0);
    advanceCameraSpring(position, velocity, target, 1 / 60, 4);
    expect(position.x).toBeLessThan(0.01);
    for (let i = 0; i < 60; i++) advanceCameraSpring(position, velocity, target, 1 / 60, 4);
    const before = velocity.x;
    advanceCameraSpring(position, velocity, new Vector3(-20, 0, 0), 1 / 144, 4);
    expect(velocity.x).toBeGreaterThan(0);
    expect(Math.abs(velocity.x - before)).toBeLessThan(0.5);
  });
});

describe('resolution pacing', () => {
  function run(controller: AdaptiveResolution, seconds: number, fps: number): number {
    let changes = 0;
    for (let i = 0; i < seconds * fps; i++) if (controller.sample(1 / fps)) changes++;
    return changes;
  }

  it('keeps full quality at 60 Hz and ignores isolated hitches and suspended frames', () => {
    const resolution = new AdaptiveResolution();
    run(resolution, 10, 60);
    resolution.sample(0.09);
    resolution.sample(30);
    run(resolution, 10, 60);
    expect(resolution.scale).toBe(1);
  });

  it('never trades image resolution for sustained-load relief', () => {
    const resolution = new AdaptiveResolution();
    expect(run(resolution, 60, 30)).toBe(0);
    expect(resolution.scale).toBe(1);
    expect(run(resolution, 60, 20)).toBe(0);
    expect(resolution.scale).toBe(1);
    expect(run(resolution, 60, 60)).toBe(0);
    expect(resolution.scale).toBe(1);
  });
});
