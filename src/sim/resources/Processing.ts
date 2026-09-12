import type { SeededRandom } from '../prng';
import { mastery } from '../knowledge/KnowledgeSystem';
import type { Occupation, Settlement, SimulationState } from '../types';
import { MATERIAL_BY_ID, RECIPE_CATALOG, type RecipeDefinition } from './catalog';
import { addMaterial, materialEconomy, storageRoom, takeMaterial } from './Inventory';
import type { ResourceEventDraft } from './ResourceSystem';

export type LabourBudget = Partial<Record<Occupation, number>>;

export function useLabour(budget: LabourBudget, occupations: readonly Occupation[], requested: number): number {
  let used = 0;
  for (const occupation of occupations) {
    const spend = Math.min(budget[occupation] ?? 0, requested - used);
    budget[occupation] = (budget[occupation] ?? 0) - spend;
    used += spend;
  }
  return used;
}

export function recipeRequirementsMet(s: Settlement, recipe: RecipeDefinition, state?: SimulationState): boolean {
  return recipe.requiredKnowledge.every(k => mastery(s, k.id).practice >= k.minPractice)
    && s.industry.intensity >= (recipe.minIndustrialIntensity ?? 0)
    && (recipe.requiredInstitutions ?? []).every(kind => state?.institutions.some(i => i.settlementId === s.id && i.kind === kind && i.support >= 0.3))
    && Object.entries(recipe.requiredInfrastructure ?? {}).every(([key, min]) => s.infrastructure[key as keyof Settlement['infrastructure']] >= min)
    && (!recipe.energy || (MATERIAL_BY_ID.get(recipe.energy.fuel)?.fuelHeat ?? 0) >= recipe.energy.minimumHeat);
}

export function recipeInputs(recipe: RecipeDefinition): Record<string, number> {
  const inputs = { ...recipe.inputs };
  if (recipe.energy) inputs[recipe.energy.fuel] = (inputs[recipe.energy.fuel] ?? 0) + recipe.energy.quantity;
  return inputs;
}

/** Shared labour, real fuel and bounded inventory gate both experimentation and repeat production. */
export function processRecipes(state: SimulationState, s: Settlement, budget: LabourBudget, random: SeededRandom): ResourceEventDraft[] {
  const events: ResourceEventDraft[] = [];
  const economy = materialEconomy(s);
  // Rotate the queue so a single busy craft cannot permanently starve other processes.
  const offset = state.month % RECIPE_CATALOG.length;
  const queue = [...RECIPE_CATALOG.slice(offset), ...RECIPE_CATALOG.slice(0, offset)];
  for (const recipe of queue) {
    if (!recipeRequirementsMet(s, recipe, state)) continue;
    const target = recipe.id === 'charcoal' ? 20 : 10;
    if (Object.keys(recipe.outputs).every(id => (s.localMaterials[id] ?? 0) >= target)) continue;
    const inputs = recipeInputs(recipe);
    for (const [id, quantity] of Object.entries(inputs)) economy.demand[id] = Math.max(economy.demand[id] ?? 0, quantity * 3);
    const inputCycles = Math.min(...Object.entries(inputs).map(([id, quantity]) => Math.floor((s.localMaterials[id] ?? 0) / quantity)));
    const workers = recipe.craftOccupations.reduce((sum, o) => sum + (budget[o] ?? 0), 0);
    const cell = state.world.cells[s.cellIndex];
    const waterWork = (cell?.soil?.waterAccess ?? 0) * s.infrastructure.workshops * mastery(s, 'wheel-axle').practice;
    const labour = (recipe.labour ?? 1) / (1 + waterWork * 0.2);
    const maxOutput = Object.values(recipe.outputs).reduce((a, b) => a + b, 0) + Object.values(recipe.byproducts ?? {}).reduce((a, b) => a + b, 0);
    const netSpace = Math.max(0, maxOutput - Object.values(inputs).reduce((a, b) => a + b, 0));
    const cycles = Math.min(3, inputCycles, Math.floor(workers / labour), netSpace ? Math.floor(storageRoom(s) / netSpace) : 3);
    if (recipe.energy && workers >= labour) economy.energyDemand += recipe.energy.quantity * Math.max(1, cycles);
    if (cycles <= 0) continue;
    const practiced = recipe.requiredKnowledge.reduce((sum, k) => sum + mastery(s, k.id).practice, 0) / Math.max(1, recipe.requiredKnowledge.length);
    const quality = Object.keys(inputs).reduce((sum, id) => sum + (economy.quality[id] ?? 0.5), 0) / Object.keys(inputs).length;
    for (let cycle = 0; cycle < cycles; cycle++) {
      economy.labourUsed += useLabour(budget, recipe.craftOccupations, labour);
      for (const [id, quantity] of Object.entries(inputs)) takeMaterial(s, id, quantity);
      if (recipe.energy) economy.energySupplied += recipe.energy.quantity;
      economy.recipeResearch[recipe.id] = (economy.recipeResearch[recipe.id] ?? 0) + 0.5 + practiced + s.knowledge.literacy * 0.3;
      for (const need of recipe.requiredKnowledge) {
        const record = s.knowledge.records[need.id];
        if (record) { record.lastUsedMonth = state.month; record.practice = Math.min(1, record.practice + 0.001); }
      }
      s.knowledge.experimentation[recipe.id === 'herbal-remedy' ? 'medicine' : 'materials'] += 0.01;
      // Early trials consume samples but do not imply a reproducible blueprint.
      if ((!s.knownRecipes.includes(recipe.id) && economy.recipeResearch[recipe.id]! < (recipe.researchWork ?? 2)) || random.chance(recipe.failureRisk * (1 - practiced))) continue;
      const efficiency = recipe.baseEfficiency + (1 - recipe.baseEfficiency) * practiced;
      for (const [id, quantity] of Object.entries(recipe.outputs)) addMaterial(s, id, quantity * efficiency, quality * 0.6 + practiced * 0.4);
      for (const [id, quantity] of Object.entries(recipe.byproducts ?? {})) addMaterial(s, id, quantity, quality);
      if (!s.knownRecipes.includes(recipe.id)) {
        s.knownRecipes.push(recipe.id);
        events.push({ type: 'recipe-learned', location: s.position, locationId: s.id, actors: [s.id],
          causes: ['craft-experimentation', ...recipe.requiredKnowledge.map(k => k.id)],
          context: { recipe: recipe.id, inputs: Object.keys(inputs).join(', '), unlocks: recipe.unlocks?.join(', ') ?? '' },
          outcome: `Local materials and repeated trials made ${recipe.name.toLowerCase()} reproducible.`,
          significance: 0.6, tags: ['resource', 'craft', 'recipe'], summary: `${s.name} learns ${recipe.name.toLowerCase()}.` });
      }
    }
  }
  return events;
}
