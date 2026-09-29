import type { Vec2 } from '../../sim/types';
import type { RestSpotPresentation, RestSupportFootprint } from './RestPresentation';

export interface IndoorSleepingArea extends RestSupportFootprint {
  floorY: number;
  doorWidth: number;
  plotWidth: number;
  plotDepth: number;
}

export function sleepAreaPoint(area: RestSupportFootprint, x: number, z: number): Vec2 {
  const c = Math.cos(area.rotationY), s = Math.sin(area.rotationY);
  return { x: area.worldX + x * c + z * s, z: area.worldZ - x * s + z * c };
}

export function sleepAreaLocal(area: RestSupportFootprint, point: Vec2): Vec2 {
  const c = Math.cos(area.rotationY), s = Math.sin(area.rotationY);
  return { x: (point.x - area.worldX) * c - (point.z - area.worldZ) * s,
    z: (point.x - area.worldX) * s + (point.z - area.worldZ) * c };
}

/** Two rows of mats flank a clear central aisle. Dimensions are in rendered world units. */
export function indoorSleepingSpots(area: IndoorSleepingArea): RestSpotPresentation[] {
  if (area.width < 0.4 || area.depth < 0.6 || area.doorWidth < 0.18) return [];
  const rows = Math.min(4, Math.floor((area.depth - 0.14 + 1e-9) / 0.46));
  const spots: RestSpotPresentation[] = [];
  const sides = area.width < 0.72 ? [0] : [-1, 1];
  for (let row = 0; row < (sides.length === 1 ? Math.min(1, rows) : rows); row++) for (const side of sides) {
    spots.push({ key: `${area.key}:bed:${row}:${side}`, supportKey: area.key,
      destination: sleepAreaPoint(area, side * (area.width / 2 - 0.16), -area.depth / 2 + 0.3 + row * 0.46),
      facing: area.rotationY, posture: 'sleep', support: 'bed', indoor: area });
  }
  return spots;
}

export function sleepAreaFloor(area: IndoorSleepingArea, point: Vec2, terrain: number): number {
  const local = sleepAreaLocal(area, point);
  if (Math.abs(local.x) > area.width / 2 + 0.08 || local.z < -area.depth / 2 - 0.08) return terrain;
  const ramp = Math.max(0, Math.min(1, (area.depth / 2 + 0.25 - local.z) / 0.25));
  return terrain + (Math.max(terrain, area.floorY) - terrain) * ramp;
}
