/** Read-only simulation observer. Proxies forward every write unchanged; no random draws or resource grants. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Simulation } from '../src/sim/Simulation';
import { depositControlled, extractableQuantity } from '../src/sim/resources/ResourceSystem';
import { materialEconomy, storageRoom } from '../src/sim/resources/Inventory';
import { resourceWorkAssignments } from '../src/sim/resources/ResourceWorkAssignments';
import type { ExtractionAccessibility } from '../src/sim/resources/ExtractionAccessibility';
import type { LabourBudget } from '../src/sim/resources/Processing';
import type { ResourceDeposit, Settlement, SimulationState } from '../src/sim/types';
import type { KnowledgeSystem } from '../src/sim/knowledge/KnowledgeSystem';

const seed = process.argv[2] ?? 'alpha-river';
const years = Number(process.argv[3] ?? 130);
const out = process.argv[4] ?? `output/timber/before/${seed}.json`;
const sim = new Simulation({ seed, startingPopulation: 360 });
const internals = sim as unknown as { knowledgeSystem: KnowledgeSystem; resourceSystem: {
  access: ExtractionAccessibility;
  gather(state: SimulationState, s: Settlement, nearby: ResourceDeposit[], budget: LabourBudget, events: unknown[]): void;
} };
const tracked = ['irrigation', 'metal-smelting', 'durable-records', 'combustion-dynamics', 'counting-measure', 'material-testing', 'pottery-firing', 'iron-working', 'precision-tools'];
type Totals = Record<string, number>;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const bump = (t: Totals, k: string, v: number) => { t[k] = (t[k] ?? 0) + v; };
interface Row {
  id: string; settlement: string; initial: number; peakPeople: number; first: Record<string, number>;
  firstWorkshop?: number; craftCircle?: number; sources: Totals; sinks: Totals; bulkChanges: Totals;
  below: Totals; extracted: number; processed: number; months: unknown[]; samples: Record<string, string>;
}
const rows = new Map<string, Row>();
let lastBulkCause = '';
function cause(stack: string): string {
  if (stack.includes('reconcileBulkStocks')) return `legacy:${lastBulkCause}`;
  if (stack.includes('dispatchInbound')) return 'facility-transfer';
  if (stack.includes('deliverDue')) return 'facility-return';
  if (stack.includes('ResourceSystem.deliver')) return 'extraction-delivery';
  if (stack.includes('payBill')) return stack.includes('maintain') ? 'facility-maintenance' : 'facility-construction';
  if (stack.includes('Survival.ts')) return 'fuel-heat';
  if (stack.includes('MaterialUse.ts') || stack.includes('Construction')) return 'buildings-material-use';
  if (stack.includes('MaterialEconomy.ts') || stack.includes('runCatalogCycle')) return 'settlement-processing';
  if (stack.includes('Consumption.ts')) return 'household-arms-spoilage';
  if (stack.includes('trade') || stack.includes('Trade')) return 'trade';
  if (stack.includes('buildInfrastructure')) return 'infrastructure';
  if (stack.includes('repairStructures')) return 'building-repair';
  if (stack.includes('TransportationSystem')) return 'transport-construction';
  return stack.split('\n').filter(l => l.includes('/src/') || l.includes('\\src\\')).slice(0, 3).map(l => l.trim().replace(/.*[\\/]src[\\/]/, '')).join('|') || 'other';
}
function observe(s: Settlement): Row {
  const existing = rows.get(s.id);
  if (existing) return existing;
  const r: Row = { id: s.id, settlement: s.name, initial: s.localMaterials.timber ?? 0, peakPeople: 0,
    first: {}, sources: {}, sinks: {}, bulkChanges: {}, below: {}, extracted: 0, processed: 0, months: [], samples: {} };
  rows.set(s.id, r);
  s.localMaterials = new Proxy(s.localMaterials, { set(target, key, value: number) {
    if (key === 'timber') {
      const delta = value - (target.timber ?? 0);
      if (Math.abs(delta) > 1e-10) {
        const stack = new Error().stack ?? '';
        const label = cause(stack);
        bump(delta > 0 ? r.sources : r.sinks, label, Math.abs(delta));
        r.samples[label] ??= stack;
      }
    }
    return Reflect.set(target, key, value);
  } });
  s.resources = new Proxy(s.resources, { set(target, key, value: number) {
    if (key === 'wood' && value !== target.wood) {
      const stack = new Error().stack ?? '';
      if (!stack.includes('publishBulkStocks')) {
        lastBulkCause = cause(stack);
        bump(r.bulkChanges, lastBulkCause, value - target.wood);
      }
    }
    return Reflect.set(target, key, value);
  } });
  return r;
}
const gatherRows = new Map<string, unknown>();
const resource = internals.resourceSystem;
const gather = resource.gather.bind(resource);
resource.gather = (state, s, nearby, budget, events) => {
  const timber = nearby.filter(d => d.resourceId === 'timber');
  const e = materialEconomy(s);
  const eligible = timber.filter(d => s.discoveredDeposits.includes(d.id) && depositControlled(state, s, d));
  const target = Math.max(35, (e.demand.timber ?? 0) * 2);
  const incoming = sum(e.inTransit.filter(t => t.resourceId === 'timber').map(t => t.quantity));
  gatherRows.set(s.id, { target, stock: s.localMaterials.timber ?? 0, incoming, requested: Math.max(0, target - (s.localMaterials.timber ?? 0) - incoming),
    labour: { ...budget }, storageRoom: storageRoom(s), capacity: sum(timber.map(d => d.capacity)),
    remaining: sum(timber.map(d => d.capacity * d.abundance)), discovered: eligible.length,
    deposits: timber.map(d => { const access = s.discoveredDeposits.includes(d.id) ? resource.access.resolve(s, d) : undefined; return {
      id: d.id, capacity: d.capacity, remaining: d.capacity * d.abundance, extracted: d.extracted ?? 0,
      discovered: s.discoveredDeposits.includes(d.id), controlled: depositControlled(state, s, d), extractable: extractableQuantity(s, d),
      accessCost: access?.cost ?? null, transportMonths: access?.months ?? null, quality: d.quality, accessibility: d.accessibility,
      weather: { snowpack: state.world.weather?.cells[d.cellIndex]?.snowpack, flood: state.world.weather?.cells[d.cellIndex]?.floodDepth },
    }; }),
  });
  gather(state, s, nearby, budget, events);
};
const throughput = new Map<string, number[]>();
const previousFlows = new Map<string, { sources: Totals; sinks: Totals }>();
const weatherSystem = (sim as unknown as { weatherSystem: { advanceMonth(): void } }).weatherSystem;
const advanceWeather = weatherSystem.advanceMonth.bind(weatherSystem);
const forestChange = new Map<string, { regrowth: number; weatherLoss: number }>();
weatherSystem.advanceMonth = () => {
  const woods = sim.state.world.cells.map(c => c.wood);
  advanceWeather();
  for (const d of sim.state.world.resourceDeposits.filter(d => d.resourceId === 'timber')) {
    let regrowth = 0, weatherLoss = 0;
    for (const local of d.cells ?? [{ cellIndex: d.cellIndex, capacity: d.capacity }]) {
      const c = sim.state.world.cells[local.cellIndex]!;
      const change = local.capacity * (c.wood - woods[local.cellIndex]!) / Math.max(0.01, c.forestCapacity ?? c.wood);
      regrowth += Math.max(0, change); weatherLoss += Math.max(0, -change);
    }
    forestChange.set(d.id, { regrowth, weatherLoss });
  }
};
for (let month = 1; month <= years * 12; month++) {
  for (const s of sim.state.settlements) observe(s);
  const before = new Map(sim.state.world.resourceDeposits.filter(d => d.resourceId === 'timber').map(d => [d.id, { stock: d.capacity * d.abundance, extracted: d.extracted ?? 0 }]));
  sim.step();
  const works = resourceWorkAssignments(sim.state);
  for (const s of sim.state.settlements.filter(s => s.alive)) {
    const r = observe(s), e = materialEconomy(s);
    const people = sim.state.people.filter(p => p.alive && p.homeId === s.id);
    if (month % 12 === 0) {
      r.peakPeople = Math.max(r.peakPeople, people.length);
      for (const id of tracked) if (r.first[id] === undefined && s.knowledge.records[id]) r.first[id] = month / 12;
      if (s.infrastructure.workshops >= 0.08) r.firstWorkshop ??= month / 12;
      if (sim.state.institutions.some(i => i.settlementId === s.id && i.kind === 'craft-circle')) r.craftCircle ??= month / 12;
    }
    const stock = s.localMaterials.timber ?? 0;
    for (const threshold of [1, 6, 12, 35]) if (stock < threshold) bump(r.below, String(threshold), 1);
    const extracted = sum(works.filter(w => w.settlementId === s.id && w.resourceId === 'timber').map(w => w.amountExtracted));
    r.extracted += extracted;
    const history = throughput.get(s.id) ?? [];
    history.push(extracted); throughput.set(s.id, history);
    const facilities = s.processing?.facilities ?? [];
    // Typed recipe lifetimeConsumed also includes facility recipes; do not count those twice.
    const processed = sum(facilities.map(f => f.totals.consumed.timber ?? 0)) + (r.sinks['settlement-processing'] ?? 0);
    const timberDeposits = sim.state.world.resourceDeposits.filter(d => d.resourceId === 'timber' && s.discoveredDeposits.includes(d.id));
    const regrowthAndDisturbance = sum(timberDeposits.map(d => d.capacity * d.abundance - (before.get(d.id)?.stock ?? d.capacity * d.abundance) + (d.extracted ?? 0) - (before.get(d.id)?.extracted ?? 0)));
    const previousFlow = previousFlows.get(s.id) ?? { sources: {}, sinks: {} };
    const deltaFlow = (now: Totals, previous: Totals) => Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v - (previous[k] ?? 0)]));
    r.months.push({ month, people: people.length, stock, extracted, delivered: e.delivered.timber ?? 0,
      sources: deltaFlow(r.sources, previousFlow.sources), sinks: deltaFlow(r.sinks, previousFlow.sinks),
      inventory: { ...s.localMaterials }, inTransit: e.inTransit.map(t => ({ material: t.resourceId, quantity: t.quantity, remainingMonths: t.remainingMonths })),
      grossRegrowth: sum(timberDeposits.map(d => forestChange.get(d.id)?.regrowth ?? 0)),
      weatherLoss: sum(timberDeposits.map(d => forestChange.get(d.id)?.weatherLoss ?? 0)),
      processed: processed - r.processed, regrowthAndDisturbance, gather: gatherRows.get(s.id),
      recent: Object.fromEntries([5, 10, 20].map(y => [y, sum(history.slice(-12 * y))])),
      facilities: facilities.map(f => ({ family: f.family, consumed: { ...f.totals.consumed }, produced: { ...f.totals.produced }, inputs: { ...f.inputs }, status: f.status, limiter: f.limiter,
        processes: Object.fromEntries(Object.entries(f.processes).map(([key, p]) => [key, p.lifetimeBatches])) })),
      blockers: month % 12 === 0 ? internals.knowledgeSystem.discoveryBlockers(sim.state, s, 'metal-smelting') : undefined,
      fuel: { charcoal: s.localMaterials.charcoal ?? 0, coal: s.localMaterials.coal ?? 0 },
    });
    r.processed = processed;
    previousFlows.set(s.id, { sources: { ...r.sources }, sinks: { ...r.sinks } });
  }
  if (month % 120 === 0) console.log(`${seed}: year ${month / 12}`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ seed, years, config: { startingPopulation: 360 }, settlements: [...rows.values()].map(r => {
  const s = sim.state.settlements.find(s => s.id === r.id)!;
  const finalTimber = s.localMaterials.timber ?? 0;
  return { ...r, finalTimber, craftedTotal: materialEconomy(s).craftedTotal ?? 0,
    conservationResidual: r.initial + sum(Object.values(r.sources)) - sum(Object.values(r.sinks)) - finalTimber };
}), institutionKinds: [...new Set(sim.state.institutions.map(i => i.kind))] }));
console.log(`done ${seed}: ${out}`);
