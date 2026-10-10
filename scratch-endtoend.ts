/** Simulate to year 276, then measure every structure the renderer would place. */
import { Simulation } from './src/sim/Simulation';
import { AssetBuilder } from './src/render/assets/AssetBuilder';
import { structureFit, WORLD_UNITS_PER_METRE } from './src/render/assets/StructureFit';
import { developmentBuildingRole, developmentPresentationEra } from './src/render/assets/BuildingGrammar';

const simulation = new Simulation({ seed: 'witness-the-saffron-river', startingPopulation: 360 });
while (simulation.year < 276) simulation.step(Math.min(600, 276 * 12 - simulation.state.month));
const state = simulation.state;
console.log(`year ${simulation.year}, ${state.settlements.length} settlements`);

const builder = new AssetBuilder();
const byForm = new Map<string, { n: number; heights: number[]; widths: number[]; fits: number[] }>();
let plots = 0;

for (const settlement of state.settlements) {
  if (!settlement.alive) continue;
  for (const plot of settlement.structurePlots ?? []) {
    const d = plot.development;
    if (!d || d.status !== 'active') continue;
    plots += 1;
    const role = developmentBuildingRole(d);
    const era = developmentPresentationEra(d);
    const asset = builder.getAsset('building', {
      seed: `${settlement.architecture?.dialectKey ?? settlement.id}:${role}:v0`,
      culture: settlement.culture?.style ?? { primary: '#888', secondary: '#666', accent: '#ccc', pattern: 'plain' },
      era, variant: `${role}#7`, development: d, settlementIdentity: settlement.architecture,
      prosperity: settlement.prosperity, specialization: settlement.specialization,
    } as never);
    const u = asset.mesh.userData;
    const massWidth = Number(u['massWidth'] ?? u['footprintWidth'] ?? 1);
    const massDepth = Number(u['massDepth'] ?? u['footprintDepth'] ?? 1);
    const fit = structureFit({ plotWidth: plot.width, plotDepth: plot.depth, massWidth, massDepth, level: d.level });
    const key = `${d.need}/${d.form}`;
    const bucket = byForm.get(key) ?? { n: 0, heights: [], widths: [], fits: [] };
    bucket.n += 1;
    bucket.heights.push(Number(u['buildingHeight']) * fit / WORLD_UNITS_PER_METRE);
    bucket.widths.push(massWidth * fit / WORLD_UNITS_PER_METRE);
    bucket.fits.push(fit);
    byForm.set(key, bucket);
  }
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
console.log(`${plots} active structures\n`);
console.log('need/form'.padEnd(26), 'n'.padStart(5), 'median w'.padStart(10), 'median h'.padStart(10), 'median fit'.padStart(11), 'min h'.padStart(8));
for (const [key, b] of [...byForm].sort((a, b) => b[1].n - a[1].n)) {
  console.log(
    key.padEnd(26), String(b.n).padStart(5),
    `${median(b.widths).toFixed(1)}m`.padStart(10), `${median(b.heights).toFixed(1)}m`.padStart(10),
    median(b.fits).toFixed(2).padStart(11), `${Math.min(...b.heights).toFixed(1)}m`.padStart(8),
  );
}
