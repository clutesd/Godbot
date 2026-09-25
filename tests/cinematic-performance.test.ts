import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PerspectiveCamera, Vector3 } from 'three';
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

  it('leaves a low manual pose without snapping, then immediately restores authored autonomous motion', () => {
    const sim = new Simulation({ seed: 'manual-autonomous-handoff', startMode: 'established',
      startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 },
      camera: { shotSeconds: [0.25, 0.25], transitionSeconds: 3 } });
    sim.state.arrival = undefined;
    sim.state.history = [];
    for (const cell of sim.state.world.cells) cell.wood = 0;
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];

    const historian = new Historian(sim.config);
    const template = historian.chooseScene(sim.state);
    const first = { ...template, id: 'manual:first', kind: 'regional-travel' as const, position: { x: 0, z: 0 } };
    const remote = { ...template, id: 'manual:remote', kind: 'regional-travel' as const, position: { x: 18, z: 0 } };
    const choose = vi.spyOn(historian, 'chooseScene')
      .mockReturnValueOnce(first)
      .mockReturnValue(remote);
    vi.spyOn(historian, 'candidates').mockImplementation(() =>
      choose.mock.calls.length <= 1 ? [first] : [remote]);

    const camera = new PerspectiveCamera(38, 1, 0.01, 200);
    const director = new CameraDirector(camera, sim.config, historian);
    director.update(1 / 60, 0, sim.state, () => 0);
    expect(director.observation.sceneId).toBe('manual:first');

    let enteredRemoteFlight = false;
    for (let frame = 1; frame < 60 * 8; frame += 1) {
      director.update(1 / 60, frame / 60, sim.state, () => 0);
      if (director.flightTelemetry().destinationSceneId === 'manual:remote') {
        enteredRemoteFlight = true;
        break;
      }
    }
    expect(enteredRemoteFlight).toBe(true);
    expect(director.current()?.id).toBe('manual:first');
    const choicesBeforeManual = choose.mock.calls.length;

    // Manual control can legally descend below the clearance used by an ordinary autonomous
    // regional shot. Releasing control must not strand the camera there.
    camera.position.set(11, 0.35, 7);
    camera.lookAt(19, 0.35, 7);
    camera.updateMatrixWorld(true);
    const manualPosition = camera.position.clone();
    const manualDirection = new Vector3();
    camera.getWorldDirection(manualDirection);

    director.resumeFromExternalPose();

    // The toggle itself never teleports the lens.
    expect(director.flightTelemetry().active).toBe(false);
    expect(camera.position.distanceTo(manualPosition)).toBeLessThan(1e-9);

    // On the very next autonomous frame, the same unseen authored destination is re-planned from
    // the manual lens pose. The Historian is not asked for another scene, and narration remains on
    // the last acquired scene until physical acquisition.
    director.update(1 / 60, 9, sim.state, () => 0);
    const resumedDirection = new Vector3();
    camera.getWorldDirection(resumedDirection);
    const recovery = director.flightTelemetry();
    expect(recovery.active).toBe(true);
    expect(recovery.destinationSceneId).toBe('manual:remote');
    expect(choose.mock.calls.length).toBe(choicesBeforeManual);
    expect(camera.position.distanceTo(manualPosition)).toBeLessThan(0.08);
    expect(resumedDirection.angleTo(manualDirection)).toBeLessThan(THREE.MathUtils.degToRad(2));
    expect(director.observation.sceneId).toBe('manual:first');

    // Recovery is continuous but decisive: it must climb out of the low manual envelope rather
    // than spending a documentary hold at eye level.
    for (let frame = 1; frame <= 120; frame += 1) {
      director.update(1 / 60, 9 + frame / 60, sim.state, () => 0);
    }
    expect(camera.position.y).toBeGreaterThan(manualPosition.y + 0.9);
    expect(camera.position.distanceTo(manualPosition)).toBeGreaterThan(1.5);
  });


  it('re-establishes context immediately after manual control leaves an acquired human close-up', () => {
    const sim = new Simulation({ seed: 'manual-human-reestablish', startMode: 'established',
      startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 },
      camera: { shotSeconds: [0.25, 0.25], transitionSeconds: 3 } });
    sim.state.arrival = undefined;
    sim.state.history = [];
    for (const cell of sim.state.world.cells) cell.wood = 0;
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];

    const historian = new Historian(sim.config);
    const template = historian.chooseScene(sim.state);
    const person = sim.state.people.find(candidate => candidate.alive);
    if (!person) throw new Error('Expected a represented person');
    const human = {
      ...template,
      id: `human:${person.id}:partner`,
      subjectId: person.id,
      kind: 'worker-follow' as const,
      position: { x: 0, z: 0 },
      title: person.name,
    };
    const context = {
      ...template,
      id: 'manual:context',
      kind: 'settlement-approach' as const,
      position: { x: 12, z: 0 },
      title: 'The settlement',
    };
    vi.spyOn(historian, 'chooseScene')
      .mockReturnValueOnce(human)
      .mockReturnValue(context);
    vi.spyOn(historian, 'candidates').mockReturnValue([context]);

    const camera = new PerspectiveCamera(38, 1, 0.01, 200);
    const director = new CameraDirector(camera, sim.config, historian);
    director.update(1 / 60, 0, sim.state, () => 0);
    expect(director.observation.sceneId).toBe(human.id);

    camera.position.set(1, 0.38, 1);
    camera.lookAt(2, 0.38, 1);
    camera.updateMatrixWorld(true);
    const manualPosition = camera.position.clone();

    director.resumeFromExternalPose();
    director.update(1 / 60, 1 / 60, sim.state, () => 0);

    const flight = director.flightTelemetry();
    expect(flight.active).toBe(true);
    expect(flight.destinationSceneId).toBe(context.id);
    expect(director.observation.sceneId).toBe(human.id);
    expect(camera.position.distanceTo(manualPosition)).toBeLessThan(0.08);

    for (let frame = 1; frame <= 120; frame += 1) {
      director.update(1 / 60, (frame + 1) / 60, sim.state, () => 0);
    }
    expect(camera.position.y).toBeGreaterThan(manualPosition.y + 0.9);
    expect(camera.position.distanceTo(manualPosition)).toBeGreaterThan(1.5);
  });


  it('restores an eye-level manual camera into a clearly autonomous composition instead of lingering near the observer pose', () => {
    const sim = new Simulation({ seed: 'manual-low-pose-restore', startMode: 'established',
      startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 },
      camera: { shotSeconds: [0.4, 0.4], transitionSeconds: 3 } });
    sim.state.arrival = undefined;
    sim.state.history = [];
    for (const cell of sim.state.world.cells) cell.wood = 0;
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];

    const historian = new Historian(sim.config);
    const template = historian.chooseScene(sim.state);
    const initial = { ...template, id: 'restore:initial', kind: 'street-observation' as const, position: { x: 0, z: 0 } };
    const autonomous = { ...template, id: 'restore:autonomous', kind: 'settlement-approach' as const, position: { x: 10, z: 3 } };
    vi.spyOn(historian, 'chooseScene')
      .mockReturnValueOnce(initial)
      .mockReturnValue(autonomous);
    vi.spyOn(historian, 'candidates').mockReturnValue([autonomous]);

    const camera = new PerspectiveCamera(38, 1, 0.01, 200);
    const director = new CameraDirector(camera, sim.config, historian);
    director.update(1 / 60, 0, sim.state, () => 0);
    expect(director.observation.sceneId).toBe(initial.id);

    camera.position.set(0.4, 0.34, 0.3);
    camera.lookAt(1.4, 0.34, 0.3);
    camera.updateMatrixWorld(true);
    const manualPosition = camera.position.clone();

    director.resumeFromExternalPose();
    expect(camera.position.distanceTo(manualPosition)).toBeLessThan(1e-9);

    director.update(1 / 60, 1 / 60, sim.state, () => 0);
    const firstRecovery = director.flightTelemetry();
    expect(firstRecovery.active).toBe(true);
    expect(firstRecovery.destinationSceneId).toBe(autonomous.id);
    expect(firstRecovery.destinationHeight).toBeGreaterThan(manualPosition.y + 1);

    for (let frame = 1; frame <= 90; frame += 1) {
      director.update(1 / 60, (frame + 1) / 60, sim.state, () => 0);
    }

    expect(camera.position.y).toBeGreaterThan(manualPosition.y + 0.65);
    expect(camera.position.distanceTo(manualPosition)).toBeGreaterThan(1.2);
    expect(director.flightTelemetry().speed).toBeGreaterThan(0.15);
  });

  it('keeps a full editorial transfer materially frame-rate independent at 30, 60 and 144 Hz', () => {
    const run = (fps: number): { acquiredAt: number; position: Vector3; maxSpeed: number } => {
      const sim = new Simulation({ seed: 'director-frame-rate', startMode: 'established',
        startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 },
        camera: { shotSeconds: [0.25, 0.25], transitionSeconds: 3 } });
      sim.state.arrival = undefined;
      sim.state.history = [];
      for (const cell of sim.state.world.cells) cell.wood = 0;
      for (const settlement of sim.state.settlements) settlement.structurePlots = [];
      const historian = new Historian(sim.config);
      const template = historian.chooseScene(sim.state);
      const first = { ...template, id: 'fps:first', kind: 'regional-travel' as const, position: { x: 0, z: 0 } };
      const second = { ...template, id: 'fps:second', kind: 'regional-travel' as const, position: { x: 18, z: 0 } };
      const choose = vi.spyOn(historian, 'chooseScene').mockReturnValueOnce(first).mockReturnValue(second);
      vi.spyOn(historian, 'candidates').mockImplementation(() =>
        choose.mock.calls.length <= 1 ? [first] : [second]);
      const camera = new PerspectiveCamera(38, 1, 0.01, 200);
      const director = new CameraDirector(camera, sim.config, historian);
      director.update(1 / fps, 0, sim.state, () => 0);

      let maxSpeed = 0;
      for (let frame = 1; frame < fps * 20; frame += 1) {
        director.update(1 / fps, frame / fps, sim.state, () => 0);
        maxSpeed = Math.max(maxSpeed, director.flightTelemetry().speed);
        if (director.observation.sceneId === 'fps:second') {
          return { acquiredAt: frame / fps, position: camera.position.clone(), maxSpeed };
        }
      }
      throw new Error(`Camera did not acquire at ${fps} Hz`);
    };

    const runs = [30, 60, 144].map(run);
    const acquisitionTimes = runs.map(result => result.acquiredAt);
    expect(Math.max(...acquisitionTimes) - Math.min(...acquisitionTimes)).toBeLessThan(0.35);
    expect(runs[0]!.position.distanceTo(runs[1]!.position)).toBeLessThan(0.2);
    expect(runs[1]!.position.distanceTo(runs[2]!.position)).toBeLessThan(0.2);
    expect(Math.max(...runs.map(result => result.maxSpeed)) - Math.min(...runs.map(result => result.maxSpeed))).toBeLessThan(0.25);
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
