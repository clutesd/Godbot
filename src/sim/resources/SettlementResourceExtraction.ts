import { practical } from '../knowledge/KnowledgeSystem';
import type { Person, Settlement, SimulationState, WorldCell } from '../types';
import { cellAt } from '../world';
import {
  ensureMaterialInventory,
  recordMaterialExtraction,
  type RawMaterialKind,
} from './MaterialEconomy';
import {
  extractDeposit,
  harvestRenewable,
  regenerateRenewables,
  type DepositResourceKind,
  type RenewableResourceKind,
} from './WorldResources';

const CATCHMENT_RADIUS_CELLS = 2;
const BASE_DEPOSITS: readonly DepositResourceKind[] = ['stone', 'clay'];
const METAL_DEPOSITS: readonly DepositResourceKind[] = ['copper-ore', 'tin-ore', 'iron-ore'];
const SUPPLEMENTAL_RENEWABLES = ['medicinal-flora', 'plant-fiber'] as const;
type SupplementalRenewable = typeof SUPPLEMENTAL_RENEWABLES[number];

export interface SettlementExtractionResult {
  authoritative: boolean;
  requestedWood: number;
  harvestedWood: number;
  requestedMinerals: number;
  extractedMinerals: number;
  deposits: Partial<Record<DepositResourceKind, number>>;
  renewables: Partial<Record<SupplementalRenewable, number>>;
}

const distanceScore = (cell: WorldCell, home: WorldCell): number =>
  Math.hypot(cell.x - home.x, cell.z - home.z);

/**
 * The local economic catchment around a settlement. It is intentionally small: geography is
 * binding without pretending that a settlement can freely exploit an entire world.
 */
export function settlementResourceCatchment(state: SimulationState, settlement: Settlement): WorldCell[] {
  const home = state.world.cells[settlement.cellIndex];
  if (!home) return [];
  const cells: WorldCell[] = [];
  const seen = new Set<number>();
  for (let dz = -CATCHMENT_RADIUS_CELLS; dz <= CATCHMENT_RADIUS_CELLS; dz += 1) {
    for (let dx = -CATCHMENT_RADIUS_CELLS; dx <= CATCHMENT_RADIUS_CELLS; dx += 1) {
      if (dx * dx + dz * dz > CATCHMENT_RADIUS_CELLS * CATCHMENT_RADIUS_CELLS) continue;
      const cell = cellAt(state.world, home.worldX + dx * state.world.cellSize, home.worldZ + dz * state.world.cellSize);
      if (!cell || cell.water) continue;
      const index = cell.z * state.world.size + cell.x;
      if (seen.has(index)) continue;
      seen.add(index);
      cells.push(cell);
    }
  }
  return cells.sort((a, b) => distanceScore(a, home) - distanceScore(b, home));
}

function advanceRenewablesToMonth(cell: WorldCell, month: number): void {
  const resources = cell.naturalResources;
  if (!resources) return;
  const previous = resources.lastRegeneratedMonth ?? 0;
  if (month <= previous) return;
  regenerateRenewables(cell, (month - previous) / 12);
  resources.lastRegeneratedMonth = month;
}

function eligibleDeposits(settlement: Settlement): DepositResourceKind[] {
  const kinds: DepositResourceKind[] = [...BASE_DEPOSITS];
  if (practical(settlement, 'metal-smelting') > 0.12 || practical(settlement, 'iron-working') > 0.12) {
    kinds.push(...METAL_DEPOSITS);
  }
  if (practical(settlement, 'mechanical-power') > 0.12 || practical(settlement, 'industrial-chemistry') > 0.12) {
    kinds.push('coal');
  }
  if (practical(settlement, 'nuclear-fission') > 0.12 || practical(settlement, 'nuclear-energy') > 0.12) {
    kinds.push('uranium-ore');
  }
  return kinds;
}

function harvestRenewableAcross(cells: readonly WorldCell[], kind: RenewableResourceKind, requested: number): number {
  if (requested <= 0) return 0;
  const ranked = cells
    .map((cell, distance) => {
      const resource = cell.naturalResources?.renewables[kind];
      const stockShare = resource && resource.capacity > 0 ? resource.stock / resource.capacity : 0;
      return { cell, score: (resource?.accessibility ?? 0) * (0.4 + stockShare * 0.6) / (1 + distance * 0.08) };
    })
    .sort((a, b) => b.score - a.score);
  let remaining = requested;
  let harvested = 0;
  for (const candidate of ranked) {
    if (remaining <= 1e-9) break;
    const amount = harvestRenewable(candidate.cell, kind, remaining);
    harvested += amount;
    remaining -= amount;
  }
  return harvested;
}

function extractMinerals(
  settlement: Settlement,
  cells: readonly WorldCell[],
  requested: number,
): { total: number; deposits: Partial<Record<DepositResourceKind, number>> } {
  const extracted: Partial<Record<DepositResourceKind, number>> = {};
  if (requested <= 0) return { total: 0, deposits: extracted };
  const kinds = eligibleDeposits(settlement);
  const candidates: Array<{ cell: WorldCell; kind: DepositResourceKind; score: number }> = [];
  for (let distance = 0; distance < cells.length; distance += 1) {
    const cell = cells[distance];
    if (!cell) continue;
    for (const kind of kinds) {
      const deposit = cell.naturalResources?.deposits[kind];
      if (!deposit || deposit.reserve <= 0) continue;
      const score = deposit.accessibility * (0.55 + deposit.grade * 0.45) * (0.5 + Math.min(1, deposit.reserve / 120)) / (1 + distance * 0.06);
      candidates.push({ cell, kind, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  let remaining = requested;
  let total = 0;
  for (const candidate of candidates) {
    if (remaining <= 1e-9) break;
    const amount = extractDeposit(candidate.cell, candidate.kind, remaining);
    if (amount <= 0) continue;
    extracted[candidate.kind] = (extracted[candidate.kind] ?? 0) + amount;
    total += amount;
    remaining -= amount;
  }
  return { total, deposits: extracted };
}

function reconcilePositiveBalance(settlement: Settlement, key: 'wood' | 'minerals', actual: number): void {
  const requested = Math.max(0, settlement.monthlyBalance[key]);
  if (requested <= 0) return;
  const shortfall = Math.max(0, requested - actual);
  settlement.monthlyBalance[key] -= shortfall;
  settlement.resources[key] = Math.max(0, settlement.resources[key] - shortfall);
}

function requestedSupplementalRenewables(residents: readonly Person[]): Record<SupplementalRenewable, number> {
  const count = (occupation: Person['occupation']): number => residents.filter((person) => person.alive && person.occupation === occupation).length;
  const foragers = count('forager');
  const keepers = count('keeper');
  const builders = count('builder');
  return {
    'medicinal-flora': foragers * 0.018 + keepers * 0.006,
    'plant-fiber': foragers * 0.032 + builders * 0.01,
  };
}

function extractionSnapshotFromFlow(settlement: Settlement, month: number): SettlementExtractionResult | undefined {
  const inventory = settlement.materials;
  if (!inventory || inventory.lastExtractionMonth !== month || inventory.lastFlow?.month !== month) return undefined;
  const extracted = inventory.lastFlow.extracted;
  const deposits: Partial<Record<DepositResourceKind, number>> = {};
  for (const kind of [...BASE_DEPOSITS, ...METAL_DEPOSITS, 'coal', 'uranium-ore'] as const) {
    const amount = extracted[kind];
    if (amount !== undefined) deposits[kind] = amount;
  }
  return {
    authoritative: true,
    requestedWood: Math.max(0, settlement.monthlyBalance.wood),
    harvestedWood: extracted.timber ?? 0,
    requestedMinerals: Math.max(0, settlement.monthlyBalance.minerals),
    extractedMinerals: Object.values(deposits).reduce((sum, amount) => sum + (amount ?? 0), 0),
    deposits,
    renewables: {
      'medicinal-flora': extracted['medicinal-flora'] ?? 0,
      'plant-fiber': extracted['plant-fiber'] ?? 0,
    },
  };
}

/**
 * Converts legacy monthly wood/mineral production estimates into real extraction and writes exact
 * physical identities into the typed material ledger. Legacy aggregates remain the compatibility
 * demand/value layer until construction and trade migrate in Step 3.
 */
export function advanceSettlementResourceExtraction(
  state: SimulationState,
  settlement: Settlement,
  residents: readonly Person[] = [],
): SettlementExtractionResult {
  const requestedWood = Math.max(0, settlement.monthlyBalance.wood);
  const requestedMinerals = Math.max(0, settlement.monthlyBalance.minerals);
  const empty: SettlementExtractionResult = {
    authoritative: false,
    requestedWood,
    harvestedWood: requestedWood,
    requestedMinerals,
    extractedMinerals: requestedMinerals,
    deposits: {},
    renewables: {},
  };
  if (!settlement.alive) return empty;

  const cells = settlementResourceCatchment(state, settlement);
  const authoritative = cells.some((cell) => cell.naturalResources !== undefined);
  if (!authoritative) return empty;

  const prior = extractionSnapshotFromFlow(settlement, state.month);
  if (prior) return prior;

  for (const cell of cells) advanceRenewablesToMonth(cell, state.month);

  const harvestedWood = harvestRenewableAcross(cells, 'timber', requestedWood);
  const mineralExtraction = extractMinerals(settlement, cells, requestedMinerals);
  const supplementalRequests = requestedSupplementalRenewables(residents);
  const renewables: Partial<Record<SupplementalRenewable, number>> = {};
  for (const kind of SUPPLEMENTAL_RENEWABLES) {
    const harvested = harvestRenewableAcross(cells, kind, supplementalRequests[kind]);
    if (harvested > 0) renewables[kind] = harvested;
  }

  reconcilePositiveBalance(settlement, 'wood', harvestedWood);
  reconcilePositiveBalance(settlement, 'minerals', mineralExtraction.total);

  const inventory = ensureMaterialInventory(settlement);
  if (harvestedWood > 0) recordMaterialExtraction(settlement, 'timber', harvestedWood, state.month);
  for (const [kind, amount] of Object.entries(mineralExtraction.deposits) as Array<[DepositResourceKind, number | undefined]>) {
    if (amount && amount > 0) recordMaterialExtraction(settlement, kind as RawMaterialKind, amount, state.month);
  }
  for (const kind of SUPPLEMENTAL_RENEWABLES) {
    const amount = renewables[kind] ?? 0;
    if (amount > 0) recordMaterialExtraction(settlement, kind, amount, state.month);
  }
  inventory.lastExtractionMonth = state.month;

  return {
    authoritative: true,
    requestedWood,
    harvestedWood,
    requestedMinerals,
    extractedMinerals: mineralExtraction.total,
    deposits: mineralExtraction.deposits,
    renewables,
  };
}
