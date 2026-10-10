import console from 'node:console';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const seeds = ['alpha-river','basalt-coast','delta-hill','east-marsh','north-steppe','stone-basin'];
const sum = xs => xs.reduce((a,b)=>a+b,0);
const round = x => Math.round(x*1000)/1000;
function summarize(run, establishedOnly) {
  const rows = run.settlements.filter(s => !establishedOnly || s.peakPeople >= 60);
  const ids = new Set(rows.map(s=>s.id));
  const records = run.armsRecords.filter(r=>ids.has(r.settlementId));
  const samples = run.monthly.flatMap(m=>m.settlements.filter(s=>ids.has(s.id)));
  const final = run.monthly.at(-1).settlements.filter(s=>ids.has(s.id));
  const merge = pick => {
    const o={}; for (const r of rows) for (const [k,v] of Object.entries(pick(r))) o[k]=(o[k]??0)+v;
    return Object.fromEntries(Object.entries(o).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,round(v)]));
  };
  const gates=rows.flatMap(r=>r.gate);
  const finalAliveRows=rows.filter(r=>r.finalState?.alive);
  const finalWood=sum(finalAliveRows.map(r=>r.finalState.timberArms));
  const finalMetal=sum(finalAliveRows.map(r=>r.finalState.metalArms));
  const opening = new Map(); const previous = new Map();
  let transitionError = 0;
  for (const r of records) {
    if (!opening.has(r.settlementId)) opening.set(r.settlementId, r.stockBefore+r.combatLoss);
    if (previous.has(r.settlementId)) transitionError=Math.max(transitionError,Math.abs(previous.get(r.settlementId)-r.stockBefore-r.combatLoss));
    previous.set(r.settlementId,r.stockAfter);
  }
  const pendingLoss=sum(rows.map(r=>r.finalState?.pendingCombatLoss??0));
  const totalCombatLoss=sum(records.map(r=>r.combatLoss))+pendingLoss;
  const finalStock=sum(rows.map(r=>r.finalState?.timberArms??r.arms.finalArms));
  const active=r=>r.active??r.desired/1.2;
  const pre=r=>r.stockBefore-r.wear-r.arbitraryLoss+r.metal;
  const usable=r=>r.stockAfter+r.metal;
  const totalActive=sum(records.map(active)); const totalDesired=sum(records.map(r=>r.desired));
  const wars=(run.wars??[]).filter(w=>ids.has(w.attacker)||ids.has(w.defender));
  const checks = {
    wholeRunStockIdentityError: Math.abs(sum([...opening.values()])+sum(records.map(r=>r.achieved-r.wear-r.arbitraryLoss))-totalCombatLoss-finalStock),
    betweenPassStockIdentityMaxError:transitionError,
    timberPaidIdentityError:Math.abs(sum(records.map(r=>r.timber))-sum(rows.map(r=>r.arms.draw))),
    outputAboveRemainingDeficit:records.filter(r=>r.achieved>(r.remainingPolicyDeficit??Infinity)+1e-9).length,
    qualityYieldIdentityMaxError:Math.max(0,...records.map(r=>Math.abs(r.achieved-r.timber*(r.quality??0.5)))),
    stockIdentityMaxError: Math.max(0,...records.map(r=>Math.abs(r.stockAfter-(r.stockBefore-r.wear-r.arbitraryLoss+r.achieved)))),
    labourIdentityMaxError: Math.max(0,...records.map(r=>Math.abs(r.labour-r.timber/0.3))),
    achievedOverAttempted: records.filter(r=>r.achieved>r.attempted+1e-9).length,
    timberPaidWithoutOutput:records.filter(r=>r.timber>1e-9&&r.achieved<=0).length,
    negativeStock: records.filter(r=>r.stockAfter < -1e-9).length,
    peaceCriticalProduction: records.filter(r=>r.timber>1e-9 && r.criticalTimber && !r.atWar).length,
  };
  return {
    checks,
    settlements: rows.length, settlementMonths:records.length,
    production:round(sum(records.map(r=>r.achieved))), timber:round(sum(records.map(r=>r.timber))),
    labour:round(sum(records.map(r=>r.labour))), attempted:round(sum(records.map(r=>r.attempted))),
    arbitraryLoss:round(sum(records.map(r=>r.arbitraryLoss))), wear:round(sum(records.map(r=>r.wear))), combatLoss:round(totalCombatLoss), pendingCombatLoss:round(pendingLoss),
    replacementDemandArmsMonths:round(sum(records.map(r=>r.replacementDemand))),
    replacementProduction:round(sum(records.map(r=>Math.min(r.achieved,r.replacementDemand)))),
    expansionDemandArmsMonths:round(sum(records.map(r=>r.expansionDemand))),
    wartimeExpansionDemandArmsMonths:round(sum(records.filter(r=>r.atWar).map(r=>r.expansionDemand))),
    hostilePeaceExpansionDemandArmsMonths:round(sum(records.filter(r=>!r.atWar && (r.threat??0)>0).map(r=>r.expansionDemand))),
    peacefulExpansionDemandArmsMonths:round(sum(records.filter(r=>!r.atWar && !(r.threat>0)).map(r=>r.expansionDemand))),
    activeSatisfiedOpeningProductionMonths:records.filter(r=>r.achieved>1e-9&&r.stockBefore+r.metal>=active(r)-1e-9).length,
    activeSatisfiedProductionMonths:records.filter(r=>r.achieved>1e-9&&pre(r)>=active(r)-1e-9).length,
    fullReserveSatisfiedProductionMonths:records.filter(r=>r.achieved>1e-9&&pre(r)>=r.desired-1e-9).length,
    unnecessaryPeaceProductionMonths:records.filter(r=>!r.atWar&&r.achieved>1e-9&&pre(r)>=r.desired-1e-9).length,
    unnecessaryPeaceTimber:round(sum(records.filter(r=>!r.atWar&&pre(r)>=r.desired-1e-9).map(r=>r.timber))),
    legacyPeaceLoss:round(sum(records.filter(r=>!r.atWar).map(r=>r.arbitraryLoss))),
    legacyWarLoss:round(sum(records.filter(r=>r.atWar).map(r=>r.arbitraryLoss))),
    productionMonths:records.filter(r=>r.achieved>1e-9).length,
    // The same military target is evaluated on both trajectories, using each world's actual population/relations.
    desiredMetMonths:records.filter(r=>r.stockAfter+r.metal>=r.desired-1e-9).length,
    activeCoveredMonths:records.filter(r=>r.stockAfter+r.metal>=r.desired/1.2-1e-9).length,
    policyTargetMetMonths:records.filter(r=>r.stockAfter>=r.policyDesired-1e-9).length,
    fullReserveBeforeProductionMonths:records.filter(r=>r.achieved>1e-9 && r.adequateBefore).length,
    unnecessaryProductionMonths:records.filter(r=>r.achieved>1e-9 && r.stockBefore-r.wear-r.arbitraryLoss+r.metal>=r.desired-1e-9).length,
    criticalProductionMonths:records.filter(r=>r.achieved>1e-9 && r.criticalTimber).length,
    criticalProductionTimber:round(sum(records.filter(r=>r.criticalTimber).map(r=>r.timber))),
    attemptedUnfilled:round(sum(records.map(r=>Math.max(0,r.attempted-r.achieved)))),
    peaceCriticalDeferredMonths:records.filter(r=>!r.atWar && r.criticalTimber && r.attempted>1e-9 && r.achieved<=1e-9).length,
    idleAdequateMonths:records.filter(r=>r.achieved<=1e-9 && r.stockAfter+r.metal>=r.desired/1.2-1e-9).length,
    warMonths:records.filter(r=>r.atWar).length,
    worldBirths:run.stats?.births??0, worldDeaths:run.stats?.deaths??0, worldPeakPopulation:run.stats?.peakPopulation??0,
    warCount:wars.length, battles:sum(wars.map(w=>w.battles)),
    casualties:sum(wars.map(w=>(ids.has(w.attacker)?w.casualtiesA:0)+(ids.has(w.defender)?w.casualtiesB:0))),
    activeDemandArmsMonths:round(totalActive), totalDesiredArmsMonths:round(totalDesired),
    activeCoveredEquivalentMonths:round(sum(records.map(r=>Math.min(usable(r),active(r))))),
    activeCoverage:round(sum(records.map(r=>Math.min(usable(r),active(r))))/Math.max(1,totalActive)),
    reserveCoverage:round(sum(records.map(r=>Math.min(usable(r),r.desired)))/Math.max(1,totalDesired)),
    warActiveCoverage:round(sum(records.filter(r=>r.atWar).map(r=>Math.min(usable(r),active(r))))/Math.max(1,sum(records.filter(r=>r.atWar).map(active)))),
    peaceActiveCoverage:round(sum(records.filter(r=>!r.atWar).map(r=>Math.min(usable(r),active(r))))/Math.max(1,sum(records.filter(r=>!r.atWar).map(active)))),
    warUnderEquippedMonths:records.filter(r=>r.atWar&&usable(r)<active(r)-1e-9).length,
    peaceUnderEquippedMonths:records.filter(r=>!r.atWar&&usable(r)<active(r)-1e-9).length,
    overTwiceReserveMonths:records.filter(r=>r.desired>0&&usable(r)>r.desired*2).length,
    metalSubstitutionArmsMonths:round(sum(records.map(r=>Math.min(r.metal,r.desired)))),
    metalSubstitutionShare:round(sum(records.map(r=>Math.min(r.metal,r.desired)))/Math.max(1,totalDesired)),
    finalMetalArms:round(sum(rows.filter(r=>r.finalState?.alive).map(r=>r.finalState.metalArms))),
    finalPopulation:sum(final.map(s=>s.population)), alive:final.length,
    finalWoodArms:round(finalWood),
    finalWoodArmsPerPopulation:round(finalWood/Math.max(1,sum(final.map(s=>s.population)))),
    finalCombinedArmsPerPopulation:round((finalWood+finalMetal)/Math.max(1,sum(final.map(s=>s.population)))),
    meanReadiness:round(sum(records.map(r=>r.desired>0?Math.min(1,(r.stockAfter+r.metal)/(r.desired/1.2)):1))/records.length),
    finalTimber:round(sum(final.map(s=>s.timber))), meanTimber:round(sum(samples.map(s=>s.timber))/samples.length),
    saturatedMonths:samples.filter(s=>s.room<=1e-6).length,
    meanStorageUtilization:round(sum(samples.map(s=>s.volume/Math.max(1,s.capacity)))/samples.length),
    ledger:merge(r=>r.ledger), rejections:merge(r=>r.rejectionsStandingForest),
    metallurgy: rows.filter(r=>r.metalSmeltingMonth!==undefined).map(r=>({id:r.id,name:r.name,year:r.metalSmeltingMonth/12})),
    metallurgyWoodOnlyEvaluations:gates.filter(g=>g.onlyWoodBlocker).length,
    metallurgyBlockers: merge(r=>r.gate.reduce((o,g)=>{for(const b of g.blockers) o[b]=(o[b]??0)+1;return o;},{})),
    storageSamples:samples.length,
    finalInventoryTimberAll:round(sum(rows.map(r=>r.ledger.settlementInventory))),
    finalFacilityTimber:round(sum(rows.map(r=>r.ledger.facilityInputYard+r.ledger.facilityOutputYard))),
    charcoalProduction:round(sum(rows.map(r=>r.ledger.facilityProducedCharcoal+(r.ledger.settlementProducedCharcoal??0)))),
    constructionTimber:round(sum(rows.map(r=>r.ledger.constructionAndInfrastructure))),
    workshopTimber:round(sum(rows.map(r=>r.ledger.facilityRealConsumption+r.ledger.settlementProcessingConsumption))),
    storageCases:rows.flatMap(r=>r.storageCases.filter(c=>c.reason==='storage-room-zero').slice(-2).map(c=>({settlement:r.name,...c}))),
    perSettlement:rows.map(r=>({id:r.id,name:r.name,peakPopulation:r.peakPeople,arms:r.arms,ledger:r.ledger}))
  };
}
const reports=[];
for(const seed of seeds) {
  const paths=['before','after'].map(p=>`output/arms/${p}/${seed}.json`);
  if(!paths.every(existsSync)) continue;
  if(!paths.every(p=>JSON.parse(readFileSync(p,'utf8')).settlements.every(s=>s.finalState))) continue;
  reports.push({seed,...Object.fromEntries(paths.map((p,i)=>{const run=JSON.parse(readFileSync(p,'utf8'));return [i?'after':'before',{all:summarize(run,false),established:summarize(run,true)}]}))});
}
writeFileSync('output/arms/comparison.json',JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports.map(r=>({seed:r.seed,...Object.fromEntries(['before','after'].map(p=>{const brief=Object.fromEntries(Object.entries(r[p].established).filter(([key])=>!['ledger','rejections','metallurgyBlockers','perSettlement','storageCases'].includes(key)));return [p,brief]}))})),null,2));
