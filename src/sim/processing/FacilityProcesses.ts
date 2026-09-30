import type { Occupation, Settlement, SimulationState } from '../types';
import { MATERIAL_BY_ID, RECIPE_BY_ID, type RecipeDefinition } from '../resources/catalog';
import { MATERIAL_RECIPES, recipeEnabled, type MaterialRecipe } from '../resources/MaterialEconomy';
import { productionTarget, recipeInputs, recipeRequirementsMet } from '../resources/Processing';
import { materialEconomy } from '../resources/Inventory';
import { recipeKey, type RecipeRef } from './types';

/** Fuels are recognised from the material catalog, never from a name. */
export const FUEL_HEAT_THRESHOLD = 0.6;

/**
 * Uniform, read-only view of an *existing* recipe. Nothing here defines a transformation: inputs,
 * outputs, labour, knowledge and yield all come from RECIPE_CATALOG / MATERIAL_RECIPES, and the
 * facility runs them through the same executors the settlement-level pipeline uses.
 */
export interface ProcessSpec {
  key: string;
  ref: RecipeRef;
  name: string;
  /** Per batch, including fuel. */
  inputs: Readonly<Record<string, number>>;
  outputs: Readonly<Record<string, number>>;
  byproducts: Readonly<Record<string, number>>;
  /** Recipe work units per batch; the facility's labour-per-work sets how many worker-months that costs. */
  work: number;
  /** Catalog recipes complete whole cycles; typed recipes accept fractional batches. */
  wholeCycles: boolean;
  fuel?: { id: string; quantity: number; minimumHeat: number };
  catalog?: RecipeDefinition;
  material?: MaterialRecipe;
  /** Occupations the recipe itself names (catalog only); facilities use their tier's crew instead. */
  craftOccupations: readonly Occupation[];
}

const cache = new Map<string, ProcessSpec | null>();

export function processSpec(ref: RecipeRef): ProcessSpec | undefined {
  const key = recipeKey(ref);
  const cached = cache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  let spec: ProcessSpec | null = null;
  if (ref.source === 'catalog') {
    const recipe = RECIPE_BY_ID.get(ref.id);
    if (recipe) spec = {
      key, ref, name: recipe.name, inputs: recipeInputs(recipe), outputs: recipe.outputs, byproducts: recipe.byproducts ?? {},
      work: recipe.labour ?? 1, wholeCycles: true, catalog: recipe, craftOccupations: recipe.craftOccupations,
      fuel: recipe.energy ? { id: recipe.energy.fuel, quantity: recipe.energy.quantity, minimumHeat: recipe.energy.minimumHeat } : undefined,
    };
  } else {
    const recipe = MATERIAL_RECIPES.find(candidate => candidate.id === ref.id);
    if (recipe) {
      const fuelId = Object.keys(recipe.inputs).find(id => (MATERIAL_BY_ID.get(id)?.fuelHeat ?? 0) >= FUEL_HEAT_THRESHOLD);
      spec = {
        key, ref, name: recipe.id.replace(/-/g, ' '), inputs: recipe.inputs as Record<string, number>, outputs: recipe.outputs as Record<string, number>,
        byproducts: {}, work: recipe.work, wholeCycles: false, material: recipe, craftOccupations: ['artisan', 'builder'],
        fuel: fuelId ? { id: fuelId, quantity: recipe.inputs[fuelId as keyof typeof recipe.inputs] ?? 0, minimumHeat: FUEL_HEAT_THRESHOLD } : undefined,
      };
    }
  }
  cache.set(key, spec);
  return spec ?? undefined;
}

/** Knowledge, institutions and industrial-intensity gates of the underlying recipe. */
export function processEnabled(state: SimulationState, s: Settlement, spec: ProcessSpec): boolean {
  if (spec.catalog) return recipeRequirementsMet(s, spec.catalog, state, { ignoreInfrastructure: true });
  return spec.material ? recipeEnabled(s, spec.material) : false;
}

/** Stock at which more output is not wanted. Demand seen by the material economy raises it. */
export function processTarget(s: Settlement, spec: ProcessSpec, outputId: string): number {
  const base = spec.catalog ? productionTarget(spec.catalog) : outputId === 'lumber' ? 24 : outputId === 'steel' ? 12 : 12;
  const demand = materialEconomy(s).demand[outputId] ?? 0;
  const pressure = s.materialUse?.materials[outputId as keyof NonNullable<Settlement['materialUse']>['materials']]?.demand ?? 0;
  return Math.max(base, demand * 3, pressure * 6);
}

/** Materials a fuel-burning process may treat as fuel for a furnace of this minimum heat. */
export function fuelHeat(id: string): number { return MATERIAL_BY_ID.get(id)?.fuelHeat ?? 0; }

/** Net material the process leaves behind per batch; used to size output-yard reservations. */
export function netOutput(spec: ProcessSpec): number {
  const out = Object.values(spec.outputs).reduce((a, b) => a + b, 0) + Object.values(spec.byproducts).reduce((a, b) => a + b, 0);
  return out;
}
