import { resourceLabourBudget, settlementLabour } from '../people/HumanCapital';
import { useLabourDetailed, type LabourUse } from './Processing';
import { practical } from '../knowledge/KnowledgeSystem';
import type { Person, Settlement, SimulationState, WorldCell } from '../types';
import { cellAt } from '../world';
import {
  advanceMaterialProcessing,
  ensureMaterialInventory,
  materialAmount,
  recordMaterialExtraction,
  type RawMaterialKind,
} from './MaterialEconomy';
import { storageRoom } from './Inventory';
import { recordResourceWorkAssignment } from './ResourceWorkAssignments';
import {
  extractDeposit,
  harvestRenewable,
  regenerateRenewables,
  type DepositResourceKind,
  type RenewableResourceKind,
} from './WorldResources';

const CATCHMENT_RADIUS_CELLS = 2;
/**
 * These resources are not yet represented by the newer generic ResourceSystem catalog. Timber,
 * stone and metal ores are intentionally absent: ResourceSystem is their sole extraction authority.
 */
const SUPPLEMENTAL_DEPOSITS = ['clay', 'coal', 'uranium-ore'] as const satisfies readonly DepositResourceKind[];
const SUPPLEMENTAL_RENEWABLES = ['medicinal-flora', 'plant-fiber'] as const;
type SupplementalDeposit = typeof SUPPLEMENTAL_DEPOSITS[number];
type SupplementalRenewable = typeof SUPPLEMENTAL_RENEWABLES[number];

export interface SettlementExtractionResult {
  /** True when a physical legacy-only resource catchment exists and was evaluated. */
  authoritative: boolean;
  /** Compatibility diagnostics only; timber is extracted exclusively by ResourceSystem. */
  requestedWood: number;
  harvestedWood: number;
  requestedMinerals: number;
  /** Supplemental clay/coal/uranium extracted this pass; excludes stone and metal ores. */
  extractedMinerals: number;
  deposits: Partial<Record<DepositResourceKind, number>>;
  renewables: Partial<Record<SupplementalRenewable, number>>;
}

interface ExtractionSite {
  cell: WorldCell;
  amount: number;
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

function eligibleSupplementalDeposits(settlement: Settlement): SupplementalDeposit[] {
  const kinds: SupplementalDeposit[] = ['clay'];
  if (practical(settlement, 'mechanical-power') > 0.12 || practical(settlement, 'industrial-chemistry') > 0.12) kinds.push('coal');
  if (practical(settlement, 'nuclear-fission') > 0.12 || practical(settlement, 'nuclear-energy') > 0.12) kinds.push('uranium-ore');
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

function extractDepositAcross(
  cells: readonly WorldCell[],
  kind: SupplementalDeposit,
  requested: number,
): { total: number; sites: ExtractionSite[] } {
  if (requested <= 0) return { total: 0, sites: [] };
  const ranked = cells
    .map((cell, distance) => {
      const deposit = cell.naturalResources?.deposits[kind];
      const score = deposit
        ? deposit.accessibility * (0.55 + deposit.grade * 0.45) * (0.5 + Math.min(1, deposit.reserve / 120)) / (1 + distance * 0.06)
        : 0;
      return { cell, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  let remaining = requested;
  let total = 0;
  const sites: ExtractionSite[] = [];
  for (const candidate of ranked) {
    if (remaining <= 1e-9) break;
    const amount = extractDeposit(candidate.cell, kind, remaining);
    if (amount <= 0) continue;
    total += amount;
    remaining -= amount;
    sites.push({ cell: candidate.cell, amount });
  }
  return { total, sites };
}

function scaleLabour(use: LabourUse, share: number): LabourUse {
  const byOccupation: LabourUse['byOccupation'] = {};
  for (const [occupation, amount] of Object.entries(use.byOccupation) as Array<[Person['occupation'], number | undefined]>) {
    if (amount && amount > 0) byOccupation[occupation] = amount * share;
  }
  return { total: use.total * share, byOccupation };
}

function recordWorldWorkSites(
  state: SimulationState,
  settlement: Settlement,
  resourceId: RawMaterialKind,
  sites: readonly ExtractionSite[],
  gatherOccupations: readonly Person['occupation'][],
  labourUse: LabourUse,
): void {
  const total = sites.reduce((sum, site) => sum + site.amount, 0);
  if (total <= 0 || labourUse.total <= 0) return;
  for (const site of sites) {
    const cellIndex = site.cell.z * state.world.size + site.cell.x;
    const siteLabour = scaleLabour(labourUse, site.amount / total);
    recordResourceWorkAssignment(state, {
      month: state.month,
      source: 'world-resource',
      settlementId: settlement.id,
      siteId: `cell:${cellIndex}:${resourceId}`,
      cellIndex,
      resourceId,
      worldPosition: { x: site.cell.worldX, z: site.cell.worldZ },
      gatherOccupations,
      labourByOccupation: siteLabour.byOccupation,
      amountExtracted: site.amount,
      labourUsed: siteLabour.total,
    });
  }
}

function requestedSupplementalRenewables(
  settlement: Settlement,
  workers: Partial<Record<Person['occupation'], number>>,
): Record<SupplementalRenewable, number> {
  const count = (occupation: Person['occupation']): number => workers[occupation] ?? 0;
  const foragers = count('forager');
  const keepers = count('keeper');
  const builders = count('builder');
  const medicinalTarget = 4 + keepers * 0.12 + foragers * 0.04;
  const fiberTarget = 6 + builders * 0.12 + foragers * 0.06;
  return {
    'medicinal-flora': Math.min(foragers * 0.018 + keepers * 0.006, Math.max(0, medicinalTarget - materialAmount(settlement, 'medicinal-flora'))),
    'plant-fiber': Math.min(foragers * 0.032 + builders * 0.01, Math.max(0, fiberTarget - materialAmount(settlement, 'plant-fiber'))),
  };
}

function requestedSupplementalDeposit(settlement: Settlement, kind: SupplementalDeposit): number {
  const operatingDemand = settlement.materialUse?.materials[kind]?.demand ?? 0;
  const baseTarget = kind === 'clay'
    ? 4 + settlement.infrastructure.workshops * 8 + settlement.infrastructure.factories * 2
    : kind === 'coal'
      ? 4 + settlement.industry.intensity * 12 + settlement.infrastructure.factories * 6
      : 1 + settlement.infrastructure.power * 2;
  const target = Math.max(baseTarget, operatingDemand * 6);
  return Math.max(0, target - materialAmount(settlement, kind));
}

function extractionSnapshotFromFlow(settlement: Settlement, month: number): SettlementExtractionResult | undefined {
  const inventory = settlement.materials;
  if (!inventory || inventory.lastExtractionMonth !== month || inventory.lastFlow?.month !== month) return undefined;
  const extracted = inventory.lastFlow.extracted;
  const deposits: Partial<Record<DepositResourceKind, number>> = {};
  for (const kind of SUPPLEMENTAL_DEPOSITS) {
    const amount = extracted[kind];
    if (amount !== undefined) deposits[kind] = amount;
  }
  return {
    authoritative: true,
    requestedWood: Math.max(0, settlement.monthlyBalance.wood),
    harvestedWood: 0,
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
 * Supplemental extraction for material kinds the generic ResourceSystem does not yet model.
 * ResourceSystem alone owns timber, stone and metal-ore extraction. This pass therefore cannot
 * double-deplete those deposits or spend labour on a second version of the same gathering work.
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
    harvestedWood: 0,
    requestedMinerals,
    extractedMinerals: 0,
    deposits: {},
    renewables: {},
  };
  if (!settlement.alive) return empty;

  const cells = settlementResourceCatchment(state, settlement);
  const authoritative = cells.some((cell) => cell.naturalResources !== undefined);
  if (!authoritative) {
    if (settlement.materials || Object.keys(settlement.localMaterials).length > 0) {
      advanceMaterialProcessing(state, settlement, localResidents);
    }
    return empty;
  }

  const inventory = ensureMaterialInventory(settlement);
  const prior = extractionSnapshotFromFlow(settlement, state.month);
  if (prior) {
    advanceMaterialProcessing(state, settlement, localResidents);
    return prior;
  }

  for (const cell of cells) advanceRenewablesToMonth(cell, state.month);

  const budget = resourceLabourBudget(state, settlement, localResidents);
  const renewables: Partial<Record<SupplementalRenewable, number>> = {};
  const renewableRequests = requestedSupplementalRenewables(
    settlement,
    settlementLabour(state, settlement, localResidents).effective,
  );
  for (const kind of SUPPLEMENTAL_RENEWABLES) {
    const capacity = (budget.forager ?? 0) + (budget.keeper ?? 0);
    const requested = Math.min(renewableRequests[kind], capacity, storageRoom(settlement));
    const harvest = harvestRenewableAcross(cells, kind, requested);
    const harvested = harvest.total;
    const supplementalLabour = useLabourDetailed(budget, ['forager', 'keeper'], harvested);
    recordWorldWorkSites(state, settlement, kind, harvest.sites, ['forager', 'keeper'], supplementalLabour);
    const accepted = recordMaterialExtraction(settlement, kind, harvested, state.month);
    if (accepted > 0) renewables[kind] = accepted;
  }

  const deposits: Partial<Record<DepositResourceKind, number>> = {};
  let extractedMinerals = 0;
  for (const kind of eligibleSupplementalDeposits(settlement)) {
    const capacity = (budget.artisan ?? 0) + (budget.builder ?? 0);
    const requested = Math.min(requestedSupplementalDeposit(settlement, kind), capacity, storageRoom(settlement));
    const extraction = extractDepositAcross(cells, kind, requested);
    const labour = useLabourDetailed(budget, ['artisan', 'builder'], extraction.total);
    recordWorldWorkSites(state, settlement, kind, extraction.sites, ['artisan', 'builder'], labour);
    const accepted = recordMaterialExtraction(settlement, kind, extraction.total, state.month);
    if (accepted <= 0) continue;
    deposits[kind] = accepted;
    extractedMinerals += accepted;
  }

  inventory.lastExtractionMonth = state.month;
  advanceMaterialProcessing(state, settlement, localResidents);

  return {
    authoritative: true,
    requestedWood,
    harvestedWood: 0,
    requestedMinerals,
    extractedMinerals,
    deposits,
    renewables,
  };
}
