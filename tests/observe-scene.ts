import type { Historian } from '../src/historian/Historian';
import type { ObservationCandidate } from '../src/historian/types';
import type { SimulationState } from '../src/sim/types';
export function acquireProposal(historian: Historian, state: SimulationState, scene: ObservationCandidate | undefined): ObservationCandidate | undefined {
  if (scene) historian.acquireScene(scene, state);
  return scene;
}
export function observeScene(historian: Historian, state: SimulationState, focus?: string): ObservationCandidate {
  const scene = historian.chooseScene(state, focus);
  historian.acquireScene(scene, state);
  return scene;
}
