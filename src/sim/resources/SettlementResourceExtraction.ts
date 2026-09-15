import { resourceLabourBudget, settlementLabour } from '../people/HumanCapital';
import { useLabour } from './Processing';
import { practical } from '../knowledge/KnowledgeSystem';
import type { Person, Settlement, SimulationState, WorldCell } from '../types';
import { cellAt } from '../world';
import {
  advanceMaterialProcessing,
  ensureMaterialInventory,
  recordMaterialExtraction,
  type RawMaterialKind,
} from './MaterialEconomy';
import { recordResourceWorkAssignment } from './ResourceWorkAssignments';
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

interface ExtractionSite {
  cell: WorldCell;
  amount: number;
}

interface DepositExtractionSite extends ExtractionSite {
  kind: DepositResourceKind;
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

function harvestRenewableAcross(
  cells: readonly WorldCell[],
  kind: RenewableResourceKind,
  requested: number,
): { total: number; sites: ExtractionSite[] } {
  if (requested <= 0) return { total: 0, sites: [] };
  const ranked = cells
    .map((cell, distance) => {
      const resource = cell.naturalResources?.renewables[kind];
      const stockShare = resource && resource.capacity > 0 ? resource.stock / resource.capacity : 0;
      return { cell, score: (resource?.accessibility ?? 0) * (0.4 + stockShare * 0.6) / (1 + distance * 0.08) };
    })
    .sort((a, b) => b.score - a.score);
  let remaining = requested;
  let total = 0;
  const sites: ExtractionSite[] = [];
  for (const candidate of ranked) {
    if (remaining <= 1e-9) break;
    const amount = harvestRenewable(candidate.cell, kind, remaining);
    if (amount <= 0) continue;
    total += amount;
    remaining -= amount;
    sites.push({ cell: candidate.cell, amount });
  }
  return { total, sites };
}

function extractMinerals(
  settlement: Settlement,
  cells: readonly WorldCell[],
  requested: number,
): { total: number; deposits: Partial<Record<DepositResourceKind, number>>; sites: DepositExtractionSite[] } {
  const extracted: Partial<Record<DepositResourceKind, number>> = {};
  const sites: DepositExtractionSite[] = [];
  if (requested <= 0) return { total: 0, deposits: extracted, sites };
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
    sites.push({ cell: candidate.cell, kind: candidate.kind, amount });
    total += amount;
    remaining -= amount;
  }
  return { total, deposits: extracted, sites };
}

function recordWorldWorkSites(
  state: SimulationState,
  settlement: Settlement,
  resourceId: RawMaterialKind,
  sites: readonly ExtractionSite[],
  gatherOccupations: readonly Person['occupation'][],
  labourUsed: number,
): void {
  const total = sites.reduce((sum, site) => sum + site.amount, 0);
  if (total <= 0 || labourUsed <= 0) return;
  for (const site of sites) {
    const cellIndex = site.cell.z * state.world.size + site.cell.x;
    recordResourceWorkAssignment(state, {
      month: state.month,
      source: 'world-resource',
      settlementId: settlement.id,
      siteId: `cell:${cellIndex}:${resourceId}`,
      cellIndex,
      resourceId,
      worldPosition: { x: site.cell.worldX, z: site.cell.worldZ },
      gatherOccupations,
      amountExtracted: site.amount,
      labourUsed: labourUsed * site.amount / total,
    });
  }
}

function reconcilePositiveBalance(settlement: Settlement, key: 'wood' | 'minerals', actual: number): void {
  const requested = Math.max(0, settlement.monthlyBalance[key]);
  if (requested <= 0) return;
  const shortfall = Math.max(0, requested - actual);
  settlement.monthlyBalance[key] -= shortfall;
  settlement.resources[key] = Math.max(0, settlement.resources[key] - shortfall);
}

function requestedSupplementalRenewables(workers: Partial<Record<Person['occupation'], number>>): Record<SupplementalRenewable, number> {
  const count = (occupation: Person['occupation']): number => workers[occupation] ?? 0;
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
 * Converts legacy monthly wood/mineral production estimates into real extraction, writes exact
 * physical identities into the typed material ledger, then gives local specialists one bounded
 * processing pass. Legacy aggregates remain the compatibility demand/value layer until Step 3.
 */
export function advanceSettlementResourceExtraction(
  state: SimulationState,
  settlement: Settlement,
  residents?: readonly Person[],
): SettlementExtractionResult {
  const localResidents = residents ?? state.people.filter((person) => person.alive && person.homeId === settlement.id);
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
  if (!authoritative) {
    if (settlement.materials) advanceMaterialProcessing(state, settlement, localResidents);
    return empty;
  }

  const prior = extractionSnapshotFromFlow(settlement, state.month);
  if (prior) {
    advanceMaterialProcessing(state, settlement, localResidents);
    return prior;
  }

  for (const cell of cells) advanceRenewablesToMonth(cell, state.month);

  const budget = resourceLabourBudget(state, settlement, localResidents);
  const timberCapacity = (budget.forager ?? 0) + (budget.builder ?? 0);
  const timberHarvest = harvestRenewableAcross(cells, 'timber', Math.min(requestedWood, timberCapacity));
  const harvestedWood = timberHarvest.total;
  const timberLabourUsed = useLabour(budget, ['forager', 'builder'], harvestedWood);
  recordWorldWorkSites(state, settlement, 'timber', timberHarvest.sites, ['forager', 'builder'], timberLabourUsed);

  const mineralCapacity = (budget.artisan ?? 0) + (budget.builder ?? 0);
  const mineralExtraction = extractMinerals(settlement, cells, Math.min(requestedMinerals, mineralCapacity));
  const mineralLabourUsed = useLabour(budget, ['artisan', 'builder'], mineralExtraction.total);
  const mineralTotal = mineralExtraction.sites.reduce((sum, site) => sum + site.amount, 0);
  if (mineralTotal > 0 && mineralLabourUsed > 0) {
    for (const site of mineralExtraction.sites) {
      recordWorldWorkSites(
        state,
        settlement,
        site.kind,
        [site],
        ['artisan', 'builder'],
        mineralLabourUsed * site.amount / mineralTotal,
      );
    }
  }

  const supplementalRequests = requestedSupplementalRenewables(settlementLabour(state, settlement, localResidents).effective);
  const renewables: Partial<Record<SupplementalRenewable, number>> = {};
  for (const kind of SUPPLEMENTAL_RENEWABLES) {
    const harvest = harvestRenewableAcross(cells, kind, Math.min(supplementalRequests[kind], (budget.forager ?? 0) + (budget.keeper ?? 0)));
    const harvested = harvest.total;
    const supplementalLabourUsed = useLabour(budget, ['forager', 'keeper'], harvested);
    recordWorldWorkSites(state, settlement, kind, harvest.sites, ['forager', 'keeper'], supplementalLabourUsed);
    if (harvested > 0) renewables[kind] = harvested;
  }

  reconcilePositiveBalance(settlement, 'wood', harvestedWood);
  reconcilePositiveBalance(settlement, 'minerals', mineralExtraction.total);

  const extractedAny = harvestedWood > 0 || mineralExtraction.total > 0
    || Object.values(renewables).some((amount) => (amount ?? 0) > 0);
  if (!settlement.materials && !extractedAny) {
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
  advanceMaterialProcessing(state, settlement, localResidents);

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