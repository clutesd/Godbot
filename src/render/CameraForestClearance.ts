import * as THREE from 'three';
import type { SimulationState } from '../sim/types';
import { cellAt } from '../sim/world';

export const CAMERA_FOREST_CLEARANCE = {
  triggerPressure: 0.16,
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

/**
 * Coarse presentation estimate of whether the lens occupies standing canopy.
 * Exact foliage remains renderer-owned; this is only an emergency camera-composition guard.
 */
export function forestCanopyPressure(
  world: SimulationState['world'],
  position: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
): number {
  const cell = cellAt(world, position.x, position.z);
  if (!cell || cell.water) return 0;

  const capacity = Math.max(0.01, cell.forestCapacity ?? cell.wood);
  const standing = clamp01(cell.wood / capacity);
  if (standing < 0.08) return 0;

  const biomeWeight = cell.biome === 'forest' ? 1
    : cell.biome === 'wetland' ? 0.8
      : cell.river ? 0.64
        : 0.44;
  const canopyHeight = 3.8 + standing * 2.6;
  const canopyTop = elevationAt(position.x, position.z) + canopyHeight;
  const overlap = clamp01((canopyTop - position.y + 0.75) / 3.4);
  return standing * biomeWeight * overlap;
}

function corridorPressure(
  world: SimulationState['world'],
  position: THREE.Vector3,
  target: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
): number {
  const lens = forestCanopyPressure(world, position, elevationAt);
  const directionX = target.x - position.x;
  const directionZ = target.z - position.z;
  const length = Math.max(0.001, Math.hypot(directionX, directionZ));
  const probe = new THREE.Vector3(
    position.x + directionX / length * CAMERA_FOREST_CLEARANCE.probeForward,
    position.y,
    position.z + directionZ / length * CAMERA_FOREST_CLEARANCE.probeForward,
  );
  const forward = forestCanopyPressure(world, probe, elevationAt);
  return lens * 0.72 + forward * 0.28;
}

/**
 * Find the smallest cinematic camera escape that materially improves local canopy clearance.
 * Candidates prefer a crane before lateral displacement, preserving authored composition.
 */
export function resolveForestCameraClearance(
  world: SimulationState['world'],
  position: THREE.Vector3,
  target: THREE.Vector3,
  elevationAt: (x: number, z: number) => number,
): ForestCameraClearance {
  const pressureBefore = corridorPressure(world, position, target, elevationAt);
  if (pressureBefore < CAMERA_FOREST_CLEARANCE.triggerPressure) {
    return { offset: new THREE.Vector3(), pressureBefore, pressureAfter: pressureBefore };
  }

  const viewX = target.x - position.x;
  const viewZ = target.z - position.z;
  const viewLength = Math.max(0.001, Math.hypot(viewX, viewZ));
  const tangentX = -viewZ / viewLength;
  const tangentZ = viewX / viewLength;

  const candidates = [
    new THREE.Vector3(0, 1.4, 0),
    new THREE.Vector3(0, 2.8, 0),
    new THREE.Vector3(0, CAMERA_FOREST_CLEARANCE.maxVertical, 0),
    new THREE.Vector3(tangentX * 1.6, 0.9, tangentZ * 1.6),
    new THREE.Vector3(-tangentX * 1.6, 0.9, -tangentZ * 1.6),
    new THREE.Vector3(tangentX * 2.8, 1.5, tangentZ * 2.8),
    new THREE.Vector3(-tangentX * 2.8, 1.5, -tangentZ * 2.8),
    new THREE.Vector3(tangentX * CAMERA_FOREST_CLEARANCE.maxLateral, 2.3, tangentZ * CAMERA_FOREST_CLEARANCE.maxLateral),
    new THREE.Vector3(-tangentX * CAMERA_FOREST_CLEARANCE.maxLateral, 2.3, -tangentZ * CAMERA_FOREST_CLEARANCE.maxLateral),
  ];

  let bestOffset = new THREE.Vector3();
  let bestPressure = pressureBefore;
  let bestScore = pressureBefore * 4;

  for (const offset of candidates) {
    const candidate = position.clone().add(offset);
    const pressure = corridorPressure(world, candidate, target, elevationAt);
    const lateral = Math.hypot(offset.x, offset.z);
    // Preserve the authored shot unless canopy pressure clearly improves.
    const displacementPenalty = offset.y * 0.012 + lateral * 0.022;
    const score = pressure * 4 + displacementPenalty;
    if (score < bestScore - 0.025) {
      bestScore = score;
      bestPressure = pressure;
      bestOffset = offset;
    }
  }

  return { offset: bestOffset, pressureBefore, pressureAfter: bestPressure };
}
