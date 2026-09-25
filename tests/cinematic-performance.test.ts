import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { advanceCameraSpring } from '../src/render/CameraSpring';
import { AdaptiveResolution } from '../src/render/AdaptiveResolution';
import { CameraDirector } from '../src/render/CameraDirector';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';

describe('cinematic motion', () => {
  it('flies to a new editorial subject without cutting or handing off narration before arrival', () => {
    const sim = new Simulation({ seed: 'continuous-camera', startMode: 'established',
      startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 },
      camera: { shotSeconds: [0.3, 0.3], transitionSeconds: 4 } });
    sim.state.arrival = undefined;
    sim.state.history = [];
    for (const cell of sim.state.world.cells) cell.wood = 0;
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];
    const historian = new Historian(sim.config), scene = historian.chooseScene(sim.state);
    const first = { ...scene, id: 'first', kind: 'regional-travel' as const, position: { x: 0, z: 0 } };
    const second = { ...scene, id: 'second', kind: 'regional-travel' as const, position: { x: 18, z: 0 } };
    const choose = vi.spyOn(historian, 'chooseScene')
      .mockReturnValueOnce(first)
      .mockReturnValue(second);
    // This test owns editorial selection. Keep the sequence planner from substituting unrelated
    // real Historian candidates; sequence behavior has its own dedicated test suite.
    vi.spyOn(historian, 'candidates').mockImplementation(() => [choose.mock.calls.length <= 1 ? first : second]);
    const camera = new PerspectiveCamera();
    const director = new CameraDirector(camera, sim.config, historian);
    director.update(1 / 60, 0, sim.state, () => 0);
    expect(director.observation.sceneId).toBe('first');

    let sawTransit = false;
    let acquired = false;
    let maximumStep = 0;
    for (let frame = 1; frame < 60 * 20; frame++) {
      const before = camera.position.clone();
      director.update(1 / 60, frame / 60, sim.state, () => 0);
      maximumStep = Math.max(maximumStep, camera.position.distanceTo(before));
      if (director.current()?.id === 'first' && frame > 30 && director.observation.sceneId === 'first') sawTransit = true;
      if (director.observation.sceneId === 'second') {
        acquired = true;
        expect(director.current()?.id).toBe('second');
        break;
      }
    }
    expect(sawTransit).toBe(true);
    expect(maximumStep).toBeLessThan(0.19);
    if (!acquired) {
      throw new Error(`Camera failed to acquire remote scene: ${JSON.stringify(director.flightTelemetry())}`);
    }
    expect(acquired).toBe(true);
  });

  it('releases the Arrival orientation card as soon as its authored shot ends', () => {
    const sim = new Simulation({ seed: 'founding-overlay-transit', startMode: 'established',
      startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 } });
    sim.state.arrival = undefined;
    sim.state.history = [];
    for (const cell of sim.state.world.cells) cell.wood = 0;
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];

    const historian = new Historian(sim.config);
    const template = historian.chooseScene(sim.state);
    const person = sim.state.people.find(candidate => candidate.alive);
    if (!person) throw new Error('Expected a represented person');
    vi.spyOn(historian, 'chooseScene')
      .mockReturnValueOnce({
        ...template,
        id: 'founding:overview:event-1',
        kind: 'world-establishing',
        position: { x: 0, z: 0 },
        title: 'ARRIVAL DAY · THE 5 LANDINGS',
      })
      .mockReturnValue({
        ...template,
        id: `founding-cast:introduction:0:${person.id}`,
        subjectId: person.id,
        kind: 'worker-follow',
        position: { x: 18, z: 0 },
        title: person.name,
      });

    const director = new CameraDirector(new PerspectiveCamera(), sim.config, historian);
    director.update(1 / 60, 0, sim.state, () => 0);
    expect(director.observation.sceneId).toBe('founding:overview:event-1');

    let sawDeparture = false;
    for (let frame = 1; frame < 60 * 12; frame++) {
      director.update(1 / 60, frame / 60, sim.state, () => 0);
      const flight = director.flightTelemetry();
      if (flight.active && flight.destinationSceneId?.startsWith('founding-cast:introduction:')) {
        sawDeparture = true;
        expect(director.observation.sceneId).toBeUndefined();
        expect(director.observation.label).toBe('The first day');
        expect(director.observation.eventType).toBe('ARRIVAL_DAY');
        break;
      }
    }
    expect(sawDeparture).toBe(true);
  });

  it('finishes the final release before requesting any post-opening destination', () => {
    const sim = new Simulation({ seed: 'founding-release-adjacent', startMode: 'established',
      startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 } });
    sim.state.arrival = undefined;
    sim.state.history = [];
    for (const cell of sim.state.world.cells) cell.wood = 0;
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];

    const historian = new Historian(sim.config);
    const template = historian.chooseScene(sim.state);
    const release = {
      ...template,
      id: 'founding-release:event-1',
      kind: 'street-observation' as const,
      position: { x: 0, z: 0 },
      title: 'THE FIRST DAY',
    };
    const ordinary = {
      ...template,
      id: 'ordinary:first-day',
      kind: 'street-observation' as const,
      position: { x: 0, z: 0 },
      title: 'Ordinary life',
    };
    const choose = vi.spyOn(historian, 'chooseScene')
      .mockReturnValueOnce(release)
      .mockReturnValue(ordinary);
    // This test is about the founding authority barrier. Sequence composition is tested separately.
    vi.spyOn(historian, 'candidates').mockReturnValue([ordinary]);

    const director = new CameraDirector(new PerspectiveCamera(), sim.config, historian);
    director.update(1 / 60, 0, sim.state, () => 0);
    expect(director.observation.sceneId).toBe('founding-release:event-1');
    expect(director.foundingPresentationComplete()).toBe(false);

    let frame = 1;
    for (; frame < 60 * 16 && !director.foundingPresentationComplete(); frame++) {
      director.update(1 / 60, frame / 60, sim.state, () => 0);
    }

    // Completion belongs to the release shot itself. No ordinary scene may be selected merely to
    // create the completion signal.
    expect(director.foundingPresentationComplete()).toBe(true);
    expect(director.observation.sceneId).toBe('founding-release:event-1');
    expect(choose).toHaveBeenCalledTimes(1);

    director.update(1 / 60, frame / 60, sim.state, () => 0);
    expect(choose).toHaveBeenCalledTimes(2);
    expect(director.flightTelemetry().destinationSceneId).toBe('ordinary:first-day');
  });

  it('holds the completed release until history authority crosses out of FOUNDING_ORIENTATION', () => {
    const sim = new Simulation({ seed: 'arrival-day-preview', startMode: 'arrival', autoRun: true,
      startingPopulation: 24 });
    sim.advanceArrival(120);
    expect(sim.foundingOrientationRunning).toBe(true);

    const historian = new Historian(sim.config);
    const template = historian.chooseScene(sim.state);
    const release = {
      ...template,
      id: 'founding-release:event-1',
      kind: 'street-observation' as const,
      position: { x: 0, z: 0 },
      title: 'THE FIRST DAY',
    };
    const ordinary = {
      ...template,
      id: 'ordinary:first-month',
      kind: 'street-observation' as const,
      position: { x: 0, z: 0 },
      title: 'The first month',
    };
    const choose = vi.spyOn(historian, 'chooseScene')
      .mockReturnValueOnce(release)
      .mockReturnValue(ordinary);
    // Hold/release authority is independent from sequence candidate ranking.
    vi.spyOn(historian, 'candidates').mockReturnValue([ordinary]);

    const director = new CameraDirector(new PerspectiveCamera(), sim.config, historian);
    director.update(1 / 60, 0, sim.state, () => 0);

    let frame = 1;
    for (; frame < 60 * 16 && !director.foundingPresentationComplete(); frame++) {
      director.update(1 / 60, frame / 60, sim.state, () => 0);
    }
    expect(director.foundingPresentationComplete()).toBe(true);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(director.observation.sceneId).toBe('founding-release:event-1');

    // Even many extra presentation frames cannot leak into a Month-0 continuity scene.
    for (let hold = 0; hold < 120; hold++, frame++) {
      director.update(1 / 60, frame / 60, sim.state, () => 0);
    }
    expect(choose).toHaveBeenCalledTimes(1);
    expect(director.observation.sceneId).toBe('founding-release:event-1');

    expect(sim.beginHistory()).toBe(true);
    director.update(1 / 60, frame / 60, sim.state, () => 0);
    expect(choose).toHaveBeenCalledTimes(2);
    expect(director.flightTelemetry().destinationSceneId).toBe('ordinary:first-month');
  });

  it('abandons an impossible physical route instead of trapping the documentary forever', () => {
    const sim = new Simulation({ seed: 'camera-route-watchdog', startMode: 'established',
      startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 },
      camera: { shotSeconds: [0.2, 0.2], transitionSeconds: 2 } });
    sim.state.arrival = undefined;
    sim.state.history = [];
    for (const cell of sim.state.world.cells) cell.wood = 0;
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];

    const historian = new Historian(sim.config);
    const template = historian.chooseScene(sim.state);
    const first = { ...template, id: 'watchdog:first', kind: 'regional-travel' as const, position: { x: 0, z: 0 } };
    const second = { ...template, id: 'watchdog:blocked', kind: 'regional-travel' as const, position: { x: 18, z: 0 } };
    const third = { ...template, id: 'watchdog:after', kind: 'regional-travel' as const, position: { x: 2, z: 0 } };
    const choose = vi.spyOn(historian, 'chooseScene')
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValue(third);
    vi.spyOn(historian, 'candidates').mockImplementation(() => {
      if (choose.mock.calls.length <= 1) return [first];
      if (choose.mock.calls.length === 2) return [second];
      return [third];
    });

    const director = new CameraDirector(
      new PerspectiveCamera(),
      sim.config,
      historian,
      undefined,
      undefined,
      () => 1,
    );
    director.update(1 / 60, 0, sim.state, () => 0);

    let escapedBlockedDestination = false;
    for (let frame = 1; frame < 60 * 8; frame++) {
      director.update(1 / 60, frame / 60, sim.state, () => 0);
      const flight = director.flightTelemetry();
      if (choose.mock.calls.length >= 3 && flight.destinationSceneId !== 'watchdog:blocked') {
        escapedBlockedDestination = true;
        break;
      }
    }
    expect(escapedBlockedDestination).toBe(true);
    expect(choose.mock.calls.length).toBeGreaterThanOrEqual(3);
  });


  it('keeps exact Arrival camera probing out of the display-frequency hot path', () => {
    const sim = new Simulation({ seed: 'arrival-day-preview', startMode: 'arrival' });
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

  it('holds the last valid frame briefly after an impossible route before reselecting', () => {
    const sim = new Simulation({ seed: 'camera-route-bridge', startMode: 'established',
      startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 },
      camera: { shotSeconds: [0.2, 0.2], transitionSeconds: 2 } });
    sim.state.arrival = undefined;
    sim.state.history = [];
    for (const cell of sim.state.world.cells) cell.wood = 0;
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];

    const historian = new Historian(sim.config);
    const template = historian.chooseScene(sim.state);
    const first = { ...template, id: 'bridge:first', kind: 'regional-travel' as const, position: { x: 0, z: 0 } };
    const blocked = { ...template, id: 'bridge:blocked', kind: 'regional-travel' as const, position: { x: 18, z: 0 } };
    const after = { ...template, id: 'bridge:after', kind: 'regional-travel' as const, position: { x: 2, z: 0 } };
    const choose = vi.spyOn(historian, 'chooseScene')
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(blocked)
      .mockReturnValue(after);
    vi.spyOn(historian, 'candidates').mockImplementation(() => {
      if (choose.mock.calls.length <= 1) return [first];
      if (choose.mock.calls.length === 2) return [blocked];
      return [after];
    });

    const director = new CameraDirector(
      new PerspectiveCamera(),
      sim.config,
      historian,
      undefined,
      undefined,
      () => 1,
    );
    director.update(1 / 60, 0, sim.state, () => 0);

    for (let frame = 1; frame < 60 * 7 && choose.mock.calls.length < 2; frame++) {
      director.update(1 / 60, frame / 60, sim.state, () => 0);
    }
    const callsAtBlockedSelection = choose.mock.calls.length;

    for (let frame = 0; frame < 30; frame++) {
      director.update(1 / 60, 8 + frame / 60, sim.state, () => 0);
    }
    expect(choose.mock.calls.length).toBe(callsAtBlockedSelection);
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
