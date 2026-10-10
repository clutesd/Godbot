/**
 * Cross-seed determinism gate. Prints a state fingerprint per seed so an optimization can be
 * proven to leave authoritative history untouched: run it before a change, run it after, diff.
 *
 *   npx tsx scripts/perf/fingerprints.ts > before.txt
 */
import { GODBOX_CONFIG } from '../../godbox.config';
import { Simulation } from '../../src/sim/Simulation';
import { stateFingerprint } from './tick-bench';

const SEEDS = ['alpha', 'beta', 'gamma', 'delta', 'witness-the-saffron-river', 'epsilon-7'];
const MONTHS = 90;

for (const seed of SEEDS) {
  const simulation = new Simulation({ ...GODBOX_CONFIG, seed, startMode: 'established' });
  simulation.state.arrival = undefined;
  simulation.step(MONTHS);
  const state = simulation.state;
  console.log(`${seed.padEnd(28)} ${stateFingerprint(state)}`
    + ` people=${state.people.length} settlements=${state.settlements.length}`
    + ` history=${state.history.length} month=${state.month}`);
}
