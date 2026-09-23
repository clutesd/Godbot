import type { SimulationState, Vec2 } from '../../sim/types';

export interface ArrivalRenderPolicy {
  readonly active: boolean;
  readonly animateHumans: boolean;
  readonly refreshWorldPresentation: boolean;
  readonly refreshVegetationLod: boolean;
  readonly updateAmbientWorldEffects: boolean;
}

/**
 * Arrival is a short authored prologue over a nearly static simulation state. Keep frame-critical
 * atmosphere/camera/pod work live, but do not spend display-frame time on systems whose authority
 * cannot change until history starts.
 */
export function arrivalRenderPolicy(state: SimulationState): ArrivalRenderPolicy {
  const active = Boolean(state.arrival && state.arrival.phase !== 'HISTORY_RUNNING');
  return {
    active,
    animateHumans: !active,
    refreshWorldPresentation: !active,
    refreshVegetationLod: !active,
    updateAmbientWorldEffects: !active,
  };
}

/**
 * Pre-warm forest detail around the vessel the opening actually approaches. Arrival then keeps that
 * stable LOD assignment for the whole prologue instead of re-sorting thousands of trees mid-shot.
 */
export function arrivalVegetationAnchor(state: SimulationState): Vec2 | undefined {
  if (!state.arrival || state.arrival.phase === 'HISTORY_RUNNING') return undefined;
  const hero = state.arrival.pods[0];
  return hero ? { x: hero.position.x, z: hero.position.z } : undefined;
}
