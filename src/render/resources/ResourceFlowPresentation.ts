import type { Settlement, WorldState } from '../../sim/types';
import { MATERIAL_RECIPES } from '../../sim/resources/MaterialEconomy';
import { RECIPE_CATALOG } from '../../sim/resources/catalog';
import { resourceProcessingForWorld } from '../../sim/resources/ResourceWorkAssignments';
import { isMinedMaterial, mineralVisualProfile } from './MineralPresentation';

export const MAX_STORED_MATERIALS = 8;
export const MAX_PROCESSING_STATIONS = 3;

/** Canonical stock, never gross extraction or the legacy inventory alias. */
export function resourceStoragePresentation(settlement: Settlement) {
  return Object.entries(settlement.localMaterials)
    .filter(([, amount]) => Number.isFinite(amount) && amount > 0.001)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_STORED_MATERIALS)
    .map(([id, amount]) => ({ id, pieces: Math.min(6, Math.ceil(Math.log2(1 + amount))), amount }));
}

/** Idle workshops survive via known recipes/history; heat needs current paid processing. */
export function resourceProcessingPresentation(world: WorldState, settlement: Settlement, month: number) {
  const recorded = resourceProcessingForWorld(world, settlement.id, month);
  const flow = settlement.materials?.lastFlow;
  const active = new Set([...recorded.keys(), ...Object.entries(flow?.month === month ? flow.recipes : {})
    .filter(([, count]) => (count ?? 0) > 0).map(([id]) => id)]);
  const known = new Set([...settlement.knownRecipes, ...active]);
  for (const recipe of MATERIAL_RECIPES) {
    if (Object.keys(recipe.outputs).some(id => (settlement.materials?.lifetimeProduced[id as keyof NonNullable<Settlement['materials']>['lifetimeProduced']] ?? 0) > 0)) known.add(recipe.id);
  }
  return [...known].sort((a, b) => Number(active.has(b)) - Number(active.has(a)) || a.localeCompare(b))
    .flatMap(id => {
      const modern = RECIPE_CATALOG.find(r => r.id === id);
      const typed = MATERIAL_RECIPES.find(r => r.id === id);
      if (!modern && !typed) return [];
      const inputs = modern?.inputs ?? typed!.inputs;
      const hot = Boolean(modern?.energy) || /smelt|steel|fire|charcoal|bronze/.test(id);
      return [{ id, active: active.has(id), hot, inputs: Object.keys(inputs), textile: /textile/.test(id) }];
    }).slice(0, MAX_PROCESSING_STATIONS);
}

export function storedMaterialColour(id: string): string {
  if (isMinedMaterial(id)) return mineralVisualProfile(id).baseColour;
  if (/copper|bronze/.test(id)) return '#bd8753';
  if (/iron|steel|tin/.test(id)) return '#a2adb1';
  if (/coal|charcoal/.test(id)) return '#383833';
  if (/uranium/.test(id)) return '#9ba868';
  if (/clay|brick/.test(id)) return '#b47958';
  if (/timber|lumber/.test(id)) return '#bd9669';
  if (/flora|herb|medicine/.test(id)) return '#819e68';
  if (/fiber|textile/.test(id)) return '#c5b77c';
  return '#a19b89';
}
