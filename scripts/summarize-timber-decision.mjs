import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = process.argv[2] ?? 'output/timber/decision';
const runs = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
const sum = xs => xs.reduce((a, b) => a + b, 0);
const round = n => Math.round(n * 100) / 100;
const merge = (rows, pick) => {
  const out = {};
  for (const r of rows) for (const [k, v] of Object.entries(pick(r) ?? {})) out[k] = round((out[k] ?? 0) + v);
  return out;
};
const sortRecord = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));

const reports = runs.map(run => {
  const rows = run.settlements.filter(s => s.peakPeople >= 60);
  const ledger = merge(rows, s => s.ledger);
  // Gathering rejections, excluding the undiscovered/uncontrolled cases that are not a rejection of
  // an accessible deposit, and only where forest still stands.
  const notARejection = new Set(['deposit-not-discovered']);
  const histogram = sortRecord(merge(rows, s => Object.fromEntries(Object.entries(s.rejectionsStandingForest).filter(([k]) => !notARejection.has(k)))));
  const allHistogram = sortRecord(merge(rows, s => s.rejections));
  const gates = rows.flatMap(s => s.gate.map(g => ({ settlement: s.name, ...g })));
  const unblockedExceptWood = gates.filter(g => g.onlyWoodBlocker);
  const fuelCapable = g => g.settlementCharcoal + g.facilityCharcoal >= 2 || g.charcoalProduced12 > 0 || g.facilityTimber >= 6;
  return {
    seed: run.seed,
    established: rows.length,
    ledger,
    identity: {
      extractedMinusDelivered: round(ledger.externalDepositExtracted - ledger.deliveredToSettlement - ledger.inTransitToSettlement),
      transferNetToFacilities: round(ledger.transferToFacilities - ledger.transferBackFromFacilities),
      realConsumption: round(ledger.facilityRealConsumption + ledger.settlementProcessingConsumption + ledger.woodenArmsConsumption
        + ledger.fuelHeatConsumption + ledger.constructionAndInfrastructure + ledger.unattributedLegacy + ledger.tradeExport),
      worstConservationResidual: Math.max(...rows.map(s => Math.abs(s.ledger.conservationResidual))),
    },
    rejectionHistogramStandingForest: histogram,
    rejectionHistogramAll: allHistogram,
    extraction: { events: sum(rows.map(s => s.extractedEvents)), amount: round(sum(rows.map(s => s.extractedAmount))) },
    arms: {
      consumed: round(sum(rows.map(s => s.arms.draw))),
      drawMonths: sum(rows.map(s => s.arms.months)),
      cappedByQuota: sum(rows.map(s => s.arms.cappedByQuota)),
      cappedByArtisan: sum(rows.map(s => s.arms.cappedByArtisan)),
      drawWhileTimberBelow6: round(sum(rows.map(s => s.arms.drawWhileTimberBelow6))),
      everMetTarget: rows.filter(s => s.arms.everMetTarget).length,
      peakRatio: round(Math.max(...rows.map(s => s.arms.peakRatio))),
      perSettlement: rows.map(s => ({ name: s.name, draw: round(s.arms.draw), months: s.arms.months, finalArms: s.arms.finalArms, target: s.arms.finalTarget, ratio: round(s.arms.peakRatio) })),
    },
    facilityVsSettlement: rows.map(s => ({
      name: s.name, settlementTimber: s.ledger.settlementInventory, facilityTimber: round(s.ledger.facilityInputYard + s.ledger.facilityOutputYard),
      transferredIn: s.ledger.transferToFacilities, consumedThere: s.ledger.facilityRealConsumption, charcoalMade: s.ledger.facilityProducedCharcoal,
      yearsTimberUnder6: s.annual.filter(a => a.timber < 6).length, yearsCharcoalOver2: s.annual.filter(a => a.charcoal + a.facilityCharcoal >= 2).length,
      standingForestFinal: s.ledger.standingForestFinal, standingForestCapacity: s.ledger.standingForestCapacity,
    })),
    metallurgy: {
      settlementsEvaluated: rows.filter(s => s.gate.length).length,
      discovered: rows.filter(s => s.metalSmeltingMonth !== undefined).map(s => ({ name: s.name, year: round(s.metalSmeltingMonth / 12) })),
      yearsEvaluated: gates.length,
      yearsOnlyWoodBlocker: unblockedExceptWood.length,
      yearsOnlyWoodBlockerWithFuel: unblockedExceptWood.filter(fuelCapable).length,
      blockerFrequency: sortRecord(gates.reduce((acc, g) => { for (const b of g.blockers) { const k = b.split(' ')[0]; acc[k] = (acc[k] ?? 0) + 1; } return acc; }, {})),
      woodBlockedYears: gates.filter(g => g.blockers.some(b => b.startsWith('resource:wood'))).length,
      woodBlockedYearsWithFuel: gates.filter(g => g.blockers.some(b => b.startsWith('resource:wood')) && fuelCapable(g)).length,
      woodBlockedYearsWithStandingForest: gates.filter(g => g.blockers.some(b => b.startsWith('resource:wood')) && g.standingForest > 100).length,
      resourcesWoodBelowLocalTimber: gates.filter(g => g.resourcesWood < g.settlementTimber - 0.001).length,
      examples: unblockedExceptWood.slice(0, 6).concat(gates.filter(g => fuelCapable(g) && g.blockers.some(b => b.startsWith('resource:wood'))).slice(0, 6)),
    },
    storageCases: rows.flatMap(s => s.storageCases.slice(0, 3).map(c => ({ settlement: s.name, ...c, facilityYards: c.facilityYards?.length ?? 0 }))).slice(0, 10),
  };
});

writeFileSync(`${dir}/../decision-summary.json`, JSON.stringify(reports, null, 2));
const brief = reports.map(r => ({ ...r, storageCases: r.storageCases.length, metallurgy: { ...r.metallurgy, examples: r.metallurgy.examples.length } }));
console.log(JSON.stringify(brief, null, 2));
