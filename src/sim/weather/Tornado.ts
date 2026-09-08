import type { TornadoState, Vec2, WeatherFront, WorldCell } from '../types';

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

export function tornadoPotential(front: WeatherFront, cell: WorldCell, temperature: number, contrast: number): number {
  if (front.kind !== 'thunderstorm' || front.intensity < 0.72 || front.wind < 0.55
    || cell.water || cell.moisture < 0.48 || temperature < 0.5 || contrast < 0.035) return 0;
  return clamp((front.intensity - 0.65) * 2) * clamp((temperature - 0.45) * 4)
    * clamp((cell.moisture - 0.4) * 3) * clamp(contrast * 6) * (1 - cell.slope * 0.8);
}

export function segmentDistance(point: Vec2, start: Vec2, end: Vec2): number {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  const fraction = lengthSquared === 0 ? 0 : clamp(((point.x - start.x) * deltaX + (point.z - start.z) * deltaZ) / lengthSquared);
  return Math.hypot(point.x - start.x - deltaX * fraction, point.z - start.z - deltaZ * fraction);
}

export function tornadoExposure(tornado: TornadoState, point: Vec2, radius = 0): number {
  let distance = Infinity;
  for (let index = 1; index < tornado.path.length; index += 1) {
    distance = Math.min(distance, segmentDistance(point, tornado.path[index - 1]!, tornado.path[index]!));
  }
  return clamp(1 - Math.max(0, distance - radius) / Math.max(0.01, tornado.width / 2));
}

export function tornadoDamage(tornado: TornadoState, exposure: number, resilience: number): number {
  return clamp(exposure * tornado.intensity ** 2 * (1.3 - clamp(resilience) * 0.8));
}