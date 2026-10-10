/**
 * Read-only companion to the timber reachability audit. At the exact moment each settlement's
 * discovery candidates are filtered, it records the blockers of the chain metal-smelting depends
 * on, so the dominant gate can be named rather than inferred. No behaviour is altered.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Simulation } from '../src/sim/Simulation';
import { observeDiscoveryAttempts } from '../src/sim/knowledge/KnowledgeSystem';
import { combustibleAccess } from '../src/sim/resources/Inventory';
import type { KnowledgeSystem } from '../src/sim/knowledge/KnowledgeSystem';

const seed = process.argv[2] ?? 'east-marsh';
const years = Number(process.argv[3] ?? 130);
const out = process.argv[4] ?? `output/timber/foundations/${seed}.json`;
const sim = new Simulation({ seed, startingPopulation: 360 });
const internals = sim as unknown as { knowledgeSystem: KnowledgeSystem };
const CHAIN = ['fire-control', 'combustion-dynamics', 'material-testing', 'metal-smelting'];
const rows = new Map<string, { id: string; name: string; peakPeople: number; years: unknown[] }>();

observeDiscoveryAttempts((state, s) => {
  const row = rows.get(s.id) ?? { id: s.id, name: s.name, peakPeople: 0, years: [] };
  rows.set(s.id, row);
  if (row.years.length >= 140) return;
  row.years.push({
    year: state.month / 12,
    institutions: state.institutions.filter(i => i.settlementId === s.id).map(i => i.kind),
    records: Object.fromEntries(CHAIN.map(id => [id, s.knowledge.records[id]
      ? { theory: Math.round(s.knowledge.records[id]!.theory * 1000) / 1000, practice: Math.round(s.knowledge.records[id]!.practice * 1000) / 1000 } : null])),
    blockers: Object.fromEntries(CHAIN.map(id => [id, internals.knowledgeSystem.discoveryBlockers(state, s, id)])),
    experimentation: { materials: Math.round((s.knowledge.experimentation.materials ?? 0) * 1000) / 1000, energy: Math.round((s.knowledge.experimentation.energy ?? 0) * 1000) / 1000 },
    fuel: Math.round(combustibleAccess(s) * 1000) / 1000,
    timber: Math.round((s.localMaterials.timber ?? 0) * 1000) / 1000,
    charcoal: Math.round((s.localMaterials.charcoal ?? 0) * 1000) / 1000,
    resourcesWood: Math.round(s.resources.wood * 1000) / 1000,
    population: state.people.filter(p => p.alive && p.homeId === s.id).length,
  });
});

for (let month = 1; month <= years * 12; month++) {
  sim.step();
  for (const s of sim.state.settlements.filter(s => s.alive)) {
    const row = rows.get(s.id);
    if (row) row.peakPeople = Math.max(row.peakPeople, sim.state.people.filter(p => p.alive && p.homeId === s.id).length);
  }
  if (month % 240 === 0) console.log(`${seed}: year ${month / 12}`);
}
observeDiscoveryAttempts(undefined);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ seed, years, settlements: [...rows.values()] }));
console.log(`done ${seed}: ${out}`);
