import { capabilityPractice } from '../knowledge/CapabilityContract';
import { infrastructureLabourBudget } from '../people/HumanCapital';
import type { SeededRandom } from '../prng';
import { MATERIAL_BY_ID } from '../resources/catalog';
import type { ExtractionAccessibility } from '../resources/ExtractionAccessibility';
import { materialEconomy } from '../resources/Inventory';
import { applyRecipe, ensureMaterialInventory } from '../resources/MaterialEconomy';
import { catalogCycleSetup, runCatalogCycle, useLabourDetailed, type LabourBudget } from '../resources/Processing';
import type { ResourceEventDraft } from '../resources/ResourceSystem';
import type { Settlement, SimulationState, StructurePlot } from '../types';
import { facilityFamilies, facilityFamily, facilityTierSpec } from './FacilityCatalog';
import {
  adoptableWorkshop, beginUpgrade, billCoverage, foundFacility, installFacilityBody, legacyFacilityTier, newFacility, payBill, reserveFacilitySite, settlementProcessing,
} from './FacilityConstruction';
import { facilityLedger, inTransitOf, bump } from './FacilityInventory';
import { advanceTransit, deliverDue, dispatchInbound, dispatchOutbound, resolveFacilityAccess, type InboundRequest } from './FacilityHaul';
import { facilityGoverned } from './FacilityOwnership';
import { facilityCarrier, facilityPowerRequest, powerFactor, powerSourceAvailable } from './FacilityPower';
import { fuelHeat, netOutput, processEnabled, processSpec, processTarget, type ProcessSpec } from './FacilityProcesses';
import type { FacilityFamilySpec, FacilityLimiter, FacilityStatus, FacilityTierSpec, ProcessingFacility } from './types';

const EPSILON = 1e-9;
const COLD = 0.35;
const WEAR = 0.006;
const round = (value: number): number => Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function tierKnowledgeMet(s: Settlement, spec: FacilityTierSpec): boolean {
  return spec.knowledge.every(need => capabilityPractice(s, need.id, 'adopted') >= need.minPractice);
}

/**
 * Enrolls the simulation in facility authority. A state that predates processing facilities gets
 * its aggregate wood/metal capacity converted, once, into completed facilities of the matching
 * tier (see legacyFacilityTier); a fresh run enrolls with nothing to convert. Settlements founded
 * later join without conversion. Harnesses that drive the recipe systems directly never enroll and
 * therefore keep the aggregate pipelines.
 */
export function ensureProcessingAuthority(state: SimulationState): void {
  const enrolling = !state.processing;
  state.processing ??= { version: 1, enrolledMonth: state.month, milestones: [] };
  for (const s of state.settlements) {
    if (s.processing?.governed) continue;
    settlementProcessing(s).governed = true;
    if (enrolling && s.alive) migrateLegacyFacilities(state, s);
  }
}

function migrateLegacyFacilities(state: SimulationState, s: Settlement): void {
  for (const family of facilityFamilies()) {
    const tier = legacyFacilityTier(s, family, spec => tierKnowledgeMet(s, spec));
    if (tier <= 0) continue;
    const adopted = adoptableWorkshop(s);
    establishFacility(state, s, family.id, tier, { plot: adopted, origin: 'migrated' });
  }
}

/**
 * Places a completed facility directly: the entry point for enrolment of legacy capacity and for
 * scenarios that start from an existing works. It creates no stock and no free output; the
 * facility begins with empty yards and must be supplied, crewed and powered like any other.
 * Ordinary growth goes through founding and upgrade, which pay for construction.
 */
export function establishFacility(
  state: SimulationState, s: Settlement, familyId: FacilityFamilySpec['id'], tier = 1,
  options: { plot?: StructurePlot; origin?: 'migrated' | 'placed' } = {},
): ProcessingFacility | undefined {
  const family = facilityFamily(familyId);
  const spec = facilityTierSpec(familyId, tier);
  if (!family || !spec) return undefined;
  const plot = options.plot ?? reserveFacilitySite(state, s);
  if (!plot) return undefined;
  const facility = newFacility(state, s, family, plot, spec, true);
  facility.history.push({ month: state.month, action: options.origin === 'placed' ? 'founded' : 'migrated', tier, detail: options.origin === 'placed' ? undefined : 'aggregate capacity converted to a facility' });
  installFacilityBody(state, s, facility, options.plot ? 'repurposed' : 'founded');
  facility.power.demand = facilityPowerRequest(spec.power, 0.3);
  facility.power.supplied = facility.power.demand;
  return facility;
}

interface StepContext {
  state: SimulationState;
  s: Settlement;
  budget: LabourBudget;
  random: SeededRandom;
  access?: ExtractionAccessibility;
  events: ResourceEventDraft[];
}

/** One month of every facility in a facility-governed settlement. Deterministic; the only randomness is the recipe executors'. */
export function advanceProcessingFacilities(
  state: SimulationState, s: Settlement, budget: LabourBudget, random: SeededRandom, access?: ExtractionAccessibility,
): ResourceEventDraft[] {
  const events: ResourceEventDraft[] = [];
  if (!facilityGoverned(state, s)) return events;
  const context: StepContext = { state, s, budget, random, access, events };
  planFacilities(context);
  for (const facility of [...settlementProcessing(s).facilities].sort((a, b) => a.id.localeCompare(b.id))) stepFacility(context, facility);
  return events;
}

// ---------------------------------------------------------------------------------------------
// Founding and upgrades
// ---------------------------------------------------------------------------------------------

function foundingBlocker(c: StepContext, family: FacilityFamilySpec): string | undefined {
  const { state, s } = c;
  const first = family.tiers[0]!;
  if (!tierKnowledgeMet(s, first)) return 'knowledge';
  if (!first.recipes.some(ref => { const spec = processSpec(ref); return !!spec && processEnabled(state, s, spec); })) return 'no-enabled-recipe';
  if (!family.triggerMaterials.some(id => (s.localMaterials[id] ?? 0) >= 3)) return 'no-raw-material';
  if (infrastructureLabourBudget(state, s).remaining < 0.25) return 'no-construction-labour';
  if (billCoverage(s, first.build) < 0.2) return 'materials';
  return undefined;
}

function upgradeBlocker(c: StepContext, f: ProcessingFacility): string | undefined {
  const { state, s } = c;
  const next = facilityTierSpec(f.family, f.tier + 1);
  if (!next) return 'max-tier';
  if (f.status === 'damaged' || f.status === 'ruined' || f.condition < 0.6) return 'damaged';
  if (f.saturationMonths < 3) return 'not-saturated';
  if (!tierKnowledgeMet(s, next)) return 'knowledge';
  if (!powerSourceAvailable(s, next.power)) return 'no-power-source';
  if (infrastructureLabourBudget(state, s).remaining < 0.25) return 'no-construction-labour';
  if (billCoverage(s, next.build) < 0.2) return 'materials';
  return undefined;
}

/** At most one construction per settlement at a time; the shared worker-month budget is finite. */
function planFacilities(c: StepContext): void {
  const { state, s, events } = c;
  const proc = settlementProcessing(s);
  if (proc.facilities.some(f => f.progress < 1 || f.upgrade)) return;
  if (!s.alive || s.buildings < 3) return;
  for (const family of facilityFamilies()) {
    const existing = proc.facilities.filter(f => f.family === family.id).sort((a, b) => a.id.localeCompare(b.id));
    if (existing.length === 0) {
      const blocker = foundingBlocker(c, family);
      if (blocker) { proc.foundingBlockers[family.id] = blocker; continue; }
      const result = foundFacility(state, s, family);
      if (!result.facility) { proc.foundingBlockers[family.id] = result.blocker ?? 'no-site'; continue; }
      delete proc.foundingBlockers[family.id];
      events.push(facilityEvent(s, result.facility, `${s.name} marks ground for a ${family.tiers[0]!.name}.`, 'facility-founded', 0.4));
      return;
    }
    const primary = existing[0]!;
    // Fire or neglect that left only ruins is rebuilt as a same-tier conversion, keeping identity, ground and stock.
    if (primary.status === 'ruined') {
      const plot = s.structurePlots?.find(p => p.id === primary.plotId);
      const spec = facilityTierSpec(primary.family, primary.tier);
      if (plot && spec && !plot.fire && billCoverage(s, spec.build) >= 0.2 && infrastructureLabourBudget(state, s).remaining >= 0.25) {
        beginUpgrade(state, primary, primary.tier);
        events.push(facilityEvent(s, primary, `${s.name} sets about rebuilding its ${spec.name}.`, 'facility-rebuild-started', 0.4));
        return;
      }
      continue;
    }
    if (upgradeBlocker(c, primary)) continue;
    beginUpgrade(state, primary, primary.tier + 1);
    events.push(facilityEvent(s, primary, `${s.name} begins converting its ${primary.kind.replace(/-/g, ' ')} to a ${facilityTierSpec(primary.family, primary.tier + 1)!.name}.`, 'facility-upgrade-started', 0.45));
    return;
  }
}

function facilityEvent(s: Settlement, f: ProcessingFacility, summary: string, cause: string, significance: number): ResourceEventDraft {
  return {
    type: 'infrastructure-built', location: { ...f.position }, locationId: s.id, actors: [s.id, f.id], causes: [cause, `${f.family}-processing`],
    context: { need: 'manufacturing', facility: f.id, family: f.family, tier: f.tier, kind: f.kind, milestone: cause },
    outcome: 'The works exists as a physical place with its own yards, crew and utilities.',
    significance, tags: ['industry', 'processing', f.family], summary,
  };
}

// ---------------------------------------------------------------------------------------------
// The monthly step of one facility
// ---------------------------------------------------------------------------------------------

function stepFacility(c: StepContext, f: ProcessingFacility): void {
  const { state, s } = c;
  f.lastMonth = state.month;
  const plot = s.structurePlots?.find(p => p.id === f.plotId);
  const spec = facilityTierSpec(f.family, f.tier);
  if (!plot || !spec) { setStatus(f, 'ruined', 'none', ['site-lost']); return; }
  f.position = { x: plot.worldX, z: plot.worldZ };
  if (f.progress < 1) { erect(c, f, plot); return; }
  if (f.upgrade) { convert(c, f, plot); return; }
  operate(c, f, plot, spec);
}

function setStatus(f: ProcessingFacility, status: FacilityStatus, limiter: FacilityLimiter, blockers: string[]): void {
  f.status = status; f.limiter = limiter; f.blockers = blockers;
  if (status !== 'active') f.throughput = 0;
}

function erect(c: StepContext, f: ProcessingFacility, plot: StructurePlot): void {
  const { state, s } = c;
  const spec = facilityTierSpec(f.family, 1)!;
  const halted = plot.fire ? 'fire' : (plot.floodDepth ?? 0) > 0.06 ? 'flooded-site' : undefined;
  const requested = Math.min(1 - f.progress, 0.34);
  const paid = halted ? 0 : payBill(state, s, spec.build, requested, f.spent);
  f.progress = Math.min(1, f.progress + paid);
  f.labourSpent += paid * spec.build.work;
  setStatus(f, 'under-construction', 'none', halted ? [halted] : paid < requested - EPSILON ? ['materials-or-labour'] : []);
  if (f.progress < 1 - 1e-8) return;
  f.progress = 1;
  installFacilityBody(state, s, f, 'founded');
  f.history.push({ month: state.month, action: 'completed', tier: f.tier });
  f.power.carrier = facilityCarrier(state, f, spec.power);
  f.power.demand = facilityPowerRequest(spec.power, 0.3);
  f.power.supplied = f.power.demand; f.power.coverage = 1;
  setStatus(f, 'idle', 'none', []);
  c.events.push(facilityEvent(s, f, `${s.name} completes a ${spec.name}.`, 'facility-completed', 0.55));
}

function convert(c: StepContext, f: ProcessingFacility, plot: StructurePlot): void {
  const { state, s } = c;
  const up = f.upgrade!;
  const spec = facilityTierSpec(f.family, up.toTier);
  if (!spec) { f.upgrade = undefined; return; }
  const halted = plot.fire ? 'fire' : (plot.floodDepth ?? 0) > 0.06 ? 'flooded-site' : undefined;
  const requested = Math.min(1 - up.progress, 0.34);
  const paid = halted ? 0 : payBill(state, s, spec.build, requested, up.spent);
  up.progress = Math.min(1, up.progress + paid);
  up.labourSpent += paid * spec.build.work;
  for (const [id, amount] of Object.entries(up.spent)) f.spent[id] = Math.max(f.spent[id] ?? 0, amount);
  // Retooling stops the line: no production, but hauls already under way still land.
  advanceTransit(f); deliverDue(s, f);
  setStatus(f, 'upgrading', 'none', halted ? [halted] : paid < requested - EPSILON ? ['materials-or-labour'] : []);
  f.power.demand = 0;
  if (up.progress < 1 - 1e-8) return;
  f.labourSpent += up.labourSpent;
  f.tier = spec.tier; f.kind = spec.kind; f.upgrade = undefined; f.saturationMonths = 0;
  f.condition = 1;
  installFacilityBody(state, s, f, 'upgraded');
  f.history.push({ month: state.month, action: 'upgraded', tier: f.tier });
  f.labour.required = spec.workers;
  f.power.carrier = facilityCarrier(state, f, spec.power);
  f.power.demand = facilityPowerRequest(spec.power, 0.3);
  f.power.supplied = f.power.demand; f.power.coverage = 1;
  setStatus(f, 'idle', 'none', []);
  c.events.push(facilityEvent(s, f, `${s.name} commissions its ${spec.name}.`, 'facility-upgraded', 0.65));
}

// ---------------------------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------------------------

interface PlanEntry {
  spec: ProcessSpec;
  enabled: boolean;
  /** Batches the settlement's targets and downstream demand call for. */
  wanted: number;
  urgency: number;
}

function expectedYield(spec: ProcessSpec, s: Settlement): number {
  if (!spec.catalog) return 1;
  const recipe = spec.catalog;
  const practiced = recipe.requiredKnowledge.reduce((sum, need) => sum + (s.knowledge.records[need.id]?.practice ?? 0), 0) / Math.max(1, recipe.requiredKnowledge.length);
  return recipe.baseEfficiency + (1 - recipe.baseEfficiency) * practiced;
}

function planProcesses(state: SimulationState, s: Settlement, f: ProcessingFacility, tier: FacilityTierSpec): PlanEntry[] {
  const supply = (id: string): number => Math.max(0, s.localMaterials[id] ?? 0) + (f.outputs[id] ?? 0) + inTransitOf(f, 'out', id);
  const entries: PlanEntry[] = [];
  for (const ref of tier.recipes) {
    const spec = processSpec(ref);
    if (!spec) continue;
    const enabled = processEnabled(state, s, spec);
    const outputs = Object.entries(spec.outputs);
    const wantedFor = (extra: Record<string, number>): number => {
      if (!enabled) return 0;
      const batches = Math.max(0, ...outputs.map(([id, quantity]) => {
        const deficit = processTarget(s, spec, id) + (extra[id] ?? 0) - supply(id);
        return deficit <= EPSILON ? 0 : deficit / Math.max(EPSILON, quantity * expectedYield(spec, s) * 0.85);
      }));
      return spec.wholeCycles ? Math.ceil(batches - 1e-9) : batches;
    };
    const urgency = Math.min(...outputs.map(([id]) => supply(id) / Math.max(1, processTarget(s, spec, id))));
    entries.push({ spec, enabled, wanted: wantedFor({}), urgency });
  }
  // Downstream demand (steel needs iron) raises what a producer in the same works is asked to make.
  const derived = (id: string): number => entries.reduce((sum, other) => sum + other.wanted * (other.spec.inputs[id] ?? 0), 0);
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const extra = Object.fromEntries(Object.keys(entry.spec.outputs).map(id => [id, derived(id) * (Object.keys(entry.spec.inputs).includes(id) ? 0 : 1)]));
    const batches = Math.max(entry.wanted, ...Object.entries(entry.spec.outputs).map(([id, quantity]) => {
      const deficit = processTarget(s, entry.spec, id) + (extra[id] ?? 0) - supply(id);
      return deficit <= EPSILON ? 0 : deficit / Math.max(EPSILON, quantity * expectedYield(entry.spec, s) * 0.85);
    }));
    entry.wanted = entry.spec.wholeCycles ? Math.ceil(batches - 1e-9) : batches;
  }
  const producesForOther = (entry: PlanEntry): boolean => entries.some(other => other !== entry && other.wanted > 0
    && Object.keys(other.spec.inputs).some(id => (entry.spec.outputs[id] ?? 0) > 0));
  return entries.sort((a, b) => Number(producesForOther(b)) - Number(producesForOther(a)) || a.urgency - b.urgency || a.spec.key.localeCompare(b.spec.key));
}

function internalMaterials(tier: FacilityTierSpec): Set<string> {
  const ids = new Set<string>();
  for (const ref of tier.recipes) {
    const spec = processSpec(ref);
    if (spec) for (const id of [...Object.keys(spec.outputs), ...Object.keys(spec.byproducts)]) ids.add(id);
  }
  return ids;
}

function inboundRequests(f: ProcessingFacility, tier: FacilityTierSpec, entries: readonly PlanEntry[], capacityWork: number, internal: ReadonlySet<string>): InboundRequest[] {
  const need: Record<string, number> = {};
  const made: Record<string, number> = {};
  let workLeft = capacityWork;
  for (const entry of entries) {
    if (entry.wanted <= EPSILON || workLeft <= EPSILON) continue;
    const batches = Math.min(entry.wanted, workLeft / entry.spec.work);
    workLeft -= batches * entry.spec.work;
    for (const [id, quantity] of Object.entries(entry.spec.inputs)) need[id] = (need[id] ?? 0) + quantity * batches;
    for (const [id, quantity] of Object.entries(entry.spec.outputs)) made[id] = (made[id] ?? 0) + quantity * batches * 0.8;
  }
  // A cold furnace also has to be lit.
  const fuelUsers = entries.filter(entry => entry.spec.fuel && entry.wanted > EPSILON);
  if (tier.heat && f.heat < COLD && fuelUsers.length > 0) {
    const fuel = fuelUsers[0]!.spec.fuel!.id;
    need[fuel] = (need[fuel] ?? 0) + tier.heat.warmup;
  }
  // Cargo takes `access.months` to arrive, so enough must be ordered to keep the line fed until the next load lands.
  const cover = 1.15 + Math.max(0, f.access.months - 1);
  return Object.entries(need).map(([material, quantity]) => {
    const onYard = (f.inputs[material] ?? 0) + inTransitOf(f, 'in', material) + (internal.has(material) ? (f.outputs[material] ?? 0) + (made[material] ?? 0) : 0);
    return { material, quantity: Math.max(0, quantity * cover - onYard) };
  }).filter(request => request.quantity > EPSILON).sort((a, b) => a.material.localeCompare(b.material));
}

function operate(c: StepContext, f: ProcessingFacility, plot: StructurePlot, tier: FacilityTierSpec): void {
  const { state, s, budget, random } = c;
  const economy = materialEconomy(s);
  const dev = plot.development;
  f.freight = { inbound: 0, outbound: 0 };
  f.labour = { required: tier.workers, available: 0, used: 0, haul: 0, byOccupation: {} };
  if (!dev || dev.status !== 'active') { setStatus(f, 'ruined', 'none', ['structure-lost']); return; }

  // Machinery wears with use and is kept up through the same paid construction path.
  f.condition = Math.max(0, f.condition - WEAR * (0.35 + 0.65 * f.throughput));
  if (f.condition < 0.97 && !plot.fire) {
    const restored = payBill(state, s, tier.maintenance, Math.min(1, (1 - f.condition) / 0.4), f.spent);
    f.condition = Math.min(1, f.condition + restored * 0.4);
  }

  f.access = resolveFacilityAccess(s, f, c.access);
  advanceTransit(f); deliverDue(s, f);
  spoil(f);

  const integrity = plot.fire ? 0 : Math.min(clamp01(plot.condition), f.condition);
  if (integrity < 0.25) { setStatus(f, 'damaged', 'condition', [plot.fire ? 'fire' : 'damaged']); f.load = 0; refreshPower(state, f, tier); return; }
  if (!tierKnowledgeMet(s, tier)) { setStatus(f, 'idle', 'knowledge', ['knowledge-lost']); f.load = 0; refreshPower(state, f, tier); return; }

  const carrier = facilityCarrier(state, f, tier.power);
  if (carrier !== f.power.carrier) { f.power.carrier = carrier; f.power.supplied = 0; f.power.coverage = 0; }
  const pf = powerFactor(tier.power, f);
  const labourPerWork = tier.workers / Math.max(EPSILON, tier.capacity);
  const crew = () => tier.occupations.reduce((sum, occupation) => sum + Math.max(0, budget[occupation] ?? 0), 0);
  f.labour.available = crew();

  const entries = planProcesses(state, s, f, tier);
  const internal = internalMaterials(tier);
  const nominalWork = tier.capacity * integrity * pf;
  const requests = inboundRequests(f, tier, entries, Math.min(nominalWork, crew() / labourPerWork), internal);
  for (const request of requests) economy.demand[request.material] = Math.max(economy.demand[request.material] ?? 0, request.quantity * 2);
  dispatchInbound(s, f, tier, budget, requests, state.month);
  deliverDue(s, f);

  // Production proper.
  let workLeft = nominalWork;
  let workDone = 0;
  let ranFuelProcess = false;
  const limits = new Set<string>();
  const ledger = facilityLedger(f, tier, internal);
  const crewLeft = () => crew() / labourPerWork;
  const wantedWork = entries.reduce((sum, entry) => sum + entry.wanted * entry.spec.work, 0);

  for (const entry of entries) {
    const { spec } = entry;
    const process = f.processes[spec.key] ??= { key: spec.key, status: 'idle', batches: 0, work: 0, lifetimeBatches: 0 };
    process.batches = 0; process.work = 0; process.blocker = undefined;
    if (!entry.enabled) { process.status = 'locked'; process.blocker = 'knowledge'; continue; }
    if (entry.wanted <= EPSILON) { process.status = 'idle'; process.blocker = 'demand'; continue; }
    const need = Object.entries(spec.inputs);
    const stocked = () => Math.min(...need.map(([id, quantity]) => ledger.amount(id) / quantity));
    const minimumHeat = Math.max(spec.fuel?.minimumHeat ?? 0, tier.heat?.minimum ?? 0);
    let hot = true;
    if (spec.fuel && fuelHeat(spec.fuel.id) < minimumHeat) { hot = false; process.blocker = 'fuel-heat'; }
    // Only a furnace with a charge worth firing is lit; lighting spends fuel the batch count must then respect.
    else if (spec.fuel && tier.heat && f.heat < COLD && stocked() > EPSILON) hot = lightFurnace(f, tier, economy, spec);
    if (!hot) { process.status = 'starved'; process.blocker ??= 'fuel'; limits.add('fuel'); continue; }
    const inputBatches = stocked();
    const net = netOutput(spec);
    const roomBatches = net > EPSILON ? ledger.room() / net : Number.POSITIVE_INFINITY;
    const workBatches = workLeft / spec.work;
    const labourBatches = crewLeft() / spec.work;
    let batches = Math.min(entry.wanted, inputBatches, roomBatches, workBatches, labourBatches);
    if (spec.wholeCycles) batches = Math.floor(batches + 1e-9);
    if (batches <= EPSILON) {
      process.status = inputBatches <= EPSILON ? 'starved' : roomBatches <= EPSILON ? 'blocked' : 'idle';
      process.blocker = inputBatches <= EPSILON ? 'inputs' : roomBatches <= EPSILON ? 'output-space' : labourBatches <= EPSILON ? 'labour' : 'capacity';
      limits.add(process.blocker);
      continue;
    }
    if (batches < Math.min(entry.wanted, inputBatches) - 1e-6) limits.add(labourBatches <= Math.min(workBatches, roomBatches) ? 'labour' : roomBatches < workBatches ? 'output-space' : 'capacity');
    else if (inputBatches < entry.wanted - 1e-6) limits.add('inputs');
    const use = useLabourDetailed(budget, tier.occupations, batches * spec.work * labourPerWork);
    economy.labourUsed += use.total;
    f.labour.used += use.total;
    for (const [occupation, amount] of Object.entries(use.byOccupation) as Array<[keyof typeof f.labour.byOccupation, number]>) {
      f.labour.byOccupation[occupation] = (f.labour.byOccupation[occupation] ?? 0) + amount;
    }
    if (spec.catalog) {
      const setup = catalogCycleSetup(s, spec.catalog, ledger);
      if (spec.fuel) economy.energyDemand += spec.fuel.quantity * batches;
      for (let cycle = 0; cycle < batches; cycle++) {
        runCatalogCycle(state, s, spec.catalog, setup, ledger, random, c.events, { efficiencyBonus: tier.yieldBonus, recordProcessing: false });
      }
    } else if (spec.material) {
      applyRecipe(s, ensureMaterialInventory(s), spec.material, round(batches), state.month, ledger);
      if (spec.fuel) { economy.energyDemand += spec.fuel.quantity * batches; economy.energySupplied += spec.fuel.quantity * batches; }
    }
    workLeft -= batches * spec.work;
    workDone += batches * spec.work;
    if (spec.fuel) ranFuelProcess = true;
    process.status = 'running'; process.batches = batches; process.work = batches * spec.work;
    process.lifetimeBatches += batches; process.lastRunMonth = state.month;
  }

  // Finished goods and waste go back to the store as fast as the route and crew allow.
  const reserve: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.wanted <= EPSILON) continue;
    for (const [id, quantity] of Object.entries(entry.spec.inputs)) if (internal.has(id)) reserve[id] = Math.max(reserve[id] ?? 0, quantity * Math.min(entry.wanted, 6));
  }
  dispatchOutbound(s, f, tier, budget, reserve);
  deliverDue(s, f);

  f.heat = ranFuelProcess ? 1 : f.heat < 0.04 ? 0 : f.heat * 0.5;
  finalize(state, s, f, plot, tier, { workDone, wantedWork, nominalWork, pf, integrity, limits, entries, internal });
}

function lightFurnace(f: ProcessingFacility, tier: FacilityTierSpec, economy: ReturnType<typeof materialEconomy>, spec: ProcessSpec): boolean {
  const heat = tier.heat!;
  const preferred = spec.fuel!.id;
  const candidates = [preferred, ...Object.keys(f.inputs).sort()].filter((id, i, all) => all.indexOf(id) === i
    && fuelHeat(id) >= heat.minimum && (f.inputs[id] ?? 0) >= heat.warmup - EPSILON);
  const fuel = candidates[0];
  if (!fuel) return false;
  f.inputs[fuel] = round((f.inputs[fuel] ?? 0) - heat.warmup);
  bump(f.totals.consumed, fuel, heat.warmup);
  economy.energyDemand += heat.warmup; economy.energySupplied += heat.warmup;
  f.heat = 1;
  return true;
}

function spoil(f: ProcessingFacility): void {
  for (const stock of [f.inputs, f.outputs]) {
    for (const [id, amount] of Object.entries(stock)) {
      const rate = MATERIAL_BY_ID.get(id)?.spoilage ?? 0;
      if (rate <= 0 || amount <= EPSILON) continue;
      const lost = round(amount * rate);
      stock[id] = round(amount - lost);
      bump(f.totals.spoiled, id, lost);
    }
  }
}

function refreshPower(state: SimulationState, f: ProcessingFacility, tier: FacilityTierSpec): void {
  f.power.carrier = facilityCarrier(state, f, tier.power);
  f.power.demand = facilityPowerRequest(tier.power, f.load);
}

interface Outcome {
  workDone: number; wantedWork: number; nominalWork: number; pf: number; integrity: number;
  limits: Set<string>; entries: readonly PlanEntry[]; internal: ReadonlySet<string>;
}

function finalize(state: SimulationState, s: Settlement, f: ProcessingFacility, plot: StructurePlot, tier: FacilityTierSpec, o: Outcome): void {
  const { workDone, wantedWork, nominalWork } = o;
  f.throughput = clamp01(workDone / Math.max(EPSILON, tier.capacity));
  // Load asks for the power the works would use if inputs were on hand; drives next month's dispatch.
  const supportedWork = o.entries.reduce((sum, entry) => {
    if (entry.wanted <= EPSILON) return sum;
    const onHand = Math.min(...Object.entries(entry.spec.inputs).map(([id, quantity]) =>
      ((f.inputs[id] ?? 0) + (o.internal.has(id) ? f.outputs[id] ?? 0 : 0) + Math.max(0, (s.localMaterials[id] ?? 0) - (s.survival?.establishment?.materialDemand[id] ?? 0))) / quantity));
    return sum + Math.min(entry.wanted, onHand) * entry.spec.work;
  }, 0);
  f.load = clamp01(Math.max(supportedWork, workDone) / Math.max(EPSILON, tier.capacity));

  let limiter: FacilityLimiter;
  if (wantedWork <= EPSILON) limiter = 'demand';
  else if (!f.access.ok) limiter = 'access';
  else if (workDone >= nominalWork * 0.97 - EPSILON && wantedWork > workDone + 1e-6) limiter = o.integrity < 0.9 && o.integrity <= o.pf ? 'condition' : o.pf < 0.9 ? 'power' : 'capacity';
  else if (o.limits.has('fuel')) limiter = 'fuel';
  else if (o.limits.has('inputs')) limiter = 'inputs';
  else if (o.limits.has('output-space')) limiter = 'output-space';
  else if (o.limits.has('labour')) limiter = 'labour';
  else if (workDone < wantedWork - 1e-6) limiter = o.pf < 0.9 ? 'power' : 'capacity';
  else limiter = 'none';
  const blockers = [...o.limits];
  if (!f.access.ok) blockers.unshift('access');
  if (tier.power.mode !== 'none' && f.power.coverage < tier.power.minimumCoverage) blockers.unshift('power');
  f.limiter = limiter;
  f.blockers = [...new Set(blockers)];

  let status: FacilityStatus;
  if (tier.power.mode !== 'none' && f.power.coverage < tier.power.minimumCoverage && wantedWork > EPSILON) status = 'unpowered';
  else if (workDone > EPSILON) status = 'active';
  else if (limiter === 'access') status = 'inaccessible';
  else if (limiter === 'fuel' || limiter === 'inputs') status = 'starved';
  else if (limiter === 'output-space') status = 'blocked';
  else if (limiter === 'labour') status = 'unstaffed';
  else if (limiter === 'power') status = 'unpowered';
  else if (limiter === 'condition') status = 'damaged';
  else status = 'idle';
  f.status = status;
  f.saturationMonths = limiter === 'capacity' ? f.saturationMonths + 1 : Math.max(0, f.saturationMonths - 1);
  if (workDone > EPSILON) f.lastActiveMonth = state.month;
  const dev = plot.development;
  if (dev && (workDone > EPSILON || wantedWork > EPSILON)) { dev.lastUsedMonth = state.month; dev.underusedSince = undefined; }
  refreshPower(state, f, tier);
}

// ---------------------------------------------------------------------------------------------
// Read-only helpers for other systems, the UI and tests
// ---------------------------------------------------------------------------------------------

export function facilitiesOf(s: Settlement, family?: string): readonly ProcessingFacility[] {
  return (s.processing?.facilities ?? []).filter(f => !family || f.family === family);
}

export function facilityCapacity(f: ProcessingFacility): number {
  const spec = facilityTierSpec(f.family, f.tier);
  return spec ? spec.capacity : 0;
}

/** Stock the facility holds or has in transit, by material: inputs + outputs + moving cargo. */
export function facilityHoldings(f: ProcessingFacility): Record<string, number> {
  const total: Record<string, number> = {};
  for (const stock of [f.inputs, f.outputs]) for (const [id, amount] of Object.entries(stock)) total[id] = (total[id] ?? 0) + amount;
  for (const shipment of f.transit) total[shipment.material] = (total[shipment.material] ?? 0) + shipment.quantity;
  return total;
}

