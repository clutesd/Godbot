import * as THREE from 'three';

export interface CameraRoutePlan {
  readonly points: readonly THREE.Vector3[];
  readonly clearance: number;
}

export interface CameraRoutePlannerOptions {
  readonly samples?: number;
  readonly lateralOffsets?: readonly number[];
  readonly terrainWeight?: number;
  readonly curvatureWeight?: number;
  readonly clearance?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scoreCandidate(
  point: THREE.Vector3,
  prev: THREE.Vector3,
  next: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
  clearance: number,
  terrainWeight: number,
  curvatureWeight: number,
): number {
  const terrain = elevationAt(point.x, point.z);
  const altitudePenalty = Math.max(0, point.y - terrain - clearance) * 0.045;
  const slopeA = Math.abs((elevationAt(prev.x, prev.z) - terrain) / Math.max(1, prev.distanceTo(point)));
  const slopeB = Math.abs((elevationAt(next.x, next.z) - terrain) / Math.max(1, next.distanceTo(point)));
  const terrainPenalty = (slopeA + slopeB) * terrainWeight;

  const a = point.clone().sub(prev).normalize();
  const b = next.clone().sub(point).normalize();
  const turn = 1 - clamp01((a.dot(b) + 1) * 0.5);
  return terrainPenalty + altitudePenalty + turn * curvatureWeight;
}

/**
 * Builds a presentation-only low-altitude route by sampling small lateral alternatives around
 * the direct corridor. The output is intentionally sparse and smoothable; CameraFlight remains
 * the motion authority.
 */
export function planTerrainAwareCameraRoute(
  origin: THREE.Vector3,
  destination: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
  options: CameraRoutePlannerOptions = {},
): CameraRoutePlan {
  const distance = Math.hypot(destination.x - origin.x, destination.z - origin.z);
  const samples = Math.max(3, Math.min(7, options.samples ?? Math.ceil(distance / 12)));
  const offsets = options.lateralOffsets ?? [-6, -3, 0, 3, 6];
  const clearance = options.clearance ?? 2.4;
  const terrainWeight = options.terrainWeight ?? 2.8;
  const curvatureWeight = options.curvatureWeight ?? 1.4;

  const dir = new THREE.Vector2(destination.x - origin.x, destination.z - origin.z).normalize();
  const normal = new THREE.Vector2(-dir.y, dir.x);

  const points: THREE.Vector3[] = [origin.clone()];
  let previous = origin.clone();

  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const baseX = THREE.MathUtils.lerp(origin.x, destination.x, t);
    const baseZ = THREE.MathUtils.lerp(origin.z, destination.z, t);
    const futureT = Math.min(1, (i + 1) / samples);
    const future = new THREE.Vector3(
      THREE.MathUtils.lerp(origin.x, destination.x, futureT),
      0,
      THREE.MathUtils.lerp(origin.z, destination.z, futureT),
    );

    let best: THREE.Vector3 | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const offset of offsets) {
      const x = baseX + normal.x * offset;
      const z = baseZ + normal.y * offset;
      const ground = elevationAt(x, z);
      const routeHeight = THREE.MathUtils.lerp(origin.y, destination.y, t);
      const candidate = new THREE.Vector3(x, Math.max(routeHeight, ground + clearance), z);
      future.y = Math.max(
        THREE.MathUtils.lerp(origin.y, destination.y, futureT),
        elevationAt(future.x, future.z) + clearance,
      );
      const score = scoreCandidate(candidate, previous, future, elevationAt, clearance, terrainWeight, curvatureWeight)
        + Math.abs(offset) * 0.018;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) {
      points.push(best);
      previous = best;
    }
  }

  points.push(destination.clone());
  return { points, clearance };
}

export function smoothCameraRoute(
  points: readonly THREE.Vector3[],
  subdivisions = 3,
  elevationAt?: (x: number, z: number) => number,
  clearance = 0,
): THREE.Vector3[] {
  if (points.length <= 2) return points.map(point => point.clone());
  const curve = new THREE.CatmullRomCurve3(points.map(point => point.clone()), false, 'centripetal', 0.5);
  const count = Math.max(points.length, (points.length - 1) * Math.max(2, subdivisions) + 1);
  const smoothed = curve.getPoints(count);
  if (elevationAt) {
    for (let index = 1; index < smoothed.length - 1; index += 1) {
      const point = smoothed[index]!;
      point.y = Math.max(point.y, elevationAt(point.x, point.z) + Math.max(0, clearance));
    }
  }
  return smoothed;
}
