import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cameraClearanceFor, cameraFramingFor, cameraTargetFloorFor, cameraTransitionScaleFor, forestSightlineObstruction, foundingEditorialTimingFor, interactionCameraComposition, structureSightlineObstruction } from '../src/render/CameraDirector';
import { Simulation } from '../src/sim/Simulation';
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


describe('Arrival Day editorial pacing', () => {
  it('keeps the post-title orientation under forty seconds at five landings', () => {
    const overview = foundingEditorialTimingFor('founding:overview:event-1');
    const landing = foundingEditorialTimingFor('founding:community:pod-1');
    expect(overview).toEqual({ durationSeconds: 9.5, transitionSeconds: 2.4 });
    expect(landing).toEqual({ durationSeconds: 5.8, transitionSeconds: 1.8 });
    expect(overview!.durationSeconds + landing!.durationSeconds * 5).toBeLessThan(40);
    expect(foundingEditorialTimingFor('ordinary:scene')).toBeUndefined();
  });

  it('keeps documentary anchors brief without changing ordinary camera timing', () => {
    expect(foundingEditorialTimingFor('founding-cast:framing:event-1')).toEqual({ durationSeconds: 4.6, transitionSeconds: 1.5 });
    expect(foundingEditorialTimingFor('founding-cast:introduction:person-1')).toEqual({ durationSeconds: 3.8, transitionSeconds: 1.1 });
    expect(foundingEditorialTimingFor(undefined)).toBeUndefined();
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

  it('allows intimate shots to stay near ground without weakening wide-shot terrain safety', () => {
    const worker = cameraClearanceFor('worker-follow');
    const street = cameraClearanceFor('street-observation');
    const wide = cameraClearanceFor('world-establishing');

    expect(worker.lens).toBeLessThan(0.5);
    expect(worker.sightline).toBeLessThan(0.2);
    expect(street.lens).toBeLessThan(0.8);
    expect(cameraTargetFloorFor('worker-follow')).toBeLessThan(0.1);
    expect(cameraTransitionScaleFor('worker-follow')).toBeLessThan(0.5);
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
