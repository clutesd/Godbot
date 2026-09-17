import type { StructureMaterial } from '../../sim/development/types';
import type { Vec2 } from '../../sim/types';

export type ConstructionWorkerPhase = 'return' | 'pickup' | 'carry' | 'deliver';

export interface ConstructionWorkerAnchors {
  pickup: Vec2;
  delivery: Vec2;
  materialCenter: Vec2;
  siteCenter: Vec2;
}

export interface ConstructionWorkerMotionSample {
  phase: ConstructionWorkerPhase;
  phaseProgress: number;
  target: Vec2;
  /** Used only when standing; movement facing still comes from PeopleVisualState. */
  restFacing: number;
  carrying: boolean;
  material: StructureMaterial;
}

const RETURN_SECONDS = 2.5;
const PICKUP_SECONDS = 0.9;
const CARRY_SECONDS = 2.7;
const DELIVER_SECONDS = 1.15;
export const CONSTRUCTION_DELIVERY_CYCLE_SECONDS = RETURN_SECONDS + PICKUP_SECONDS + CARRY_SECONDS + DELIVER_SECONDS;

/**
 * Deterministic presentation cycle for a builder already assigned to an active construction site.
 * It does not consume inventory or advance project progress. The simulation decides whether work
 * exists; this only makes one unit of that work visually comprehensible.
 */
export function sampleConstructionWorkerMotion(
  personId: string,
  elapsedSeconds: number,
  anchors: ConstructionWorkerAnchors,
  material: StructureMaterial,
): ConstructionWorkerMotionSample {
  // Spread workers around the loop so a crew reads as a workflow instead of synchronized actors.
  const offset = stableUnit(`${personId}:construction-cycle`) * CONSTRUCTION_DELIVERY_CYCLE_SECONDS;
  let t = positiveModulo(elapsedSeconds + offset, CONSTRUCTION_DELIVERY_CYCLE_SECONDS);

  if (t < RETURN_SECONDS) {
    return {
      phase: 'return',
      phaseProgress: t / RETURN_SECONDS,
      target: anchors.pickup,
      restFacing: facingToward(anchors.pickup, anchors.materialCenter),
      carrying: false,
      material,
    };
  }
  t -= RETURN_SECONDS;

  if (t < PICKUP_SECONDS) {
    return {
      phase: 'pickup',
      phaseProgress: t / PICKUP_SECONDS,
      target: anchors.pickup,
      restFacing: facingToward(anchors.pickup, anchors.materialCenter),
      // The load appears during the final part of the crouch/reach, not before contact.
      carrying: t / PICKUP_SECONDS > 0.62,
      material,
    };
  }
  t -= PICKUP_SECONDS;

  if (t < CARRY_SECONDS) {
    return {
      phase: 'carry',
      phaseProgress: t / CARRY_SECONDS,
      target: anchors.delivery,
      restFacing: facingToward(anchors.delivery, anchors.siteCenter),
      carrying: true,
      material,
    };
  }
  t -= CARRY_SECONDS;

  const progress = t / DELIVER_SECONDS;
  return {
    phase: 'deliver',
    phaseProgress: progress,
    target: anchors.delivery,
    restFacing: facingToward(anchors.delivery, anchors.siteCenter),
    // Keep the load visible through the first placement beat, then let it visibly leave the hands.
    carrying: progress < 0.52,
    material,
  };
}

/** Stable -1..1 lane so workers do not walk through each other on one exact line. */
export function constructionWorkerLane(personId: string): number {
  return stableUnit(`${personId}:construction-lane`) * 2 - 1;
}

export function rotateConstructionAnchor(
  local: Vec2,
  siteCenter: Vec2,
  rotationY: number,
): Vec2 {
  const cosine = Math.cos(rotationY);
  const sine = Math.sin(rotationY);
  return {
    x: siteCenter.x + local.x * cosine + local.z * sine,
    z: siteCenter.z - local.x * sine + local.z * cosine,
  };
}

function facingToward(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}
