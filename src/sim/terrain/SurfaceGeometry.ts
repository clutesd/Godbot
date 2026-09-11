import { fbmSeeded, octaveSeeds, smoothstep } from './noise';
import { nearestIndex, sampleField } from './TerrainField';
import type { WorldState } from '../types';

export type WaterDepthState = 'dry' | 'wet' | 'flooded' | 'deeply-flooded' | 'submerged';
/** World units, shared with the visible ground and water; an adult is roughly 0.7 units tall. */
export const DANGEROUS_WATER_DEPTH = 0.12;

export function classifyWaterDepth(depth: number, wetness = 0): WaterDepthState {
  if (depth >= 0.95) return 'submerged';
  if (depth >= 0.45) return 'deeply-flooded';
  if (depth >= DANGEROUS_WATER_DEPTH) return 'flooded';
  return depth > 0.005 || wetness > 0.75 ? 'wet' : 'dry';
}

export function waterDepthAt(world: WorldState, x: number, z: number, floorY?: number): number {
  const water = surfaceWaterAt(world, x, z);
  return Number.isFinite(water) ? Math.max(0, water - (floorY ?? surfaceHeightAt(world, x, z))) : 0;
}

const grainSeeds = octaveSeeds('terrain', 'surface-grain', 3);

/** Shared by engineering, traversal and TerrainSurface; no presentation dependency. */
export function elevationToY(elevation: number, seaLevel: number): number {
  const alpine = smoothstep(seaLevel + 0.16, 0.92, elevation);
  return (elevation - seaLevel) * 17.5 + alpine ** 1.45 * 8.5;
}

/** Stable inverse used when finite flood depth has to be exposed through the legacy waterLevel field. */
export function yToElevation(y: number, seaLevel: number): number {
  let lo = seaLevel - 0.25;
  let hi = 1.35;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) * 0.5;
    if (elevationToY(mid, seaLevel) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) * 0.5;
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
