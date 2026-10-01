import type { WorldState } from '../../sim/types';
import { surfaceHeightAt } from '../../sim/terrain/SurfaceGeometry';
import * as THREE from 'three';
import { terrainDiagonalAD } from '../../sim/terrain/TerrainTopology';
import type { TerrainSurface } from './TerrainSurface';

/** Reuse the actual terrain palette and diagonals, so shallow water inherits sand, silt or rock.
 * Cache only during construction; the water geometry's existing colour buffer stores the result. */
export function renderedGroundColorSampler(world: WorldState, surface: TerrainSurface, seed: string):
  (x: number, z: number, target: THREE.Color) => THREE.Color {
  const { resolution, step, originX, originZ } = world.terrain;
  const cache = new Map<number, THREE.Color>();
  const color = (x: number, z: number): THREE.Color => {
    const index = z * resolution + x;
    let value = cache.get(index);
    if (!value) {
      value = surface.colorAtVertex(seed, index, new THREE.Color());
      cache.set(index, value);
    }
    return value;
  };
  return (x, z, target) => {
    const fx = Math.max(0, Math.min(resolution - 1, (x - originX) / step));
    const fz = Math.max(0, Math.min(resolution - 1, (z - originZ) / step));
    const ix = Math.min(resolution - 2, Math.floor(fx));
    const iz = Math.min(resolution - 2, Math.floor(fz));
    const u = fx - ix, v = fz - iz;
    const a = color(ix, iz), b = color(ix + 1, iz), c = color(ix, iz + 1), d = color(ix + 1, iz + 1);
    let colors: THREE.Color[], weights: number[];
    if (!terrainDiagonalAD(world.terrain, ix, iz)) {
      [colors, weights] = u + v <= 1 ? [[a, b, c], [1 - u - v, u, v]] : [[d, c, b], [u + v - 1, 1 - u, 1 - v]];
    } else {
      [colors, weights] = v >= u ? [[a, c, d], [1 - v, v - u, u]] : [[a, b, d], [1 - u, u - v, v]];
    }
    target.setRGB(0, 0, 0);
    for (let i = 0; i < 3; i++) {
      target.r += colors[i]!.r * weights[i]!;
      target.g += colors[i]!.g * weights[i]!;
      target.b += colors[i]!.b * weights[i]!;
    }
    return target;
  };
}

/** Sample the triangles actually drawn by TerrainSurface, including their alternating diagonals.
 * Sampling the continuous height function between vertices instead creates a different shore. */
export function renderedGroundSampler(world: WorldState): (x: number, z: number) => number {
  const { resolution, step, originX, originZ } = world.terrain;
  const cache = new Map<number, number>();
  const height = (x: number, z: number): number => {
    const index = z * resolution + x;
    let y = cache.get(index);
    if (y === undefined) {
      y = Math.fround(surfaceHeightAt(world, originX + x * step, originZ + z * step));
      cache.set(index, y);
    }
    return y;
  };
  return (x, z) => {
    const fx = Math.max(0, Math.min(resolution - 1, (x - originX) / step));
    const fz = Math.max(0, Math.min(resolution - 1, (z - originZ) / step));
    const ix = Math.min(resolution - 2, Math.floor(fx));
    const iz = Math.min(resolution - 2, Math.floor(fz));
    const u = fx - ix, v = fz - iz;
    const a = height(ix, iz), b = height(ix + 1, iz);
    const c = height(ix, iz + 1), d = height(ix + 1, iz + 1);
    if (!terrainDiagonalAD(world.terrain, ix, iz)) {
      return u + v <= 1 ? a + (b - a) * u + (c - a) * v
        : d + (c - d) * (1 - u) + (b - d) * (1 - v);
    }
    return v >= u ? a + (c - a) * v + (d - c) * u
      : a + (b - a) * u + (d - b) * v;
  };
}
