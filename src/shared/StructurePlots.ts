import { farmGeometries } from './FarmGeometry';
import { SeededRandom } from '../sim/prng';
import { nearestIndex, sampleHeight } from '../sim/terrain/TerrainField';
import { fineSegmentDry, waterAt } from '../sim/transport/TerrainTraversal';
import type { Settlement, SimulationState, StructurePlot } from '../sim/types';
import { cellAt, TERRAIN_VERTICAL_SCALE } from '../sim/world';
import { createSettlementLayoutPlan, districtForResponse, type BuildingDistrict } from './SettlementLayoutPlan';
import { FOUNDING_HEARTH_RESERVE_RADIUS, foundingHearthWorldPosition } from './FoundingCampLayout';
import { PlacementContract } from './placement/PlacementContract';
import { closestFrontagePoint, movementGatheringPoint, movementJunctions, settlementMovementFrontage } from './MovementFrontage';

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
    const layout = createSettlementLayoutPlan({ settlement, settlements: state.settlements, routes: state.tradeRoutes, transportation: state.transportation, eraRank: 1, seed: state.seed, identity: settlement.architecture });
    const frontage = settlementMovementFrontage(state.world, settlement);
    const gathering = movementGatheringPoint(frontage);
    const junctions = movementJunctions(frontage);
    const busiest = Math.max(1e-9, ...frontage.map(edge => edge.strength));
    const destinations = [
      ...layout.portals.map(portal => portal.bank ?? { x: portal.worldX, z: portal.worldZ }),
      ...(district === 'craft' || district === 'industrial' ? state.world.resourceDeposits
        .filter(deposit => settlement.workedDeposits.includes(deposit.id))
        .map(deposit => ({ x: deposit.worldX, z: deposit.worldZ })) : []),
    ];
    const index = plots.length;
    const random = new SeededRandom(`${state.seed}:${settlement.id}:structure:${index}`);
    const major = district === 'civic' || district === 'sacred' || district === 'industrial';
    // District plot widths are sized against what the architecture actually builds on them: a
    // workshop's mass runs to ~2.4 canonical units against a house's ~1.9, so a craft plot that
    // matched a house's left every workshop fitted down to two thirds of its designed size.
    const width = random.range(0.7, 1.18) * (major ? 1.55 * 2.6 : district === 'residential' ? 1.9 : 2.0) * (options.buildingScale ?? 1);
    const depth = width * 0.82;
    const radius = width * 0.66 * (options.precinct ?? 1);
    const neighbours = plots.filter(plot => plot.condition > 0.08);
    const peers = neighbours.filter(plot => (plot.development ? districtForResponse(plot.development) : 'residential') === district);
    let best: { worldX: number; worldZ: number; score: number } | undefined;
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const angle = index * 2.399 + attempt * 0.83 + random.range(-0.2, 0.2);
      const dispersal = (settlement.development?.informal.government ?? 0) > (settlement.development?.pressures.government ?? 0) ? 1.3 : 1;
      const searchRadius = (0.5 + Math.sqrt(attempt + 1) * 0.8) * dispersal;
      // Grow from occupied ground rather than a district ring. Homes form compounds;
      // stores and workshops follow their existing working neighbours and access.
      const source = peers.length ? peers[attempt % peers.length] : neighbours[attempt % Math.max(1, neighbours.length)];
      const originX = source?.worldX ?? settlement.position.x;
      const originZ = source?.worldZ ?? settlement.position.z;
      const reach = source ? source.radius + radius + 0.3 + (attempt % 8) * 0.55 : searchRadius;
      let worldX = originX + Math.cos(angle) * reach;
      let worldZ = originZ + Math.sin(angle) * reach;
      // Keep compound growth candidates, but increasingly sample the sides of established paths.
      // Never put the building on the circulation centreline to earn a wear bonus.
      if (frontage.length && attempt % 3 !== 0) {
        // Spread the fixed candidate budget over the whole survey, including large towns.
        const edge = frontage[Math.floor(Math.floor(attempt / 3) * Math.max(1, frontage.length / 43)) % frontage.length]!;
        const t = random.range(0.08, 0.92);
        const dx = edge.to.x - edge.from.x, dz = edge.to.z - edge.from.z;
        const length = Math.hypot(dx, dz);
        const side = attempt % 2 ? 1 : -1;
        const offset = radius + edge.halfWidth + 0.3 + random.range(0, 0.65);
        worldX = edge.from.x + dx * t - dz / length * offset * side;
        worldZ = edge.from.z + dz * t + dx / length * offset * side;
      }
      if (destinations.length && attempt % 6 === 0) {
        const destination = destinations[Math.floor(attempt / 6) % destinations.length]!;
        const offset = radius + 0.5 + random.range(0, 2);
        worldX = destination.x + Math.cos(angle) * offset;
        worldZ = destination.z + Math.sin(angle) * offset;
      }
      if (state.arrival?.pods.some(p => Math.hypot(worldX - p.position.x, worldZ - p.position.z) < radius + 1.5)) continue;
      if (foundingHearth && Math.hypot(worldX - foundingHearth.x, worldZ - foundingHearth.z) < radius + FOUNDING_HEARTH_RESERVE_RADIUS) continue;
      const cell = cellAt(state.world, worldX, worldZ);
      if (!cell || waterAt(state.world, { x: worldX, z: worldZ }, cell) || cell.slope > 0.42 || cell.biome === 'mountain') continue;
      if (frontage.some(edge => {
        const point = closestFrontagePoint(edge, { x: worldX, z: worldZ });
        return Math.hypot(point.x - worldX, point.z - worldZ) < radius + edge.halfWidth + 0.2;
      })) continue;
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
        const local = cellAt(state.world, sampleX, sampleZ);
        const flood = local ? state.world.weather?.cells[local.z * state.world.size + local.x]?.floodDepth ?? 0 : 0;
        if (flood > 0.08 || water > height - 0.003 || Math.abs(height - ground) * TERRAIN_VERTICAL_SCALE > 0.65) valid = false;
      }
      if (!valid || !contract.validate({ type: major ? 'major-building' : 'small-building', worldX, worldZ, footprintRadius: radius }).valid) continue;
      // Only a dry, unblocked short connection counts as access. Proximity across a river,
      // another plot or a cultivated field must not attract otherwise isolated buildings.
      const accessible = (point: { x: number; z: number }): boolean => {
        if (!fineSegmentDry(state.world, { x: worldX, z: worldZ }, point)) return false;
        const steps = Math.max(2, Math.ceil(Math.hypot(point.x - worldX, point.z - worldZ) / 0.5));
        for (let step = 1; step <= steps; step++) {
          const x = worldX + (point.x - worldX) * step / steps;
          const z = worldZ + (point.z - worldZ) * step / steps;
          const local = cellAt(state.world, x, z);
          if (!local || local.slope > 0.42 || waterAt(state.world, { x, z }, local)
            || (state.world.weather?.cells[local.z * state.world.size + local.x]?.floodDepth ?? 0) > 0.08
            || state.energy?.nodes?.some(node => !node.retired && Math.hypot(node.position.x - x, node.position.z - z) < node.radius + 0.15)
            || allPlots.some(plot => Math.hypot(plot.worldX - x, plot.worldZ - z) < plot.radius + 0.15)
            || fields.some(field => {
              const dx = x - field.center.x, dz = z - field.center.z;
              const lx = dx * Math.cos(field.rotationY) - dz * Math.sin(field.rotationY);
              const lz = dx * Math.sin(field.rotationY) + dz * Math.cos(field.rotationY);
              return Math.abs(lx) < field.width / 2 + 0.15 && Math.abs(lz) < field.depth / 2 + 0.15;
            })) return false;
        }
        return true;
      };
      let accessGap = Number.POSITIVE_INFINITY, traffic = 0;
      for (const edge of frontage) {
        const point = closestFrontagePoint(edge, { x: worldX, z: worldZ });
        const gap = Math.hypot(point.x - worldX, point.z - worldZ) - radius - edge.halfWidth;
        if (gap > 5 || gap >= accessGap || !accessible(point)) continue;
        accessGap = gap; traffic = edge.strength;
      }
      for (const destination of destinations) {
        const gap = Math.hypot(destination.x - worldX, destination.z - worldZ) - radius;
        if (gap < 0.3 || gap > 5 || gap >= accessGap || !accessible(destination)) continue;
        accessGap = gap;
      }
      // Established towns grow along accessible circulation; founding compounds may grow before
      // movement has left persistent wear. No path is stamped by reserving a plot.
      if (frontage.length && neighbours.length >= 4 && !Number.isFinite(accessGap)) continue;
      const accessWeight = Math.min(3, 0.5 + neighbours.length * 0.3);
      const destinationDistance = destinations.length ? Math.min(...destinations.map(point => Math.hypot(point.x - worldX, point.z - worldZ))) : 0;
      const distance = Math.hypot(worldX - settlement.position.x, worldZ - settlement.position.z);
      const neighbourGap = source ? Math.hypot(worldX - source.worldX, worldZ - source.worldZ) - source.radius - radius : distance;
      // Junctions pull activity-led uses (markets, workshops, civic); quieter lanes keep residential compounds.
      const junctionDistance = junctions.length && (district === 'market' || district === 'civic' || district === 'craft')
        ? Math.min(...junctions.map(junction => Math.hypot(junction.point.x - worldX, junction.point.z - worldZ) * (1 - Math.min(0.6, junction.strength / busiest) * 0.5)))
        : 0;
      // Contours and established circulation compete with functional proximity. High,
      // dry sites attract defensive/sacred uses; food seeks fertile, gentle ground.
      const score = neighbourGap * (district === 'residential' ? 1.5 : 0.65)
        + (source ? Math.abs(ground - sampleHeight(state.world.terrain, source.worldX, source.worldZ)) * 18 : 0)
        + cell.slope * 12 + distance * 0.12
        + (Number.isFinite(accessGap) ? accessGap * accessWeight - traffic * (district === 'market' || district === 'civic' ? 4 : 1.5) : 3)
        + (district === 'craft' && settlement.specialization === 'agriculture' ? -cell.fertility * 2 : 0)
        - (district === 'sacred' || settlement.architecture?.orientationBias === 'defense' ? ground * 2 : 0)
        + (gathering && (district === 'market' || district === 'civic') ? Math.hypot(worldX - gathering.x, worldZ - gathering.z) * 0.2 : 0)
        + junctionDistance * 0.2
        + destinationDistance * (district === 'market' || district === 'industrial' ? 0.35 : 0.12);
      if (!best || score < best.score) best = { worldX, worldZ, score };
    }
    if (best) {
      const { worldX, worldZ } = best;
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
