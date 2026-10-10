/**
 * Fast, repeatable monthly-tick benchmark used for before/after comparison of simulation
 * optimizations. Fixed seed and fixed warmup, so two runs are directly comparable.
 *
 *   npx tsx scripts/perf/tick-bench.ts [--months=40] [--warmup=24] [--seed=...] [--json]
 *
 * It also reports a determinism fingerprint of the measured state. Any optimization that changes
 * the fingerprint has changed history and must be rejected.
 */
import { performance } from 'node:perf_hooks';
import { GODBOX_CONFIG } from '../../godbox.config';
import { Simulation } from '../../src/sim/Simulation';
import type { SimulationState } from '../../src/sim/types';

/**
 * A cheap but broad fingerprint of authoritative state. It deliberately samples people, world
 * cells, settlements and the history record so a behavioural change anywhere in the tick shows up.
 */
export function stateFingerprint(state: SimulationState): string {
  let hash = 2166136261;
  const mix = (value: number): void => {
    hash ^= Math.imul(Math.round(value * 1e6) | 0, 0x9e3779b1) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  };
  const mixText = (text: string): void => {
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; }
  };
  mix(state.month);
  mix(state.people.length);
  mix(state.history.length);
  for (const person of state.people) {
    mix(person.position.x); mix(person.position.z); mix(person.age);
    mixText(person.activity ?? ''); mixText(person.settlementId ?? '');
  }
  for (const settlement of state.settlements) {
    mixText(settlement.id); mix(settlement.population); mix(settlement.urbanization);
    for (const [resource, amount] of Object.entries(settlement.inventory ?? {})) { mixText(resource); mix(Number(amount) || 0); }
  }
  for (const cell of state.world.cells) { mix(cell.wood); mix(cell.movementCost); mix(cell.elevation); }
  for (const record of state.history.slice(-200)) { mixText(record.id); mixText(record.type); mix(record.magnitude); }
  return (hash >>> 0).toString(16);
}

export interface TickBenchResult {
  readonly seed: string;
  readonly warmupMonths: number;
  readonly measuredMonths: number;
  readonly people: number;
  readonly settlements: number;
  readonly worldCells: number;
  readonly historyRecords: number;
  readonly fingerprint: string;
  readonly minMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly meanMs: number;
  /** Peak resident heap after the measured window, in MiB. */
  readonly heapUsedMiB: number;
}

export function benchmarkTicks(options: { months?: number; warmup?: number; seed?: string } = {}): TickBenchResult {
  const months = options.months ?? 40;
  const warmup = options.warmup ?? 24;
  const seed = options.seed ?? 'perf-tick-bench';

  const simulation = new Simulation({ ...GODBOX_CONFIG, seed, startMode: 'established' });
  simulation.state.arrival = undefined;
  simulation.step(warmup);

  const samples: number[] = [];
  for (let month = 0; month < months; month++) {
    const startedAt = performance.now();
    simulation.step();
    samples.push(performance.now() - startedAt);
  }

  const ordered = [...samples].sort((a, b) => a - b);
  const percentile = (fraction: number): number =>
    Number((ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))] ?? 0).toFixed(2));
  const state = simulation.state;
  return {
    seed,
    warmupMonths: warmup,
    measuredMonths: months,
    people: state.people.length,
    settlements: state.settlements.length,
    worldCells: state.world.cells.length,
    historyRecords: state.history.length,
    fingerprint: stateFingerprint(state),
    minMs: percentile(0),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: percentile(1),
    meanMs: Number((samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(2)),
    heapUsedMiB: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)),
  };
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/perf/tick-bench.ts');
if (invokedDirectly) {
  const numeric = (flag: string): number | undefined => {
    const raw = process.argv.find(argument => argument.startsWith(`--${flag}=`))?.split('=')[1];
    return raw === undefined ? undefined : Number(raw);
  };
  const result = benchmarkTicks({
    months: numeric('months'),
    warmup: numeric('warmup'),
    seed: process.argv.find(argument => argument.startsWith('--seed='))?.split('=')[1],
  });
  if (process.argv.includes('--json')) console.log(JSON.stringify(result));
  else {
    console.log(`seed ${result.seed} | people ${result.people} | settlements ${result.settlements}`
      + ` | cells ${result.worldCells} | history ${result.historyRecords}`);
    console.log(`tick ms: p50 ${result.p50Ms}  p95 ${result.p95Ms}  max ${result.maxMs}`
      + `  mean ${result.meanMs}  min ${result.minMs}`);
    console.log(`heapUsed ${result.heapUsedMiB} MiB | fingerprint ${result.fingerprint}`);
  }
}
