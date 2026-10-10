import { spawn } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import process from 'node:process';
const seeds=['alpha-river','basalt-coast','delta-hill','east-marsh','north-steppe','stone-basin'];
const tasks=['before','after'].flatMap(phase=>seeds.map(seed=>({phase,seed})));
const statuses=[];
await Promise.all(tasks.map(({phase,seed})=>new Promise(resolve=>{
  const script=phase==='before'?'output/arms/baseline-worktree/scripts/arms-demand-audit.ts':'output/arms/repaired-worktree/scripts/arms-demand-audit.ts';
  const log=createWriteStream(`output/arms/${phase}-${seed}-final.log`);
  const child=spawn(process.execPath,['--import','tsx',script,seed,'130',`output/arms/${phase}/${seed}.json`],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.pipe(log);child.stderr.pipe(log);
  const row={phase,seed,pid:child.pid,status:'running'};statuses.push(row);
  writeFileSync('output/arms/run-status.json',JSON.stringify(statuses,null,2));
  child.on('exit',code=>{row.status=code===0?'complete':`failed:${code}`;log.end();writeFileSync('output/arms/run-status.json',JSON.stringify(statuses,null,2));resolve();});
})));
