import { mkdirSync, writeFileSync } from 'node:fs';
import { morphologyFixture } from '../tests/fixtures/settlementMorphology';
import { reserveStructurePlot } from '../src/shared/StructurePlots';
import { movementGatheringPoint, settlementMovementFrontage } from '../src/shared/MovementFrontage';

// A reproducible plan-view acceptance fixture, using identical technology, seed and plot requests.
// These are controlled histories, not screenshots of naturally simulated settlement evolution.
const scenarios = [
  { title: 'Eastbound movement', history: 'east' as const, shore: false },
  { title: 'Turning movement corridor', history: 'bend' as const, shore: false },
  { title: 'Eastbound movement beside water', history: 'east' as const, shore: true },
];
const panels = scenarios.map(scenario => {
  const { state, town } = morphologyFixture(scenario.history);
  const bank = state.world.cellSize * 0.65;
  if (scenario.shore) {
    const field = state.world.terrain;
    for (let z = 0; z < field.resolution; z++) {
      if (field.originZ + z * field.step < bank) continue;
      for (let x = 0; x < field.resolution; x++) field.waterLevel[z * field.resolution + x] = state.world.seaLevel + 0.25;
    }
  }
  for (let i = 0; i < 12; i++) {
    const plot = reserveStructurePlot(state, town, i % 4 === 0 ? 'market' : 'residential');
    if (!plot) throw new Error(`No legal site for ${scenario.title}, plot ${i}`);
    state.month += 12;
  }
  const paths = settlementMovementFrontage(state.world, town);
  return { ...scenario, bank, paths, gathering: movementGatheringPoint(paths), plots: town.structurePlots! };
});
const scale = 11, middle = 170;
const x = (value: number) => middle + value * scale;
const z = (value: number) => 190 - value * scale;
const body = panels.map((panel, index) => {
  const water = panel.shore ? `<rect x="10" y="65" width="320" height="${z(panel.bank) - 65}" fill="#b1d3dc"/>` : '';
  const paths = panel.paths.map(edge => `<line x1="${x(edge.from.x)}" y1="${z(edge.from.z)}" x2="${x(edge.to.x)}" y2="${z(edge.to.z)}" stroke="#896447" stroke-width="${edge.halfWidth * 2 * scale}" stroke-linecap="round"/>`).join('');
  const plots = panel.plots.map(plot => `<circle cx="${x(plot.worldX)}" cy="${z(plot.worldZ)}" r="${plot.radius * scale}" fill="#ba9970" fill-opacity="0.35" stroke="#715237"/><rect x="${x(plot.worldX) - plot.width * scale / 2}" y="${z(plot.worldZ) - plot.depth * scale / 2}" width="${plot.width * scale}" height="${plot.depth * scale}" fill="#715237"/>`).join('');
  const gathering = panel.gathering ? `<circle cx="${x(panel.gathering.x)}" cy="${z(panel.gathering.z)}" r="4" fill="#b86a26" stroke="white"/>` : '';
  return `<g transform="translate(${index * 350},0)"><text x="15" y="35" font-size="16">${panel.title}</text><rect x="10" y="65" width="320" height="255" fill="#edf0de" stroke="#cad0bd"/>${water}${paths}${plots}${gathering}</g>`;
}).join('');
mkdirSync('output', { recursive: true });
writeFileSync('output/settlement-morphology.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="390" viewBox="0 0 1050 390"><rect width="1050" height="390" fill="#faf9f5"/><g font-family="sans-serif" fill="#333">${body}<text x="15" y="355" font-size="14">Same seed and technology. Brown: recorded circulation. Circles: reserved footprints. Orange: gathering destination.</text><text x="15" y="378" font-size="12">Controlled acceptance fixtures; plot reservation creates no roads or paving.</text></g></svg>`);
writeFileSync('output/settlement-morphology.json', JSON.stringify(panels, null, 2));
console.log('Wrote output/settlement-morphology.svg');
