import process from 'node:process';
import { spawn } from 'node:child_process';
const phase = process.argv[2];
const seeds = process.argv.slice(3);
await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['--import','tsx','scripts/arms-demand-audit.ts',seed,'130',`output/arms/${phase}/${seed}.json`], {stdio:'inherit'});
  p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${seed}: ${code}`)));
})));
