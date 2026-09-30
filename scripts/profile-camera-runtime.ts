// CPU-only camera/historian audit with synthetic archived history. Excludes WebGL/GPU cost.
import { performance } from 'node:perf_hooks';
import { PerspectiveCamera } from 'three';
import type { HistoricalEvent } from '../src/sim/types';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';
import { CameraDirector } from '../src/render/CameraDirector';

const simulation = new Simulation({ seed: 'camera-cpu-audit', startMode: 'established',
  startingPopulation: 240, world: { size: 52 } });
simulation.state.arrival = undefined;
simulation.state.month = 1000;
simulation.state.history = Array.from({ length: 50_000 }, (_, i) => ({
  id: `profile-${i}`, month: Math.floor(i / 50), type: 'birth', actors: ['world'], causes: [], context: {},
  outcome: 'Recorded birth', affectedPopulation: 1, magnitude: 0.1, significance: 0.1, tags: [], summary: 'Recorded birth',
} satisfies HistoricalEvent));
const director = new CameraDirector(new PerspectiveCamera(38, 1.6, 0.01, 500),
  simulation.config, new Historian(simulation.config));
const frames: number[] = [], monthly: number[] = [];

// People and terrain are frozen to isolate camera cost; the documentary clock and record grow.
// Three initial windows warm up the runtime before sixty measured presentation seconds.
for (let frame = 0; frame < 1980; frame++) {
  const changed = frame % 60 === 0;
  if (changed) {
    simulation.state.month++;
    simulation.state.history.push({ ...simulation.state.history[0]!, id: `appended-${frame}`, month: simulation.state.month });
  }
  const start = performance.now();
  director.update(1 / 30, frame / 30, simulation.state, () => 0);
  const elapsed = performance.now() - start;
  if (frame >= 180) { frames.push(elapsed); if (changed) monthly.push(elapsed); }
}
frames.sort((a, b) => a - b); monthly.sort((a, b) => a - b);
const percentile = (samples: number[], fraction: number): number =>
  Number(samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))]!.toFixed(3));
console.log(JSON.stringify({
  scenario: '240 people, 50000 archived records, monthly appends', units: 'milliseconds', frames: frames.length,
  median: percentile(frames, 0.5), p95: percentile(frames, 0.95), p99: percentile(frames, 0.99), max: percentile(frames, 1),
  monthlyMedian: percentile(monthly, 0.5), monthlyP95: percentile(monthly, 0.95),
  acquisitions: director.sceneTransitions.filter(transition => transition.phase === 'acquired').length,
}));
