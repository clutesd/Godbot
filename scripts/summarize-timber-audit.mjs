import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = process.argv[2] ?? 'output/timber/before';
const runs = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
const sum = xs => xs.reduce((a, b) => a + b, 0);
const aggregate = (rows, pick) => {
  const result = {};
  for (const r of rows) for (const [key, amount] of Object.entries(pick(r))) result[key] = (result[key] ?? 0) + amount;
  return result;
};
const reports = runs.map(run => {
  const rows = run.settlements.filter(s => s.peakPeople >= 60);
  const months = rows.flatMap(s => s.months);
  const g = months.filter(m => m.gather);
  const closest = rows.flatMap(s => s.months.filter(m => m.blockers?.length && !m.blockers.some(b => b.startsWith('foundation:')))
    .map(m => ({ settlement: s.settlement, month: m.month, stock: m.stock, recent: m.recent, fuel: m.fuel, blockers: m.blockers,
      annualExtracted: sum(s.months.filter(x => x.month > m.month - 12 && x.month <= m.month).map(x => x.extracted)),
      facilities: m.facilities.map(f => ({ family: f.family, inputs: f.inputs, consumed: f.consumed, produced: f.produced })) })))
    .sort((a, b) => a.blockers.length - b.blockers.length || b.fuel.charcoal - a.fuel.charcoal).slice(0, 12);
  return { seed: run.seed, established: rows.length, observedMonths: months.length,
    residual: Math.max(...run.settlements.map(s => Math.abs(s.conservationResidual))),
    sources: aggregate(rows, s => s.sources), sinks: aggregate(rows, s => s.sinks),
    extracted: sum(rows.map(s => s.extracted)), delivered: sum(months.map(m => m.delivered)),
    below: aggregate(rows, s => s.below),
    finalUnder1: rows.filter(s => s.finalTimber < 1).length,
    gather: { requested: sum(g.map(m => m.gather.requested)), capBinding: g.filter(m => m.gather.requested <= 0).length,
      storageFull: g.filter(m => m.gather.storageRoom < 0.001).length,
      noOrdinaryTimberLabour: g.filter(m => (m.gather.labour.forager ?? 0) + (m.gather.labour.builder ?? 0) < 0.001).length,
      noAccessibleTimber: g.filter(m => !m.gather.deposits.some(d => d.discovered && d.controlled && d.extractable > 0 && d.accessCost !== null && d.accessCost <= 8)).length },
    facilitiesConsumed: aggregate(rows, s => aggregate(s.months.at(-1)?.facilities ?? [], f => f.consumed)),
    facilitiesProduced: aggregate(rows, s => aggregate(s.months.at(-1)?.facilities ?? [], f => f.produced)),
    settlements: rows.map(s => { const mm = s.months, last = mm.at(-1), gg = mm.filter(m => m.gather); return {
      name: s.settlement, peak: s.peakPeople, extracted: s.extracted, final: s.finalTimber, sources: s.sources, sinks: s.sinks,
      crafted: s.craftedTotal, below: s.below, recent: last.recent, first: s.first,
      meanAvailableLabour: sum(gg.map(m => (m.gather.labour.forager ?? 0) + (m.gather.labour.builder ?? 0))) / gg.length,
      initialStanding: gg[0]?.gather.remaining, finalStanding: gg.at(-1)?.gather.remaining,
      finalCapacity: gg.at(-1)?.gather.capacity,
    }; }), closest,
  };
});
const out = `${dir}/../${dir.split(/[\\/]/).at(-1)}-summary.json`;
writeFileSync(out, JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports.map(({ settlements, ...r }) => ({ ...r, settlements: settlements.map(({sources, sinks, ...s}) => s) })), null, 2));
