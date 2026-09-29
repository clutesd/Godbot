import { movementPathStage, strongestMovementPathNeighbour } from '../environment/PathEvolution';
import { PlacementContract } from '../../shared/placement/PlacementContract';
import { StructureNavigation } from '../people/StructureNavigation';
import { distance, fineSegmentDry, samplesBetween } from '../transport/TerrainTraversal';
import type { Settlement, SimulationState, Vec2 } from '../types';

export interface GridCorridor { a: Vec2; b: Vec2; }
export function gridCorridors(state: SimulationState, s: Settlement): GridCorridor[] {
  const corridors: GridCorridor[] = [];
  const reach = Math.max(12, ...(s.structurePlots ?? []).map(p => distance(s.position, { x: p.worldX, z: p.worldZ }) + 5));
  const add = (a: Vec2, b: Vec2, width: number): void => {
    const length = distance(a, b);
    if (length < 0.01) return;
    const count = Math.max(1, Math.ceil(length / 3));
    const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
    for (const side of [1, -1]) for (let i = 0; i < count; i++) {
      const start = { x: a.x + (b.x - a.x) * i / count - dz * width * side,
        z: a.z + (b.z - a.z) * i / count + dx * width * side };
      const end = { x: a.x + (b.x - a.x) * (i + 1) / count - dz * width * side,
        z: a.z + (b.z - a.z) * (i + 1) / count + dx * width * side };
      if (distance(start, s.position) <= reach && distance(end, s.position) <= reach) corridors.push({ a: start, b: end });
    }
  };
  for (const segment of Object.values(state.transportation.segments).sort((a, b) => a.id.localeCompare(b.id))) {
    if (segment.status !== 'complete' || segment.mode === 'water') continue;
    for (let i = 1; i < segment.points.length; i++) add(segment.points[i - 1]!, segment.points[i]!, 0.55);
  }
  for (const deposit of state.world.resourceDeposits) for (const trail of deposit.accessTrails ?? []) {
    for (let i = 1; i < trail.length; i++) add(trail[i - 1]!, trail[i]!, 0.25);
  }
  const seen = new Set<string>();
  for (const [index, cell] of state.world.cells.entries()) {
    if (cell.water || distance(s.position, { x: cell.worldX, z: cell.worldZ }) > reach || movementPathStage(cell) === 'none') continue;
    const neighbour = strongestMovementPathNeighbour(state.world, index);
    if (neighbour === undefined) continue;
    const key = [index, neighbour].sort((a, b) => a - b).join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    const end = state.world.cells[neighbour]!;
    add({ x: cell.worldX, z: cell.worldZ }, { x: end.worldX, z: end.worldZ }, state.world.cellSize * 0.12 + 0.18);
  }
  // No template streets are invented: roadless sites receive short, surveyed improvised spurs.
  return corridors.sort((a, b) => distance(a.a, s.position) - distance(b.a, s.position));
}

/** Reuses the world placement, hydrology and structure-clearance contracts. */
export class GridRouting {
  private contract: PlacementContract;
  private navigation = new StructureNavigation();
  constructor(private state: SimulationState) {
    this.contract = new PlacementContract(state.world);
    this.navigation.set(state.settlements.flatMap(s => s.structurePlots ?? []));
  }
  site(p: Vec2, radius = 0.12): boolean {
    return fineSegmentDry(this.state.world, p, p) && this.contract.validate({ type: 'infrastructure', worldX: p.x, worldZ: p.z, footprintRadius: radius }).valid
      && this.navigation.clear(p)
      && this.navigation.nearby(p, p, radius + 3).every(s =>
        distance(p, { x: s.worldX, z: s.worldZ }) > Math.hypot(s.width, s.depth) / 2 + radius + 0.15);
  }
  clear(a: Vec2, b: Vec2): boolean {
    return this.navigation.clear(a, b) && fineSegmentDry(this.state.world, a, b)
      && samplesBetween(this.state.world, a, b).every(p =>
        this.contract.validate({ type: 'infrastructure', worldX: p.x, worldZ: p.z, footprintRadius: 0.08 }).valid);
  }
  /** A commissioned bridge corridor permits a bounded overhead span with both towers on dry banks. */
  bridgeSpan(a: Vec2, b: Vec2): boolean {
    return distance(a, b) <= 24 && this.site(a) && this.site(b) && this.navigation.clear(a, b);
  }
  /** Road vertices get a strong cost preference. Obstacle corners provide bounded dry detours.
   * Only the simulation stores the chosen path; later road growth never moves existing wires. */
  route(a: Vec2, b: Vec2, corridors: GridCorridor[] = [], equipment: readonly { position: Vec2; radius: number }[] = []): Vec2[] | undefined {
    if (distance(a, b) < 0.001) return [a, b];
    const clearance = new StructureNavigation();
    clearance.set(equipment.filter(n => n.radius >= 0.6 && distance(n.position, a) > n.radius + 0.2 && distance(n.position, b) > n.radius + 0.2)
      .map(n => ({ worldX: n.position.x, worldZ: n.position.z, width: n.radius * 1.6, depth: n.radius * 1.6 })));
    const points: Vec2[] = [a, b];
    const poleClear = (p: Vec2): boolean => distance(p, a) < 0.02 || distance(p, b) < 0.02
      || equipment.every(n => n.radius < 0.2 || distance(p, n.position) > n.radius + 0.32);
    const roadEdges = new Set<string>();
    const add = (p: Vec2): number => {
      const existing = points.findIndex(q => distance(p, q) < 0.02);
      if (existing >= 0) return existing;
      points.push(p); return points.length - 1;
    };
    for (const corridor of corridors) {
      const count = Math.max(1, Math.ceil(distance(corridor.a, corridor.b) / 3));
      let previous = -1;
      for (let i = 0; i <= count; i++) {
        const p = { x: corridor.a.x + (corridor.b.x - corridor.a.x) * i / count,
          z: corridor.a.z + (corridor.b.z - corridor.a.z) * i / count };
        if (!this.site(p) || !clearance.clear(p) || !poleClear(p)) { previous = -1; continue; }
        const index = add(p);
        if (previous >= 0) { roadEdges.add(`${previous}:${index}`); roadEdges.add(`${index}:${previous}`); }
        previous = index;
      }
    }
    for (const plot of [...this.navigation.nearby(a, b, 8), ...clearance.nearby(a, b, 8)]) {
      const radius = Math.hypot(plot.width, plot.depth) / 2 + 0.5;
      for (let i = 0; i < 8; i++) {
        const p = { x: plot.worldX + Math.cos(i * Math.PI / 4) * radius,
          z: plot.worldZ + Math.sin(i * Math.PI / 4) * radius };
        if (this.site(p) && clearance.clear(p) && poleClear(p)) add(p);
      }
    }
    const costs = points.map(() => Infinity), previous = points.map(() => -1), seen = new Set<number>();
    costs[0] = 0;
    for (let pass = 0; pass < points.length; pass++) {
      let next = -1;
      for (let i = 0; i < points.length; i++) if (!seen.has(i) && (next < 0 || costs[i]! < costs[next]!)) next = i;
      if (next < 0 || !Number.isFinite(costs[next])) break;
      if (next === 1) {
        const path = [b];
        for (let i = previous[1]!; i >= 0; i = previous[i]!) path.push(points[i]!);
        return path.reverse();
      }
      seen.add(next);
      for (let i = 1; i < points.length; i++) {
        if (seen.has(i)) continue;
        const length = distance(points[next]!, points[i]!);
        const cost = costs[next]! + length * (roadEdges.has(`${next}:${i}`) ? 0.22 : 1);
        if (cost >= costs[i]! || !clearance.clear(points[next]!, points[i]!) || !this.clear(points[next]!, points[i]!)) continue;
        costs[i] = cost; previous[i] = next;
      }
    }
    return undefined;
  }
}
