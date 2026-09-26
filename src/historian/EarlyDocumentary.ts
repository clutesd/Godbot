import type { SimulationState } from '../sim/types';
import type { ObservationCandidate } from './types';

/** Presentation policy only: five intimate founding years, with no change to simulation time. */
export function isEarlyDocumentary(state: SimulationState): boolean {
  return state.arrival?.phase === 'HISTORY_RUNNING' && state.month <= 60;
}

export function isHumanObservation(scene: ObservationCandidate): boolean {
  return ['worker-follow', 'traveler-follow', 'discovery-scene', 'street-observation'].includes(scene.kind);
}

export function earlyDocumentaryBias(scene: ObservationCandidate): number {
  if (scene.event && scene.event.significance >= 0.72) return 0;
  if (isHumanObservation(scene)) return 0.45;
  if (scene.kind === 'settlement-approach' || scene.kind === 'infrastructure-scene') return 0.1;
  return scene.editorial?.preferredScale === 'wide' ? -0.4 : 0;
}
