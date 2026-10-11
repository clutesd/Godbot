/**
 * Time-sliced month verification and benchmark.
 *
 *   npx tsx scripts/perf/slice-bench.ts [--months=40] [--warmup=24] [--seed=...]
 *
 * Runs two identical worlds: one with ordinary step() and one through advanceMonthSliced() with a
 * deadline that has always passed, so every month pauses at every safe boundary. The fingerprints
 * must match; a mismatch means slicing changed history. It also reports the longest uninterrupted
 * slice, the main-thread stall an interactive frame can still see.
 */
import { performance } from 'node:perf_hooks';
import { GODBOX_CONFIG } from '../../godbox.config';
import { Simulation } from '../../src/sim/Simulation';
import { stateFingerprint } from './tick-bench';

const arg = (name: string, fallback: string): string =>
  process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const months = Number(arg('months', '40'));
const warmup = Number(arg('warmup', '24'));
const seed = arg('seed', 'perf-tick-bench');

const create = (): Simulation => {
  const simulation = new Simulation({ ...GODBOX_CONFIG, seed, startMode: 'established' });
  simulation.state.arrival = undefined;
  simulation.step(warmup);
  return simulation;
};

const atomic = create();
const atomicTicks: number[] = [];
for (let month = 0; month < months; month += 1) {
  const startedAt = performance.now();
  atomic.step();
  atomicTicks.push(performance.now() - startedAt);
}

const sliced = create();
sliced.setTickProfiling(true);
const slices: number[] = [];
let slowest = { ms: 0, month: 0, index: 0 };
for (let month = 0; month < months; month += 1) {
  let index = 0;
  for (;;) {
    const startedAt = performance.now();
    // Deadline already passed: exactly one safe slice per call.
    const committed = sliced.advanceMonthSliced(-Infinity);
    const elapsed = performance.now() - startedAt;
    slices.push(elapsed);
    if (elapsed > slowest.ms) slowest = { ms: elapsed, month: sliced.state.month, index };
    index += 1;
    if (committed) break;
  }
}

const percentile = (values: number[], fraction: number): number => {
  const ordered = [...values].sort((a, b) => a - b);
  return Number((ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))] ?? 0).toFixed(2));
};
const atomicPrint = stateFingerprint(atomic.state);
const slicedPrint = stateFingerprint(sliced.state);
console.log(`seed ${seed} | month ${sliced.state.month} | people ${sliced.state.people.length}`);
console.log(`atomic month  p50 ${percentile(atomicTicks, 0.5)}ms  p95 ${percentile(atomicTicks, 0.95)}ms  max ${percentile(atomicTicks, 1)}ms`);
console.log(`slice         p50 ${percentile(slices, 0.5)}ms  p95 ${percentile(slices, 0.95)}ms  p99 ${percentile(slices, 0.99)}ms  max ${slowest.ms.toFixed(2)}ms`
  + ` (month ${slowest.month}, slice #${slowest.index}) | ${(slices.length / months).toFixed(0)} slices/month`);
console.log(`fingerprint atomic ${atomicPrint} sliced ${slicedPrint} ${atomicPrint === slicedPrint ? 'MATCH' : 'MISMATCH'}`);
for (const tick of sliced.tickPerformance().slowestTicks.slice(0, 4)) {
  const phases = Object.entries(tick.phases).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 4)
    .map(([phase, ms]) => `${phase} ${(ms ?? 0).toFixed(1)}ms`).join(', ');
  console.log(`  slow month ${tick.month}${tick.annual ? ' (annual)' : ''} ${tick.totalMs.toFixed(1)}ms -> ${phases}`);
}
if (atomicPrint !== slicedPrint) process.exitCode = 1;
