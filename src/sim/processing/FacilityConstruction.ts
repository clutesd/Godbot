import { reserveStructurePlot } from '../../shared/StructurePlots';
import type { DevelopmentProject, DevelopmentResponse, StructureDevelopment, StructureHistoryEntry } from '../development/types';
import { infrastructureLabourBudget } from '../people/HumanCapital';
import { paidConstructionWorkerIds } from '../people/ConstructionLabour';
import { materialEconomy, reconcileBulkStocks } from '../resources/Inventory';
import { consumeMaterial } from '../resources/MaterialUse';
import { MATERIAL_RECIPES, type MaterialKind } from '../resources/MaterialEconomy';
import type { Settlement, SimulationState, StructurePlot } from '../types';
import { facilityTierSpec } from './FacilityCatalog';
import { emptyTotals } from './FacilityInventory';
import { facilityCarrier } from './FacilityPower';
import type { FacilityBill, FacilityFamilySpec, FacilityTierSpec, ProcessingFacility, SettlementProcessing } from './types';

const EPSILON = 1e-9;

export function settlementProcessing(s: Settlement): SettlementProcessing {
  return s.processing ??= { governed: false, facilities: [], foundingBlockers: {}, nextFacilityIndex: 0 };
}

/** Physical stock able to pay a bill right now, 0..1 of the whole bill. */
export function billCoverage(s: Settlement, bill: FacilityBill): number {
  if (bill.lines.length === 0) return 1;
  return Math.max(0, Math.min(1, ...bill.lines.map(line => line.amount <= EPSILON ? 1
    : line.options.reduce((sum, id) => sum + Math.max(0, s.localMaterials[id] ?? 0), 0) / line.amount)));
}

/**
 * Pays for `requested` of a bill (0..1). Materials come out of the canonical settlement store in
 * option-preference order and worker-months out of the shared infrastructure labour budget, so
 * progress is exactly what was physically paid for. Returns the progress actually bought.
 */
export function payBill(state: SimulationState, s: Settlement, bill: FacilityBill, requested: number, spent: Record<string, number>): number {
  if (requested <= EPSILON) return 0;
  reconcileBulkStocks(s);
  const economy = materialEconomy(s);
  const labour = infrastructureLabourBudget(state, s);
  let progress = Math.min(requested, bill.work > 0 ? Math.max(0, labour.remaining) / bill.work : requested);
  for (const line of bill.lines) {
    if (line.amount <= EPSILON) continue;
    const primary = line.options[0];
    if (primary) economy.demand[primary] = Math.max(economy.demand[primary] ?? 0, line.amount * requested * 2);
    const available = line.options.reduce((sum, id) => sum + Math.max(0, s.localMaterials[id] ?? 0), 0);
    progress = Math.min(progress, available / line.amount);
  }
  progress = Math.max(0, progress);
  if (progress <= EPSILON) return 0;
  for (const line of bill.lines) {
    let remaining = line.amount * progress;
    for (const id of line.options) {
      if (remaining <= EPSILON) break;
      const used = consumeMaterial(s, id as MaterialKind, remaining, state.month);
      if (used <= 0) continue;
      spent[id] = (spent[id] ?? 0) + used;
      remaining -= used;
    }
  }
  labour.remaining -= progress * bill.work;
  return progress;
}

export function newFacility(
  state: SimulationState, s: Settlement, family: FacilityFamilySpec, plot: StructurePlot, spec: FacilityTierSpec, complete: boolean,
): ProcessingFacility {
  const proc = settlementProcessing(s);
  const index = proc.nextFacilityIndex++;
  const facility: ProcessingFacility = {
    id: `${s.id}:facility:${family.id}:${index}`, settlementId: s.id, family: family.id, tier: spec.tier, kind: spec.kind,
    plotId: plot.id, position: { x: plot.worldX, z: plot.worldZ }, foundedMonth: state.month,
    progress: complete ? 1 : 0, condition: 1, status: complete ? 'idle' : 'under-construction', limiter: 'none', blockers: [],
    inputs: {}, outputs: {}, quality: {}, transit: [], processes: {}, heat: 0,
    power: { carrier: 'none', demand: 0, supplied: 0, coverage: 1 },
    access: { ok: true, mode: 'walk', cost: 1, months: 1, vehicle: 'basket', unitsPerWorkerMonth: 0 },
    labour: { required: spec.workers, available: 0, used: 0, haul: 0, byOccupation: {} },
    freight: { inbound: 0, outbound: 0 },
    throughput: 0, load: 0, saturationMonths: 0, spent: {}, labourSpent: 0, totals: emptyTotals(), history: [],
  };
  facility.power.carrier = facilityCarrier(state, facility, spec.power);
  proc.facilities.push(facility);
  return facility;
}

function dominantCulture(state: SimulationState, s: Settlement): { id: string; style: DevelopmentResponse['style'] } | undefined {
  const id = Object.keys(s.cultureShares).sort((a, b) => (s.cultureShares[b] ?? 0) - (s.cultureShares[a] ?? 0) || a.localeCompare(b))[0];
  const culture = state.cultures.find(c => c.id === id) ?? state.cultures[0];
  return culture ? { id: culture.id, style: culture.style } : undefined;
}

function facilityConstructionResponse(state: SimulationState, s: Settlement, f: ProcessingFacility, spec: FacilityTierSpec): DevelopmentResponse | undefined {
  const culture = dominantCulture(state, s);
  if (!culture) return undefined;
  return {
    need: 'manufacturing', form: spec.form, name: spec.name, level: Math.min(3, spec.tier), material: spec.material,
    cultureId: culture.id, style: { ...culture.style }, services: { manufacturing: spec.service },
    reasons: ['processing-facility', `${f.family}:${spec.kind}`], capabilities: spec.knowledge.map(k => k.id),
    cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: spec.build.work,
    facilityId: f.id, facilityFamily: f.family, facilityTier: spec.tier,
  };
}

/** Documentary receipt only; payBill remains the sole material and labour consumer. */
export function recordFacilityConstruction(state: SimulationState, s: Settlement, f: ProcessingFacility, spec: FacilityTierSpec,
  progress: number, startedMonth: number, action: StructureHistoryEntry['action'], spent: Record<string, number>, labourSpent: number): void {
  const response = facilityConstructionResponse(state, s, f, spec);
  if (!response) return;
  const receipt: DevelopmentProject = f.constructionWork?.startedMonth === startedMonth && f.constructionWork.response.facilityTier === spec.tier ? f.constructionWork : {
    plotId: f.plotId, response, startedMonth, action, progress: 0,
    spent: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
  };
  Object.assign(receipt, { progress: progress >= 1 - 1e-8 ? 1 : progress, labourSpent, lastWorkMonth: state.month, materialSpent: { ...spent } });
  // payBill's shared infrastructure pool is builder labour. This only chooses up to three actual
  // builder representatives after that pool has paid; it performs no second labour allocation.
  receipt.workerIds = paidConstructionWorkerIds(receipt, state.people, s.id, { builder: labourSpent > 0 ? 3 : 0 });
  f.constructionWork = receipt;
}

/** Install the authoritative body in place, retaining its paid receipt for the human reveal. */
export function installFacilityBody(state: SimulationState, s: Settlement, f: ProcessingFacility, action: StructureHistoryEntry['action']): void {
  const plot = s.structurePlots?.find(p => p.id === f.plotId);
  const spec = facilityTierSpec(f.family, f.tier);
  const response = spec && facilityConstructionResponse(state, s, f, spec);
  if (!plot || !spec || !response) return;
  const record: StructureHistoryEntry = { month: state.month, action, name: spec.name, need: 'manufacturing', cultureId: response.cultureId,
    reasons: response.reasons, form: spec.form, level: response.level, material: spec.material };
  const prior = plot.development;
  const development: StructureDevelopment = {
    ...response, status: 'active', origin: prior?.origin ?? record, history: prior?.history ?? [],
    constructionWork: f.constructionWork,
    transitionCount: (prior?.transitionCount ?? 0) + (prior ? 1 : 0), lastUsedMonth: state.month,
  };
  if (prior) development.history = [record, ...development.history].slice(0, 12);
  plot.development = development;
  plot.char = 0;
  if (!prior || prior.status !== 'active') plot.condition = 1;
}

export interface FoundingResult { facility?: ProcessingFacility; blocker?: string }

/** Reserves ground for a facility with room for input yard, utilities and loading. */
export function reserveFacilitySite(state: SimulationState, s: Settlement): StructurePlot | undefined {
  // The industrial district is preferred; a settlement hemmed in by water or the map edge falls back to its craft quarter, then the core.
  for (const district of ['industrial', 'craft', 'civic'] as const) {
    const plot = reserveStructurePlot(state, s, district, { buildingScale: 0.72, precinct: 2 });
    if (plot) return plot;
  }
  return undefined;
}

export function foundFacility(state: SimulationState, s: Settlement, family: FacilityFamilySpec): FoundingResult {
  const spec = family.tiers[0];
  if (!spec) return { blocker: 'no-tier' };
  const plot = reserveFacilitySite(state, s);
  if (!plot) return { blocker: 'no-valid-plot' };
  const facility = newFacility(state, s, family, plot, spec, false);
  facility.history.push({ month: state.month, action: 'founded', tier: 1 });
  return { facility };
}

/** Start converting the first facility tier or the next one; identity, plot and stock are retained. */
export function beginUpgrade(state: SimulationState, f: ProcessingFacility, toTier: number): void {
  f.upgrade = { toTier, progress: 0, startedMonth: state.month, spent: {}, labourSpent: 0 };
  f.history.push({ month: state.month, action: 'upgrade-started', tier: toTier });
  f.status = 'upgrading';
}

/**
 * Legacy compatibility. A save that predates processing facilities carried its wood/metal industry
 * only as aggregate workshop/factory capacity and known recipes. Enrolment turns that capacity
 * into completed facilities of the matching tier so those settlements keep producing, but now
 * through a place. The mapping is a pure function of the old state and therefore deterministic.
 */
export function legacyFacilityTier(s: Settlement, family: FacilityFamilySpec, meets: (spec: FacilityTierSpec) => boolean): number {
  const first = family.tiers[0];
  if (!first || s.infrastructure.workshops < 0.05) return 0;
  const producedBefore = first.recipes.some(ref => {
    if (s.knownRecipes.includes(ref.id)) return true;
    const outputs = ref.source === 'material' ? Object.keys(processOutputs(ref.id)) : [];
    return outputs.some(id => (s.materials?.lifetimeProduced[id as keyof NonNullable<Settlement['materials']>['lifetimeProduced']] ?? 0) > 0);
  });
  if (!producedBefore || !meets(first)) return 0;
  let tier = 1;
  for (const spec of family.tiers.slice(1)) {
    const capacity = spec.tier === 2 ? s.infrastructure.workshops >= 0.3 : s.infrastructure.factories >= 0.15;
    if (!capacity || !meets(spec)) break;
    tier = spec.tier;
  }
  return tier;
}

function processOutputs(id: string): Record<string, number> {
  return (MATERIAL_RECIPES.find(recipe => recipe.id === id)?.outputs ?? {}) as Record<string, number>;
}

/** An unclaimed, intact manufacturing workshop is adopted as the works' body before new ground is taken. */
export function adoptableWorkshop(s: Settlement): StructurePlot | undefined {
  return (s.structurePlots ?? []).find(p => p.development?.status === 'active' && p.development.need === 'manufacturing'
    && (p.development.form === 'workshop' || p.development.form === 'works') && !p.development.facilityId && !p.fire && !p.accessRestricted);
}
