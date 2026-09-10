import { SeededRandom } from '../sim/prng';
import { nearestIndex, sampleHeight } from '../sim/terrain/TerrainField';
import type { Settlement, SimulationState, StructurePlot } from '../sim/types';
import { cellAt, TERRAIN_VERTICAL_SCALE } from '../sim/world';
import { createSettlementLayoutPlan, type BuildingDistrict } from './SettlementLayoutPlan';
import { PlacementContract } from './placement/PlacementContract';

/** A request reserves land only after passing the same contract used by the renderer. */
export function reserveStructurePlot(state: SimulationState, settlement: Settlement, district: BuildingDistrict): StructurePlot | undefined {
    const plots = settlement.structurePlots ??= [];
    if (plots.length >= 96) return undefined;
    const allPlots = state.settlements.flatMap(entry => entry.structurePlots ?? []);
    const contract = new PlacementContract(state.world);
    const layout = createSettlementLayoutPlan({ settlement, settlements: state.settlements, routes: state.tradeRoutes, eraRank: 1, seed: state.seed });
    const index = plots.length;
    const random = new SeededRandom(`${state.seed}:${settlement.id}:structure:${index}`);
    const anchor = layout.anchors[district];
    const major = district === 'civic' || district === 'sacred' || district === 'industrial';
    const width = random.range(0.7, 1.18) * (major ? 1.55 * 2.6 : district === 'residential' ? 1.9 : 1.6);
    const depth = width * 0.82;
    const radius = width * 0.66;
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const angle = index * 2.399 + attempt * 0.83 + random.range(-0.2, 0.2);
      const dispersal = (settlement.development?.informal.government ?? 0) > (settlement.development?.pressures.government ?? 0) ? 1.3 : 1;
      const searchRadius = (0.5 + Math.sqrt(attempt + 1) * 0.8) * dispersal;
      const worldX = anchor.worldX + Math.cos(angle) * searchRadius;
      const worldZ = anchor.worldZ + Math.sin(angle) * searchRadius;
      const cell = cellAt(state.world, worldX, worldZ);
      if (!cell || cell.water || cell.slope > 0.42 || cell.biome === 'mountain') continue;
      if (allPlots.some(plot => Math.hypot(plot.worldX - worldX, plot.worldZ - worldZ) < plot.radius + radius + 0.25)) continue;
      const ground = sampleHeight(state.world.terrain, worldX, worldZ);
      let valid = true;
      for (let sample = 0; sample < 9; sample += 1) {
        const sampleX = worldX + (sample === 8 ? 0 : Math.cos(sample / 8 * Math.PI * 2) * radius);
        const sampleZ = worldZ + (sample === 8 ? 0 : Math.sin(sample / 8 * Math.PI * 2) * radius);
        const height = sampleHeight(state.world.terrain, sampleX, sampleZ);
        const water = state.world.terrain.waterLevel[nearestIndex(state.world.terrain, sampleX, sampleZ)]!;
        if (water > height - 0.003 || Math.abs(height - ground) * TERRAIN_VERTICAL_SCALE > 0.65) valid = false;
      }
      if (!valid || !contract.validate({ type: major ? 'major-building' : 'small-building', worldX, worldZ, footprintRadius: radius }).valid) continue;
      const plot: StructurePlot = { id: `${settlement.id}:building:${index}`, worldX, worldZ, radius, width, depth,
        height: random.range(0.55, 1.25) * (major ? 1.7 : 1), condition: 1, foundedMonth: state.month };
      plots.push(plot);
      return plot;
    }
    return undefined;
}

export function syncStructurePlots(state: SimulationState): void {
  for (const settlement of state.settlements) {
    if (settlement.development) continue;
    const plots = settlement.structurePlots ??= [];
    const target = Math.min(96, settlement.buildings);
    if (!settlement.alive || plots.length >= target || settlement.structurePlotTarget === target) continue;
    settlement.structurePlotTarget = target;
    for (let index = plots.length; index < target; index += 1) {
      if (!reserveStructurePlot(state, settlement, 'residential')) break;
    }
  }
}
