import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cameraClearanceFor, cameraFramingFor, forestSightlineObstruction } from '../src/render/CameraDirector';
import { Simulation } from '../src/sim/Simulation';

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


describe('human-scale documentary camera framing', () => {
  it('keeps personal scenes close enough for people and their animation to read', () => {
    const worker = cameraFramingFor('worker-follow');
    const discovery = cameraFramingFor('discovery-scene');
    const street = cameraFramingFor('street-observation');

    expect(worker.radius[1]).toBeLessThanOrEqual(3.8);
    expect(worker.height[1]).toBeLessThanOrEqual(1.55);
    expect(discovery.radius[1]).toBeLessThanOrEqual(4.1);
    expect(discovery.height[1]).toBeLessThanOrEqual(1.8);
    expect(street.radius[0]).toBeLessThan(5);
    expect(street.height[0]).toBeLessThan(2);
  });

  it('allows intimate shots to stay near ground without weakening wide-shot terrain safety', () => {
    const worker = cameraClearanceFor('worker-follow');
    const street = cameraClearanceFor('street-observation');
    const wide = cameraClearanceFor('world-establishing');

    expect(worker.lens).toBeLessThan(1);
    expect(worker.sightline).toBeLessThan(0.4);
    expect(street.lens).toBeLessThan(1.2);
    expect(wide.lens).toBe(3);
    expect(wide.sightline).toBe(1.6);
  });
});
