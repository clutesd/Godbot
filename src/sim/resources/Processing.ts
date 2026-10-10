import { poweredProductivity } from '../energy/types';
import type { SeededRandom } from '../prng';
import { mastery } from '../knowledge/KnowledgeSystem';
import { recordHeatWork, recordMaterialWork } from '../knowledge/HeatExperience';
import type { Occupation, Settlement, SimulationState } from '../types';
import { craftValueAdded, MATERIAL_BY_ID, RECIPE_CATALOG, type RecipeDefinition } from './catalog';
import { materialEconomy, storageRoom } from './Inventory';
import { settlementLedger, type MaterialLedger } from './MaterialLedger';
import type { ResourceEventDraft } from './ResourceSystem';
import { recordResourceProcessing } from './ResourceWorkAssignments';

export type LabourBudget = Partial<Record<Occupation, number>>;
export interface LabourUse {
  total: number;
  byOccupation: Partial<Record<Occupation, number>>;
}

/** Spends labour in the declared priority order and preserves the exact contributing buckets. */
export function useLabourDetailed(budget: LabourBudget, occupations: readonly Occupation[], requested: number): LabourUse {
  let total = 0;
  const byOccupation: Partial<Record<Occupation, number>> = {};
  for (const occupation of occupations) {
    const spend = Math.min(budget[occupation] ?? 0, requested - total);
    if (spend <= 0) continue;
    budget[occupation] = (budget[occupation] ?? 0) - spend;
    byOccupation[occupation] = spend;
    total += spend;
  }
  return { total, byOccupation };
}

export function useLabour(budget: LabourBudget, occupations: readonly Occupation[], requested: number): number {
  return useLabourDetailed(budget, occupations, requested).total;
}

export interface RecipeRequirementOptions {
  /** A processing facility *is* the infrastructure; its physical state is checked by the facility instead. */
  ignoreInfrastructure?: boolean;
}

export function recipeRequirementsMet(s: Settlement, recipe: RecipeDefinition, state?: SimulationState, options: RecipeRequirementOptions = {}): boolean {
  return recipe.requiredKnowledge.every(k => mastery(s, k.id).practice >= k.minPractice)
    && s.industry.intensity >= (recipe.minIndustrialIntensity ?? 0)
    && (recipe.requiredInstitutions ?? []).every(kind => state?.institutions.some(i => i.settlementId === s.id && i.kind === kind && i.support >= 0.3))
    && (options.ignoreInfrastructure || Object.entries(recipe.requiredInfrastructure ?? {}).every(([key, min]) => s.infrastructure[key as keyof Settlement['infrastructure']] >= min))
    && (!recipe.energy || (MATERIAL_BY_ID.get(recipe.energy.fuel)?.fuelHeat ?? 0) >= recipe.energy.minimumHeat);
}

export function recipeInputs(recipe: RecipeDefinition): Record<string, number> {
  const inputs = { ...recipe.inputs };
  if (recipe.energy) inputs[recipe.energy.fuel] = (inputs[recipe.energy.fuel] ?? 0) + recipe.energy.quantity;
  return inputs;
}

export interface CatalogCycleSetup {
  inputs: Record<string, number>;
  /** Mean practice of the recipe's required knowledge, 0..1. */
  practiced: number;
  /** Mean quality of the inputs at the moment production began. */
  quality: number;
}

export function catalogCycleSetup(s: Settlement, recipe: RecipeDefinition, ledger: MaterialLedger = settlementLedger(s)): CatalogCycleSetup {
  const inputs = recipeInputs(recipe);
  const practiced = recipe.requiredKnowledge.reduce((sum, k) => sum + mastery(s, k.id).practice, 0) / Math.max(1, recipe.requiredKnowledge.length);
  const quality = Object.keys(inputs).reduce((sum, id) => sum + ledger.quality(id), 0) / Object.keys(inputs).length;
  return { inputs, practiced, quality };
}

export interface CatalogCycleOptions {
  /** Extra yield from better equipment (processing facilities). */
  efficiencyBonus?: number;
  /** Settlement-level workshops are drawn by the resource presentation; facilities draw themselves. */
  recordProcessing?: boolean;
}

/**
 * One craft cycle of a catalog recipe against any ledger. This is the single implementation of
 * input consumption, fuel accounting, practice/research, trial failure, yield and quality, used by
 * both the settlement-level pipeline and processing facilities.
 */
export function runCatalogCycle(
  state: SimulationState, s: Settlement, recipe: RecipeDefinition, setup: CatalogCycleSetup, ledger: MaterialLedger,
  random: SeededRandom, events: ResourceEventDraft[], options: CatalogCycleOptions = {},
): void {
  const economy = materialEconomy(s);
  const { inputs, practiced, quality } = setup;
  for (const [id, quantity] of Object.entries(inputs)) ledger.take(id, quantity);
  if (options.recordProcessing !== false) recordResourceProcessing(state, s.id, recipe.id);
  if (recipe.energy) economy.energySupplied += recipe.energy.quantity;
  economy.recipeResearch[recipe.id] = (economy.recipeResearch[recipe.id] ?? 0) + 0.5 + practiced + s.knowledge.literacy * 0.3;
  for (const need of recipe.requiredKnowledge) {
    const record = s.knowledge.records[need.id];
    if (record) { record.lastUsedMonth = state.month; record.practice = Math.min(1, record.practice + 0.001); }
  }
  s.knowledge.experimentation[recipe.id === 'herbal-remedy' ? 'medicine' : 'materials'] += 0.01;
  if (recipe.heat) recordHeatWork(s, recipe.heat, state.month);
  recordMaterialWork(s, 1, state.month);
  // Early trials consume samples but do not imply a reproducible blueprint.
  if ((!s.knownRecipes.includes(recipe.id) && economy.recipeResearch[recipe.id]! < (recipe.researchWork ?? 2)) || random.chance(recipe.failureRisk * (1 - practiced))) return;
  const efficiency = Math.min(1, recipe.baseEfficiency + (options.efficiencyBonus ?? 0) + (1 - recipe.baseEfficiency) * practiced);
  const accepted: Record<string, number> = {};
  for (const [id, quantity] of Object.entries(recipe.outputs)) accepted[id] = ledger.add(id, quantity * efficiency, quality * 0.6 + practiced * 0.4);
  // Only output a store actually took in is worth anything: a full warehouse ends the value, not just the stock.
  const crafted = craftValueAdded(accepted, inputs);
  economy.craftedThisMonth = (economy.craftedThisMonth ?? 0) + crafted;
  economy.craftedTotal = (economy.craftedTotal ?? 0) + crafted;
  for (const [id, quantity] of Object.entries(recipe.byproducts ?? {})) ledger.add(id, quantity, quality);
  if (!s.knownRecipes.includes(recipe.id)) {
    s.knownRecipes.push(recipe.id);
    events.push({ type: 'recipe-learned', location: s.position, locationId: s.id, actors: [s.id],
      causes: ['craft-experimentation', ...recipe.requiredKnowledge.map(k => k.id)],
      context: { recipe: recipe.id, inputs: Object.keys(inputs).join(', '), unlocks: recipe.unlocks?.join(', ') ?? '' },
      outcome: `Local materials and repeated trials made ${recipe.name.toLowerCase()} reproducible.`,
      significance: 0.6, tags: ['resource', 'craft', 'recipe'], summary: `${s.name} learns ${recipe.name.toLowerCase()}.` });
  }
}

export interface ProcessRecipeOptions {
  /** Catalog recipe ids performed elsewhere (a processing facility) and therefore not at settlement level. */
  skip?: ReadonlySet<string>;
}

/** Shared labour, real fuel and bounded inventory gate both experimentation and repeat production. */
export function processRecipes(state: SimulationState, s: Settlement, budget: LabourBudget, random: SeededRandom, options: ProcessRecipeOptions = {}): ResourceEventDraft[] {
  const events: ResourceEventDraft[] = [];
  const economy = materialEconomy(s);
  const ledger = settlementLedger(s);
  // Rotate the queue so a single busy craft cannot permanently starve other processes.
  const offset = state.month % RECIPE_CATALOG.length;
  const queue = [...RECIPE_CATALOG.slice(offset), ...RECIPE_CATALOG.slice(0, offset)];
  for (const recipe of queue) {
    if (options.skip?.has(recipe.id)) continue;
    if (!recipeRequirementsMet(s, recipe, state)) continue;
    const target = productionTarget(recipe);
    if (Object.keys(recipe.outputs).every(id => (s.localMaterials[id] ?? 0) >= target)) continue;
    const inputs = recipeInputs(recipe);
    for (const [id, quantity] of Object.entries(inputs)) economy.demand[id] = Math.max(economy.demand[id] ?? 0, quantity * 3);
    const inputCycles = Math.min(...Object.entries(inputs).map(([id, quantity]) => Math.floor(Math.max(0,
      (s.localMaterials[id] ?? 0) - (s.survival?.establishment?.materialDemand[id] ?? 0)) / quantity)));
    const workers = recipe.craftOccupations.reduce((sum, o) => sum + (budget[o] ?? 0), 0);
    const cell = state.world.cells[s.cellIndex];
    const waterWork = (cell?.soil?.waterAccess ?? 0) * s.infrastructure.workshops * mastery(s, 'wheel-axle').practice;
    const labour = (recipe.labour ?? 1) / ((1 + waterWork * 0.2) * poweredProductivity(s));
    const maxOutput = Object.values(recipe.outputs).reduce((a, b) => a + b, 0) + Object.values(recipe.byproducts ?? {}).reduce((a, b) => a + b, 0);
    const netSpace = Math.max(0, maxOutput - Object.values(inputs).reduce((a, b) => a + b, 0));
    const cycles = Math.min(3, inputCycles, Math.floor(workers / labour), netSpace ? Math.floor(storageRoom(s) / netSpace) : 3);
    if (recipe.energy && workers >= labour) economy.energyDemand += recipe.energy.quantity * Math.max(1, cycles);
    if (cycles <= 0) continue;
    const setup = catalogCycleSetup(s, recipe, ledger);
    for (let cycle = 0; cycle < cycles; cycle++) {
      economy.labourUsed += useLabour(budget, recipe.craftOccupations, labour);
      runCatalogCycle(state, s, recipe, setup, ledger, random, events);
    }
  }
  return events;
}

/** Stock at which a recipe's outputs stop being worth making. Shared with facility scheduling. */
export function productionTarget(recipe: RecipeDefinition): number { return recipe.id === 'charcoal' ? 20 : 10; }
