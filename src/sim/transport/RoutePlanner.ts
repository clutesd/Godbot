import { cellAt } from '../world';
import type { Vec2, WorldState } from '../types';
import type { NetworkMode, TransportationState } from './types';
import { surfaceHeightAt } from '../terrain/SurfaceGeometry';
import { distance, edgeKey, MinQueue, pointKey, surveyEdge, type SurveyedEdge } from './TerrainTraversal';

export interface PlannedEdge extends SurveyedEdge { a: Vec2; b: Vec2 }
const directions = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;

/** Bounded, direction-aware A*. Searches run on investment/retry, never on render frames. */
export class RoutePlanner {
  private cache = new Map<string, SurveyedEdge | null>();
  private environmentRevision = -1;
  constructor(private readonly world: WorldState) {}

  plan(start: Vec2, end: Vec2, mode: NetworkMode, network: TransportationState, bridges = false, maxExpansions = 12_000): PlannedEdge[] {
    if (this.environmentRevision !== (this.world.environmentRevision ?? 0)) {
      this.cache.clear();
      this.environmentRevision = this.world.environmentRevision ?? 0;
    }
    const a = cellAt(this.world, start.x, start.z);
    const b = cellAt(this.world, end.x, end.z);
    if (!a || !b) return [];
    const gridPoint = (index: number): Vec2 => {
      const c = this.world.cells[index]!;
      return { x: c.worldX, z: c.worldZ };
    };
    const startIndex = a.z * this.world.size + a.x;
    const endIndex = b.z * this.world.size + b.x;
    const first = gridPoint(startIndex);
    const last = gridPoint(endIndex);
    const prefix = distance(start, first) > 0.001 ? this.edge(start, first, mode, false) : undefined;
    const suffix = distance(last, end) > 0.001 ? this.edge(last, end, mode, false) : undefined;
    if ((distance(start, first) > 0.001 && !prefix) || (distance(last, end) > 0.001 && !suffix)) return [];
    if (startIndex === endIndex) {
      const direct = this.edge(start, end, mode, false);
      return direct && direct.length > 0.001 ? [{ ...direct, a: start, b: end }] : [];
    }
    const open = new MinQueue();
    const costs = new Map<string, number>();
    const parent = new Map<string, { key: string; edge: PlannedEdge }>();
    const initial = `${startIndex}:8`;
    open.push(initial, 0);
    costs.set(initial, 0);
    const closed = new Set<string>();
    let expansions = 0;
    while (open.size && expansions < maxExpansions) {
      const current = open.pop()!;
      if (closed.has(current.key)) continue;
      closed.add(current.key);
      expansions++;
      const [index, heading] = current.key.split(':').map(Number) as [number, number];
      if (index === endIndex) {
        const result: PlannedEdge[] = [];
        let key = current.key;
        while (parent.has(key)) {
          const entry = parent.get(key)!;
          result.push(entry.edge);
          key = entry.key;
        }
        result.reverse();
        if (prefix) result.unshift({ ...prefix, a: start, b: first });
        if (suffix) result.push({ ...suffix, a: last, b: end });
        const total = result.reduce((n, e) => n + e.cost, 0);
        // Geography can make this investment unreasonable, even when a technical path exists.
        return total <= Math.max(this.world.cellSize * 8, distance(start, end) * (mode === 'rail' ? 16 : 22)) ? this.smooth(result, mode, network) : [];
      }
      const from = gridPoint(index);
      const x = index % this.world.size;
      const z = Math.floor(index / this.world.size);
      for (let direction = 0; direction < directions.length; direction++) {
        const [dx, dz] = directions[direction]!;
        const turn = heading === 8 ? 0 : Math.min(Math.abs(direction - heading), 8 - Math.abs(direction - heading));
        if (mode === 'rail' && turn > 1) continue;
        for (let span = 1; span <= (mode !== 'water' && dx * dz === 0 ? 3 : 1); span++) {
          const nx = x + dx * span;
          const nz = z + dz * span;
          if (nx < 0 || nz < 0 || nx >= this.world.size || nz >= this.world.size) continue;
          const next = nz * this.world.size + nx;
          const to = gridPoint(next);
          const existing = network.segments[edgeKey(from, to, mode)];
          if (span > 1 && !bridges && !(existing?.kind === 'bridge' && existing.status === 'complete')) continue;
          const edge = this.edge(from, to, mode, bridges || (existing?.kind === 'bridge' && existing.status === 'complete'));
          if (!edge || (span > 1 && edge.kind !== 'bridge')) continue;
          const key = `${next}:${direction}`;
          const built = network.segments[edgeKey(from, to, mode)]?.status === 'complete';
          const cost = costs.get(current.key)! + edge.cost * (built ? 0.4 : 1) + turn ** 2 * this.world.cellSize * (mode === 'rail' ? 3 : 0.14);
          if (cost >= (costs.get(key) ?? Infinity)) continue;
          costs.set(key, cost);
          parent.set(key, { key: current.key, edge: { ...edge, a: from, b: to } });
          open.push(key, cost + distance(to, end) * 0.4);
        }
      }
    }
    return [];
  }

  private edge(a: Vec2, b: Vec2, mode: NetworkMode, bridge: boolean): SurveyedEdge | undefined {
    const key = `${mode}:${pointKey(a)}>${pointKey(b)}:${bridge}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? undefined;
    const value = surveyEdge(this.world, a, b, mode, bridge);
    if (this.cache.size >= 32_000) this.cache.clear();
    this.cache.set(key, value ?? null);
    return value;
  }

  /** Curves become surveyed simulation geometry before construction; unsafe curves are rejected. */
  private smooth(edges: PlannedEdge[], mode: NetworkMode, network: TransportationState): PlannedEdge[] {
    return edges.map((edge, index) => {
      if (edge.kind !== 'surface' || network.segments[edgeKey(edge.a, edge.b, mode)]) return edge;
      const previous = edges[index - 1];
      const next = edges[index + 1];
      const tangent = (a: Vec2, b: Vec2): Vec2 => {
        const length = Math.max(0.00001, distance(a, b));
        return { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
      };
      const start = tangent(previous?.kind === 'surface' ? previous.a : edge.a, edge.b);
      const end = tangent(edge.a, next?.kind === 'surface' ? next.b : edge.b);
      const handle = edge.length * 0.26;
      const c1 = { x: edge.a.x + start.x * handle, z: edge.a.z + start.z * handle };
      const c2 = { x: edge.b.x - end.x * handle, z: edge.b.z - end.z * handle };
      const count = Math.max(8, edge.points.length - 1);
      const points = Array.from({ length: count + 1 }, (_, i) => {
        const t = i / count;
        const u = 1 - t;
        const x = u ** 3 * edge.a.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * edge.b.x;
        const z = u ** 3 * edge.a.z + 3 * u ** 2 * t * c1.z + 3 * u * t ** 2 * c2.z + t ** 3 * edge.b.z;
        return { x, z, y: surfaceHeightAt(this.world, x, z) + 0.04 };
      });
      let length = 0;
      for (let i = 1; i < points.length; i++) {
        if (!surveyEdge(this.world, points[i - 1]!, points[i]!, mode)) return edge;
        length += distance(points[i - 1]!, points[i]!);
      }
      return { ...edge, points, length };
    });
  }
}
