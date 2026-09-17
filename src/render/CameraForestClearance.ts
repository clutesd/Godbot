import * as THREE from 'three';
import type { SimulationState } from '../sim/types';
import { cellAt } from '../sim/world';

export const CAMERA_FOREST_CLEARANCE = {
  triggerPressure: 0.16,
  releasePressure: 0.08,
  probeForward: 2.6,
  maxVertical: 4.8,
  maxLateral: 3.8,
  responseIn: 2.8,
  responseOut: 1.15,
} as const;

export interface ForestCameraClearance {
  offset: THREE.Vector3;
  pressureBefore: number;
  pressureAfter: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function forestCanopyPressureAt(
  world: SimulationState['world'],
  x: number,
  y: number,
  z: number,
  elevationAt: (x: number, z: number) => number,
): number {
  const cell = cellAt(world, x, z);
  if (!cell || cell.water) return 0;

  const capacity = Math.max(0.01, cell.forestCapacity ?? cell.wood);
  const standing = clamp01(cell.wood / capacity);
  if (standing < 0.08) return 0;

  const biomeWeight = cell.biome === 'forest' ? 1
    : cell.biome === 'wetland' ? 0.8
      : cell.river ? 0.64
        : 0.44;
  const canopyHeight = 3.8 + standing * 2.6;
  const canopyTop = elevationAt(x, z) + canopyHeight;
  const overlap = clamp01((canopyTop - y + 0.75) / 3.4);
  return standing * biomeWeight * overlap;
}

/**
 * Coarse presentation estimate of whether the lens occupies standing canopy.
 * Exact foliage remains renderer-owned; this is only an emergency camera-composition guard.
 */
export function forestCanopyPressure(
  world: SimulationState['world'],
  position: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
): number {
  return forestCanopyPressureAt(world, position.x, position.y, position.z, elevationAt);
}

function corridorPressureAt(
  world: SimulationState['world'],
  x: number,
  y: number,
  z: number,
  targetX: number,
  targetZ: number,
  elevationAt: (x: number, z: number) => number,
): number {
  const lens = forestCanopyPressureAt(world, x, y, z, elevationAt);
  const directionX = targetX - x;
  const directionZ = targetZ - z;
  const length = Math.max(0.001, Math.hypot(directionX, directionZ));
  const forward = forestCanopyPressureAt(
    world,
    x + directionX / length * CAMERA_FOREST_CLEARANCE.probeForward,
    y,
    z + directionZ / length * CAMERA_FOREST_CLEARANCE.probeForward,
    elevationAt,
  );
  return lens * 0.72 + forward * 0.28;
}

/**
 * Find the smallest cinematic camera escape that materially improves local canopy clearance.
 * Candidates prefer a crane before lateral displacement, preserving authored composition.
 * The active flag lowers the release threshold so the lens does not chatter at a canopy boundary.
 */
export function resolveForestCameraClearance(
  world: SimulationState['world'],
  position: THREE.Vector3,
  target: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
  active = false,
): ForestCameraClearance {
  const pressureBefore = corridorPressureAt(
    world,
    position.x,
    position.y,
    position.z,
    target.x,
    target.z,
    elevationAt,
  );
  const threshold = active ? CAMERA_FOREST_CLEARANCE.releasePressure : CAMERA_FOREST_CLEARANCE.triggerPressure;
  if (pressureBefore < threshold) {
    return { offset: new THREE.Vector3(), pressureBefore, pressureAfter: pressureBefore };
  }

  const viewX = target.x - position.x;
  const viewZ = target.z - position.z;
  const viewLength = Math.max(0.001, Math.hypot(viewX, viewZ));
  const tangentX = -viewZ / viewLength;
  const tangentZ = viewX / viewLength;

  let bestX = 0;
  let bestY = 0;
  let bestZ = 0;
  let bestPressure = pressureBefore;
  let bestScore = pressureBefore * 4;

  const consider = (offsetX: number, offsetY: number, offsetZ: number): void => {
    const pressure = corridorPressureAt(
      world,
      position.x + offsetX,
      position.y + offsetY,
      position.z + offsetZ,
      target.x,
      target.z,
      elevationAt,
    );
    const lateral = Math.hypot(offsetX, offsetZ);
    // Preserve the authored shot unless canopy pressure clearly improves.
    const displacementPenalty = offsetY * 0.012 + lateral * 0.022;
    const score = pressure * 4 + displacementPenalty;
    if (score < bestScore - 0.025) {
      bestScore = score;
      bestPressure = pressure;
      bestX = offsetX;
      bestY = offsetY;
      bestZ = offsetZ;
    }
  };

  // A crane is visually cheaper than a sidestep, so evaluate it first and let ties prefer it.
  consider(0, 1.4, 0);
  consider(0, 2.8, 0);
  consider(0, CAMERA_FOREST_CLEARANCE.maxVertical, 0);
  consider(tangentX * 1.6, 0.9, tangentZ * 1.6);
  consider(-tangentX * 1.6, 0.9, -tangentZ * 1.6);
  consider(tangentX * 2.8, 1.5, tangentZ * 2.8);
  consider(-tangentX * 2.8, 1.5, -tangentZ * 2.8);
  consider(tangentX * CAMERA_FOREST_CLEARANCE.maxLateral, 2.3, tangentZ * CAMERA_FOREST_CLEARANCE.maxLateral);
  consider(-tangentX * CAMERA_FOREST_CLEARANCE.maxLateral, 2.3, -tangentZ * CAMERA_FOREST_CLEARANCE.maxLateral);

  return {
    offset: new THREE.Vector3(bestX, bestY, bestZ),
    pressureBefore,
    pressureAfter: bestPressure,
  };
}
