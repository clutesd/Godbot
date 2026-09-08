import { fbmSeeded, octaveSeeds, smoothstep } from './noise';
import { nearestIndex, sampleField } from './TerrainField';
import type { WorldState } from '../types';

const grainSeeds = octaveSeeds('terrain', 'surface-grain', 3);

/** Shared by engineering, traversal and TerrainSurface; no presentation dependency. */
export function elevationToY(elevation: number, seaLevel: number): number {
  const alpine = smoothstep(seaLevel + 0.16, 0.92, elevation);
  return (elevation - seaLevel) * 17.5 + alpine ** 1.45 * 8.5;
}

export function surfaceHeightAt(world: WorldState, x: number, z: number): number {
  const elevation = sampleField(world.terrain, world.terrain.height, x, z);
  const grain = elevation < world.seaLevel ? 0 : (fbmSeeded(grainSeeds, x * 0.42, z * 0.42) - 0.5)
    * 0.34 * (0.35 + smoothstep(world.seaLevel + 0.16, world.mountainLevel, elevation) * 0.9);
  return elevationToY(elevation, world.seaLevel) + grain;
}

export function surfaceWaterAt(world: WorldState, x: number, z: number): number {
  const level = world.terrain.waterLevel[nearestIndex(world.terrain, x, z)] ?? -1;
  return level < 0 ? -Infinity : elevationToY(level, world.seaLevel);
}
