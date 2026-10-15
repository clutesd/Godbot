/**
 * Unassisted multi-century architecture reachability run.
 *
 *   npx tsx scripts/architecture-reachability.ts <seed> <years> <out.json>
 *
 * Default settings and 360 founders. Nothing is granted: the observer only reads state.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { Simulation } from '../src/sim/Simulation';
import { ArchitectureReachability, serializeReachability } from '../src/dev/architectureReachability';

const seed = process.argv[2] ?? 'alpha-river';
const years = Number(process.argv[3] ?? 400);
const out = process.argv[4] ?? `output/architecture-reachability/${seed}.json`;
if (!Number.isInteger(years) || years <= 0) throw new Error('years must be a positive integer');

const fingerprint = createHash('sha256');
for (const path of readdirSync('src', { recursive: true }).map(String).filter(p => p.endsWith('.ts')).sort()) {
  fingerprint.update(path.replaceAll('\\', '/')); fingerprint.update(readFileSync(`src/${path}`));
}

const sim = new Simulation({ seed, startingPopulation: 360 } as never);
const observer = new ArchitectureReachability(1);
const started = Date.now();
while (sim.state.month < years * 12) {
  sim.step(1);
  observer.observeMonth(sim.state);
  if (sim.state.month % 12 === 0) observer.observeYear(sim.state);
  if (sim.state.month % 600 === 0) process.stderr.write(`${seed}: year ${sim.state.month / 12} (${Math.round((Date.now() - started) / 1000)}s)\n`);
}
const record = serializeReachability(observer.record(seed, years));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ sourceSha256: fingerprint.digest('hex'), elapsedMs: Date.now() - started, ...record as object }, null, 2));
process.stderr.write(`${seed}: wrote ${out}\n`);
