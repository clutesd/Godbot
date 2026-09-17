import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CAMERA_FOREST_CLEARANCE,
  forestCanopyPressure,
  resolveForestCameraClearance,
} from '../src/render/CameraForestClearance';
import { Simulation } from '../src/sim/Simulation';

function forestFixture(seed: string) {
  const simulation = new Simulation({ seed, startingPopulation: 80 });
  const world = simulation.state.world;
  for (const cell of world.cells) {
    cell.water = false;
    cell.biome = 'forest';
    cell.wood = 1;
    cell.forestCapacity = 1;
    cell.elevation = 0;
  }
  return world;
}

describe('cinematic forest camera clearance', () => {
  it('detects a lens inside mature canopy but not one safely above it', () => {
    const world = forestFixture('camera-clearance-pressure');
    expect(forestCanopyPressure(world, new THREE.Vector3(0, 4, 0), () => 0)).toBeGreaterThan(0.3);
    expect(forestCanopyPressure(world, new THREE.Vector3(0, 12, 0), () => 0)).toBe(0);
  });

  it('finds a bounded escape that materially reduces canopy pressure', () => {
    const world = forestFixture('camera-clearance-escape');
    const camera = new THREE.Vector3(0, 3.5, 0);
    const target = new THREE.Vector3(10, 1, 0);
    const clearance = resolveForestCameraClearance(world, camera, target, () => 0);

    expect(clearance.pressureBefore).toBeGreaterThan(CAMERA_FOREST_CLEARANCE.triggerPressure);
    expect(clearance.offset.length()).toBeGreaterThan(0);
    expect(clearance.offset.y).toBeLessThanOrEqual(CAMERA_FOREST_CLEARANCE.maxVertical);
    expect(Math.hypot(clearance.offset.x, clearance.offset.z)).toBeLessThanOrEqual(CAMERA_FOREST_CLEARANCE.maxLateral + 1e-6);
    expect(clearance.pressureAfter).toBeLessThan(clearance.pressureBefore);
  });

  it('uses release hysteresis so a small boundary crossing does not chatter', () => {
    const world = forestFixture('camera-clearance-hysteresis');
    const camera = new THREE.Vector3(0, 6.7, 0);
    const target = new THREE.Vector3(10, 1, 0);

    const inactive = resolveForestCameraClearance(world, camera, target, () => 0, false);
    const active = resolveForestCameraClearance(world, camera, target, () => 0, true);

    expect(inactive.pressureBefore).toBeLessThan(CAMERA_FOREST_CLEARANCE.triggerPressure);
    expect(inactive.offset.lengthSq()).toBe(0);
    expect(active.pressureBefore).toBeGreaterThan(CAMERA_FOREST_CLEARANCE.releasePressure);
    expect(active.offset.lengthSq()).toBeGreaterThan(0);
  });

  it('trusts the rendered-crown probe over coarse forest stock when an actual gap is clear', () => {
    const world = forestFixture('camera-clearance-rendered-gap');
    const camera = new THREE.Vector3(0, 3.5, 0);
    const target = new THREE.Vector3(10, 1, 0);
    const clearProbe = {
      sightlineObstruction: () => 0,
      canopyPressureAt: () => 0,
    };

    const clearance = resolveForestCameraClearance(world, camera, target, () => 0, false, clearProbe);
    expect(clearance.pressureBefore).toBe(0);
    expect(clearance.offset.lengthSq()).toBe(0);
  });

  it('does nothing when the forest has already been cleared', () => {
    const world = forestFixture('camera-clearance-empty');
    for (const cell of world.cells) cell.wood = 0;
    const clearance = resolveForestCameraClearance(
      world,
      new THREE.Vector3(0, 3.5, 0),
      new THREE.Vector3(10, 1, 0),
      () => 0,
    );

    expect(clearance.pressureBefore).toBe(0);
    expect(clearance.offset.lengthSq()).toBe(0);
  });
});
