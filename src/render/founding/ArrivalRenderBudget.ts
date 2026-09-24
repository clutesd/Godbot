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
  const arrival = state.arrival;
  const active = Boolean(arrival && arrival.phase !== 'HISTORY_RUNNING');
  // Founders begin emerging shortly after the first touchdown. From that point onward the people
  // are the subject of the film, so keep character presentation live while the heavier simulation
  // and world-maintenance systems remain frozen.
  const humanSequence = Boolean(active && arrival && arrival.elapsedSeconds >= 26.5);
  return {
    active,
    animateHumans: !active || humanSequence,
    refreshWorldPresentation: !active,
    // The camera now visits all five sites at ground level. Refreshing vegetation LOD during the
    // site tour prevents a beautiful low shot from inheriting the opening's single-site LOD.
    refreshVegetationLod: !active || Boolean(arrival && arrival.elapsedSeconds >= 28),
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
