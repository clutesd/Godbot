import type { WorldState } from '../../sim/types';
import { surfaceHeightAt } from '../../sim/terrain/SurfaceGeometry';

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
    if (((ix + iz) & 1) === 0) {
      return u + v <= 1 ? a + (b - a) * u + (c - a) * v
        : d + (c - d) * (1 - u) + (b - d) * (1 - v);
    }
    return v >= u ? a + (c - a) * v + (d - c) * u
      : a + (b - a) * u + (d - b) * v;
  };
}
