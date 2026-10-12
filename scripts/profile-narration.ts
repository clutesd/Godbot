// CPU-only editorial benchmark. Includes the installed production narration layers;
// excludes simulation ticks, rendering and GPU work.
import '../godbox.config';
import { performance } from 'node:perf_hooks';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';
import type { HistoricalEvent } from '../src/sim/types';

const sim = new Simulation({ seed: 'narration-cpu-audit', startMode: 'established',
  startingPopulation: 240, world: { size: 52 } });
sim.state.arrival = undefined;
sim.state.month = 4800;
const place = sim.state.settlements[0]!;
const types = ['political-transition', 'institution-formed', 'recipe-learned', 'technology-widespread'] as const;
sim.state.history = Array.from({ length: 50_000 }, (_, i): HistoricalEvent => {
  const recent = i >= 49_952;
  return { id: `profile-${i}`, sequence: i + 1, month: recent ? 4780 + i % 20 : Math.floor(i / 20),
    type: recent ? types[i % types.length]! : 'birth', actors: recent ? [place.id] : ['world'],
    locationId: recent ? place.id : undefined, location: recent ? place.position : undefined,
    causes: [], context: {}, summary: recent ? `${place.name} establishes a new practice.` : 'A birth is recorded.',
    outcome: recent ? 'Repeated trials make the process reproducible.' : 'A child is born.',
    affectedPopulation: recent ? 40 : 1, magnitude: recent ? 0.8 : 0.1,
    significance: recent ? 0.85 : 0.1, tags: [] };
});
const historian = new Historian(sim.config);
const samples: number[] = [];
const initial = JSON.stringify(sim.state);
for (let pass = 0; pass < 65; pass++) {
  const start = performance.now();
  const scene = historian.chooseScene(sim.state);
  if (!historian.validateStatement(scene.statement, sim.state)) throw new Error('Ungrounded narration');
  if (pass >= 5) samples.push(performance.now() - start);
}
if (JSON.stringify(sim.state) !== initial) throw new Error('Narration mutated the world');
samples.sort((a, b) => a - b);
const at = (fraction: number) => Number(samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))]!.toFixed(3));
process.stdout.write(JSON.stringify({ scenario: '240 people, 50000 records, 48 recent significant events',
  units: 'milliseconds per editorial selection', passes: samples.length,
  median: at(0.5), p95: at(0.95), max: at(1) }) + '\n');
