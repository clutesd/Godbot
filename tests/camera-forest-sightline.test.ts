import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraDirector, cameraClearanceFor, cameraFlightProfileFor, cameraFramingFor, cameraLensObstruction, cameraMotionProgressFor, cameraShotPacingFor, cameraTargetFloorFor, cameraTransitionScaleFor, forestSightlineObstruction, foundingCastShotProfileFor, foundingEditorialTimingFor, foundingLandingShotProfileFor, isFoundingReleaseScene, isPersonalCameraKind, interactionCameraComposition, resolveCameraSafety, resolveFoundingSightline, structureSightlineObstruction } from '../src/render/CameraDirector';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';
import type { PhysicalActionPresentation } from '../src/render/people/PhysicalActionPresentation';

describe('forest-aware camera sightline scoring', () => {
  it('penalizes a low sightline through standing forest and clears when the forest is removed', () => {
    const simulation = new Simulation({ seed: 'camera-forest-sightline', startingPopulation: 80 });
    const world = simulation.state.world;
    for (const cell of world.cells) {
      cell.water = false;
      cell.biome = 'forest';
      cell.wood = 1;
      cell.forestCapacity = 1;
      cell.elevation = 0;
    }

    const camera = new THREE.Vector3(-10, 4, 0);
    const target = new THREE.Vector3(10, 1, 0);
    const elevationAt = (): number => 0;
    const forested = forestSightlineObstruction(world, camera, target, elevationAt);

    for (const cell of world.cells) cell.wood = 0;
    const cleared = forestSightlineObstruction(world, camera, target, elevationAt);

    expect(forested).toBeGreaterThan(0.2);
    expect(cleared).toBe(0);
  });

  it('does not penalize a sightline that passes safely above the canopy', () => {
    const simulation = new Simulation({ seed: 'camera-forest-high-angle', startingPopulation: 80 });
    const world = simulation.state.world;
    for (const cell of world.cells) {
      cell.water = false;
      cell.biome = 'forest';
      cell.wood = 1;
      cell.forestCapacity = 1;
      cell.elevation = 0;
    }

    const camera = new THREE.Vector3(-10, 20, 0);
    const target = new THREE.Vector3(10, 12, 0);
    const score = forestSightlineObstruction(world, camera, target, () => 0);

    expect(score).toBe(0);
  });
});


describe('Arrival camera occlusion avoidance', () => {
  it('leaves an already-clear authored Arrival composition unchanged', () => {
    const simulation = new Simulation({ seed: 'arrival-clear-camera', startingPopulation: 80 });
    for (const cell of simulation.state.world.cells) cell.wood = 0;
    for (const settlement of simulation.state.settlements) settlement.structurePlots = [];
    const authored = new THREE.Vector3(-10, 10, 0);
    const target = new THREE.Vector3(0, 1, 0);

    const resolved = resolveFoundingSightline(simulation.state, authored, target, () => 0, 0.72);

    expect(resolved.position.x).toBeCloseTo(authored.x, 10);
    expect(resolved.position.y).toBeCloseTo(authored.y, 10);
    expect(resolved.position.z).toBeCloseTo(authored.z, 10);
    expect(resolved.angularCorrection).toBe(0);
    expect(resolved.structureObstruction).toBe(0);
    expect(resolved.forestObstruction).toBe(0);
  });

  it('rotates around the same subject/radius when a structure blocks the authored sightline', () => {
    const simulation = new Simulation({ seed: 'arrival-structure-camera', startingPopulation: 80 });
    for (const cell of simulation.state.world.cells) cell.wood = 0;
    const settlement = simulation.state.settlements.find(candidate => candidate.alive)!;
    settlement.structurePlots = [{
      id: 'arrival-blocker',
      worldX: -2.6,
      worldZ: 0,
      width: 2.4,
      depth: 2.4,
      height: 5,
      radius: 1.2,
      condition: 1,
      foundedMonth: 0,
    }];
    const authored = new THREE.Vector3(-7, 1.5, 0);
    const target = new THREE.Vector3(0, 0.2, 0);
    const authoredScore = structureSightlineObstruction(simulation.state, authored, target, () => 0);

    const resolved = resolveFoundingSightline(simulation.state, authored, target, () => 0, 0.72);

    expect(authoredScore).toBeGreaterThan(0.5);
    expect(resolved.structureObstruction).toBeLessThan(authoredScore);
    expect(resolved.structureObstruction).toBeLessThanOrEqual(0.001);
    expect(resolved.angularCorrection).not.toBe(0);
    expect(Math.hypot(resolved.position.x - target.x, resolved.position.z - target.z))
      .toBeCloseTo(Math.hypot(authored.x - target.x, authored.z - target.z), 5);
  });

  it('raises or changes side in dense forest and never returns a worse founding sightline', () => {
    const simulation = new Simulation({ seed: 'arrival-dense-forest-camera', startingPopulation: 80 });
    for (const cell of simulation.state.world.cells) {
      cell.water = false;
      cell.biome = 'forest';
      cell.wood = 1;
      cell.forestCapacity = 1;
      cell.elevation = 0;
    }
    const authored = new THREE.Vector3(-10, 5, 0);
    const target = new THREE.Vector3(0, 0.8, 0);
    const before = forestSightlineObstruction(simulation.state.world, authored, target, () => 0);

    const resolved = resolveFoundingSightline(simulation.state, authored, target, () => 0, 0.72);

    expect(before).toBeGreaterThan(0.1);
    expect(resolved.forestObstruction).toBeLessThanOrEqual(before);
    expect(resolved.lift > 0 || resolved.angularCorrection !== 0).toBe(true);
  });
});



describe('unified camera safety authority', () => {
  it('treats a persistent founding vessel as a hard lens volume and moves the camera out of it', () => {
    const simulation = new Simulation({ seed: 'camera-vessel-volume', startingPopulation: 80 });
    simulation.state.arrival = {
      phase: 'HISTORY_RUNNING',
      elapsedSeconds: 46,
      minimumSeparation: 8,
      pods: [{
        id: 'camera-test-pod',
        groupId: 'camera-test-group',
        name: 'Camera Test',
        color: '#ffffff',
        position: { x: 0, z: 0 },
        groundY: 0,
        cellIndex: 0,
        domains: ['navigation'],
        knowledge: [],
        population: 1,
        personIds: [],
        landed: true,
        entrySeconds: 0,
        descentSeconds: 1,
        entryOffset: { x: -4, z: -4 },
        supplies: { food: 0, goods: 0, timber: 0, stone: 0 },
        condition: 1,
        shelterCapacity: 1,
      }],
    };
    for (const cell of simulation.state.world.cells) cell.wood = 0;

    const authored = new THREE.Vector3(0, 1.1, 0);
    const target = new THREE.Vector3(3, 0.2, 0);
    expect(cameraLensObstruction(simulation.state, authored, () => 0)).toBeGreaterThan(2);

    const resolved = resolveCameraSafety(simulation.state, authored, target, () => 0, {
      lensClearance: 0.42,
      sightlineClearance: 0.12,
    });

    expect(cameraLensObstruction(simulation.state, resolved.position, () => 0)).toBe(0);
    expect(resolved.position.distanceTo(authored)).toBeGreaterThan(0.1);
  });

  it('uses renderer-owned collision knowledge when an individual tree occupies the authored lens', () => {
    const simulation = new Simulation({ seed: 'camera-renderer-probe', startingPopulation: 80 });
    for (const cell of simulation.state.world.cells) cell.wood = 0;
    const authored = new THREE.Vector3(-3, 0.72, 0);
    const target = new THREE.Vector3(0, 0.14, 0);
    const probe = (position: THREE.Vector3): number =>
      position.distanceTo(authored) < 0.35 ? 5 : 0;

    const resolved = resolveCameraSafety(simulation.state, authored, target, () => 0, {
      lensClearance: 0.42,
      sightlineClearance: 0.12,
      previousPosition: authored,
      environmentProbe: probe,
    });

    expect(probe(resolved.position)).toBe(0);
    expect(resolved.lensObstruction).toBe(0);
    expect(Math.hypot(resolved.position.x - target.x, resolved.position.z - target.z)).toBeLessThan(3.1);
    expect(resolved.position.y).toBeCloseTo(authored.y);
  });

  it('prefers continuity when nearby safe compositions are otherwise equivalent', () => {
    const simulation = new Simulation({ seed: 'camera-continuity', startingPopulation: 80 });
    for (const cell of simulation.state.world.cells) cell.wood = 0;
    const authored = new THREE.Vector3(-3, 1, 0);
    const target = new THREE.Vector3(0, 0.2, 0);
    const previous = new THREE.Vector3(-2.82, 1, -1.03);

    const resolved = resolveCameraSafety(simulation.state, authored, target, () => 0, {
      previousPosition: previous,
      environmentProbe: (position) => position.distanceTo(authored) < 0.2 ? 4 : 0,
    });

    expect(resolved.position.z).toBeLessThan(0);
    expect(resolved.lensObstruction).toBe(0);
  });
});

describe('Arrival camera frame budget', () => {
  it('does not run exact forest/silhouette surveys at display frequency', () => {
    const simulation = new Simulation({ seed: 'arrival-day-preview', startMode: 'arrival' });
    const historian = new Historian(simulation.config);
    const camera = new THREE.PerspectiveCamera();
    let probes = 0;
    const director = new CameraDirector(
      camera,
      simulation.config,
      historian,
      undefined,
      undefined,
      () => { probes += 1; return 0; },
    );
    const arrival = simulation.state.arrival;
    if (!arrival) throw new Error('Expected Arrival state');
    arrival.phase = 'ARRIVAL_SEQUENCE';

    for (let frame = 0; frame < 120; frame++) {
      arrival.elapsedSeconds = 20 + frame / 60;
      director.update(1 / 60, frame / 60, simulation.state, () => 0);
    }

    expect(probes).toBeGreaterThan(120);
    expect(probes).toBeLessThan(15000);
  });
});

describe('Arrival Day editorial pacing', () => {
  it('gives the post-title handoff enough time to settle without becoming another long montage', () => {
    const overview = foundingEditorialTimingFor('founding:overview:event-1');
    const portrait = foundingEditorialTimingFor('founding-cast:introduction:0:person-1');
    const release = foundingEditorialTimingFor('founding-release:event-1');
    expect(overview).toEqual({ durationSeconds: 7.8, transitionSeconds: 3.2 });
    expect(portrait).toEqual({ durationSeconds: 6.2, transitionSeconds: 2.6 });
    expect(release).toEqual({ durationSeconds: 7.8, transitionSeconds: 3.2 });
    expect(overview!.durationSeconds + portrait!.durationSeconds * 2 + release!.durationSeconds).toBeLessThan(30);
    expect(foundingEditorialTimingFor('ordinary:scene')).toBeUndefined();
  });

  it('lets documentary anchors settle, then gives the silent release room to breathe', () => {
    expect(foundingEditorialTimingFor('founding-cast:framing:event-1')).toEqual({ durationSeconds: 6, transitionSeconds: 2.6 });
    expect(foundingEditorialTimingFor('founding-cast:introduction:0:person-1')).toEqual({ durationSeconds: 6.2, transitionSeconds: 2.6 });
    expect(foundingEditorialTimingFor('founding-release:event-1')).toEqual({ durationSeconds: 7.8, transitionSeconds: 3.2 });
    expect(isFoundingReleaseScene('founding-release:event-1')).toBe(true);
    expect(isFoundingReleaseScene('ordinary:scene')).toBe(false);
    expect(foundingEditorialTimingFor(undefined)).toBeUndefined();
  });

  it('gives the four human anchors distinct close-camera compositions', () => {
    const profiles = Array.from({ length: 4 }, (_, index) =>
      foundingCastShotProfileFor(`founding-cast:introduction:${index}:person-${index}`)
    );
    expect(profiles.every(Boolean)).toBe(true);
    expect(new Set(profiles.map(profile => profile?.role)).size).toBe(4);
    expect(new Set(profiles.map(profile => `${profile?.radius}:${profile?.height}`)).size).toBe(4);
    expect(profiles[0]?.role).toBe('portrait');
    expect(profiles[1]?.role).toBe('side-profile');
    expect(profiles[2]?.role).toBe('life-in-place');
    expect(profiles[3]?.role).toBe('last-look');
    expect(profiles[0]?.radius).toBeLessThan(profiles[2]?.radius ?? 0);
    expect(profiles[3]?.distanceDelta).toBeGreaterThan(0);
    expect(foundingCastShotProfileFor('ordinary:person')).toBeUndefined();
  });

  it('gives all five landing beats different visual jobs', () => {
    const profiles = Array.from({ length: 5 }, (_, order) =>
      foundingLandingShotProfileFor(`founding:community:${order}:pod-${order}`)
    );
    expect(profiles.every(Boolean)).toBe(true);
    expect(new Set(profiles.map(profile => profile?.role)).size).toBe(5);
    expect(new Set(profiles.map(profile => profile?.motion)).size).toBe(5);
    expect(new Set(profiles.map(profile => `${profile?.radius}:${profile?.height}`)).size).toBe(5);
    expect(profiles[0]?.role).toBe('terrain-reveal');
    expect(profiles[1]?.role).toBe('ground-approach');
    expect(profiles[2]?.role).toBe('lateral-life');
    expect(profiles[3]?.role).toBe('geographic-contrast');
    expect(profiles[4]?.role).toBe('history-handoff');
    expect(profiles[2]?.height).toBeLessThan(profiles[0]?.height ?? 0);
    expect(profiles[3]?.height).toBeGreaterThan(profiles[1]?.height ?? 100);
    expect(foundingLandingShotProfileFor('ordinary:scene')).toBeUndefined();
  });
});


describe('human-scale documentary camera framing', () => {
  it('keeps personal scenes close enough for people and their animation to read', () => {
    const worker = cameraFramingFor('worker-follow');
    const discovery = cameraFramingFor('discovery-scene');
    const street = cameraFramingFor('street-observation');

    expect(worker.radius[1]).toBeLessThanOrEqual(2.8);
    expect(worker.height[1]).toBeLessThanOrEqual(0.82);
    expect(worker.targetHeight).toBeLessThan(0.2);
    expect(discovery.radius[1]).toBeLessThanOrEqual(3);
    expect(discovery.height[1]).toBeLessThanOrEqual(0.9);
    expect(street.radius[0]).toBeLessThan(3.5);
    expect(street.height[0]).toBeLessThanOrEqual(1.25);
  });

  it('gives human observation shots substantially more stillness than movement', () => {
    const worker = cameraShotPacingFor('worker-follow');
    const street = cameraShotPacingFor('street-observation');
    const traveler = cameraShotPacingFor('traveler-follow');

    expect(worker.settleHoldFraction + worker.finishHoldFraction).toBeGreaterThanOrEqual(0.7);
    expect(worker.motionFraction).toBeLessThanOrEqual(0.3);
    expect(street.settleHoldFraction + street.finishHoldFraction).toBeGreaterThanOrEqual(0.65);
    expect(traveler.settleHoldFraction + traveler.finishHoldFraction).toBeGreaterThan(traveler.motionFraction);
  });

  it('uses deliberate settle and finish holds instead of moving for the whole shot', () => {
    const pacing = cameraShotPacingFor('worker-follow');
    expect(pacing.settleHoldFraction).toBeGreaterThanOrEqual(0.18);
    expect(pacing.finishHoldFraction).toBeGreaterThanOrEqual(0.22);
    expect(pacing.motionFraction).toBeLessThan(0.6);

    expect(cameraMotionProgressFor('worker-follow', 2, 12)).toBe(0);
    const middle = cameraMotionProgressFor('worker-follow', 6, 12);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
    expect(cameraMotionProgressFor('worker-follow', 10.5, 12)).toBe(1);
  });

  it('flies into personal scenes lower and slower than wide documentary moves', () => {
    const personal = cameraFlightProfileFor('worker-follow', 30);
    const wide = cameraFlightProfileFor('world-establishing', 30);

    expect(isPersonalCameraKind('worker-follow')).toBe(true);
    expect(isPersonalCameraKind('world-establishing')).toBe(false);
    expect(personal.limits.maxSpeed).toBeLessThan(wide.limits.maxSpeed);
    expect(personal.limits.maxAcceleration).toBeLessThan(wide.limits.maxAcceleration);
    expect(personal.cruiseClearance).toBeLessThan(wide.cruiseClearance);
    expect(personal.approachFraction).toBeGreaterThan(wide.approachFraction);
    expect(personal.gazeLimits.maxSpeed).toBeLessThan(wide.gazeLimits.maxSpeed);
  });

  it('allows intimate shots to stay near ground without weakening wide-shot terrain safety', () => {
    const worker = cameraClearanceFor('worker-follow');
    const street = cameraClearanceFor('street-observation');
    const wide = cameraClearanceFor('world-establishing');

    expect(worker.lens).toBeLessThan(0.5);
    expect(worker.sightline).toBeLessThan(0.2);
    expect(street.lens).toBeLessThan(0.8);
    expect(cameraTargetFloorFor('worker-follow')).toBeLessThan(0.1);
    expect(cameraTransitionScaleFor('worker-follow')).toBeGreaterThan(1.1);
    expect(cameraTransitionScaleFor('worker-follow')).toBeLessThan(1.25);
    expect(wide.lens).toBe(3);
    expect(wide.sightline).toBe(1.6);
    expect(cameraTransitionScaleFor('world-establishing')).toBe(1);
  });
});


describe('low-camera structure occlusion', () => {
  it('heavily penalizes placing an intimate camera inside a building footprint', () => {
    const simulation = new Simulation({ seed: 'camera-building-collision', startingPopulation: 80 });
    const settlement = simulation.state.settlements.find(candidate => candidate.alive)!;
    settlement.structurePlots = [{
      id: 'camera-blocker',
      worldX: 0,
      worldZ: 0,
      width: 2,
      depth: 2,
      height: 1.4,
      radius: 1,
      condition: 1,
      foundedMonth: 0,
    }];
    const score = structureSightlineObstruction(
      simulation.state,
      new THREE.Vector3(0.2, 0.65, 0),
      new THREE.Vector3(3, 0.14, 0),
      () => 0,
    );
    expect(score).toBeGreaterThan(2);
  });

  it('penalizes a building crossing a low subject sightline but not one behind the camera', () => {
    const simulation = new Simulation({ seed: 'camera-building-sightline', startingPopulation: 80 });
    const settlement = simulation.state.settlements.find(candidate => candidate.alive)!;
    settlement.structurePlots = [{
      id: 'camera-blocker',
      worldX: 0,
      worldZ: 0,
      width: 1.6,
      depth: 1.6,
      height: 1.2,
      radius: 0.8,
      condition: 1,
      foundedMonth: 0,
    }];
    const elevationAt = (): number => 0;
    const blocked = structureSightlineObstruction(
      simulation.state,
      new THREE.Vector3(-3, 0.65, 0),
      new THREE.Vector3(3, 0.14, 0),
      elevationAt,
    );
    const clear = structureSightlineObstruction(
      simulation.state,
      new THREE.Vector3(1.5, 0.65, 0),
      new THREE.Vector3(4, 0.14, 0),
      elevationAt,
    );
    expect(blocked).toBeGreaterThan(0.5);
    expect(clear).toBe(0);
  });
});


describe('interaction-aware personal composition', () => {
  const action = (anchorX: number, anchorZ: number, contactStrength = 0): PhysicalActionPresentation => ({
    personId: 'worker',
    actionKind: 'resource-mineral',
    authoritativeActivity: 'gather',
    sourceAuthority: 'test',
    targetId: 'ore',
    targetKind: 'mineral',
    interactionAnchor: { x: anchorX, z: anchorZ },
    locomotionTarget: { x: 0, z: 0 },
    phase: contactStrength > 0 ? 'contact' : 'prepare-recover',
    phaseProgress: contactStrength,
    activeTool: 'pick',
    contactStrength,
  });

  it('frames actor and work object together from a side-on documentary angle', () => {
    const composition = interactionCameraComposition({ x: 0, z: 0 }, action(0.6, 0, 1), Math.PI / 2);

    expect(composition.span).toBeCloseTo(0.6);
    expect(composition.focusX).toBeGreaterThan(0.3);
    expect(composition.focusX).toBeLessThan(0.4);
    expect(composition.focusZ).toBeCloseTo(0);
    expect(Math.abs(Math.cos(composition.azimuth))).toBeLessThan(0.001);
    expect(composition.distanceBoost).toBeGreaterThan(0.2);
    expect(composition.contactLock).toBe(1);
  });

  it('caps distant work targets so a close shot never turns back into an aerial composition', () => {
    const composition = interactionCameraComposition({ x: 0, z: 0 }, action(10, 0), Math.PI / 2);

    expect(composition.span).toBe(1.6);
    expect(composition.targetX).toBeCloseTo(1.6);
    expect(composition.distanceBoost).toBeLessThanOrEqual(0.72);
    expect(composition.focusX).toBeLessThan(1);
  });

  it('keeps the authored camera side when both perpendicular views tell the action clearly', () => {
    const positiveSide = interactionCameraComposition({ x: 0, z: 0 }, action(0.5, 0), Math.PI / 2);
    const negativeSide = interactionCameraComposition({ x: 0, z: 0 }, action(0.5, 0), -Math.PI / 2);

    expect(Math.sin(positiveSide.azimuth)).toBeGreaterThan(0.9);
    expect(Math.sin(negativeSide.azimuth)).toBeLessThan(-0.9);
  });
});
