import { FOUNDING_LANDING_SAFE_RADIUS, type FoundingPod } from '../../sim/founding/FoundingArrival';
import type { Settlement, Vec2 } from '../../sim/types';

const LANDING_SPOKES = 16;
const LANDING_SPOKE_STEP = Math.PI * 2 / LANDING_SPOKES;

/**
 * The vessel's feet reach a little past one world unit from touchdown. The hearth sits well
 * outside that keep-out while remaining inside the radius validated when the landing site was
 * chosen. Snapping to a validation spoke also keeps the choice deterministic and terrain-backed.
 */
export const FOUNDING_VESSEL_KEEP_OUT_RADIUS = 1.3;
export const FOUNDING_HEARTH_DISTANCE = FOUNDING_LANDING_SAFE_RADIUS - 0.2;

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

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
