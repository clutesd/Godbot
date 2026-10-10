import { readFileSync, existsSync } from 'node:fs';

const dirs = { before: process.argv[2] ?? 'output/timber/foundations', after: process.argv[3] ?? 'output/timber/foundations-after' };
const seeds = (process.argv[4] ?? 'alpha-river,basalt-coast,delta-hill,east-marsh,north-steppe,stone-basin').split(',');
const round = n => Math.round(n * 1000) / 1000;
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';

function report(dir, seed) {
  const path = `${dir}/${seed}.json`;
  if (!existsSync(path)) return undefined;
  const run = JSON.parse(readFileSync(path, 'utf8'));
  const rows = run.settlements.filter(s => s.peakPeople >= 60);
  const years = rows.flatMap(s => s.years);
  const firstYear = (s, id) => s.years.find(y => y.records[id])?.year;
  const blockerHits = id => {
    const acc = {};
    for (const y of years) for (const b of y.blockers[id]) { const k = b.split(' ')[0]; acc[k] = (acc[k] ?? 0) + 1; }
    return Object.fromEntries(Object.entries(acc).sort((a, b) => b[1] - a[1]));
  };
  const fcPractice = years.filter(y => y.records['fire-control']).map(y => y.records['fire-control'].practice);
  const mean = xs => xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
  return {
    seed, established: rows.length, settlementYears: years.length,
    combustion: {
      settlementsEverDiscovered: rows.filter(s => firstYear(s, 'combustion-dynamics') !== undefined).length,
      firstYears: rows.map(s => firstYear(s, 'combustion-dynamics')).filter(y => y !== undefined).sort((a, b) => a - b),
      yearsWithRecord: years.filter(y => y.records['combustion-dynamics']).length,
      meanPractice: mean(years.filter(y => y.records['combustion-dynamics']).map(y => y.records['combustion-dynamics'].practice)),
      yearsFoundationCleared: years.filter(y => !y.blockers['metal-smelting'].some(b => b.startsWith('foundation:combustion-dynamics'))).length,
      blockers: blockerHits('combustion-dynamics'),
    },
    fireControl: { meanPractice: mean(fcPractice), yearsAtOrAbove0165: pct(fcPractice.filter(x => x >= 0.165).length, fcPractice.length) },
    energyExperimentation: { mean: mean(years.map(y => y.experimentation.energy)), max: round(Math.max(0, ...years.map(y => y.experimentation.energy))) },
    metalSmelting: {
      settlementsDiscovered: rows.filter(s => firstYear(s, 'metal-smelting') !== undefined).length,
      firstYears: rows.map(s => firstYear(s, 'metal-smelting')).filter(y => y !== undefined).sort((a, b) => a - b),
      blockers: blockerHits('metal-smelting'),
    },
    fuelGate: {
      meanFuelAccess: mean(years.map(y => y.fuel ?? 0)),
      yearsFuelOver21: pct(years.filter(y => (y.fuel ?? 0) >= 2.1).length, years.length),
      yearsRawWoodUnder6: pct(years.filter(y => (y.resourcesWood ?? 0) < 6).length, years.length),
      yearsFuelOkButRawWoodShort: pct(years.filter(y => (y.fuel ?? 0) >= 2.1 && (y.resourcesWood ?? 0) < 6).length, years.length),
    },
    perSettlement: rows.map(s => ({ name: s.name, peak: s.peakPeople,
      combustion: firstYear(s, 'combustion-dynamics') ?? null, metalSmelting: firstYear(s, 'metal-smelting') ?? null })),
  };
}

const out = [];
for (const seed of seeds) {
  const before = report(dirs.before, seed);
  const after = report(dirs.after, seed);
  out.push({ seed, before, after });
}

const line = (label, b, a) => console.log('  ' + label.padEnd(34) + String(b ?? '-').padStart(14) + '   ->' + String(a ?? '-').padStart(14));
for (const { seed, before, after } of out) {
  console.log('=== ' + seed + (before && after ? '' : '  (incomplete)'));
  if (!before || !after) continue;
  line('established settlements', before.established, after.established);
  line('combustion: settlements w/ record', `${before.combustion.settlementsEverDiscovered}/${before.established}`, `${after.combustion.settlementsEverDiscovered}/${after.established}`);
  line('combustion: first years', before.combustion.firstYears.join(','), after.combustion.firstYears.join(','));
  line('combustion: mean practice', before.combustion.meanPractice, after.combustion.meanPractice);
  line('combustion foundation cleared yrs', before.combustion.yearsFoundationCleared, after.combustion.yearsFoundationCleared);
  line('fire-control mean practice', before.fireControl.meanPractice, after.fireControl.meanPractice);
  line('fire-control yrs >= 0.165', before.fireControl.yearsAtOrAbove0165, after.fireControl.yearsAtOrAbove0165);
  line('energy experimentation mean/max', `${before.energyExperimentation.mean}/${before.energyExperimentation.max}`, `${after.energyExperimentation.mean}/${after.energyExperimentation.max}`);
  line('metal-smelting settlements', `${before.metalSmelting.settlementsDiscovered}/${before.established}`, `${after.metalSmelting.settlementsDiscovered}/${after.established}`);
  line('metal-smelting first years', before.metalSmelting.firstYears.join(','), after.metalSmelting.firstYears.join(','));
  line('mean fuel access', before.fuelGate.meanFuelAccess, after.fuelGate.meanFuelAccess);
  line('yrs fuel ok but raw wood < 6', before.fuelGate.yearsFuelOkButRawWoodShort, after.fuelGate.yearsFuelOkButRawWoodShort);
  console.log('  remaining metal-smelting blockers (after):', JSON.stringify(after.metalSmelting.blockers));
  console.log('  remaining combustion blockers (after):   ', JSON.stringify(after.combustion.blockers));
}
console.log('\nJSON:');
console.log(JSON.stringify(out, null, 1));
