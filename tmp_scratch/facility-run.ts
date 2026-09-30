import { Simulation } from '../src/sim/Simulation';
import { presetConfig, timePresetConfig } from '../src/presets';

const seed = process.argv[2] ?? 'witness-the-saffron-river';
const years = Number(process.argv[3] ?? 150);
const cfg = presetConfig('default', timePresetConfig('batch/headless'));
const sim = new Simulation({ ...cfg, seed, startingPopulation: 360 } as never);
const t0 = Date.now();
for (let y = 1; y <= years; y++) {
  sim.step(12);
  if (y % 25 === 0 || y === years) {
    const rows: string[] = [];
    for (const s of sim.state.settlements.filter(s => s.alive)) {
      const fs = s.processing?.facilities ?? [];
      if (!fs.length) continue;
      rows.push(`${s.name}(${s.buildings}b): ` + fs.map(f => `${f.kind}[t${f.tier} ${f.status}${f.upgrade ? '>' + f.upgrade.toTier : ''} ${f.progress < 1 ? f.progress.toFixed(2) : ''} thr=${f.throughput.toFixed(2)} ${f.limiter} pw=${f.power.carrier}:${f.power.coverage.toFixed(2)}]`).join(' '));
    }
    console.log(`--- year ${y} (${((Date.now() - t0) / 1000).toFixed(0)}s) alive=${sim.state.settlements.filter(s => s.alive).length}`);
    console.log(rows.join('\n'));
  }
}
const blockers = sim.state.settlements.filter(s => s.alive).map(s => `${s.name}:${JSON.stringify(s.processing?.foundingBlockers)}`).slice(0, 8);
console.log(blockers.join('\n'));
