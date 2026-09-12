import type { Vec2 } from '../../sim/types';

export type SettlementStreetKind = 'primary' | 'secondary' | 'service' | 'ceremonial';

export interface GroundRoutingLike {
  nearestWalkable(point: Vec2, identity?: string, maxRadius?: number): Vec2;
  route(start: Vec2, end: Vec2): Vec2[];
  routeIsValid(points: readonly Vec2[]): boolean;
}

export interface BoundedStreetRouteOptions {
  identity: string;
  endpointSearchRadius: number;
  maxEndpointDrift: number;
  maxDetourFactor: number;
  maxLength: number;
}

export function planarDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function polylineLength(points: readonly Vec2[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += planarDistance(points[index - 1]!, points[index]!);
  }
  return length;
}

/**
 * Resolves a local street through the same walkability contract used by represented people.
 * Presentation is allowed to move an endpoint slightly onto safe ground, but it may never turn a
 * short district street into a giant scenic detour. If a sensible dry route does not exist, the
 * street simply is not drawn.
 */
export function boundedStreetRoute(
  routing: GroundRoutingLike,
  start: Vec2,
  end: Vec2,
  options: BoundedStreetRouteOptions,
): Vec2[] {
  const safeStart = routing.nearestWalkable(start, `${options.identity}:start`, options.endpointSearchRadius);
  const safeEnd = routing.nearestWalkable(end, `${options.identity}:end`, options.endpointSearchRadius);
  if (planarDistance(start, safeStart) > options.maxEndpointDrift || planarDistance(end, safeEnd) > options.maxEndpointDrift) return [];

  const direct = planarDistance(safeStart, safeEnd);
  if (direct < 0.08) return [];
  const routed = [safeStart, ...routing.route(safeStart, safeEnd)];
  const last = routed[routed.length - 1];
  if (!last || planarDistance(last, safeEnd) > 0.12 || !routing.routeIsValid(routed)) return [];

  const length = polylineLength(routed);
  const detourLimit = Math.max(direct + options.maxEndpointDrift, direct * options.maxDetourFactor);
  if (length > options.maxLength || length > detourLimit) return [];
  return dedupePoints(routed);
}

/**
 * Densifies coarse A* waypoints so each visible road tile hugs the high-resolution terrain rather
 * than bridging over hills as one rigid rectangular beam.
 */
export function densifyStreetRoute(points: readonly Vec2[], maxStep: number): Vec2[] {
  if (points.length < 2) return [...points];
  const result: Vec2[] = [{ ...points[0]! }];
  const step = Math.max(0.12, maxStep);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const distance = planarDistance(from, to);
    const samples = Math.max(1, Math.ceil(distance / step));
    for (let sample = 1; sample <= samples; sample += 1) {
      const t = sample / samples;
      result.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
    }
  }
  return dedupePoints(result);
}

/** Width hierarchy is intentionally restrained at GODBOX documentary scale. */
export function settlementStreetWidth(eraRank: number, kind: SettlementStreetKind): number {
  const primary = eraRank >= 4 ? 0.28 : eraRank >= 2 ? 0.24 : 0.2;
  if (kind === 'ceremonial') return Math.min(0.34, primary * 1.18);
  if (kind === 'primary') return primary;
  if (kind === 'secondary') return primary * 0.76;
  return primary * 0.62;
}

export function pointAlongStreet(points: readonly Vec2[], fraction: number): { point: Vec2; tangent: Vec2 } | undefined {
  if (points.length < 2) return undefined;
  const total = polylineLength(points);
  if (total < 0.001) return undefined;
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let cursor = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const segment = planarDistance(from, to);
    if (cursor + segment >= target || index === points.length - 1) {
      const t = segment < 0.001 ? 0 : Math.max(0, Math.min(1, (target - cursor) / segment));
      return {
        point: { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t },
        tangent: { x: to.x - from.x, z: to.z - from.z },
      };
    }
    cursor += segment;
  }
  return undefined;
}

function dedupePoints(points: readonly Vec2[]): Vec2[] {
  const result: Vec2[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (previous && planarDistance(previous, point) < 0.015) continue;
    result.push({ ...point });
  }
  return result;
}
