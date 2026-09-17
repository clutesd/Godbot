import type { Vector3 } from 'three';

export interface CameraTreeCrown {
  x: number;
  y: number;
  z: number;
  radiusX: number;
  radiusY: number;
  radiusZ: number;
  density: number;
}

export interface CameraVegetationProbe {
  sightlineObstruction(from: Vector3, target: Vector3): number;
  canopyPressureAt(x: number, y: number, z: number): number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Exact presentation-space pressure from the currently rendered crown envelopes.
 * Multiple overlapping crowns combine probabilistically instead of simply summing past 1.
 */
export function crownPressureAt(
  crowns: readonly CameraTreeCrown[],
  x: number,
  y: number,
  z: number,
): number {
  let visibility = 1;
  for (const crown of crowns) {
    const rx = Math.max(0.05, crown.radiusX);
    const ry = Math.max(0.05, crown.radiusY);
    const rz = Math.max(0.05, crown.radiusZ);
    const dx = (x - crown.x) / rx;
    const dy = (y - crown.y) / ry;
    const dz = (z - crown.z) / rz;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(dz) > 1) continue;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance >= 1) continue;
    const contribution = clamp01((1 - distance) * crown.density * 0.96);
    visibility *= 1 - contribution;
    if (visibility < 0.02) return 1;
  }
  return 1 - visibility;
}

/**
 * Estimate how much rendered canopy intersects the camera-to-subject segment.
 * The same crown envelopes drive lens pressure, so shot selection and emergency clearance agree.
 */
export function crownSightlineObstruction(
  crowns: readonly CameraTreeCrown[],
  from: Vector3,
  target: Vector3,
): number {
  const lineX = target.x - from.x;
  const lineY = target.y - from.y;
  const lineZ = target.z - from.z;
  let visibility = 1;

  for (const crown of crowns) {
    const rx = Math.max(0.05, crown.radiusX);
    const ry = Math.max(0.05, crown.radiusY);
    const rz = Math.max(0.05, crown.radiusZ);
    const sx = (from.x - crown.x) / rx;
    const sy = (from.y - crown.y) / ry;
    const sz = (from.z - crown.z) / rz;
    const dx = lineX / rx;
    const dy = lineY / ry;
    const dz = lineZ / rz;
    const denominator = dx * dx + dy * dy + dz * dz;
    if (denominator < 1e-8) continue;

    const amount = clamp01(-(sx * dx + sy * dy + sz * dz) / denominator);
    // Ignore crowns effectively behind the lens or beyond the intended subject.
    if (amount <= 0.015 || amount >= 0.995) continue;
    const px = sx + dx * amount;
    const py = sy + dy * amount;
    const pz = sz + dz * amount;
    const distance = Math.sqrt(px * px + py * py + pz * pz);
    if (distance >= 1) continue;

    const penetration = 1 - distance;
    const foregroundWeight = 1 + (1 - amount) * 0.72;
    const contribution = clamp01(penetration * crown.density * foregroundWeight * 0.9);
    visibility *= 1 - contribution;
    if (visibility < 0.02) return 1;
  }

  return 1 - visibility;
}
