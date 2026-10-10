import {readFileSync,writeFileSync} from 'node:fs';
const runs=JSON.parse(readFileSync('output/arms/comparison.json','utf8'));
if(runs.length!==6) throw new Error('Six complete pairs required');
const fmt=v=>typeof v==='number'?v.toLocaleString('en-US',{maximumFractionDigits:3}):String(v);
const pct=v=>`${(100*v).toFixed(1)}%`;
const metrics=[
 ['Settlements ever observed','settlements'],['Settlement-month observations','settlementMonths'],
 ['Arms timber consumed','timber'],['Usable wooden arms produced','production'],['Artisan labour spent','labour'],
 ['Production months','productionMonths'],['Production with active force already satisfied (post-loss)','activeSatisfiedProductionMonths'],
 ['Production with full reserve already satisfied (post-loss)','fullReserveSatisfiedProductionMonths'],
 ['Production with active force satisfied at opening, before wear','activeSatisfiedOpeningProductionMonths'],['Production with full reserve satisfied at opening, before wear','fullReserveBeforeProductionMonths'],
 ['Unnecessary peacetime production months','unnecessaryPeaceProductionMonths'],['Unnecessary peacetime timber','unnecessaryPeaceTimber'],
 ['Ordinary issued-equipment wear','wear'],['Legacy undifferentiated peace attrition','legacyPeaceLoss'],['Legacy undifferentiated war attrition','legacyWarLoss'],
 ['Actual combat equipment losses, including final pending losses','combatLoss'],
 ['Replacement demand (arms·months of outstanding demand)','replacementDemandArmsMonths'],['Production assigned to replacement','replacementProduction'],
 ['Expansion/hostility/war demand (arms·months)','expansionDemandArmsMonths'],
 ['Expansion demand during war (arms·months)','wartimeExpansionDemandArmsMonths'],['Expansion demand during hostile peace (arms·months)','hostilePeaceExpansionDemandArmsMonths'],['Other peaceful expansion demand (arms·months)','peacefulExpansionDemandArmsMonths'],
 ['Peace production fully deferred by critical timber shortage (months)','peaceCriticalDeferredMonths'],['All attempted output unfilled (units)','attemptedUnfilled'],
 ['Production below critical timber needs (months)','criticalProductionMonths'],['Timber spent below critical needs','criticalProductionTimber'],
 ['Active-force coverage, demand-weighted','activeCoverage',pct],['Full-reserve coverage, demand-weighted','reserveCoverage',pct],
 ['Peace active-force coverage','peaceActiveCoverage',pct],['War active-force coverage','warActiveCoverage',pct],
 ['Months active force fully covered','activeCoveredMonths'],['Months full reserve covered','desiredMetMonths'],['Months old/new policy target covered','policyTargetMetMonths'],
 ['War settlement-months','warMonths'],['Under-equipped war months','warUnderEquippedMonths'],['Under-equipped peace months','peaceUnderEquippedMonths'],['Months stock exceeds twice desired reserve','overTwiceReserveMonths'],
 ['Metal demand substitution (arms·months)','metalSubstitutionArmsMonths'],['Metal share of desired equipment','metalSubstitutionShare',pct],['Final metal arms in living settlements','finalMetalArms'],
 ['Final wooden arms per person (living settlements)','finalWoodArmsPerPopulation'],
 ['Final settlement timber, including retained dead-settlement stores','finalInventoryTimberAll'],['Final settlement timber in living settlements','finalTimber'],['Mean monthly timber per living settlement','meanTimber'],
 ['Final facility timber in input/output inventories','finalFacilityTimber'],['Charcoal produced, settlement + facility','charcoalProduction'],
 ['Construction/infrastructure timber consumed','constructionTimber'],['Processing/workshop timber consumed (includes charcoal inputs)','workshopTimber'],
 ['Standing timber remaining in known deposits',x=>x.ledger.standingForestFinal],['Timber in facility transit',x=>x.ledger.facilityInTransit],
 ['Timber extracted',x=>x.ledger.externalDepositExtracted],['Timber delivered',x=>x.ledger.deliveredToSettlement],['Fuel/heat timber consumed',x=>x.ledger.fuelHeatConsumption],
 ['Storage saturated settlement-months','saturatedMonths'],['Storage sample count','storageSamples'],['Mean storage utilization','meanStorageUtilization',pct],
 ['Standing-forest storage rejection events',x=>x.rejections['storage-room-zero']??0],['Standing-forest labour rejection events',x=>x.rejections['insufficient-resource-labour']??0],
 ['Metallurgy discoveries',x=>x.metallurgy.length],['Earliest metallurgy year',x=>x.metallurgy.length?Math.min(...x.metallurgy.map(m=>m.year)):'not reached'],['Evaluations blocked only by wood','metallurgyWoodOnlyEvaluations'],
 ['Living settlements at year 130','alive'],['Final population in living cohort settlements','finalPopulation'],['Wars involving cohort','warCount'],['Battles in those wars','battles'],['Combat casualties from cohort','casualties'],
];
let md='# Fresh paired wooden-arms validation\n\nSix seeds; 360 starting people; 130 years (1,560 monthly steps); unchanged default configuration. Only these fresh baseline/repaired runs are compared. Both cohorts use the same filter within their own trajectory: all settlements, or peak population >=60. Cohort membership and downstream histories may diverge after the repair.\n\n';
md+='Source boundary: these are fresh runs of the working tree at launch. Two navigation files were edited elsewhere later (`StructureNavigation.ts`, `WalkabilityLayer.ts`); the workers had already statically loaded their modules and did not run in watch mode. Results do not validate those later edits. The complete baseline and repaired launch snapshots are preserved under `output/arms/baseline-worktree` and `output/arms/repaired-worktree`; the repaired snapshot matches all 113 launch hashes.\n\n';
md+='All amounts are model units. Arms are quality-weighted usable equipment equivalents. Months are settlement-months. Coverage is equipment-demand-weighted and capped at 100%. Stock counts include wood plus metal when evaluating coverage. Production-with-coverage counts use stock after losses but before production. Filling a partially drawn-down reserve is intentional. Demand sums are arms·months of outstanding demand, not quantities manufactured. The old producer has no causal replacement backlog; its diagnostic replacement and expansion quantities describe the old population-target deficit.\n\n';
md+='**Calibration flag:** the retained **1% monthly wear rate on issued wooden equipment requires later calibration**. It was left unchanged during validation. Legacy 1% peace/8% war attrition is shown separately because its physical cause was unspecified. In baseline conservation accounting, this is the legacy wear/attrition bucket; it is not mislabeled as casualty loss.\n\n';
for(const r of runs){
 md+=`## ${r.seed}\n\n| Metric | All before | All after | Established before | Established after |\n|---|---:|---:|---:|---:|\n`;
 for(const [label,key,format=fmt] of metrics){const values=['all','established'].flatMap(c=>['before','after'].map(p=>{const x=r[p][c];if(key==='wear'&&p==='before')return 'not separately modelled';return format(typeof key==='function'?key(x):x[key]);}));md+=`| ${label} | ${values.join(' | ')} |\n`;}
 md+='\nMetallurgy discoveries (all settlements):\n\n';
 for(const p of ['before','after']){
  const x=r[p].all;md+=`- ${p}: ${x.metallurgy.map(m=>`${m.name} (year ${fmt(m.year)})`).join('; ')||'none'}. Not reached: ${x.perSettlement.filter(s=>!x.metallurgy.some(m=>m.id===s.id)).map(s=>s.name).join(', ')||'none'}.\n`;
 }
 md+=`\nWorld demography (not restricted to the established cohort): births ${fmt(r.before.all.worldBirths)} ? ${fmt(r.after.all.worldBirths)}; deaths ${fmt(r.before.all.worldDeaths)} ? ${fmt(r.after.all.worldDeaths)}; peak population ${fmt(r.before.all.worldPeakPopulation)} ? ${fmt(r.after.all.worldPeakPopulation)}.\n\n`;
}
md+='## Accounting verification\n\nCombat losses occur after the resource pass. Each next pass\'s opening observation is therefore adjusted by its queued combat-loss amount to reconstruct the pre-combat opening. Consecutive-pass stock is independently reconciled; final pending losses and retained inventory of dead settlements are included in whole-run totals. The baseline equation includes its separately identified legacy attrition.\n\n| Seed / cohort / phase | Whole-run stock residual | Between-pass max residual | Timber payment residual | Output above policy deficit | Negative stock |\n|---|---:|---:|---:|---:|---:|\n';
for(const r of runs)for(const c of ['all','established'])for(const p of ['before','after']){const k=r[p][c].checks;md+=`| ${r.seed} / ${c} / ${p} | ${k.wholeRunStockIdentityError.toExponential(2)} | ${k.betweenPassStockIdentityMaxError.toExponential(2)} | ${k.timberPaidIdentityError.toExponential(2)} | ${k.outputAboveRemainingDeficit} | ${k.negativeStock} |\n`;}
md+='\nTimber payment is independently checked against the canonical inventory proxy, not merely equated to the diagnostic field. Output is checked against both quality × paid timber and the pre-production policy deficit. The baseline did not cap batches at its deficit, so baseline excess-output events may occur; the repaired producer must have zero such events.\n';
writeFileSync('docs/wooden-arms-paired-validation.md',md);
const numericKeys=Object.keys(runs[0].after.all).filter(k=>typeof runs[0].after.all[k]==='number');
const csv=[['seed','cohort','phase',...numericKeys].join(',')];
for(const r of runs)for(const c of ['all','established'])for(const p of ['before','after'])csv.push([r.seed,c,p,...numericKeys.map(k=>r[p][c][k])].join(','));
writeFileSync('output/arms/paired-metrics.csv',csv.join('\n')+'\n');
const violations=[];
for(const r of runs)for(const c of ['all','established'])for(const p of ['before','after']){
 const k=r[p][c].checks;
 for(const name of ['wholeRunStockIdentityError','betweenPassStockIdentityMaxError','timberPaidIdentityError','stockIdentityMaxError','labourIdentityMaxError','qualityYieldIdentityMaxError'])if(k[name]>1e-7)violations.push(`${r.seed}/${c}/${p}: ${name}=${k[name]}`);
 if(k.timberPaidWithoutOutput||k.negativeStock||k.achievedOverAttempted)violations.push(`${r.seed}/${c}/${p}: invalid production or stock`);
 if(p==='after'&&k.outputAboveRemainingDeficit)violations.push(`${r.seed}/${c}: output exceeds deficit`);
}
writeFileSync('output/arms/accounting-verification.json',JSON.stringify({passed:!violations.length,violations},null,2));
