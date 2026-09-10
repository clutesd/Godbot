import type { WorldState } from '../../sim/types';

/** Terrain sampling clamps at the edge; placement must reject that extrapolated ground. */
export function insideVegetationTerrain(world: WorldState, x: number, z: number, margin = 0): boolean {
  const terrain = world.terrain;
  const extent = (terrain.resolution - 1) * terrain.step;
  return Number.isFinite(x) && Number.isFinite(z)
    && x >= terrain.originX + margin && x <= terrain.originX + extent - margin
    && z >= terrain.originZ + margin && z <= terrain.originZ + extent - margin;
}
