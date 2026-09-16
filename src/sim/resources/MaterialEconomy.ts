import { resourceLabourBudget } from '../people/HumanCapital';
import { useLabour } from './Processing';
import { capabilityPractice, type KnowledgeUseRequirement } from '../knowledge/CapabilityContract';
import type { Person, Settlement, SimulationState } from '../types';
import { addMaterial, publishBulkStocks, takeMaterial } from './Inventory';

export const RAW_MATERIAL_KINDS = [
  'timber',
  'medicinal-flora',
  'plant-fiber',
  'stone',
  'clay',
  'copper-ore',
  'tin-ore',
  'iron-ore',
  'coal',
  'uranium-ore',
] as const;

export const PROCESSED_MATERIAL_KINDS = [
  'lumber',
  'charcoal',
  'brick',
  'copper',
  'tin',
  'bronze',
  'iron',
  'steel',
  'medicine',
  'textile',
] as const;

export type RawMaterialKind = typeof RAW_MATERIAL_KINDS[number];
export type ProcessedMaterialKind = typeof PROCESSED_MATERIAL_KINDS[number];
export type MaterialKind = RawMaterialKind | ProcessedMaterialKind;
export type MaterialStock = Record<MaterialKind, number>;

export const MATERIAL_KINDS = [...RAW_MATERIAL_KINDS, ...PROCESSED_MATERIAL_KINDS] as const;

/**
 * Material kinds that existed only in the old typed economy. When loading a Step-1B-era save that
 * already has canonical ResourceSystem stock, these may be migrated safely. Timber, stone, ores,
 * charcoal and bronze are deliberately excluded because both old and modern systems could have
 * produced them and merging would double-count physical stock.
 */
export const LEGACY_ONLY_MATERIAL_KINDS: readonly MaterialKind[] = [
  'medicinal-flora', 'plant-fiber', 'clay', 'coal', 'uranium-ore',
  'lumber', 'brick', 'copper', 'tin', 'iron', 'steel', 'medicine', 'textile',
] as const;

export interface MaterialFlowSnapshot {
  month: number;
  extracted: Partial<Record<RawMaterialKind, number>>;
  consumed: Partial<Record<MaterialKind, number>>;
  produced: Partial<Record<ProcessedMaterialKind, number>>;
  recipes: Partial<Record<string, number>>;
}

export interface MaterialInventoryState {
  /**
   * Compatibility alias only. After ensureMaterialInventory() this is the same object as
   * Settlement.localMaterials, never an independently mutable physical ledger.
   */
  stock: MaterialStock;
  revision: number;
  lastExtractionMonth?: number;
  lastProcessedMonth?: number;
  lastFlow?: MaterialFlowSnapshot;
  lifetimeExtracted: Partial<Record<RawMaterialKind, number>>;
  lifetimeConsumed: Partial<Record<MaterialKind, number>>;
  lifetimeProduced: Partial<Record<ProcessedMaterialKind, number>>;
}

declare module '../types' {
  interface Settlement {
    /**
     * Typed material telemetry and a compatibility stock alias. Physical quantity is owned solely
     * by localMaterials/Inventory.ts; `materials.stock` is normalized to that same object.
     */
    materials?: MaterialInventoryState;
  }
}

export interface MaterialKnowledgeRequirement {
  id: string;
  stage: KnowledgeUseRequirement;
  minPractice: number;
}

export interface MaterialRecipe {
  id: string;
  inputs: Partial<Record<MaterialKind, number>>;
  outputs: Partial<Record<ProcessedMaterialKind, number>>;
  knowledge: readonly MaterialKnowledgeRequirement[];
  /** Abstract specialist effort consumed per batch. */
  work: number;
  /** Maximum share of the primary input converted in one month. */
  maxInputShare: number;
}

const recipe = (
  id: string,
  inputs: MaterialRecipe['inputs'],
  outputs: MaterialRecipe['outputs'],
  knowledge: MaterialRecipe['knowledge'],
  work: number,
  maxInputShare = 0.25,
): MaterialRecipe => ({ id, inputs, outputs, knowledge, work, maxInputShare });

/**
 * Advanced production not yet represented by the newer ResourceSystem recipe catalog. Charcoal
 * and bronze are intentionally absent because the modern recipe system already owns them. Tin ore
 * likewise stays with canonical bronze casting rather than being refined into an unused dead-end.
 */
export const MATERIAL_RECIPES: readonly MaterialRecipe[] = [
  recipe('saw-lumber', { timber: 1 }, { lumber: 0.84 }, [
    { id: 'stone-composites', stage: 'adopted', minPractice: 0.18 },
  ], 0.3, 0.22),
  recipe('fire-brick', { clay: 1, timber: 0.22 }, { brick: 0.88 }, [
    { id: 'pottery-firing', stage: 'adopted', minPractice: 0.28 },
  ], 0.48, 0.28),
  recipe('smelt-copper', { 'copper-ore': 1, charcoal: 0.32 }, { copper: 0.68 }, [
    { id: 'metal-smelting', stage: 'adopted', minPractice: 0.3 },
  ], 0.62, 0.32),
  recipe('smelt-iron', { 'iron-ore': 1, charcoal: 0.55 }, { iron: 0.56 }, [
    { id: 'iron-working', stage: 'adopted', minPractice: 0.34 },
    { id: 'high-temperature-ceramics', stage: 'adopted', minPractice: 0.28 },
  ], 0.82, 0.32),
  recipe('make-steel', { iron: 1, coal: 0.2 }, { steel: 0.9 }, [
    { id: 'iron-working', stage: 'adopted', minPractice: 0.45 },
    { id: 'industrial-chemistry', stage: 'transformed', minPractice: 0.45 },
  ], 1.05, 0.4),
  recipe('prepare-medicine', { 'medicinal-flora': 1 }, { medicine: 0.65 }, [
    { id: 'anatomical-observation', stage: 'adopted', minPractice: 0.18 },
    { id: 'fire-control', stage: 'adopted', minPractice: 0.18 },
  ], 0.34, 0.24),
  recipe('work-textile', { 'plant-fiber': 1 }, { textile: 0.8 }, [
    { id: 'stone-composites', stage: 'adopted', minPractice: 0.18 },
  ], 0.28, 0.24),
] as const;

const EPSILON = 1e-9;

export function emptyMaterialStock(): MaterialStock {
  return Object.fromEntries(MATERIAL_KINDS.map((kind) => [kind, 0])) as MaterialStock;
}

function round(value: number): number {
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
}

/**
 * Normalizes old saves and the old API without preserving a second stock authority. If the
 * canonical inventory is empty we can safely migrate the complete historical typed stock. If the
 * modern inventory already contains physical stock, only legacy-only kinds are migrated to avoid
 * duplicating timber/stone/ore/charcoal/bronze that may have been produced by both systems.
 */
function attachCanonicalStock(settlement: Settlement, inventory: MaterialInventoryState): void {
  const canonical = settlement.localMaterials;
  const legacy = inventory.stock;
  let migrated = false;
  if (legacy !== canonical) {
    const canonicalHasPhysicalStock = Object.values(canonical).some((amount) => Number.isFinite(amount) && amount > EPSILON);
    const migrate = canonicalHasPhysicalStock ? LEGACY_ONLY_MATERIAL_KINDS : MATERIAL_KINDS;
    for (const kind of migrate) {
      const amount = Math.max(0, legacy?.[kind] ?? 0);
      if (amount <= EPSILON) continue;
      canonical[kind] = round((canonical[kind] ?? 0) + amount);
      migrated = true;
    }
  }
  for (const kind of MATERIAL_KINDS) canonical[kind] = round(canonical[kind] ?? 0);
  inventory.stock = canonical as MaterialStock;
  if (migrated) publishBulkStocks(settlement);
}

export function ensureMaterialInventory(settlement: Settlement): MaterialInventoryState {
  if (settlement.materials) {
    attachCanonicalStock(settlement, settlement.materials);
    return settlement.materials;
  }
  settlement.materials = {
    stock: settlement.localMaterials as MaterialStock,
    revision: 0,
    lifetimeExtracted: {},
    lifetimeConsumed: {},
    lifetimeProduced: {},
  };
  attachCanonicalStock(settlement, settlement.materials);
  return settlement.materials;
}

function flowForMonth(inventory: MaterialInventoryState, month: number): MaterialFlowSnapshot {
  if (inventory.lastFlow?.month === month) return inventory.lastFlow;
  inventory.lastFlow = { month, extracted: {}, consumed: {}, produced: {}, recipes: {} };
  return inventory.lastFlow;
}

/** Canonical typed-material availability view. */
export function materialAmount(settlement: Settlement, kind: MaterialKind): number {
  return Math.max(0, settlement.localMaterials[kind] ?? 0);
}

/**
 * Records supplemental extraction into the one physical inventory. Storage limits are respected;
 * telemetry records only material that was actually accepted into settlement storage.
 */
export function recordMaterialExtraction(
  settlement: Settlement,
  kind: RawMaterialKind,
  amount: number,
  month: number,
): number {
  if (!Number.isFinite(amount) || amount <= EPSILON) return 0;
  const inventory = ensureMaterialInventory(settlement);
  const accepted = round(addMaterial(settlement, kind, amount));
  if (accepted <= EPSILON) return 0;
  inventory.lifetimeExtracted[kind] = round((inventory.lifetimeExtracted[kind] ?? 0) + accepted);
  const flow = flowForMonth(inventory, month);
  flow.extracted[kind] = round((flow.extracted[kind] ?? 0) + accepted);
  inventory.revision += 1;
  return accepted;
}

function recipeEnabled(settlement: Settlement, recipeDefinition: MaterialRecipe): boolean {
  return recipeDefinition.knowledge.every((requirement) =>
    capabilityPractice(settlement, requirement.id, requirement.stage) >= requirement.minPractice);
}

function maxBatchesFromInputs(settlement: Settlement, recipeDefinition: MaterialRecipe): number {
  let possible = Number.POSITIVE_INFINITY;
  let primaryKind: MaterialKind | undefined;
  let primaryAmount = 0;
  for (const [kind, amount] of Object.entries(recipeDefinition.inputs) as Array<[MaterialKind, number | undefined]>) {
    if (!amount || amount <= 0) continue;
    primaryKind ??= kind;
    primaryAmount ||= amount;
    possible = Math.min(possible, materialAmount(settlement, kind) / amount);
  }
  if (!Number.isFinite(possible) || !primaryKind || primaryAmount <= 0) return 0;
  const shareLimit = materialAmount(settlement, primaryKind) * recipeDefinition.maxInputShare / primaryAmount;
  return Math.max(0, Math.min(possible, shareLimit));
}

function applyRecipe(
  settlement: Settlement,
  inventory: MaterialInventoryState,
  recipeDefinition: MaterialRecipe,
  batches: number,
  month: number,
): void {
  if (batches <= EPSILON) return;
  const flow = flowForMonth(inventory, month);
  for (const [kind, perBatch] of Object.entries(recipeDefinition.inputs) as Array<[MaterialKind, number | undefined]>) {
    if (!perBatch || perBatch <= 0) continue;
    const requested = round(perBatch * batches);
    const consumed = round(takeMaterial(settlement, kind, requested));
    if (consumed + 1e-6 < requested) throw new Error(`material processing conservation violation: ${recipeDefinition.id}:${kind}`);
    inventory.lifetimeConsumed[kind] = round((inventory.lifetimeConsumed[kind] ?? 0) + consumed);
    flow.consumed[kind] = round((flow.consumed[kind] ?? 0) + consumed);
  }
  for (const [kind, perBatch] of Object.entries(recipeDefinition.outputs) as Array<[ProcessedMaterialKind, number | undefined]>) {
    if (!perBatch || perBatch <= 0) continue;
    const produced = round(addMaterial(settlement, kind, round(perBatch * batches)));
    inventory.lifetimeProduced[kind] = round((inventory.lifetimeProduced[kind] ?? 0) + produced);
    flow.produced[kind] = round((flow.produced[kind] ?? 0) + produced);
  }
  flow.recipes[recipeDefinition.id] = round((flow.recipes[recipeDefinition.id] ?? 0) + batches);
  inventory.revision += 1;
}

export interface MaterialProcessingResult {
  processed: boolean;
  capacity: number;
  usedCapacity: number;
  recipes: Partial<Record<string, number>>;
}

/**
 * Runs at most once per settlement/month. It is deterministic, uses the shared resource labour
 * budget, and reads/writes only canonical physical stock. These recipes cover advanced products
 * that the newer generic ResourceSystem does not yet manufacture.
 */
export function advanceMaterialProcessing(
  state: SimulationState,
  settlement: Settlement,
  residents: readonly Person[],
): MaterialProcessingResult {
  const inventory = ensureMaterialInventory(settlement);
  if (!settlement.alive || inventory.lastProcessedMonth === state.month) {
    return { processed: false, capacity: 0, usedCapacity: 0, recipes: {} };
  }
  inventory.lastProcessedMonth = state.month;
  const budget = resourceLabourBudget(state, settlement, residents);
  const mechanization = 1 + settlement.infrastructure.workshops + settlement.infrastructure.factories * 2 + settlement.industry.intensity;
  const capacity = ((budget.artisan ?? 0) + (budget.builder ?? 0)) * mechanization;
  let remainingCapacity = capacity;
  const ran: Partial<Record<string, number>> = {};

  for (const recipeDefinition of MATERIAL_RECIPES) {
    if (remainingCapacity <= EPSILON || !recipeEnabled(settlement, recipeDefinition)) continue;
    const protectedLimit = Math.min(...Object.entries(recipeDefinition.inputs).map(([id, amount]) => Math.max(0,
      (settlement.localMaterials[id] ?? 0) - (settlement.survival?.establishment?.materialDemand[id] ?? 0)) / amount!));
    const inputBatches = Math.min(maxBatchesFromInputs(settlement, recipeDefinition), protectedLimit);
    const capacityBatches = remainingCapacity / recipeDefinition.work;
    const batches = round(Math.min(inputBatches, capacityBatches));
    if (batches <= EPSILON) continue;
    applyRecipe(settlement, inventory, recipeDefinition, batches, state.month);
    remainingCapacity = Math.max(0, remainingCapacity - batches * recipeDefinition.work);
    ran[recipeDefinition.id] = batches;
  }

  useLabour(budget, ['artisan', 'builder'], (capacity - remainingCapacity) / mechanization);
  return {
    processed: Object.keys(ran).length > 0,
    capacity: round(capacity),
    usedCapacity: round(capacity - remainingCapacity),
    recipes: ran,
  };
}

/** Static safety audit for CI and future recipe additions. */
export function validateMaterialRecipes(recipes: readonly MaterialRecipe[] = MATERIAL_RECIPES): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const graph = new Map<MaterialKind, Set<MaterialKind>>();

  for (const item of recipes) {
    if (ids.has(item.id)) errors.push(`duplicate recipe id: ${item.id}`);
    ids.add(item.id);
    const inputs = Object.entries(item.inputs).filter(([, amount]) => (amount ?? 0) > 0) as Array<[MaterialKind, number]>;
    const outputs = Object.entries(item.outputs).filter(([, amount]) => (amount ?? 0) > 0) as Array<[ProcessedMaterialKind, number]>;
    if (inputs.length === 0) errors.push(`${item.id}: no positive inputs`);
    if (outputs.length === 0) errors.push(`${item.id}: no positive outputs`);
    if (!(item.work > 0)) errors.push(`${item.id}: work must be positive`);
    if (!(item.maxInputShare > 0 && item.maxInputShare <= 1)) errors.push(`${item.id}: maxInputShare must be in (0,1]`);
    const inputMass = inputs.reduce((sum, [, amount]) => sum + amount, 0);
    const outputMass = outputs.reduce((sum, [, amount]) => sum + amount, 0);
    if (outputMass > inputMass + EPSILON) errors.push(`${item.id}: outputs exceed inputs`);
    for (const [input] of inputs) {
      const edges = graph.get(input) ?? new Set<MaterialKind>();
      for (const [output] of outputs) edges.add(output);
      graph.set(input, edges);
    }
  }

  const visiting = new Set<MaterialKind>();
  const visited = new Set<MaterialKind>();
  const visit = (node: MaterialKind): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of graph.get(node) ?? []) if (visit(next)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  if (MATERIAL_KINDS.some((kind) => visit(kind))) errors.push('material recipe graph contains a cycle');
  return errors;
}
