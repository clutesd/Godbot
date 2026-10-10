import type { DevelopmentProject, StructureForm, StructureMaterial } from '../development/types';
import type { Occupation, Vec2 } from '../types';
import type { FreightVehicle } from '../transport/types';

/**
 * Facility families share one authority. A family is data: an ordered ladder of tiers, each naming
 * the *existing* recipes (resource catalog or typed material economy) it can physically run.
 * Textiles, chemicals, electrical equipment and strategic processing are still reserved ids so a
 * later pass only adds a family definition, never a new architecture.
 */
export type FacilityFamilyId =
  | 'wood' | 'metallurgy'
  | 'ceramics' | 'textiles' | 'machinery' | 'chemicals' | 'electrical-equipment' | 'strategic';

/** `catalog` = RECIPE_CATALOG (resource system); `material` = MATERIAL_RECIPES (typed economy). */
export interface RecipeRef { source: 'catalog' | 'material'; id: string }
export const recipeKey = (ref: RecipeRef): string => `${ref.source}:${ref.id}`;

export type FacilityStatus =
  | 'under-construction' | 'upgrading' | 'active' | 'idle'
  | 'starved' | 'unpowered' | 'unstaffed' | 'blocked' | 'inaccessible' | 'damaged' | 'ruined';

/** The single strongest thing holding last month's throughput below nominal capacity. */
export type FacilityLimiter =
  | 'none' | 'capacity' | 'labour' | 'inputs' | 'fuel' | 'power' | 'output-space' | 'access' | 'knowledge' | 'condition' | 'demand';

export interface FacilityCostLine {
  /** Acceptable physical materials in preference order; the first option is the demand signal. */
  options: readonly string[];
  amount: number;
}
export interface FacilityBill { lines: readonly FacilityCostLine[]; work: number }

export interface FacilityPowerSpec {
  /** `either` runs from a shaft (waterwheel/steam) until a grid node serves the plot, then electricity. */
  mode: 'none' | 'mechanical' | 'electric' | 'either';
  /** Normalized energy per month at full capacity. */
  demand: number;
  /** Share of nominal throughput achievable by hand/animal work with no power at all. */
  fallback: number;
  /** Below this coverage the plant is reported as unpowered. */
  minimumCoverage: number;
}

export interface FacilityHeatSpec {
  /** Coolest fuel (see MATERIAL_CATALOG.fuelHeat) this furnace can be brought to temperature with. */
  minimum: number;
  /** Fuel burned to bring a cold furnace up to working temperature. */
  warmup: number;
}

export interface FacilityKnowledgeNeed { id: string; minPractice: number }

export interface FacilityTierSpec {
  tier: number;
  /** Stable kind id for the tier (`saw-pit`, `sawmill`, ...). */
  kind: string;
  name: string;
  form: StructureForm;
  material: StructureMaterial;
  /** Recipe work units per month at full staffing, power, heat and condition. */
  capacity: number;
  /** Worker-months per month required at full capacity. */
  workers: number;
  occupations: readonly Occupation[];
  /** Capacity of each of the input and output yards. */
  yard: number;
  knowledge: readonly FacilityKnowledgeNeed[];
  power: FacilityPowerSpec;
  heat?: FacilityHeatSpec;
  /** Additive efficiency gained by catalog recipes because of better equipment. */
  yieldBonus: number;
  recipes: readonly RecipeRef[];
  /** Cost of erecting this tier from nothing (tier 1) or upgrading from the previous tier. */
  build: FacilityBill;
  /** Monthly upkeep to hold machinery condition; paid through the same construction path. */
  maintenance: FacilityBill;
  /** Manufacturing service the finished works contributes to settlement development. */
  service: number;
}

export interface FacilityFamilySpec {
  id: FacilityFamilyId;
  name: string;
  description: string;
  tiers: readonly FacilityTierSpec[];
  /** Raw and intermediate materials whose availability justifies founding the family. */
  triggerMaterials: readonly string[];
}

export type FacilityStock = Record<string, number>;

export interface FacilityShipment {
  direction: 'in' | 'out';
  material: string;
  quantity: number;
  quality: number;
  remainingMonths: number;
}

export interface FacilityProcessState {
  key: string;
  status: 'running' | 'starved' | 'blocked' | 'idle' | 'locked';
  /** Batches/cycles actually completed in the most recent month. */
  batches: number;
  work: number;
  lifetimeBatches: number;
  lastRunMonth?: number;
  blocker?: string;
}

export interface FacilityPowerState {
  carrier: 'none' | 'mechanical' | 'electric';
  /** Demand submitted to the energy dispatch for the current month. */
  demand: number;
  supplied: number;
  coverage: number;
}

export interface FacilityAccessState {
  ok: boolean;
  mode: 'walk' | 'road' | 'rail' | 'water';
  cost: number;
  months: number;
  vehicle: FreightVehicle;
  /** Units one worker-month of hauling moves over this route with this vehicle. */
  unitsPerWorkerMonth: number;
  /** Road project registered so the works is reachable by something better than a path. */
  projectId?: string;
}

export interface FacilityLabourState {
  required: number;
  available: number;
  used: number;
  haul: number;
  byOccupation: Partial<Record<Occupation, number>>;
}

export interface FacilityTotals {
  dispatchedIn: Record<string, number>;
  arrived: Record<string, number>;
  consumed: Record<string, number>;
  produced: Record<string, number>;
  dispatchedOut: Record<string, number>;
  deliveredOut: Record<string, number>;
  /** Only stock a full destination refused; conserved by returning it to the output yard. */
  returned: Record<string, number>;
  /** Perishables that rotted on a yard; the only sink besides consumption and shipping. */
  spoiled: Record<string, number>;
}

export interface FacilityHistoryEntry {
  month: number;
  action: 'founded' | 'completed' | 'upgrade-started' | 'upgraded' | 'migrated' | 'damaged' | 'abandoned';
  tier: number;
  detail?: string;
}

export interface FacilityUpgrade {
  toTier: number;
  progress: number;
  startedMonth: number;
  spent: Record<string, number>;
  labourSpent: number;
}

export interface ProcessingFacility {
  /** Paid construction/upgrade receipt shared with the human construction presentation. */
  constructionWork?: DevelopmentProject;
  id: string;
  settlementId: string;
  family: FacilityFamilyId;
  /** Built tier. During an upgrade this is still the operating (old) tier. */
  tier: number;
  kind: string;
  plotId: string;
  position: Vec2;
  foundedMonth: number;
  /** 0..1 initial erection; production requires 1. */
  progress: number;
  upgrade?: FacilityUpgrade;
  /** Machinery condition. Structural damage lives on the plot and combines by weakest link. */
  condition: number;
  status: FacilityStatus;
  limiter: FacilityLimiter;
  /** Human-readable reasons throughput was reduced last month, strongest first. */
  blockers: string[];
  inputs: FacilityStock;
  outputs: FacilityStock;
  quality: Record<string, number>;
  transit: FacilityShipment[];
  processes: Record<string, FacilityProcessState>;
  /** 0..1 furnace temperature; cold furnaces burn warm-up fuel before working. */
  heat: number;
  power: FacilityPowerState;
  access: FacilityAccessState;
  /** Road built so this works is reachable by better than a path (owned by the transport system). */
  roadProjectId?: string;
  labour: FacilityLabourState;
  /** Material moved between the store and the yards last month, in units. */
  freight: { inbound: number; outbound: number };
  /** 0..1 fraction of nominal work delivered last month. */
  throughput: number;
  /** 0..1 fraction of nominal work the facility tried to do before power/labour/heat cut it. */
  load: number;
  saturationMonths: number;
  spent: Record<string, number>;
  labourSpent: number;
  totals: FacilityTotals;
  history: FacilityHistoryEntry[];
  lastActiveMonth?: number;
  lastMonth?: number;
}

export interface SettlementProcessing {
  /** Facility authority owns the settlement's wood/metal transformations when true. */
  governed: boolean;
  facilities: ProcessingFacility[];
  /** Most recent reason a family could not be founded (no site, labour, materials ...). */
  foundingBlockers: Partial<Record<FacilityFamilyId, string>>;
  nextFacilityIndex: number;
}

export interface ProcessingAuthority {
  version: 1;
  enrolledMonth: number;
  milestones: string[];
}

declare module '../types' {
  interface Settlement { processing?: SettlementProcessing }
  interface SimulationState { processing?: ProcessingAuthority }
}

declare module '../development/types' {
  interface DevelopmentResponse {
    /** Set on structures that are the physical body of a ProcessingFacility. */
    facilityId?: string;
    facilityFamily?: FacilityFamilyId;
    facilityTier?: number;
  }
}
