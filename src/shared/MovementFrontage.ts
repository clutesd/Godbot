import { movementPathHalfWidth, movementPathStage, movementPathStrength, strongestMovementPathNeighbour } from '../sim/environment/PathEvolution';
import type { Settlement, Vec2, WorldState } from '../sim/types';

export interface MovementFrontage {
  from: Vec2;
  to: Vec2;
  strength: number;
  /** Half width from the existing movement-path presentation authority. */
  halfWidth: number;
}

/** A bounded local survey of the same worn-cell edges presented by ResourceSiteRenderer.
 * This is a read-only view of land history, never a planner or a source of new roads. */
export function settlementMovementFrontage(world: WorldState, settlement: Settlement): MovementFrontage[] {
  const reach = Math.min(32, Math.max(12, Math.sqrt(settlement.buildings + 1) * 3));
  const cx = Math.round(settlement.position.x / world.cellSize + world.size / 2);
  const cz = Math.round(settlement.position.z / world.cellSize + world.size / 2);
  const span = Math.ceil(reach / world.cellSize);
  const edges: MovementFrontage[] = [];
  const seen = new Set<string>();
  for (let z = Math.max(0, cz - span); z <= Math.min(world.size - 1, cz + span); z++) {
    for (let x = Math.max(0, cx - span); x <= Math.min(world.size - 1, cx + span); x++) {
      const index = z * world.size + x, cell = world.cells[index]!;
      if (cell.water || (world.weather?.cells[index]?.floodDepth ?? 0) > 0.08 || movementPathStage(cell) === 'none'
        || Math.hypot(cell.worldX - settlement.position.x, cell.worldZ - settlement.position.z) > reach) continue;
      const next = strongestMovementPathNeighbour(world, index);
      if (next === undefined) continue;
      const other = world.cells[next]!;
      if ((world.weather?.cells[next]?.floodDepth ?? 0) > 0.08) continue;
      const key = index < next ? `${index}:${next}` : `${next}:${index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: { x: cell.worldX, z: cell.worldZ }, to: { x: other.worldX, z: other.worldZ },
        strength: Math.min(movementPathStrength(cell), movementPathStrength(other)),
        halfWidth: Math.max(movementPathHalfWidth(world.cellSize, movementPathStage(cell), movementPathStrength(cell)), movementPathHalfWidth(world.cellSize, movementPathStage(other), movementPathStrength(other))) });
    }
  }
  return edges;
}

export function closestFrontagePoint(edge: MovementFrontage, point: Vec2): Vec2 {
  const dx = edge.to.x - edge.from.x, dz = edge.to.z - edge.from.z;
  const t = Math.max(0, Math.min(1, ((point.x - edge.from.x) * dx + (point.z - edge.from.z) * dz) / Math.max(1e-9, dx * dx + dz * dz)));
  return { x: edge.from.x + dx * t, z: edge.from.z + dz * t };
}

export interface MovementJunction {
  point: Vec2;
  degree: number;
  /** Summed strength of the edges meeting here. */
  strength: number;
}

/** Every surveyed meeting point of two or more worn edges, busiest first. Read-only. */
export function movementJunctions(edges: readonly MovementFrontage[], minDegree = 2): MovementJunction[] {
  const nodes = new Map<string, MovementJunction>();
  for (const edge of edges) for (const point of [edge.from, edge.to]) {
    const key = `${point.x}:${point.z}`;
    const node = nodes.get(key) ?? { point, degree: 0, strength: 0 };
    node.degree++;
    node.strength += edge.strength;
    nodes.set(key, node);
  }
  return [...nodes.values()]
    .filter(node => node.degree >= minDegree)
    .sort((a, b) => b.strength - a.strength);
}

/** Busy junctions attract informal gathering; no paving or geometry is granted here. */
export function movementGatheringPoint(edges: readonly MovementFrontage[]): Vec2 | undefined {
  let best: Vec2 | undefined, score = -1;
  for (const node of movementJunctions(edges, 1)) {
    const candidate = node.strength * (1 + Math.min(3, node.degree - 1) * 0.5);
    if (candidate > score) { best = node.point; score = candidate; }
  }
  return best;
}
