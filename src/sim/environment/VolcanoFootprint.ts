import { stableHash } from '../prng';
import { surfaceHeightAt } from '../terrain/SurfaceGeometry';
import { nearestIndex } from '../terrain/TerrainField';
import type { Vec2, WorldState } from '../types';

export interface LavaChannel { points: Vec2[]; width: number }
export interface FlowSurface {
  heightAt(x: number, z: number): number;
  blockedAt(x: number, z: number): boolean;
}

/** A bounded downhill walk. A closed depression arrests the flow; it cannot climb out. */
export function traceLavaFlow(surface: FlowSurface, start: Vec2, heading: number, length: number): Vec2[] {
  const points = [{ ...start }];
  const step = 0.6;
  let { x, z } = start;
  let y = surface.heightAt(x, z);
  if (surface.blockedAt(x, z)) return [];
  for (let travelled = 0; travelled + step <= length; travelled += step) {
    let next: { x: number; z: number; y: number; angle: number } | undefined;
    let score = Infinity;
    for (let k = -6; k <= 6; k++) {
      const angle = heading + k * 0.2;
      const nx = x + Math.cos(angle) * step, nz = z + Math.sin(angle) * step;
      const ny = surface.heightAt(nx, nz);
      if (ny >= y - 0.0001) continue;
      const candidate = ny + Math.abs(k) * 0.012;
      if (candidate < score) { score = candidate; next = { x: nx, z: nz, y: ny, angle }; }
    }
    if (!next || surface.blockedAt(next.x, next.z)) break;
    ({ x, z, y } = next);
    heading = next.angle;
    points.push({ x, z });
  }
  return points;
}

const channels = new WeakMap<WorldState, LavaChannel[]>();

/** Shared, deterministic geometry for both consequences and presentation. No simulation RNG. */
export function volcanoChannels(world: WorldState, seed: string): readonly LavaChannel[] {
  const cached = channels.get(world);
  if (cached) return cached;
  const vent = world.volcanicVent;
  if (!vent) return [];
  const terrain = world.terrain;
  const maxX = terrain.originX + (terrain.resolution - 1) * terrain.step;
  const maxZ = terrain.originZ + (terrain.resolution - 1) * terrain.step;
  const surface: FlowSurface = {
    heightAt: (x, z) => surfaceHeightAt(world, x, z),
    // Use permanent water masks, never monthly flood stages: render timing cannot change paths.
    blockedAt: (x, z) => x < terrain.originX || z < terrain.originZ || x > maxX || z > maxZ
      || surfaceHeightAt(world, x, z) <= 0.08
      || Boolean(terrain.lake[nearestIndex(terrain, x, z)] || terrain.river[nearestIndex(terrain, x, z)]),
  };
  const result: LavaChannel[] = [];
  for (let c = 0; c < 3; c++) {
    const heading = c / 3 * Math.PI * 2 + stableHash(`${seed}:volcano:flow:${c}`) * 0.6;
    let points: Vec2[] = [];
    // Find a draining breach within each sector instead of choosing a blocked compass ray.
    for (let candidate = -3; candidate <= 3; candidate++) {
      const angle = heading + candidate * 0.16;
      const start = { x: vent.worldX + Math.cos(angle) * vent.craterRadius * 1.05,
        z: vent.worldZ + Math.sin(angle) * vent.craterRadius * 1.05 };
      const path = traceLavaFlow(surface, start, angle,
        vent.craterRadius * (2.4 + stableHash(`${seed}:volcano:length:${c}`) * 1.4));
      if (path.length > points.length) points = path;
    }
    if (points.length > 2) result.push({ points, width: vent.craterRadius * 0.32 });
  }
  channels.set(world, result);
  return result;
}

export function lavaHalfWidth(width: number, fraction: number): number {
  return width * (1 - fraction * 0.6) * Math.sqrt(Math.max(0, Math.min(1, (1 - fraction) / 0.14)))
    * (0.85 + Math.sin(fraction * 31) ** 2 * 0.15) * 0.5;
}

/** The advancing toe is the same fraction used by the lava shader. */
export function lavaReach(activity: number): number { return Math.min(1, Math.max(0, (activity - 0.46) / 0.54)); }

export function lavaExposure(channels: readonly LavaChannel[], x: number, z: number, reach: number, radius = 0): number {
  let exposure = 0;
  if (reach <= 0) return 0;
  for (const channel of channels) {
    const segments = channel.points.length - 1;
    for (let i = 0; i < segments && i / segments < reach; i++) {
      const a = channel.points[i]!, b = channel.points[i + 1]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, reach * segments - i,
        ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      const half = lavaHalfWidth(channel.width, (i + t) / segments) + radius;
      if (half > 0) exposure = Math.max(exposure, Math.max(0, 1 - distance / half));
    }
  }
  return exposure;
}

export interface VolcanicWind { x: number; z: number; strength: number }
export function volcanicWind(world: WorldState, x: number, z: number): VolcanicWind {
  const gx = Math.max(0, Math.min(world.size - 1, Math.round(x / world.cellSize + world.size / 2)));
  const gz = Math.max(0, Math.min(world.size - 1, Math.round(z / world.cellSize + world.size / 2)));
  const weather = world.weather?.cells[gz * world.size + gx] ?? world.weather;
  const wx = weather?.windX ?? 1, wz = weather?.windZ ?? 0;
  const length = Math.hypot(wx, wz);
  return { x: length > 0 ? wx / length : 1, z: length > 0 ? wz / length : 0,
    strength: length > 0 ? Math.max(0, Math.min(1, weather?.wind ?? 0.3)) : 0 };
}

/** Compact wind-stretched footprint, with local fallout even upwind of the vent. */
export function ashExposure(dx: number, dz: number, radius: number, wind: VolcanicWind): number {
  const along = dx * wind.x + dz * wind.z;
  const across = -dx * wind.z + dz * wind.x;
  const length = radius * (along > 0 ? 4 + wind.strength * 8 : 4 - wind.strength * 2);
  const distance = Math.hypot(along / length, across / (radius * 4));
  return Math.max(0, 1 - distance) ** 2;
}
