import { writeFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation';
import { knowledgeLifecycleStage } from '../src/sim/knowledge/CapabilityContract';
import { materialEconomy } from '../src/sim/resources/Inventory';
import type { Settlement, SimulationState } from '../src/sim/types';

const seed = process.argv[2]!;
const years = Number(process.argv[3] ?? 130);
const out = process.argv[4]!;

const TRACKED = ['irrigation', 'metal-smelting', 'durable-records', 'combustion-dynamics', 'counting-measure', 'material-testing', 'pottery-firing', 'iron-working', 'precision-tools'];

interface Row {
  settlement: string; peakPeople: number; finalPeople: number;
  potteryAdopted: number | null; firstWorkshop: number | null; craftCircle: number | null;
  first: Record<string, number | null>;
  peakGoods: number; finalGoods: number; goodsPerPerson: number; finalWealth: number;
  finalTimber: number; finalStone: number; peakArtisans: number; finalArtisans: number;
  routes: number; craftedTotal: number;
  blockers: Record<string, string>;      // persistent blocker per unreached knowledge
  workshopBlocker: string;
}

const sim = new Simulation({ seed, startingPopulation: 360 } as never);
const ks = (sim as never as {
  knowledgeSystem: {
    infrastructureDiagnostics: (s: SimulationState, x: Settlement) => Array<{ key: string; blocker: string }>;
    discoveryBlockers: (s: SimulationState, x: Settlement, id: string) => string[];
  };
}).knowledgeSystem;

const rows = new Map<string, Row>();
// Observe the decision itself, before annual construction spends material. End-of-year
// diagnostics alone can name a blocker which was not present at the discovery attempt.
const decisions: unknown[] = [];
const decisionSystem = ks as unknown as { attemptDiscoveries: (state: SimulationState, s: Settlement) => unknown[] };
const attempt = decisionSystem.attemptDiscoveries.bind(decisionSystem);
decisionSystem.attemptDiscoveries = (state, s) => {
  if (!s.knowledge.records['metal-smelting']) decisions.push({ month: state.month, settlement: s.name,
    blockers: ks.discoveryBlockers(state, s, 'metal-smelting'), timber: s.localMaterials.timber ?? 0, wood: s.resources.wood,
    charcoal: s.localMaterials.charcoal ?? 0, copperOre: s.localMaterials['copper-ore'] ?? 0, ironOre: s.localMaterials['iron-ore'] ?? 0,
    experience: { ...materialEconomy(s).experience },
    fuelUsed: s.survival?.cold.fuelUsed ?? 0,
    facilities: (s.processing?.facilities ?? []).map(f => ({ family: f.family, status: f.status, inputs: { ...f.inputs }, outputs: { ...f.outputs },
      consumed: { ...f.totals.consumed }, produced: { ...f.totals.produced }, lastActiveMonth: f.lastActiveMonth })),
  });
  return attempt(state, s);
};
// Blocker observations over the final third of the run decide what is "persistent".
const tail = new Map<string, Map<string, string[]>>();
const persistWindow = Math.floor(years * 0.66);

const row = (s: Settlement): Row => {
  let r = rows.get(s.id);
  if (!r) {
    r = { settlement: s.name, peakPeople: 0, finalPeople: 0, potteryAdopted: null, firstWorkshop: null, craftCircle: null,
      first: Object.fromEntries(TRACKED.map(id => [id, null])), peakGoods: 0, finalGoods: 0, goodsPerPerson: 0, finalWealth: 0,
      finalTimber: 0, finalStone: 0, peakArtisans: 0, finalArtisans: 0, routes: 0, craftedTotal: 0,
      blockers: {}, workshopBlocker: 'n/a' };
    rows.set(s.id, r);
  }
  return r;
};

for (let y = 1; y <= years; y++) {
  sim.step(12);
  for (const s of sim.state.settlements.filter(c => c.alive)) {
    const r = row(s);
    const residents = sim.state.people.filter(p => p.alive && p.homeId === s.id);
    const artisans = residents.filter(p => p.occupation === 'artisan').length;
    r.peakPeople = Math.max(r.peakPeople, residents.length);
    r.finalPeople = residents.length;
    r.peakArtisans = Math.max(r.peakArtisans, artisans);
    r.finalArtisans = artisans;
    r.peakGoods = Math.max(r.peakGoods, s.resources.goods);
    r.finalGoods = s.resources.goods;
    r.goodsPerPerson = residents.length ? s.resources.goods / residents.length : 0;
    r.finalWealth = s.resources.wealth;
    r.finalTimber = s.localMaterials.timber ?? 0;
    r.finalStone = s.localMaterials.stone ?? 0;
    r.craftedTotal = materialEconomy(s).craftedTotal ?? 0;
    r.routes = sim.state.tradeRoutes.filter(t => t.active && (t.a === s.id || t.b === s.id)).length;
    if (r.potteryAdopted === null && knowledgeLifecycleStage(s, 'pottery-firing') === 'adopted') r.potteryAdopted = y;
    if (r.firstWorkshop === null && s.infrastructure.workshops >= 0.08) r.firstWorkshop = y;
    if (r.craftCircle === null && sim.state.institutions.some(i => i.settlementId === s.id && i.kind === 'craft-circle')) r.craftCircle = y;
    for (const id of TRACKED) if (r.first[id] === null && s.knowledge.records[id]) r.first[id] = y;
    if (y >= persistWindow) {
      let perSettlement = tail.get(s.id);
      if (!perSettlement) tail.set(s.id, perSettlement = new Map());
      for (const id of TRACKED) {
        if (s.knowledge.records[id]) continue;
        const b = ks.discoveryBlockers(sim.state, s, id);
        const key = b.length === 0 ? 'eligible-awaiting-experimentation' : b.map(x => x.split(' ')[0]).join('+');
        (perSettlement.get(id) ?? perSettlement.set(id, []).get(id)!).push(key);
      }
      if (s.infrastructure.workshops < 0.08) {
        const w = ks.infrastructureDiagnostics(sim.state, s).find(d => d.key === 'workshops');
        (perSettlement.get('#workshop') ?? perSettlement.set('#workshop', []).get('#workshop')!).push((w?.blocker ?? '?').split(' ')[0]!);
      }
    }
  }
}

const modal = (list: string[] | undefined): string => {
  if (!list?.length) return 'n/a';
  const counts = new Map<string, number>();
  for (const v of list) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
};
for (const [id, r] of rows) {
  const perSettlement = tail.get(id);
  for (const k of TRACKED) if (r.first[k] === null) r.blockers[k] = modal(perSettlement?.get(k));
  if (r.firstWorkshop === null) r.workshopBlocker = modal(perSettlement?.get('#workshop'));
}

writeFileSync(out, JSON.stringify({
  seed, years, decisions,
  settlements: [...rows.values()].sort((a, b) => b.peakPeople - a.peakPeople),
  aliveAtEnd: sim.state.settlements.filter(s => s.alive).length,
  activeRoutes: sim.state.tradeRoutes.filter(r => r.active).length,
  institutionKinds: [...new Set(sim.state.institutions.map(i => i.kind))].sort(),
}, null, 1));
console.log(`done ${seed}`);
