// Summarize architecture reachability runs: node scripts/summarize-architecture-reachability.mjs <dir>
import { readFileSync, readdirSync } from 'node:fs';
const dir = process.argv[2] ?? 'output/architecture-reachability/after';
const runs = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
const ids = Object.keys(runs[0].archetypes);
console.log(['archetype', ...runs.map(r => r.seed)].join(' | '));
for (const id of ids) {
  console.log([id.padEnd(14), ...runs.map(r => { const t = r.archetypes[id];
    return t.firstConstructed === null ? (t.firstStarted === null ? '—' : `started y${t.firstStarted}`) : `y${t.firstConstructed} vis y${t.firstVisible ?? '—'} peak ${t.peak}/${t.peakVisible} end ${t.final}/${t.finalVisible} [${t.periods.join(',')}]${t.runningMonths ? ` ran ${t.runningMonths}mo` : ''}`; })].join(' | '));
}
for (const r of runs) {
  console.log(`\n${r.seed}: pop peak ${r.population.peak} final ${r.population.final}; settlements ${r.settlements.final}; eras ${JSON.stringify(r.eras)}`);
  console.log('  capabilities', JSON.stringify(r.capabilities));
  console.log('  maxLevel', JSON.stringify(r.maxLevel));
  console.log('  plants', JSON.stringify(r.plants));
  console.log('  facilities', JSON.stringify(r.facilities));
  console.log('  bridges', JSON.stringify(r.bridges));
  console.log('  generations', JSON.stringify(r.generations.map(g => `${g.settlement}:${g.plots}/${g.displayed}:${g.displayedPeriods.join('+')}`)));
}
