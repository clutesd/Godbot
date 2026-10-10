/**
 * Read-only reachability audit for timber and the metallurgy gate.
 *
 * Nothing here grants materials, draws randomness or alters a branch. It installs the two
 * diagnostic observers (`observeGatherDecisions`, `observeDiscoveryAttempts`) so every extraction
 * rejection is recorded at the branch that rejected it, and every metal-smelting evaluation is
 * recorded at the moment the candidate filter runs, and it proxies `localMaterials` to attribute
 * each timber movement to its calling authority.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Simulation } from '../src/sim/Simulation';
import { depositControlled, extractableQuantity, observeGatherDecisions, type GatherDecision } from '../src/sim/resources/ResourceSystem';
import { materialEconomy, storageCapacity, storageRoom, storedVolume } from '../src/sim/resources/Inventory';
import { observeDiscoveryAttempts, mastery } from '../src/sim/knowledge/KnowledgeSystem';
import { settlementRepresentedPopulation } from '../src/sim/advanced/AdvancedCivilizationSystem';
import type { ProcessingFacility } from '../src/sim/processing/types';
import type { ResourceDeposit, Settlement, SimulationState } from '../src/sim/types';
import type { KnowledgeSystem } from '../src/sim/knowledge/KnowledgeSystem';

import { armsDemand, observeArmsDemand, type ArmsDiagnostic } from '../src/sim/resources/ArmsDemand';
const armsRecords: ArmsDiagnostic[] = [];
observeArmsDemand(r => {
  const settlement = sim.state.settlements.find(s => s.id === r.settlementId)!;
  const people = sim.state.people.filter(p => p.alive && p.homeId === settlement.id);
  const demand = armsDemand(sim.state, settlement, people, r.population);
  armsRecords.push(Object.assign({}, r, { active: demand.active, threat: demand.threat, eligible: demand.eligible,
    quality: materialEconomy(settlement).quality.timber ?? 0.5,
    remainingPolicyDeficit: Math.max(0, r.policyDesired - (r.stockBefore - r.wear - r.arbitraryLoss)) }));
});
const monthly: unknown[] = [];

const seed = process.argv[2] ?? 'alpha-river';
const years = Number(process.argv[3] ?? 130);
const out = process.argv[4] ?? `output/timber/decision/${seed}.json`;
const sim = new Simulation({ seed, startingPopulation: 360 });
const internals = sim as unknown as { knowledgeSystem: KnowledgeSystem };

type Totals = Record<string, number>;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const bump = (t: Totals, k: string, v: number) => { t[k] = (t[k] ?? 0) + v; };
const round = (n: number) => Math.round(n * 1000) / 1000;
const facilities = (s: Settlement): ProcessingFacility[] => s.processing?.facilities ?? [];
const facilityHeld = (s: Settlement, id: string) => sum(facilities(s).map(f => (f.inputs[id] ?? 0) + (f.outputs[id] ?? 0)));
const facilityTotal = (s: Settlement, key: 'consumed' | 'produced' | 'arrived' | 'dispatchedIn' | 'dispatchedOut' | 'deliveredOut' | 'returned' | 'spoiled', id: string) =>
  sum(facilities(s).map(f => f.totals[key][id] ?? 0));
const facilityTransit = (s: Settlement, id: string) => sum(facilities(s).map(f => f.transit.filter(t => t.material === id).reduce((n, t) => n + t.quantity, 0)));

/** Which authority moved settlement timber, read from the live call stack at the write. */
let lastBulkCause = '';
function cause(stack: string): string {
  if (stack.includes('reconcileBulkStocks')) return `legacy:${lastBulkCause}`;
  if (stack.includes('dispatchInbound')) return 'facility-transfer-out';
  if (stack.includes('deliverDue')) return 'facility-transfer-in';
  if (stack.includes('ResourceSystem.deliver')) return 'extraction-delivery';
  if (stack.includes('payBill')) return stack.includes('maintain') ? 'facility-maintenance' : 'facility-construction';
  if (stack.includes('Survival.ts')) return 'fuel-heat';
  if (stack.includes('MaterialUse.ts') || stack.includes('Construction')) return 'buildings-material-use';
  if (stack.includes('MaterialEconomy.ts') || stack.includes('runCatalogCycle')) return 'settlement-processing';
  if (stack.includes('Consumption.ts')) return 'wooden-arms';
  if (stack.includes('trade') || stack.includes('Trade')) return 'trade';
  if (stack.includes('buildInfrastructure')) return 'infrastructure';
  if (stack.includes('repairStructures')) return 'building-repair';
  if (stack.includes('TransportationSystem')) return 'transport-construction';
  if (stack.includes('SettlementDevelopmentSystem')) return 'settlement-development';
  return stack.split('\n').filter(l => l.includes('/src/') || l.includes('\\src\\')).slice(0, 2).map(l => l.trim().replace(/.*[\\/]src[\\/]/, '')).join('|') || 'other';
}

interface GateRecord {
  year: number; month: number; discoveredThisYear: boolean; blockers: string[]; onlyWoodBlocker: boolean;
  resourcesWood: number; settlementTimber: number; facilityTimber: number; settlementCharcoal: number; facilityCharcoal: number;
  charcoalProduced12: number; charcoalProducedLifetime: number; charcoalCapableFacility: boolean; charcoalRecipeKnown: boolean;
  controlledAccessibleTimberDeposits: number; standingForest: number; timberDelivered12: number; timberExtracted12: number;
  combustionTheory: number; combustionPractice: number; testingTheory: number; testingPractice: number;
  artisans: number; copperOre: number; ironOre: number; population: number;
  storageCapacity: number; storedVolume: number; storageRoom: number;
}

interface Row {
  id: string; name: string; peakPeople: number; initial: number;
  sources: Totals; sinks: Totals;
  rejections: Totals; rejectionsStandingForest: Totals; rejectionsByStage: Record<string, Totals>;
  extractedEvents: number; extractedAmount: number;
  storageCases: unknown[]; caseQuota: Totals; gate: GateRecord[]; metalSmeltingMonth?: number;
  arms: { draw: number; months: number; cappedByQuota: number; cappedByArtisan: number; peakRatio: number; finalArms: number; finalTarget: number; everMetTarget: boolean; drawWhileTimberBelow6: number };
  settlementCharcoalProduction: number;
  timberDelivered: number; tradeIn: number; tradeOut: number;
  annual: Array<{ year: number; timber: number; charcoal: number; extracted: number; facilityTimber: number; facilityCharcoal: number; arms: number; people: number }>;
}
const rows = new Map<string, Row>();
const monthlyExtract = new Map<string, number[]>();
const monthlyDeliver = new Map<string, number[]>();
const charcoalHistory = new Map<string, number[]>();

function observe(s: Settlement): Row {
  const existing = rows.get(s.id);
  if (existing) return existing;
  const r: Row = {
    id: s.id, name: s.name, peakPeople: 0, initial: s.localMaterials.timber ?? 0,
    sources: {}, sinks: {}, rejections: {}, rejectionsStandingForest: {}, rejectionsByStage: { queue: {}, loop: {} },
    extractedEvents: 0, extractedAmount: 0, storageCases: [], caseQuota: {}, gate: [],
    arms: { draw: 0, months: 0, cappedByQuota: 0, cappedByArtisan: 0, peakRatio: 0, finalArms: 0, finalTarget: 0, everMetTarget: false, drawWhileTimberBelow6: 0 },
    settlementCharcoalProduction: 0, timberDelivered: 0, tradeIn: 0, tradeOut: 0, annual: [],
  };
  rows.set(s.id, r);
  s.localMaterials = new Proxy(s.localMaterials, { set(target, key, value: number) {
    if (key === 'charcoal' && value > (target.charcoal ?? 0) && (new Error().stack ?? '').includes('runCatalogCycle')) r.settlementCharcoalProduction += value - (target.charcoal ?? 0);
    if (key === 'timber') {
      const delta = value - (target.timber ?? 0);
      if (Math.abs(delta) > 1e-10) {
        const label = cause(new Error().stack ?? '');
        bump(delta > 0 ? r.sources : r.sinks, label, Math.abs(delta));
        if (label === 'wooden-arms' && delta < 0) {
          r.arms.draw += -delta; r.arms.months += 1;
          if (-delta > 0.1999) r.arms.cappedByQuota += 1; else r.arms.cappedByArtisan += 1;
          if ((target.timber ?? 0) < 6) r.arms.drawWhileTimberBelow6 += -delta;
        }
      }
    }
    return Reflect.set(target, key, value);
  } });
  s.resources = new Proxy(s.resources, { set(target, key, value: number) {
    if (key === 'wood' && value !== target.wood) {
      const stack = new Error().stack ?? '';
      if (!stack.includes('publishBulkStocks')) lastBulkCause = cause(stack);
    }
    return Reflect.set(target, key, value);
  } });
  return r;
}

/** Standing forest in the settlement's own discovered timber deposits. */
const timberDeposits = (state: SimulationState, s: Settlement): ResourceDeposit[] =>
  state.world.resourceDeposits.filter(d => d.resourceId === 'timber' && s.discoveredDeposits.includes(d.id));

observeGatherDecisions((decision: GatherDecision) => {
  if (decision.resourceId !== 'timber') return;
  const r = rows.get(decision.settlementId);
  if (!r) return;
  if (decision.reason === 'extracted') { r.extractedEvents += 1; r.extractedAmount += Number(decision.context.amount ?? 0); return; }
  bump(r.rejections, decision.reason, 1);
  bump(r.rejectionsByStage[decision.stage]!, decision.reason, 1);
  const standing = Number(decision.context.standing ?? NaN);
  const undepleted = decision.reason !== 'deposit-depleted' && (Number.isNaN(standing) ? true : standing > 0.5);
  if (!undepleted) return;
  bump(r.rejectionsStandingForest, decision.reason, 1);
  // Storage/access case file: the state at a rejection while forest still stands.
  const quota = r.caseQuota[decision.reason] ?? 0;
  if ((decision.reason === 'storage-room-zero' || decision.reason === 'stock-at-extraction-target' || decision.reason === 'incoming-shipment-satisfies-target'
    || decision.reason === 'insufficient-resource-labour') && quota < 10 && (quota < 3 || decision.month % 211 === 0)) {
    r.caseQuota[decision.reason] = quota + 1;
    const s = sim.state.settlements.find(x => x.id === decision.settlementId)!;
    const residents = sim.state.people.filter(p => p.alive && p.homeId === s.id);
    const deposits = timberDeposits(sim.state, s);
    r.storageCases.push({
      month: decision.month, reason: decision.reason, context: decision.context,
      storageCapacity: round(storageCapacity(s)), storedVolume: round(storedVolume(s)), storageRoom: round(storageRoom(s)),
      occupants: Object.fromEntries(Object.entries(s.localMaterials).filter(([, v]) => v > 0.01).map(([k, v]) => [k, round(v)]).sort((a, b) => Number(b[1]) - Number(a[1]))),
      inTransitVolume: round(sum(materialEconomy(s).inTransit.map(t => t.quantity))),
      timberDemand: round(materialEconomy(s).demand.timber ?? 0), extractionTarget: round(Math.max(35, (materialEconomy(s).demand.timber ?? 0) * 2)),
      settlementTimber: round(s.localMaterials.timber ?? 0), facilityTimber: round(facilityHeld(s, 'timber')),
      settlementCharcoal: round(s.localMaterials.charcoal ?? 0), facilityCharcoal: round(facilityHeld(s, 'charcoal')),
      facilityYards: facilities(s).map(f => ({ family: f.family, kind: f.kind, yardUsed: round(sum(Object.values(f.inputs).concat(Object.values(f.outputs)))), inputs: f.inputs, outputs: f.outputs, status: f.status, limiter: f.limiter })),
      standingForest: round(sum(deposits.map(d => d.capacity * d.abundance))),
      // Whether timber's own gather occupations exist at all, versus having had their month spent earlier.
      workforce: { forager: residents.filter(p => p.occupation === 'forager').length, builder: residents.filter(p => p.occupation === 'builder').length,
        artisan: residents.filter(p => p.occupation === 'artisan').length, carrier: residents.filter(p => p.occupation === 'carrier').length, people: residents.length },
    });
  }
});

observeDiscoveryAttempts((state, s) => {
  const r = rows.get(s.id);
  if (!r || s.knowledge.records['metal-smelting'] || r.gate.length >= 140) return;
  const blockers = internals.knowledgeSystem.discoveryBlockers(state, s, 'metal-smelting');
  const deposits = timberDeposits(state, s);
  const charcoal = charcoalHistory.get(s.id) ?? [];
  const extracted = monthlyExtract.get(s.id) ?? [];
  const delivered = monthlyDeliver.get(s.id) ?? [];
  const labour = (internals.knowledgeSystem as unknown as { labourBySettlement: Map<string, { occupations: Record<string, number> }> }).labourBySettlement.get(s.id);
  const lifetime = facilityTotal(s, 'produced', 'charcoal') + r.settlementCharcoalProduction;
  r.gate.push({
    year: state.month / 12, month: state.month, discoveredThisYear: false, blockers, onlyWoodBlocker: blockers.length === 1 && blockers[0]!.startsWith('resource:wood'),
    resourcesWood: round(s.resources.wood), settlementTimber: round(s.localMaterials.timber ?? 0), facilityTimber: round(facilityHeld(s, 'timber')),
    settlementCharcoal: round(s.localMaterials.charcoal ?? 0), facilityCharcoal: round(facilityHeld(s, 'charcoal')),
    charcoalProduced12: round(sum(charcoal.slice(-12))), charcoalProducedLifetime: round(lifetime),
    charcoalCapableFacility: facilities(s).some(f => Object.keys(f.processes).some(key => key.includes('charcoal')) && f.status !== 'idle'),
    charcoalRecipeKnown: mastery(s, 'fire-control').practice >= 0.2,
    controlledAccessibleTimberDeposits: deposits.filter(d => depositControlled(state, s, d) && extractableQuantity(s, d) > 0).length,
    standingForest: round(sum(deposits.map(d => d.capacity * d.abundance))),
    timberDelivered12: round(sum(delivered.slice(-12))), timberExtracted12: round(sum(extracted.slice(-12))),
    combustionTheory: round(mastery(s, 'combustion-dynamics').theory), combustionPractice: round(mastery(s, 'combustion-dynamics').practice),
    testingTheory: round(mastery(s, 'material-testing').theory), testingPractice: round(mastery(s, 'material-testing').practice),
    artisans: labour?.occupations.artisan ?? 0, copperOre: round(s.localMaterials['copper-ore'] ?? 0), ironOre: round(s.localMaterials['iron-ore'] ?? 0),
    population: settlementRepresentedPopulation(state, s.id, state.people.filter(p => p.alive && p.homeId === s.id)),
    storageCapacity: round(storageCapacity(s)), storedVolume: round(storedVolume(s)), storageRoom: round(storageRoom(s)),
  });
});

const previousCharcoal = new Map<string, number>();
for (let month = 1; month <= years * 12; month++) {
  for (const s of sim.state.settlements) observe(s);
  const beforeExtract = new Map(sim.state.settlements.map(s => [s.id, rows.get(s.id)?.extractedAmount ?? 0]));
  sim.step();
  for (const s of sim.state.settlements.filter(s => s.alive)) {
    const r = observe(s);
    const people = sim.state.people.filter(p => p.alive && p.homeId === s.id);
    r.peakPeople = Math.max(r.peakPeople, people.length);
    const economy = materialEconomy(s);
    r.timberDelivered += economy.delivered.timber ?? 0;
    const extractHistory = monthlyExtract.get(s.id) ?? []; extractHistory.push(r.extractedAmount - (beforeExtract.get(s.id) ?? 0)); monthlyExtract.set(s.id, extractHistory);
    const deliverHistory = monthlyDeliver.get(s.id) ?? []; deliverHistory.push(economy.delivered.timber ?? 0); monthlyDeliver.set(s.id, deliverHistory);
    const charcoalNow = facilityTotal(s, 'produced', 'charcoal') + (s.localMaterials.charcoal ?? 0) + facilityHeld(s, 'charcoal');
    const history = charcoalHistory.get(s.id) ?? [];
    history.push(Math.max(0, facilityTotal(s, 'produced', 'charcoal') - (previousCharcoal.get(s.id) ?? 0)));
    previousCharcoal.set(s.id, facilityTotal(s, 'produced', 'charcoal'));
    charcoalHistory.set(s.id, history);
    void charcoalNow;
    if (s.knowledge.records['metal-smelting'] && r.metalSmeltingMonth === undefined) {
      r.metalSmeltingMonth = sim.state.month;
      const last = r.gate.at(-1);
      if (last && sim.state.month - last.month < 12) last.discoveredThisYear = true;
    }
    r.arms.finalArms = round(economy.timberArms);
    r.arms.finalTarget = round(people.length * 0.1);
    r.arms.peakRatio = Math.max(r.arms.peakRatio, economy.timberArms / Math.max(1, people.length * 0.1));
    if (economy.timberArms >= people.length * 0.1) r.arms.everMetTarget = true;
    if (month % 12 === 0) {
      r.annual.push({ year: month / 12, timber: round(s.localMaterials.timber ?? 0), charcoal: round(s.localMaterials.charcoal ?? 0),
        extracted: round(sum(extractHistory.slice(-12))), facilityTimber: round(facilityHeld(s, 'timber')), facilityCharcoal: round(facilityHeld(s, 'charcoal')),
        arms: round(economy.timberArms), people: people.length });
    }
  }
  monthly.push({ month, settlements: sim.state.settlements.filter(s => s.alive).map(s => ({ id: s.id, population: sim.state.people.filter(p => p.alive && p.homeId === s.id).length, timber: s.localMaterials.timber ?? 0, room: storageRoom(s), volume: storedVolume(s), capacity: storageCapacity(s) })) });
  if (month % 120 === 0) console.log(`${seed}: year ${month / 12}`);
}

observeGatherDecisions(undefined);
observeDiscoveryAttempts(undefined);

const settlements = [...rows.values()].map(r => {
  const s = sim.state.settlements.find(x => x.id === r.id)!;
  const deposits = timberDeposits(sim.state, s);
  const economy = materialEconomy(s);
  const ledger = {
    externalDepositExtracted: round(r.extractedAmount),
    inTransitToSettlement: round(sum(economy.inTransit.filter(t => t.resourceId === 'timber').map(t => t.quantity))),
    deliveredToSettlement: round(r.timberDelivered),
    settlementInventory: round(s.localMaterials.timber ?? 0),
    facilityInputYard: round(sum(facilities(s).map(f => f.inputs.timber ?? 0))),
    facilityOutputYard: round(sum(facilities(s).map(f => f.outputs.timber ?? 0))),
    facilityInTransit: round(facilityTransit(s, 'timber')),
    transferToFacilities: round(facilityTotal(s, 'dispatchedIn', 'timber')),
    transferBackFromFacilities: round(facilityTotal(s, 'deliveredOut', 'timber')),
    facilityRealConsumption: round(facilityTotal(s, 'consumed', 'timber')),
    facilityProducedCharcoal: round(facilityTotal(s, 'produced', 'charcoal')),
    settlementProducedCharcoal: round(r.settlementCharcoalProduction),
    settlementProcessingConsumption: round(r.sinks['settlement-processing'] ?? 0),
    woodenArmsConsumption: round(r.arms.draw),
    fuelHeatConsumption: round(r.sinks['fuel-heat'] ?? 0),
    constructionAndInfrastructure: round(sum(['buildings-material-use', 'legacy:infrastructure', 'infrastructure', 'facility-construction', 'facility-maintenance',
      'legacy:facility-construction', 'legacy:facility-maintenance', 'transport-construction', 'building-repair', 'settlement-development', 'legacy:settlement-development'].map(k => r.sinks[k] ?? 0))),
    tradeExport: round(r.sinks.trade ?? 0), tradeImport: round(r.sources.trade ?? 0),
    unattributedLegacy: round(sum(Object.entries(r.sinks).filter(([k]) => k.startsWith('legacy:') && !k.includes('infrastructure') && !k.includes('facility') && !k.includes('development')).map(([, v]) => v))),
    remainingStock: round(s.localMaterials.timber ?? 0),
    standingForestFinal: round(sum(deposits.map(d => d.capacity * d.abundance))),
    standingForestCapacity: round(sum(deposits.map(d => d.capacity))),
    conservationResidual: round(r.initial + sum(Object.values(r.sources)) - sum(Object.values(r.sinks)) - (s.localMaterials.timber ?? 0)),
  };
  return { ...r, finalState: { alive: s.alive, timberArms: economy.timberArms, metalArms: economy.arms,
    pendingCombatLoss: economy.woodenArmsService?.combatLoss ?? 0, service: economy.woodenArmsService }, sources: Object.fromEntries(Object.entries(r.sources).map(([k, v]) => [k, round(v)])),
    sinks: Object.fromEntries(Object.entries(r.sinks).map(([k, v]) => [k, round(v)])), ledger,
    finalFacilities: facilities(s).map(f => ({ family: f.family, kind: f.kind, status: f.status, limiter: f.limiter, inputs: f.inputs, outputs: f.outputs,
      consumed: f.totals.consumed, produced: f.totals.produced, batches: Object.fromEntries(Object.entries(f.processes).map(([k, p]) => [k, p.lifetimeBatches])) })),
    knowledge: Object.fromEntries(['metal-smelting', 'combustion-dynamics', 'material-testing', 'fire-control', 'stone-composites', 'pottery-firing']
      .map(id => [id, s.knowledge.records[id] ? { theory: round(s.knowledge.records[id]!.theory), practice: round(s.knowledge.records[id]!.practice) } : null])),
  };
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ seed, years, config: { startingPopulation: 360 }, armsRecords, monthly, settlements,
  wars: sim.state.wars.map(w => ({ id:w.id, attacker:w.attacker, defender:w.defender, startMonth:w.startMonth,
    resolvedMonth:w.resolvedMonth, active:w.active, casualtiesA:w.casualtiesA, casualtiesB:w.casualtiesB,
    battles:w.campaign.battleCount, resolutionReason:w.resolutionReason })), stats: sim.state.stats }));
console.log(`done ${seed}: ${out}`);
