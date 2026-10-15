import * as THREE from 'three';
import type { Vec2, WorldState } from '../../sim/types';
import { movementPathHalfWidth, movementPathStage, movementPathStrength, movementPathConnections, type MovementPathStage } from '../../sim/environment/PathEvolution';

export const MOVEMENT_STAGE_RANK: Record<MovementPathStage, number> = { none: 0, 'desire-path': 1, footpath: 2, 'packed-track': 3, 'cart-road': 4, 'engineered-road': 5 };
const COLORS: Record<Exclude<MovementPathStage, 'none'>, THREE.Color> = {
  'desire-path': new THREE.Color('#79634e'), footpath: new THREE.Color('#68513e'),
  'packed-track': new THREE.Color('#574535'), 'cart-road': new THREE.Color('#554936'), 'engineered-road': new THREE.Color('#66615a'),
};
export interface StreetEnd extends Vec2 { halfWidth: number; stage: Exclude<MovementPathStage, 'none'> }
export interface WornStreetEdge { from: StreetEnd; to: StreetEnd }
interface StreetNode { end: StreetEnd; directions: Vec2[]; neighbours: { key: string; distance: number }[]; station?: number; miter?: Vec2 }
const key = (p: Vec2) => `${p.x}:${p.z}`;

/** Survey exactly the persisted worn-cell links. No extra connectivity or era-based paving. */
export function recordedStreetEdges(world: WorldState): WornStreetEdge[] {
  const edges: WornStreetEdge[] = [];
  for (const [i, j] of movementPathConnections(world)) {
    const a = world.cells[i]!, b = world.cells[j]!, stageA = movementPathStage(a), stageB = movementPathStage(b);
    if (stageA === 'none' || stageB === 'none') continue;
    edges.push({ from: { x: a.worldX, z: a.worldZ, stage: stageA, halfWidth: movementPathHalfWidth(world.cellSize, stageA, movementPathStrength(a)) },
      to: { x: b.worldX, z: b.worldZ, stage: stageB, halfWidth: movementPathHalfWidth(world.cellSize, stageB, movementPathStrength(b)) } });
  }
  return edges;
}

/** One terrain-conforming surface with shared bend cross-sections and filled working junctions. */
export function movementStreetGeometry(edges: readonly WornStreetEdge[], heightAt: (x: number, z: number) => number): THREE.BufferGeometry {
  const nodes = new Map<string, StreetNode>();
  for (const edge of edges) for (const [end, other] of [[edge.from, edge.to], [edge.to, edge.from]]) {
    const length = Math.hypot(other!.x - end!.x, other!.z - end!.z);
    if (length < 1e-6) continue;
    const node = nodes.get(key(end!)) ?? { end: end!, directions: [], neighbours: [] };
    node.directions.push({ x: (other!.x - end!.x) / length, z: (other!.z - end!.z) / length });
    node.neighbours.push({ key: key(other!), distance: length });
    nodes.set(key(end!), node);
  }
  // Shared longitudinal stations keep paving courses continuous across ordinary bends.
  for (const seed of nodes.values()) if (seed.station === undefined) {
    seed.station = 0; const queue = [seed];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const node = queue[cursor]!;
      for (const link of node.neighbours) {
        const next = nodes.get(link.key)!;
        if (next.station !== undefined) continue;
        next.station = node.station! + link.distance; queue.push(next);
      }
    }
  }
  for (const node of nodes.values()) if (node.directions.length === 2) {
    const [a, b] = node.directions;
    // A bounded miter joins both road edges; acute dead ends never produce giant spikes.
    const tx = a!.x - b!.x, tz = a!.z - b!.z, length = Math.hypot(tx, tz);
    if (length < .15) continue;
    const mx = -tz / length, mz = tx / length;
    const projection = Math.abs(mx * -a!.z + mz * a!.x);
    const reach = node.end.halfWidth / Math.max(.56, projection);
    node.miter = { x: mx * reach, z: mz * reach };
  }
  const positions: number[] = [], colors: number[] = [], uv: number[] = [], indices: number[] = [];
  const vertex = (x: number, z: number, u: number, v: number, stage: number, color: THREE.Color) => {
    positions.push(x, heightAt(x, z) + .018, z); uv.push(u, v, stage); colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };
  const offset = (end: StreetEnd, side: Vec2) => {
    const m = nodes.get(key(end))?.miter;
    if (!m) return { x: side.x * end.halfWidth, z: side.z * end.halfWidth };
    const sign = m.x * side.x + m.z * side.z >= 0 ? 1 : -1;
    return { x: m.x * sign, z: m.z * sign };
  };
  for (const edge of edges) {
    const a = edge.from, b = edge.to, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const side = { x: -dz / length, z: dx / length }, oa = offset(a, side), ob = offset(b, side);
    const base = positions.length / 3, steps = Math.max(1, Math.ceil(length / .22));
    const stationA = nodes.get(key(a))!.station!, stationB = nodes.get(key(b))!.station!;
    for (let step = 0; step <= steps; step++) {
      const t = step / steps, color = COLORS[a.stage].clone().lerp(COLORS[b.stage], t);
      for (let lane = 0; lane < 5; lane++) {
        const u = lane / 4, lateral = u * 2 - 1;
        vertex(a.x + dx * t + THREE.MathUtils.lerp(oa.x, ob.x, t) * lateral,
          a.z + dz * t + THREE.MathUtils.lerp(oa.z, ob.z, t) * lateral, u, THREE.MathUtils.lerp(stationA, stationB, t),
          THREE.MathUtils.lerp(MOVEMENT_STAGE_RANK[a.stage], MOVEMENT_STAGE_RANK[b.stage], t), color);
        if (step > 0 && lane < 4) {
          const n = base + step * 5 + lane; indices.push(n - 5, n - 4, n, n, n - 4, n + 1);
        }
      }
    }
  }
  let junctions = 0;
  for (const node of nodes.values()) {
    if (node.directions.length < 3 && (node.directions.length !== 2 || node.miter)) continue;
    junctions++;
    const end = node.end, ring: Vec2[] = [];
    // Join the incoming verge corners, not a new plaza or oversized circular stamp.
    for (const direction of node.directions) for (const sign of [-1, 1]) ring.push({ x: -direction.z * end.halfWidth * sign, z: direction.x * end.halfWidth * sign });
    ring.sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
    const stage = MOVEMENT_STAGE_RANK[end.stage], color = COLORS[end.stage];
    const center = vertex(end.x, end.z, .5, 0, stage, color);
    const boundary = ring.map(p => vertex(end.x + p.x, end.z + p.z, 1, Math.hypot(p.x, p.z), stage, color));
    for (let i = 0; i < boundary.length; i++) indices.push(center, boundary[(i + 1) % boundary.length]!, boundary[i]!);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('roadUV', new THREE.Float32BufferAttribute(uv, 3)); geometry.setIndex(indices);
  if (positions.length) { geometry.computeVertexNormals(); geometry.computeBoundingSphere(); }
  geometry.userData['circulationAuthority'] = 'recorded-movement-wear';
  geometry.userData['streetEdges'] = edges.length; geometry.userData['streetJunctions'] = junctions;
  return geometry;
}
