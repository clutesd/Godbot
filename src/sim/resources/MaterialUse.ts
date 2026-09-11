import { capabilityPractice } from '../knowledge/CapabilityContract';
import type { Person, Settlement, SimulationState } from '../types';
import type { DevelopmentProject, DevelopmentResponse } from '../development/types';
import {
  ensureMaterialInventory,
  type MaterialFlowSnapshot,
  type MaterialKind,
} from './MaterialEconomy';

export type MaterialUseDomain = 'infrastructure' | 'industry' | 'healthcare' | 'military';

export interface FlexibleMaterialRequirement {
  id: string;
  amount: number;
  options: readonly MaterialKind[];
  reason: string;
}

export interface MaterialPressureState {
  demand: number;
  supplied: number;
  unmet: number;
  coverage: number;
  pressure: number;
}

export interface MaterialUseState {
  month: number;
  domains: Record<MaterialUseDomain, MaterialPressureState>;
  materials: Partial<Record<MaterialKind, MaterialPressureState>>;
  criticalInputs: MaterialKind[];
  readiness: Record<MaterialUseDomain, number>;
}

declare module '../types' {
  interface Settlement {
    /** Current operating material sufficiency, derived from real typed stocks each month. */
    materialUse?: MaterialUseState;
    /** 0..1 aggregate physical-input shortage signal for future trade/migration/politics systems. */
    resourceScarcityPressure?: number;
  }
}

declare module '../development/types' {
  interface DevelopmentProject {
    /** Frozen physical bill of materials selected when the project begins. */
    materialRequirements?: FlexibleMaterialRequirement[];
    /** Exact materials consumed by this project over its lifetime. */
    materialSpent?: Partial<Record<MaterialKind, number>>;
  }
}

const EPSILON = 1e-9;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const round = (value: number): number => Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
const zeroPressure = (): MaterialPressureState => ({ demand: 0, supplied: 0, unmet: 0, coverage: 1, pressure: 0 });

function flowForMonth(settlement: Settlement, month: number): MaterialFlowSnapshot {
  const inventory = ensureMaterialInventory(settlement);
  if (inventory.lastFlow?.month === month) return inventory.lastFlow;
  inventory.lastFlow = { month, extracted: {}, consumed: {}, produced: {}, recipes: {} };
  return inventory.lastFlow;
}

/** Single conservation-safe path for non-recipe material consumption. */
export function consumeMaterial(settlement: Settlement, kind: MaterialKind, requested: number, month: number): number {
  if (!Number.isFinite(requested) || requested <= EPSILON) return 0;
  const inventory = ensureMaterialInventory(settlement);
  const supplied = round(Math.min(requested, inventory.stock[kind]));
  if (supplied <= EPSILON) return 0;
  inventory.stock[kind] = round(inventory.stock[kind] - supplied);
  inventory.lifetimeConsumed[kind] = round((inventory.lifetimeConsumed[kind] ?? 0) + supplied);
  const flow = flowForMonth(settlement, month);
  flow.consumed[kind] = round((flow.consumed[kind] ?? 0) + supplied);
  inventory.revision += 1;
  return supplied;
}

export function hasMaterialAuthority(settlement: Settlement): boolean {
  return settlement.materials !== undefined;
}

function formScale(response: DevelopmentResponse): number {
  const form = response.form;
  const formFactor = form === 'dwelling' ? 0.85
    : form === 'marker' ? 0.55
      : form === 'gathering' ? 0.7
        : form === 'tower' || form === 'works' ? 1.35
          : form === 'workshop' ? 1.15
            : 1;
  return response.level * formFactor;
}

/**
 * Physical bill of materials for persistent structures. Generic wealth/goods/labor remain separate
 * compatibility costs; this bill is the authoritative physical fabric of the structure.
 */
export function structureMaterialRequirements(response: DevelopmentResponse): FlexibleMaterialRequirement[] {
  const scale = formScale(response);
  switch (response.material) {
    case 'earth':
      return [{ id: 'earth-frame', amount: round(0.7 * scale), options: ['timber', 'lumber'], reason: 'structural-frame' }];
    case 'timber':
      return [
        { id: 'timber-frame', amount: round(5.2 * scale), options: ['lumber', 'timber'], reason: 'structural-frame' },
        { id: 'binding', amount: round(0.18 * scale), options: ['textile', 'plant-fiber'], reason: 'binding-and-roofing' },
      ];
    case 'masonry':
      return [
        { id: 'masonry', amount: round(5.8 * scale), options: ['stone', 'brick'], reason: 'walls-and-foundations' },
        { id: 'masonry-frame', amount: round(1.25 * scale), options: ['lumber', 'timber'], reason: 'roof-and-scaffolding' },
      ];
    case 'ceramic':
      return [
        { id: 'fired-fabric', amount: round(4.8 * scale), options: ['brick'], reason: 'fired-structural-fabric' },
        { id: 'ceramic-frame', amount: round(1.05 * scale), options: ['lumber', 'timber'], reason: 'roof-and-frame' },
      ];
    case 'metal':
      return [
        { id: 'structural-metal', amount: round(4.2 * scale), options: ['steel', 'iron', 'bronze'], reason: 'load-bearing-metal' },
        { id: 'metal-foundation', amount: round(2.2 * scale), options: ['brick', 'stone'], reason: 'foundations' },
        { id: 'metal-frame', amount: round(0.9 * scale), options: ['lumber', 'timber'], reason: 'forms-and-interior-frame' },
      ];
  }
}

function availableForRequirement(settlement: Settlement, requirement: FlexibleMaterialRequirement): number {
  if (!settlement.materials) return Number.POSITIVE_INFINITY;
  return requirement.options.reduce((sum, kind) => sum + settlement.materials!.stock[kind], 0);
}

/** 0..1 fraction of a bill that could be supplied right now. */
export function materialRequirementCoverage(settlement: Settlement, requirements: readonly FlexibleMaterialRequirement[]): number {
  if (!settlement.materials || requirements.length === 0) return 1;
  return clamp01(Math.min(...requirements.map((requirement) =>
    requirement.amount <= EPSILON ? 1 : availableForRequirement(settlement, requirement) / requirement.amount)));
}

/** Maximum additional project progress supportable by current physical stocks. */
export function maxMaterialProgressIncrement(settlement: Settlement, requirements: readonly FlexibleMaterialRequirement[]): number {
  if (!settlement.materials || requirements.length === 0) return 1;
  return Math.max(0, Math.min(...requirements.map((requirement) =>
    requirement.amount <= EPSILON ? 1 : availableForRequirement(settlement, requirement) / requirement.amount)));
}

function consumeFlexibleRequirement(
  settlement: Settlement,
  requirement: FlexibleMaterialRequirement,
  amount: number,
  month: number,
  spent?: Partial<Record<MaterialKind, number>>,
): number {
  let remaining = amount;
  let supplied = 0;
  for (const kind of requirement.options) {
    if (remaining <= EPSILON) break;
    const used = consumeMaterial(settlement, kind, remaining, month);
    if (used <= 0) continue;
    supplied += used;
    remaining -= used;
    if (spent) spent[kind] = round((spent[kind] ?? 0) + used);
  }
  return round(supplied);
}

/** Consume the project fabric corresponding exactly to an incremental progress fraction. */
export function consumeConstructionMaterials(
  settlement: Settlement,
  project: DevelopmentProject,
  progressDelta: number,
  month: number,
): void {
  const requirements = project.materialRequirements;
  if (!settlement.materials || !requirements || progressDelta <= EPSILON) return;
  project.materialSpent ??= {};
  for (const requirement of requirements) {
    const needed = requirement.amount * progressDelta;
    const supplied = consumeFlexibleRequirement(settlement, requirement, needed, month, project.materialSpent);
    if (supplied + 1e-6 < needed) throw new Error(`material conservation violation for ${project.plotId}:${requirement.id}`);
  }
}

interface DomainRequirement extends FlexibleMaterialRequirement {
  domain: MaterialUseDomain;
}

function activeHealthcareService(settlement: Settlement): number {
  return (settlement.structurePlots ?? []).reduce((sum, plot) => {
    if (plot.development?.status !== 'active' || plot.accessRestricted) return sum;
    return sum + (plot.development.services.healthcare ?? 0) * plot.condition;
  }, 0);
}

function operatingRequirements(settlement: Settlement, residents: readonly Person[]): DomainRequirement[] {
  const requirements: DomainRequirement[] = [];
  const add = (domain: MaterialUseDomain, id: string, amount: number, options: readonly MaterialKind[], reason: string): void => {
    if (amount > EPSILON) requirements.push({ domain, id, amount: round(amount), options, reason });
  };
  const infra = settlement.infrastructure;
  add('infrastructure', 'road-maintenance', infra.roads * 0.018, ['stone', 'brick'], 'road-maintenance');
  add('infrastructure', 'bridge-maintenance', infra.bridges * 0.024, ['lumber', 'stone', 'steel'], 'bridge-maintenance');
  add('infrastructure', 'port-maintenance', infra.ports * 0.032, ['lumber', 'timber'], 'port-maintenance');
  add('infrastructure', 'workshop-maintenance', infra.workshops * 0.025, ['lumber', 'brick', 'stone'], 'workshop-maintenance');
  add('infrastructure', 'rail-metal', infra.rail * 0.075, ['steel', 'iron'], 'rail-maintenance');
  add('infrastructure', 'rail-timber', infra.rail * 0.028, ['lumber', 'timber'], 'rail-ties-and-structures');
  add('infrastructure', 'power-metal', infra.power * 0.052, ['steel', 'iron', 'copper'], 'power-maintenance');
  add('infrastructure', 'factory-fabric', infra.factories * 0.058, ['steel', 'iron', 'brick'], 'factory-maintenance');

  const intensity = Math.max(0, settlement.industry.intensity);
  add('industry', 'industrial-fuel', intensity * 0.14, ['coal', 'charcoal', 'timber'], 'process-energy');
  add('industry', 'industrial-metal', intensity * 0.085, ['steel', 'iron', 'bronze'], 'machine-wear');

  const healthKnowledge = Math.max(
    capabilityPractice(settlement, 'anatomical-observation', 'adopted'),
    capabilityPractice(settlement, 'contagion-patterns', 'adopted'),
    capabilityPractice(settlement, 'modern-medicine', 'adopted'),
  );
  const healthcare = activeHealthcareService(settlement);
  if (healthKnowledge > 0.15 || healthcare > 0.2) {
    const averageHealth = residents.length > 0 ? residents.reduce((sum, person) => sum + person.health, 0) / residents.length : 1;
    add('healthcare', 'medicine-use', residents.length * 0.0014 * (0.55 + (1 - averageHealth) + settlement.pollution * 0.45 + healthcare * 0.08), ['medicine'], 'clinical-and-household-care');
  }

  const militaryActivity = Math.max(0, settlement.conflictPressure * 0.85 + settlement.politicalPower.military * 0.18 - 0.04);
  if (militaryActivity > 0) {
    add('military', 'military-metal', residents.length * 0.0015 * militaryActivity, ['steel', 'iron', 'bronze'], 'weapons-and-protection');
    add('military', 'military-textile', residents.length * 0.0008 * militaryActivity, ['textile', 'plant-fiber'], 'equipment-and-logistics');
    add('military', 'military-fuel', residents.length * 0.00065 * militaryActivity * Math.max(0.25, intensity + infra.power), ['coal', 'charcoal', 'timber'], 'military-energy-and-transport');
  }
  return requirements;
}

function pressure(demand: number, supplied: number): MaterialPressureState {
  if (demand <= EPSILON) return zeroPressure();
  const coverage = clamp01(supplied / demand);
  return { demand: round(demand), supplied: round(supplied), unmet: round(Math.max(0, demand - supplied)), coverage, pressure: clamp01(1 - coverage) };
}

function accumulateMaterialPressure(
  current: Partial<Record<MaterialKind, { demand: number; supplied: number }>>,
  requirement: DomainRequirement,
  allocations: Partial<Record<MaterialKind, number>>,
  unmet: number,
): void {
  for (const [kind, amount] of Object.entries(allocations) as Array<[MaterialKind, number | undefined]>) {
    if (!amount || amount <= 0) continue;
    const value = current[kind] ?? { demand: 0, supplied: 0 };
    value.demand += amount;
    value.supplied += amount;
    current[kind] = value;
  }
  if (unmet > EPSILON) {
    const preferred = requirement.options[0];
    if (!preferred) return;
    const value = current[preferred] ?? { demand: 0, supplied: 0 };
    value.demand += unmet;
    current[preferred] = value;
  }
}

/**
 * Monthly physical operating demand. It is intentionally conservative: construction remains a
 * separate bill, while these flows represent upkeep, process fuel, medicine and military stores.
 */
export function advanceSettlementMaterialUse(
  state: SimulationState,
  settlement: Settlement,
  residents: readonly Person[],
): MaterialUseState {
  if (settlement.materialUse?.month === state.month) return settlement.materialUse;
  if (!settlement.materials) {
    const legacy: MaterialUseState = {
      month: state.month,
      domains: { infrastructure: zeroPressure(), industry: zeroPressure(), healthcare: zeroPressure(), military: zeroPressure() },
      materials: {}, criticalInputs: [],
      readiness: { infrastructure: 1, industry: 1, healthcare: 1, military: 1 },
    };
    settlement.materialUse = legacy;
    settlement.resourceScarcityPressure = 0;
    return legacy;
  }

  const requirements = operatingRequirements(settlement, residents);
  const domainTotals: Record<MaterialUseDomain, { demand: number; supplied: number }> = {
    infrastructure: { demand: 0, supplied: 0 }, industry: { demand: 0, supplied: 0 }, healthcare: { demand: 0, supplied: 0 }, military: { demand: 0, supplied: 0 },
  };
  const materialTotals: Partial<Record<MaterialKind, { demand: number; supplied: number }>> = {};

  for (const requirement of requirements) {
    const allocations: Partial<Record<MaterialKind, number>> = {};
    let remaining = requirement.amount;
    let supplied = 0;
    for (const kind of requirement.options) {
      if (remaining <= EPSILON) break;
      const used = consumeMaterial(settlement, kind, remaining, state.month);
      if (used <= 0) continue;
      allocations[kind] = round((allocations[kind] ?? 0) + used);
      supplied += used;
      remaining -= used;
    }
    domainTotals[requirement.domain].demand += requirement.amount;
    domainTotals[requirement.domain].supplied += supplied;
    accumulateMaterialPressure(materialTotals, requirement, allocations, Math.max(0, requirement.amount - supplied));
  }

  const domains = Object.fromEntries((Object.keys(domainTotals) as MaterialUseDomain[]).map((domain) => [
    domain, pressure(domainTotals[domain].demand, domainTotals[domain].supplied),
  ])) as Record<MaterialUseDomain, MaterialPressureState>;
  const materials: Partial<Record<MaterialKind, MaterialPressureState>> = {};
  for (const [kind, totals] of Object.entries(materialTotals) as Array<[MaterialKind, { demand: number; supplied: number }]>) {
    materials[kind] = pressure(totals.demand, totals.supplied);
  }
  const criticalInputs = (Object.entries(materials) as Array<[MaterialKind, MaterialPressureState]>)
    .filter(([, value]) => value.pressure >= 0.6 && value.demand > EPSILON)
    .sort((a, b) => b[1].pressure - a[1].pressure || b[1].demand - a[1].demand)
    .map(([kind]) => kind);
  const readiness = Object.fromEntries((Object.keys(domains) as MaterialUseDomain[]).map((domain) => [domain, domains[domain].coverage])) as Record<MaterialUseDomain, number>;
  const weightedDemand = (Object.values(domains) as MaterialPressureState[]).reduce((sum, value) => sum + value.demand, 0);
  const weightedUnmet = (Object.values(domains) as MaterialPressureState[]).reduce((sum, value) => sum + value.unmet, 0);
  const scarcity = weightedDemand > EPSILON ? clamp01(weightedUnmet / weightedDemand) : 0;

  settlement.materialUse = { month: state.month, domains, materials, criticalInputs, readiness };
  settlement.resourceScarcityPressure = scarcity;
  const legacyVulnerabilities = settlement.industry.vulnerableInputs.filter((input) => ['food-surplus', 'specialist-labor'].includes(input));
  settlement.industry.vulnerableInputs = [...new Set([...legacyVulnerabilities, ...criticalInputs])];
  if (scarcity > 0.7 && settlement.industry.active) settlement.industry.intensity = Math.max(0, settlement.industry.intensity * (1 - (scarcity - 0.7) * 0.012));
  return settlement.materialUse;
}

export function materialReadiness(settlement: Settlement, domain: MaterialUseDomain): number {
  if (!settlement.materials) return 1;
  return settlement.materialUse?.readiness[domain] ?? 1;
}
