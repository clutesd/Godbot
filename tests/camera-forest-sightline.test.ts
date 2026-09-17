import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { forestSightlineObstruction } from '../src/render/CameraDirector';
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
