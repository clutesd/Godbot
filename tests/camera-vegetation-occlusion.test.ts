import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  crownPressureAt,
  crownSightlineObstruction,
  type CameraTreeCrown,
} from '../src/render/CameraVegetationOcclusion';

const crown = (overrides: Partial<CameraTreeCrown> = {}): CameraTreeCrown => ({
  x: 0,
  y: 3,
  z: 0,
  radiusX: 2,
  radiusY: 2,
  radiusZ: 2,
  density: 1,
  ...overrides,
});

describe('rendered crown camera occlusion', () => {
  it('reports strong pressure only when the lens is physically inside a rendered crown', () => {
    const crowns = [crown()];
    expect(crownPressureAt(crowns, 0, 3, 0)).toBeGreaterThan(0.9);
    expect(crownPressureAt(crowns, 3, 3, 0)).toBe(0);
  });

  it('scores a crown crossing the subject sightline but ignores an off-axis crown', () => {
    const from = new THREE.Vector3(-6, 3, 0);
    const target = new THREE.Vector3(6, 3, 0);
    expect(crownSightlineObstruction([crown()], from, target)).toBeGreaterThan(0.8);
    expect(crownSightlineObstruction([crown({ z: 5 })], from, target)).toBe(0);
  });

  it('respects seasonal/biological foliage density instead of treating every crown as opaque', () => {
    const from = new THREE.Vector3(-6, 3, 0);
    const target = new THREE.Vector3(6, 3, 0);
    const dense = crownSightlineObstruction([crown({ density: 1 })], from, target);
    const sparse = crownSightlineObstruction([crown({ density: 0.15 })], from, target);
    expect(dense).toBeGreaterThan(sparse * 4);
  });

  it('combines overlapping crowns without exceeding a normalized obstruction signal', () => {
    const from = new THREE.Vector3(-6, 3, 0);
    const target = new THREE.Vector3(6, 3, 0);
    const score = crownSightlineObstruction([
      crown({ x: -1 }),
      crown({ x: 1 }),
      crown({ x: 0, z: 0.4 }),
    ], from, target);
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThanOrEqual(1);
  });
});
