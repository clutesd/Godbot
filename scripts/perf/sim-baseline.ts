/**
 * Simulation-step baseline for GODBOX frame pacing.
 *
 * Why this exists: the browser main thread runs authoritative monthly ticks inside the same
 * requestAnimationFrame callback that renders. Any tick whose cost approaches the 16.7 ms budget
 * is a visible hitch, and `InteractiveTickBudget` can only defer such a tick -- it cannot make it
 * cheaper. This harness measures real tick cost per phase at production configuration so long
 * frames can be attributed to a named simulation phase instead of guessed at.
 *
 * Diagnostic only: it never alters tick order, random draws, or state. Run:
 *   npx tsx scripts/perf/sim-baseline.ts [--scenario=name] [--json]
 */
import { performance } from 'node:perf_hooks';
import { GODBOX_CONFIG } from '../../godbox.config';
import { Simulation } from '../../src/sim/Simulation';
import type { TickPerformanceSnapshot, TickPhase } from '../../src/sim/TickProfiler';

export interface SimScenario {
  readonly name: string;
  readonly description: string;
  /** Months advanced before measurement, so the world reaches the state under test. */
  readonly warmupMonths: number;
  /** Months measured with the per-phase profiler enabled. */
  readonly measureMonths: number;
}

/**
 * Warmup lengths come from the production pacing curve: `documentary` runs 0.3-6 months/second,
 * so a viewer reaches year ~40 within the first few minutes and year ~2000 in a long session.
 */
export const SIM_SCENARIOS: readonly SimScenario[] = [
  { name: 'early', description: 'Founding decade: small population, first structures', warmupMonths: 24, measureMonths: 120 },
  { name: 'mature', description: 'Year ~120: established settlements, routes, crafts', warmupMonths: 1_440, measureMonths: 240 },
  { name: 'dense', description: 'Year ~600: population pressing the soft cap', warmupMonths: 7_200, measureMonths: 240 },
  { name: 'industrial', description: 'Year ~1600: industry, energy, transport networks', warmupMonths: 19_200, measureMonths: 240 },
  { name: 'deep', description: 'Year ~6000: full history buffer, advanced civilization', warmupMonths: 72_000, measureMonths: 240 },
];

const PHASE_ORDER: readonly TickPhase[] = [
  'weather', 'environment', 'survival-planning', 'resources', 'economy', 'knowledge-month',
  'transport-trade', 'survival-resolution', 'people', 'wars', 'migration',
  'quarterly-partnerships', 'annual-diplomacy', 'annual-institutions', 'annual-politics',
  'knowledge-year', 'annual-culture', 'settlement-change', 'advanced-month', 'advanced-year',
  'bookkeeping', 'history-trim',
];

export interface SimScenarioResult {
  readonly scenario: string;
  readonly description: string;
  readonly month: number;
  readonly year: number;
  readonly population: number;
  readonly settlements: number;
  readonly historyRecords: number;
  readonly warmupSeconds: number;
  readonly tick: TickPerformanceSnapshot;
  /** Phases ranked by total contributed milliseconds across the measured window. */
  readonly hotPhases: ReadonlyArray<{ phase: TickPhase; meanMs: number; p95Ms: number; maxMs: number; shareOfTotal: number }>;
}

export function runSimScenario(scenario: SimScenario, seed = GODBOX_CONFIG.seed ?? 'perf-baseline'): SimScenarioResult {
  // Production configuration verbatim, minus the Arrival film: tick cost is what is being measured
  // and the prologue holds the simulation at month 0.
  const simulation = new Simulation({ ...GODBOX_CONFIG, seed, startMode: 'established' });
  simulation.state.arrival = undefined;

  const warmupStart = performance.now();
  // Chunked so a single step() call never allocates an unrepresentative amount at once.
  let remaining = scenario.warmupMonths;
  while (remaining > 0) {
    const chunk = Math.min(240, remaining);
    simulation.step(chunk);
    remaining -= chunk;
  }
  const warmupSeconds = (performance.now() - warmupStart) / 1000;

  simulation.setTickProfiling(true);
  simulation.resetTickProfiling();
  for (let month = 0; month < scenario.measureMonths; month++) simulation.step();
  const tick = simulation.tickPerformance();

  const totalMs = tick.total.meanMs * Math.max(1, tick.total.count);
  const hotPhases = PHASE_ORDER
    .map(phase => ({ phase, stats: tick.phases[phase] }))
    .filter((entry): entry is { phase: TickPhase; stats: NonNullable<typeof entry.stats> } => Boolean(entry.stats))
    .map(({ phase, stats }) => ({
      phase,
      meanMs: stats.meanMs,
      p95Ms: stats.p95Ms,
      maxMs: stats.maxMs,
      shareOfTotal: totalMs > 0 ? Number(((stats.meanMs * stats.count) / totalMs).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.shareOfTotal - a.shareOfTotal);

  const state = simulation.state;
  return {
    scenario: scenario.name,
    description: scenario.description,
    month: state.month,
    year: simulation.year,
    population: state.people.length,
    settlements: state.settlements.length,
    historyRecords: state.history.length,
    warmupSeconds: Number(warmupSeconds.toFixed(2)),
    tick,
    hotPhases,
  };
}

function formatResult(result: SimScenarioResult): string {
  const lines: string[] = [];
  lines.push(`\n=== ${result.scenario.toUpperCase()} === ${result.description}`);
  lines.push(`  year ${result.year.toLocaleString()} | month ${result.month.toLocaleString()} | people ${result.population}`
    + ` | settlements ${result.settlements} | history ${result.historyRecords.toLocaleString()}`
    + ` | warmup ${result.warmupSeconds}s`);
  const t = result.tick;
  lines.push(`  tick total   mean ${t.total.meanMs.toFixed(3)}ms  p95 ${t.total.p95Ms.toFixed(3)}ms  max ${t.total.maxMs.toFixed(3)}ms  (n=${t.total.count})`);
  lines.push(`  ordinary     mean ${t.ordinary.meanMs.toFixed(3)}ms  p95 ${t.ordinary.p95Ms.toFixed(3)}ms  max ${t.ordinary.maxMs.toFixed(3)}ms`);
  lines.push(`  annual       mean ${t.annual.meanMs.toFixed(3)}ms  p95 ${t.annual.p95Ms.toFixed(3)}ms  max ${t.annual.maxMs.toFixed(3)}ms`);
  lines.push('  hottest phases (share of measured tick time):');
  for (const phase of result.hotPhases.slice(0, 8)) {
    lines.push(`    ${(phase.shareOfTotal * 100).toFixed(1).padStart(5)}%  ${phase.phase.padEnd(24)}`
      + ` mean ${phase.meanMs.toFixed(3)}ms  p95 ${phase.p95Ms.toFixed(3)}ms  max ${phase.maxMs.toFixed(3)}ms`);
  }
  const worst = t.slowestTicks.slice(0, 3);
  if (worst.length) {
    lines.push('  slowest individual ticks:');
    for (const sample of worst) {
      const attribution = Object.entries(sample.phases)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 3)
        .map(([phase, ms]) => `${phase} ${(ms ?? 0).toFixed(2)}ms`).join(', ');
      lines.push(`    month ${String(sample.month).padStart(7)} ${sample.annual ? '(annual)' : '        '}`
        + ` ${sample.totalMs.toFixed(2)}ms -> ${attribution}`);
    }
  }
  return lines.join('\n');
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/perf/sim-baseline.ts');
if (invokedDirectly) {
  const requested = process.argv.find(argument => argument.startsWith('--scenario='))?.split('=')[1];
  const asJson = process.argv.includes('--json');
  const scenarios = requested ? SIM_SCENARIOS.filter(s => s.name === requested) : SIM_SCENARIOS;
  if (!scenarios.length) {
    console.error(`Unknown scenario. Available: ${SIM_SCENARIOS.map(s => s.name).join(', ')}`);
    process.exit(1);
  }
  const results = scenarios.map(scenario => {
    if (!asJson) console.error(`measuring ${scenario.name} (warmup ${scenario.warmupMonths} months)...`);
    return runSimScenario(scenario);
  });
  if (asJson) console.log(JSON.stringify(results, null, 2));
  else console.log(results.map(formatResult).join('\n'));
}
