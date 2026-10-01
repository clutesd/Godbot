import { fbmSeeded, octaveSeeds, smoothstep } from './noise';
import { nearestIndex, sampleField, type TerrainField } from './TerrainField';
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
  // Most queries are dry. Avoid terrain interpolation/noise unless water is actually present.
  return Number.isFinite(water) ? Math.max(0, water - (floorY ?? surfaceHeightAt(world, x, z))) : 0;
}

const grainSeeds = octaveSeeds('terrain', 'surface-grain', 3);

/** Shared by engineering, traversal and TerrainSurface; no presentation dependency. */
export function elevationToY(elevation: number, seaLevel: number): number {
  const alpine = smoothstep(seaLevel + 0.16, 0.92, elevation);
  return (elevation - seaLevel) * 17.5 + alpine ** 1.45 * 8.5;
}

/**
 * Bilinear share of the permanent river/lake channel at a position. Channel beds are carved only a
 * few millimetres below their stage, so the decorative grain below must never reach them.
 */
function channelWeightAt(terrain: TerrainField, worldX: number, worldZ: number): number {
  const { resolution, step, originX, originZ, river, lake } = terrain;
  const fx = Math.min(resolution - 1, Math.max(0, (worldX - originX) / step));
  const fz = Math.min(resolution - 1, Math.max(0, (worldZ - originZ) / step));
  const x0 = Math.min(resolution - 1, Math.floor(fx)), z0 = Math.min(resolution - 1, Math.floor(fz));
  const x1 = Math.min(resolution - 1, x0 + 1), z1 = Math.min(resolution - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const channel = (x: number, z: number): number => river[z * resolution + x] || lake[z * resolution + x] ? 1 : 0;
  const top = channel(x0, z0) + (channel(x1, z0) - channel(x0, z0)) * tx;
  const bottom = channel(x0, z1) + (channel(x1, z1) - channel(x0, z1)) * tx;
  return top + (bottom - top) * tz;
}

export function surfaceHeightAt(world: WorldState, x: number, z: number): number {
  const elevation = sampleField(world.terrain, world.terrain.height, x, z);
  let grain = elevation < world.seaLevel ? 0 : (fbmSeeded(grainSeeds, x * 0.42, z * 0.42) - 0.5)
    * 0.34 * (0.35 + smoothstep(world.seaLevel + 0.16, world.mountainLevel, elevation) * 0.9);
  // Surface grain belongs to banks and meadows. Left on a channel bed it pokes through the water
  // as dry speckles inside rivers and lakes, so the bed stays smooth exactly where water lives.
  if (grain !== 0) grain *= (1 - channelWeightAt(world.terrain, x, z))
    * smoothstep(world.seaLevel, world.seaLevel + 0.02, elevation);
  return elevationToY(elevation, world.seaLevel) + grain;
}

export function surfaceWaterAt(world: WorldState, x: number, z: number): number {
  const level = world.terrain.waterLevel[nearestIndex(world.terrain, x, z)] ?? -1;
  return level < 0 ? -Infinity : elevationToY(level, world.seaLevel);
}
