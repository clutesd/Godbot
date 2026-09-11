import { fbm } from '../terrain/noise';
import type { WorldCell } from '../types';

export type RenewableResourceKind = 'timber' | 'medicinal-flora' | 'plant-fiber';
export type DepositResourceKind = 'stone' | 'clay' | 'copper-ore' | 'tin-ore' | 'iron-ore' | 'coal' | 'uranium-ore';
export type NaturalResourceKind = RenewableResourceKind | DepositResourceKind;

export interface RenewableResourceState {
  /** Current harvestable stock in simulation resource units. */
  stock: number;
  /** Ecological carrying capacity under the cell's present terrain/climate. */
  capacity: number;
  /** Fraction of carrying capacity restored per simulated year before pressure/damage. */
  regenerationPerYear: number;
  /** 0..1 ease of reaching and harvesting the resource. */
  accessibility: number;
}

export interface DepositResourceState {
  /** Remaining finite reserve in simulation resource units. */
  reserve: number;
  /** Original reserve, retained so depletion remains measurable and inspectable. */
  initialReserve: number;
  /** 0..1 useful material concentration/quality. */
  grade: number;
  /** 0..1 ease of extraction from terrain and overburden. */
  accessibility: number;
}

export interface CellResourceState {
  renewables: Record<RenewableResourceKind, RenewableResourceState>;
  deposits: Partial<Record<DepositResourceKind, DepositResourceState>>;
  /** Incremented by extraction/regeneration so observers can cheaply detect change. */
  revision: number;
}

declare module '../types' {
  interface WorldCell {
    /**
     * Authoritative physical resource stocks. Legacy `wood` and `minerals` remain broad
     * compatibility signals while the economy migrates onto these explicit stocks.
     */
    naturalResources?: CellResourceState;
  }
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const round = (value: number): number => Math.round(Math.max(0, value) * 1000) / 1000;

function terrainAccessibility(cell: WorldCell): number {
  return clamp01(0.92 - cell.slope * 0.62 - cell.relief * 0.7 - Math.max(0, cell.movementCost - 1) * 0.08);
}

function geology(seed: string, kind: DepositResourceKind, cell: WorldCell, scale: number, xOffset: number, zOffset: number): number {
  return fbm(`${seed}:resource:${kind}`, cell.x * scale + xOffset, cell.z * scale + zOffset, 4);
}

function deposit(
  score: number,
  threshold: number,
  reserveScale: number,
  grade: number,
  accessibility: number,
  abundance: number,
): DepositResourceState | undefined {
  if (score <= threshold) return undefined;
  const richness = clamp01((score - threshold) / Math.max(0.01, 1 - threshold));
  const reserve = round((18 + richness * reserveScale) * abundance * (0.72 + grade * 0.56));
  if (reserve <= 0) return undefined;
  return {
    reserve,
    initialReserve: reserve,
    grade: round(clamp01(grade)),
    accessibility: round(clamp01(accessibility)),
  };
}

/**
 * Builds the physical endowment of one simulation cell from terrain and seeded geology.
 * Resource identity is therefore spatial, deterministic and independent of historical time.
 */
export function createCellResourceState(seed: string, cell: WorldCell, resourceAbundance = 1): CellResourceState {
  const abundance = Math.max(0.1, resourceAbundance);
  const access = terrainAccessibility(cell);
  if (cell.water) {
    const empty = (): RenewableResourceState => ({ stock: 0, capacity: 0, regenerationPerYear: 0, accessibility: 0 });
    return { renewables: { timber: empty(), 'medicinal-flora': empty(), 'plant-fiber': empty() }, deposits: {}, revision: 0 };
  }

  const timberCapacity = round((90 + cell.wood * 1800) * abundance * (0.72 + cell.moisture * 0.42));
  const timberStock = round(timberCapacity * clamp01(0.56 + cell.wood * 0.42));
  const medicinalHabitat = clamp01(cell.fertility * 0.46 + cell.moisture * 0.34 + cell.temperature * 0.2 - cell.rockiness * 0.16);
  const medicinalCapacity = round(280 * medicinalHabitat * abundance);
  const fiberHabitat = clamp01(cell.fertility * 0.5 + cell.moisture * 0.25 + (1 - cell.slope) * 0.25);
  const fiberCapacity = round(360 * fiberHabitat * abundance);

  const stoneScore = clamp01(cell.rockiness * 0.62 + cell.relief * 0.52 + cell.elevation * 0.22 + geology(seed, 'stone', cell, 0.18, 7, -13) * 0.18);
  const clayScore = clamp01(cell.moisture * 0.3 + (cell.river || cell.lake ? 0.34 : 0) + (1 - cell.slope) * 0.2 + geology(seed, 'clay', cell, 0.24, -19, 31) * 0.28);
  const copperScore = clamp01(cell.rockiness * 0.2 + cell.elevation * 0.12 + geology(seed, 'copper-ore', cell, 0.15, 43, -11) * 0.78);
  const tinScore = clamp01(cell.rockiness * 0.24 + cell.elevation * 0.16 + geology(seed, 'tin-ore', cell, 0.12, -37, 17) * 0.72);
  const ironScore = clamp01(cell.rockiness * 0.24 + cell.elevation * 0.18 + geology(seed, 'iron-ore', cell, 0.14, 13, 59) * 0.76);
  const coalScore = clamp01((1 - cell.elevation) * 0.16 + (cell.landform === 'basin' || cell.landform === 'lowland' ? 0.14 : 0) + geology(seed, 'coal', cell, 0.1, 71, -47) * 0.78);
  const uraniumScore = clamp01(cell.rockiness * 0.28 + cell.elevation * 0.24 + geology(seed, 'uranium-ore', cell, 0.085, -83, 29) * 0.68);

  const deposits: CellResourceState['deposits'] = {};
  const assign = (kind: DepositResourceKind, state: DepositResourceState | undefined): void => { if (state) deposits[kind] = state; };
  assign('stone', deposit(stoneScore, 0.16, 1250, 0.38 + cell.rockiness * 0.5, access, abundance));
  assign('clay', deposit(clayScore, 0.28, 720, 0.42 + cell.moisture * 0.38, clamp01(access + 0.08), abundance));
  assign('copper-ore', deposit(copperScore, 0.56, 520, copperScore, access, abundance));
  assign('tin-ore', deposit(tinScore, 0.62, 380, tinScore, access, abundance));
  assign('iron-ore', deposit(ironScore, 0.53, 760, ironScore, access, abundance));
  assign('coal', deposit(coalScore, 0.6, 980, coalScore, clamp01(access * 0.88), abundance));
  assign('uranium-ore', deposit(uraniumScore, 0.72, 220, uraniumScore, clamp01(access * 0.72), abundance));

  return {
    renewables: {
      timber: {
        stock: timberStock,
        capacity: timberCapacity,
        regenerationPerYear: round(0.018 + cell.moisture * 0.032 + cell.temperature * 0.018),
        accessibility: round(access),
      },
      'medicinal-flora': {
        stock: round(medicinalCapacity * clamp01(0.5 + medicinalHabitat * 0.42)),
        capacity: medicinalCapacity,
        regenerationPerYear: round(0.12 + cell.moisture * 0.08),
        accessibility: round(clamp01(access + (cell.landform === 'lowland' ? 0.08 : 0))),
      },
      'plant-fiber': {
        stock: round(fiberCapacity * clamp01(0.55 + fiberHabitat * 0.4)),
        capacity: fiberCapacity,
        regenerationPerYear: round(0.18 + cell.fertility * 0.08),
        accessibility: round(clamp01(access + 0.06)),
      },
    },
    deposits,
    revision: 0,
  };
}

export function harvestRenewable(cell: WorldCell, kind: RenewableResourceKind, requested: number): number {
  const state = cell.naturalResources?.renewables[kind];
  if (!state || requested <= 0 || state.stock <= 0) return 0;
  const accessibleStock = state.stock * Math.max(0.08, state.accessibility);
  const harvested = Math.min(requested, accessibleStock, state.stock);
  state.stock = round(state.stock - harvested);
  if (harvested > 0 && cell.naturalResources) cell.naturalResources.revision += 1;
  return harvested;
}

export function extractDeposit(cell: WorldCell, kind: DepositResourceKind, requested: number): number {
  const state = cell.naturalResources?.deposits[kind];
  if (!state || requested <= 0 || state.reserve <= 0) return 0;
  const accessibleReserve = state.reserve * Math.max(0.05, state.accessibility) * (0.55 + state.grade * 0.45);
  const extracted = Math.min(requested, accessibleReserve, state.reserve);
  state.reserve = round(state.reserve - extracted);
  if (extracted > 0 && cell.naturalResources) cell.naturalResources.revision += 1;
  return extracted;
}

/** Advances renewable ecology without recreating any finite geological reserve. */
export function regenerateRenewables(cell: WorldCell, years = 1): void {
  const resources = cell.naturalResources;
  if (!resources || years <= 0) return;
  let changed = false;
  for (const renewable of Object.values(resources.renewables)) {
    if (renewable.capacity <= 0 || renewable.stock >= renewable.capacity) continue;
    const stockShare = clamp01(renewable.stock / renewable.capacity);
    const recovery = renewable.capacity * renewable.regenerationPerYear * years * (0.35 + stockShare * 0.65);
    const next = round(Math.min(renewable.capacity, renewable.stock + recovery));
    changed ||= next !== renewable.stock;
    renewable.stock = next;
  }
  if (changed) resources.revision += 1;
}

export function remainingDepositShare(cell: WorldCell, kind: DepositResourceKind): number {
  const state = cell.naturalResources?.deposits[kind];
  if (!state || state.initialReserve <= 0) return 0;
  return clamp01(state.reserve / state.initialReserve);
}
