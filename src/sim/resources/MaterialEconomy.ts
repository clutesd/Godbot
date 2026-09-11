import { capabilityPractice, type KnowledgeUseRequirement } from '../knowledge/CapabilityContract';
import type { Person, Settlement, SimulationState } from '../types';

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

export interface MaterialFlowSnapshot {
  month: number;
  extracted: Partial<Record<RawMaterialKind, number>>;
  consumed: Partial<Record<MaterialKind, number>>;
  produced: Partial<Record<ProcessedMaterialKind, number>>;
  recipes: Partial<Record<string, number>>;
}

export interface MaterialInventoryState {
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
     * Typed physical material ledger. Legacy `resources.wood/minerals/goods` remain compatibility
     * aggregates until construction/trade are migrated to specific materials in Step 3.
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
 * First production graph. Ordering is deliberately dependency-safe so products made earlier in a
 * month may feed a later recipe, while monthly share/capacity limits prevent instant stock churn.
 */
export const MATERIAL_RECIPES: readonly MaterialRecipe[] = [
  recipe('saw-lumber', { timber: 1 }, { lumber: 0.84 }, [
    { id: 'stone-composites', stage: 'adopted', minPractice: 0.18 },
  ], 0.3, 0.22),
  recipe('burn-charcoal', { timber: 1 }, { charcoal: 0.6 }, [
    { id: 'fire-control', stage: 'adopted', minPractice: 0.18 },
  ], 0.24, 0.18),
  recipe('fire-brick', { clay: 1, timber: 0.22 }, { brick: 0.88 }, [
    { id: 'pottery-firing', stage: 'adopted', minPractice: 0.28 },
  ], 0.48, 0.28),
  recipe('smelt-copper', { 'copper-ore': 1, charcoal: 0.32 }, { copper: 0.68 }, [
    { id: 'metal-smelting', stage: 'adopted', minPractice: 0.3 },
  ], 0.62, 0.32),
  recipe('smelt-tin', { 'tin-ore': 1, charcoal: 0.28 }, { tin: 0.66 }, [
    { id: 'metal-smelting', stage: 'adopted', minPractice: 0.3 },
  ], 0.58, 0.3),
  recipe('alloy-bronze', { copper: 0.88, tin: 0.12 }, { bronze: 0.9 }, [
    { id: 'metal-smelting', stage: 'adopted', minPractice: 0.34 },
    { id: 'material-testing', stage: 'adopted', minPractice: 0.18 },
  ], 0.48, 0.35),
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

const ALL_MATERIALS = [...RAW_MATERIAL_KINDS, ...PROCESSED_MATERIAL_KINDS] as const;
const EPSILON = 1e-9;

export function emptyMaterialStock(): MaterialStock {
  return Object.fromEntries(ALL_MATERIALS.map((kind) => [kind, 0])) as MaterialStock;
}

export function ensureMaterialInventory(settlement: Settlement): MaterialInventoryState {
  if (settlement.materials) return settlement.materials;
  settlement.materials = {
    stock: emptyMaterialStock(),
    revision: 0,
    lifetimeExtracted: {},
    lifetimeConsumed: {},
    lifetimeProduced: {},
  };
  return settlement.materials;
}

function flowForMonth(inventory: MaterialInventoryState, month: number): MaterialFlowSnapshot {
  if (inventory.lastFlow?.month === month) return inventory.lastFlow;
  inventory.lastFlow = { month, extracted: {}, consumed: {}, produced: {}, recipes: {} };
  return inventory.lastFlow;
}

function round(value: number): number {
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
}

export function materialAmount(settlement: Settlement, kind: MaterialKind): number {
  return settlement.materials?.stock[kind] ?? 0;
}

export function recordMaterialExtraction(
  settlement: Settlement,
  kind: RawMaterialKind,
  amount: number,
  month: number,
): void {
  if (!Number.isFinite(amount) || amount <= EPSILON) return;
  const inventory = ensureMaterialInventory(settlement);
  const value = round(amount);
  inventory.stock[kind] = round(inventory.stock[kind] + value);
  inventory.lifetimeExtracted[kind] = round((inventory.lifetimeExtracted[kind] ?? 0) + value);
  const flow = flowForMonth(inventory, month);
  flow.extracted[kind] = round((flow.extracted[kind] ?? 0) + value);
  inventory.revision += 1;
}

function recipeEnabled(settlement: Settlement, recipeDefinition: MaterialRecipe): boolean {
  return recipeDefinition.knowledge.every((requirement) =>
    capabilityPractice(settlement, requirement.id, requirement.stage) >= requirement.minPractice);
}

function processingCapacity(settlement: Settlement, residents: readonly Person[]): number {
  const artisans = residents.filter((person) => person.alive && person.occupation === 'artisan').length;
  const builders = residents.filter((person) => person.alive && person.occupation === 'builder').length;
  return Math.max(0,
    artisans * 0.62
    + builders * 0.08
    + settlement.infrastructure.workshops * 5
    + settlement.infrastructure.factories * 12
    + settlement.industry.intensity * 8);
}

function maxBatchesFromInputs(stock: MaterialStock, recipeDefinition: MaterialRecipe): number {
  let possible = Number.POSITIVE_INFINITY;
  let primaryKind: MaterialKind | undefined;
  let primaryAmount = 0;
  for (const [kind, amount] of Object.entries(recipeDefinition.inputs) as Array<[MaterialKind, number | undefined]>) {
    if (!amount || amount <= 0) continue;
    primaryKind ??= kind;
    primaryAmount ||= amount;
    possible = Math.min(possible, stock[kind] / amount);
  }
  if (!Number.isFinite(possible) || !primaryKind || primaryAmount <= 0) return 0;
  const shareLimit = stock[primaryKind] * recipeDefinition.maxInputShare / primaryAmount;
  return Math.max(0, Math.min(possible, shareLimit));
}

function applyRecipe(
  inventory: MaterialInventoryState,
  recipeDefinition: MaterialRecipe,
  batches: number,
  month: number,
): void {
  if (batches <= EPSILON) return;
  const flow = flowForMonth(inventory, month);
  for (const [kind, perBatch] of Object.entries(recipeDefinition.inputs) as Array<[MaterialKind, number | undefined]>) {
    if (!perBatch || perBatch <= 0) continue;
    const amount = round(perBatch * batches);
    inventory.stock[kind] = round(Math.max(0, inventory.stock[kind] - amount));
    inventory.lifetimeConsumed[kind] = round((inventory.lifetimeConsumed[kind] ?? 0) + amount);
    flow.consumed[kind] = round((flow.consumed[kind] ?? 0) + amount);
  }
  for (const [kind, perBatch] of Object.entries(recipeDefinition.outputs) as Array<[ProcessedMaterialKind, number | undefined]>) {
    if (!perBatch || perBatch <= 0) continue;
    const amount = round(perBatch * batches);
    inventory.stock[kind] = round(inventory.stock[kind] + amount);
    inventory.lifetimeProduced[kind] = round((inventory.lifetimeProduced[kind] ?? 0) + amount);
    flow.produced[kind] = round((flow.produced[kind] ?? 0) + amount);
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
 * Runs at most once per settlement/month. It is deterministic, bounded by specialist capacity,
 * cannot drive inventory negative, and only deploys knowledge at the explicitly required stage.
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
  const capacity = processingCapacity(settlement, residents);
  let remainingCapacity = capacity;
  const ran: Partial<Record<string, number>> = {};

  for (const recipeDefinition of MATERIAL_RECIPES) {
    if (remainingCapacity <= EPSILON || !recipeEnabled(settlement, recipeDefinition)) continue;
    const inputBatches = maxBatchesFromInputs(inventory.stock, recipeDefinition);
    const capacityBatches = remainingCapacity / recipeDefinition.work;
    const batches = round(Math.min(inputBatches, capacityBatches));
    if (batches <= EPSILON) continue;
    applyRecipe(inventory, recipeDefinition, batches, state.month);
    remainingCapacity = Math.max(0, remainingCapacity - batches * recipeDefinition.work);
    ran[recipeDefinition.id] = batches;
  }

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
  if (ALL_MATERIALS.some((kind) => visit(kind))) errors.push('material recipe graph contains a cycle');
  return errors;
}
