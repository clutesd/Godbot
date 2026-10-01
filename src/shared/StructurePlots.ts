import { farmGeometries } from './FarmGeometry';
import { SeededRandom } from '../sim/prng';
import { nearestIndex, sampleHeight } from '../sim/terrain/TerrainField';
import { waterAt } from '../sim/transport/TerrainTraversal';
import type { Settlement, SimulationState, StructurePlot } from '../sim/types';
import { cellAt, TERRAIN_VERTICAL_SCALE } from '../sim/world';
import { createSettlementLayoutPlan, type BuildingDistrict } from './SettlementLayoutPlan';
import { FOUNDING_HEARTH_RESERVE_RADIUS, foundingHearthWorldPosition } from './FoundingCampLayout';
import { PlacementContract } from './placement/PlacementContract';

export interface PlotReservationOptions {
  /** Shrinks the building relative to the district default while the reserved ground stays proportional to `precinct`. */
  buildingScale?: number;
  /** Ground reserved around the building for yards, utilities and loading, in building radii. */
  precinct?: number;
}

/** A request reserves land only after passing the same contract used by the renderer. */
export function reserveStructurePlot(state: SimulationState, settlement: Settlement, district: BuildingDistrict, options: PlotReservationOptions = {}): StructurePlot | undefined {
    const plots = settlement.structurePlots ??= [];
    if (plots.length >= 96) return undefined;
    const allPlots = state.settlements.flatMap(entry => entry.structurePlots ?? []);
    const fields = state.settlements.flatMap(entry => farmGeometries(entry));
    const contract = new PlacementContract(state.world);
    const foundingHearth = foundingHearthWorldPosition(settlement, state.arrival?.pods ?? []);
    const layout = createSettlementLayoutPlan({ settlement, settlements: state.settlements, routes: state.tradeRoutes, eraRank: 1, seed: state.seed, identity: settlement.architecture });
    const index = plots.length;
    const random = new SeededRandom(`${state.seed}:${settlement.id}:structure:${index}`);
    const anchor = layout.anchors[district];
    const major = district === 'civic' || district === 'sacred' || district === 'industrial';
    const width = random.range(0.7, 1.18) * (major ? 1.55 * 2.6 : district === 'residential' ? 1.9 : 1.6) * (options.buildingScale ?? 1);
    const depth = width * 0.82;
    const radius = width * 0.66 * (options.precinct ?? 1);
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const angle = index * 2.399 + attempt * 0.83 + random.range(-0.2, 0.2);
      const dispersal = (settlement.development?.informal.government ?? 0) > (settlement.development?.pressures.government ?? 0) ? 1.3 : 1;
      const searchRadius = (0.5 + Math.sqrt(attempt + 1) * 0.8) * dispersal;
      const worldX = anchor.worldX + Math.cos(angle) * searchRadius;
      const worldZ = anchor.worldZ + Math.sin(angle) * searchRadius;
      if (state.arrival?.pods.some(p => Math.hypot(worldX - p.position.x, worldZ - p.position.z) < radius + 1.5)) continue;
      if (foundingHearth && Math.hypot(worldX - foundingHearth.x, worldZ - foundingHearth.z) < radius + FOUNDING_HEARTH_RESERVE_RADIUS) continue;
      const cell = cellAt(state.world, worldX, worldZ);
      if (!cell || waterAt(state.world, { x: worldX, z: worldZ }, cell) || cell.slope > 0.42 || cell.biome === 'mountain') continue;
      if (allPlots.some(plot => Math.hypot(plot.worldX - worldX, plot.worldZ - worldZ) < plot.radius + radius + 0.25)) continue;
      if (state.energy?.nodes?.some(node => !node.retired && Math.hypot(node.position.x - worldX, node.position.z - worldZ) < node.radius + radius + 0.25)) continue;
      // Persistent electrical rights of way remain clear when the settlement grows around them.
      if (state.energy?.lines.some(line => !line.retired && line.points.some((point, i) => {
        const end = line.points[i + 1];
        if (!end) return false;
        const dx = end.x - point.x, dz = end.z - point.z;
        const t = Math.max(0, Math.min(1, ((worldX - point.x) * dx + (worldZ - point.z) * dz) / Math.max(1e-9, dx * dx + dz * dz)));
        return Math.hypot(worldX - point.x - t * dx, worldZ - point.z - t * dz) < radius + 0.2;
      }))) continue;
      if (fields.some(field => {
        const dx = worldX - field.center.x, dz = worldZ - field.center.z;
        const localX = dx * Math.cos(field.rotationY) - dz * Math.sin(field.rotationY);
        const localZ = dx * Math.sin(field.rotationY) + dz * Math.cos(field.rotationY);
        return Math.hypot(Math.max(0, Math.abs(localX) - field.width / 2),
          Math.max(0, Math.abs(localZ) - field.depth / 2)) < radius + 0.25;
      })) continue;
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
