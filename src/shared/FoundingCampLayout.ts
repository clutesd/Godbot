import type { FoundingPod } from '../sim/founding/FoundingArrival';
import type { Settlement, Vec2 } from '../sim/types';

const LANDING_SPOKES = 16;
const LANDING_SPOKE_STEP = Math.PI * 2 / LANDING_SPOKES;

/**
 * The hearth is close enough to read as part of the landing camp but remains comfortably outside
 * the vessel footprint. The full landing spoke was terrain-validated at touchdown,
 * so any point along this shorter spoke inherits that dry, traversable corridor.
 */
export const FOUNDING_VESSEL_KEEP_OUT_RADIUS = 1.3;
export const FOUNDING_HEARTH_DISTANCE = 2.45;
/** No later structure may consume the social/working ground immediately around the hearth. */
export const FOUNDING_HEARTH_RESERVE_RADIUS = 0.95;

export function foundingHearthOffset(pod: Pick<FoundingPod, 'id' | 'entryOffset'>): Vec2 {
  const approachAngle = Math.atan2(-pod.entryOffset.z, -pod.entryOffset.x);
  const side = stableUnit(`${pod.id}:hearth-side`) < 0.5 ? -1 : 1;
  const idealAngle = approachAngle + side * Math.PI / 2;
  const snappedAngle = Math.round(idealAngle / LANDING_SPOKE_STEP) * LANDING_SPOKE_STEP;
  return {
    x: Math.cos(snappedAngle) * FOUNDING_HEARTH_DISTANCE,
    z: Math.sin(snappedAngle) * FOUNDING_HEARTH_DISTANCE,
  };
}

export function foundingSettlementHearthOffset(
  settlement: Pick<Settlement, 'foundingPodId'>,
  pods: readonly Pick<FoundingPod, 'id' | 'entryOffset'>[],
): Vec2 | undefined {
  if (!settlement.foundingPodId) return undefined;
  const pod = pods.find(candidate => candidate.id === settlement.foundingPodId);
  return pod ? foundingHearthOffset(pod) : undefined;
}

export function foundingHearthWorldPosition(
  settlement: Pick<Settlement, 'foundingPodId' | 'position'>,
  pods: readonly Pick<FoundingPod, 'id' | 'entryOffset'>[],
): Vec2 | undefined {
  const offset = foundingSettlementHearthOffset(settlement, pods);
  return offset ? { x: settlement.position.x + offset.x, z: settlement.position.z + offset.z } : undefined;
}

/** A founding hearth is infrastructure only after its one-time first-fire achievement. */
export function foundingHearthEstablished(settlement: Pick<Settlement, 'foundingPodId' | 'survival'>): boolean {
  return !settlement.foundingPodId || Boolean(settlement.survival?.firstFire?.eventId);
}

/** Kept explicit so renderer, signatures and tests agree on what "the hearth is burning" means. */
export function foundingHearthBurning(settlement: Pick<Settlement, 'survival'>): boolean {
  return ((settlement.survival?.hearth?.fuelUsed ?? 0) + (settlement.survival?.cold.fuelUsed ?? 0)) > 0;
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
