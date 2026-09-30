import type { Settlement, SimulationState } from '../types';
import { facilityOwnedRecipes } from './FacilityCatalog';
import type { RecipeRef } from './types';
import './types';

/** True once the simulation has enrolled this settlement in facility authority. */
export function facilityGoverned(state: Pick<SimulationState, 'processing'>, settlement: Pick<Settlement, 'processing'>): boolean {
  return !!state.processing && settlement.processing?.governed === true;
}

/**
 * Recipe ids a governed settlement may NOT run at settlement level because a physical facility
 * performs them. Undefined for legacy, un-enrolled settlements so the aggregate pipelines keep
 * working exactly as before for saves and harnesses that predate processing facilities.
 */
export function facilityOwnedRecipeSet(
  state: Pick<SimulationState, 'processing'>, settlement: Pick<Settlement, 'processing'>, source: RecipeRef['source'],
): ReadonlySet<string> | undefined {
  if (!facilityGoverned(state, settlement)) return undefined;
  return facilityOwnedRecipes()[source];
}
