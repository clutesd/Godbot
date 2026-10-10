import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import process from 'node:process';
for (;;) {
 const statuses=JSON.parse(readFileSync('output/arms/run-status.json','utf8'));
 if(statuses.some(s=>s.status.startsWith('failed'))) { writeFileSync('output/arms/finalization-status.json',JSON.stringify({status:'failed-run',statuses}));break; }
 if(statuses.length===12&&statuses.every(s=>s.status==='complete')) {
  const results=['scripts/summarize-arms-audit.mjs','scripts/report-arms-audit.mjs'].map(script=>{const r=spawnSync(process.execPath,[script],{encoding:'utf8',windowsHide:true});return {script,code:r.status,error:r.stderr};});
  writeFileSync('output/arms/finalization-status.json',JSON.stringify(results,null,2));break;
 }
 await setTimeout(30000);
}
