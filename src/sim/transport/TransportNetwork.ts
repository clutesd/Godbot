import type { Vec2, WorldState } from '../types';
import type { NetworkMode, RoutePoint, TransportationState, TransportSegment, TraversalPath } from './types';
import { distance, gradeLimit, landAllowed, MinQueue, navigableAt, pointKey, waterAt } from './TerrainTraversal';
import { surfaceWaterAt } from '../terrain/SurfaceGeometry';

export function segmentUsable(world: WorldState, segment: TransportSegment): boolean {
  if (segment.status !== 'complete' || segment.points.length < 2 || (segment.floodDepth ?? 0) >= 0.12) return false;
  const points = segment.points;
  if (pointKey(points[0]!) !== segment.from || pointKey(points[points.length - 1]!) !== segment.to) return false;
  if (segment.kind === 'bridge') {
    if (segment.mode === 'water' || !landAllowed(world, points[0]!, segment.mode) || !landAllowed(world, points[points.length - 1]!, segment.mode)) return false;
    return points.every(p => !waterAt(world, p) || p.y >= surfaceWaterAt(world, p.x, p.z) + 0.15);
  }
  if (segment.mode === 'water') return segment.kind === 'shipping' && points.every(p => navigableAt(world, p));
  return points.every(p => landAllowed(world, p, segment.mode));
}

/** Completed segments form the graph; crossing edges join only their surveyed banks. */
export class TransportNetwork {
  private signature = '';
  private networkRevision = -1;
  private adjacency = new Map<string, TransportSegment[]>();
  private valid = new Set<string>();
  private cache = new Map<string, TraversalPath | null>();
  constructor(private readonly world: WorldState, private readonly state: TransportationState) {}

  refresh(): void {
    const signature = `${this.state.revision}:${this.world.environmentRevision ?? 0}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const usable = Object.values(this.state.segments).filter(segment => segmentUsable(this.world, segment));
    if (this.networkRevision === this.state.revision && usable.length === this.valid.size
      && usable.every(segment => this.valid.has(segment.id))) return;
    this.networkRevision = this.state.revision;
    this.adjacency.clear();
    this.valid.clear();
    this.cache.clear();
    for (const segment of usable) {
      this.valid.add(segment.id);
      for (const node of [segment.from, segment.to]) {
        const key = `${segment.mode}:${node}`;
        const edges = this.adjacency.get(key) ?? [];
        edges.push(segment);
        this.adjacency.set(key, edges);
      }
    }
  }

  pathValid(path: TraversalPath): boolean {
    this.refresh();
    if (!path.segmentIds.length || path.points.length < 2) return false;
    let node = pointKey(path.points[0]!);
    let pointIndex = 0;
    for (const id of path.segmentIds) {
      const segment = this.state.segments[id];
      if (!segment || segment.mode !== path.mode || !this.valid.has(id)) return false;
      const forward = segment.from === node;
      if (forward) node = segment.to;
      else if (segment.to === node) node = segment.from;
      else return false;
      for (let i = 0; i < segment.points.length; i++) {
        const expected = segment.points[forward ? i : segment.points.length - 1 - i]!;
        const actual = path.points[pointIndex + i];
        if (!actual || actual.x !== expected.x || actual.y !== expected.y || actual.z !== expected.z) return false;
      }
      pointIndex += segment.points.length - 1;
    }
    return pointIndex === path.points.length - 1 && node === pointKey(path.points[path.points.length - 1]!);
  }

  findPath(from: string, to: string, mode: NetworkMode): TraversalPath | undefined {
    this.refresh();
    const cacheKey = `${mode}:${from}>${to}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey) ?? undefined;
    const open = new MinQueue();
    const cost = new Map<string, number>([[from, 0]]);
    const parent = new Map<string, { key: string; node: string; segment: TransportSegment }>();
    const nodes = new Map<string, string>([[from, from]]);
    open.push(from, 0);
    while (open.size) {
      const current = open.pop()!;
      if (current.score !== cost.get(current.key)) continue;
      const currentNode = nodes.get(current.key)!;
      if (currentNode === to) {
        const chain: { node: string; segment: TransportSegment }[] = [];
        let cursor = current.key;
        while (parent.has(cursor)) {
          const entry = parent.get(cursor)!;
          chain.push(entry);
          cursor = entry.key;
        }
        const points: RoutePoint[] = [];
        const segmentIds: string[] = [];
        for (const entry of chain.reverse()) {
          const oriented = entry.segment.from === entry.node ? entry.segment.points : [...entry.segment.points].reverse();
          points.push(...oriented.slice(points.length ? 1 : 0).map(p => ({ ...p })));
          segmentIds.push(entry.segment.id);
        }
        const result = points.length > 1 ? { mode, segmentIds, points, length: pathLength(points) } : undefined;
        this.cache.set(cacheKey, result ?? null);
        return result;
      }
      for (const segment of this.adjacency.get(`${mode}:${currentNode}`) ?? []) {
        const incoming = parent.get(current.key)?.segment;
        if (mode === 'rail' && incoming && !railTurnAllowed(incoming, segment, currentNode)) continue;
        const node = segment.from === currentNode ? segment.to : segment.from;
        const key = mode === 'rail' ? `${node}|${segment.id}` : node;
        const nextCost = current.score + segment.length;
        if (nextCost >= (cost.get(key) ?? Infinity)) continue;
        cost.set(key, nextCost);
        nodes.set(key, node);
        parent.set(key, { key: current.key, node: currentNode, segment });
        open.push(key, nextCost);
      }
    }
    this.cache.set(cacheKey, null);
    return undefined;
  }
}

function railTurnAllowed(incoming: TransportSegment, outgoing: TransportSegment, node: string): boolean {
  const entry = incoming.to === node ? incoming.points : [...incoming.points].reverse();
  const exit = outgoing.from === node ? outgoing.points : [...outgoing.points].reverse();
  const p = entry[entry.length - 2]!;
  const center = exit[0]!;
  const q = exit[1]!;
  const dot = (center.x - p.x) * (q.x - center.x) + (center.z - p.z) * (q.z - center.z);
  return dot / (distance(p, center) * distance(center, q)) >= Math.SQRT1_2 - 0.00001;
}

export function pathLength(points: readonly Vec2[]): number {
  return points.reduce((n, p, i) => n + (i ? distance(points[i - 1]!, p) : 0), 0);
}

/** Arc-distance sampling is shared by simulation checks and vehicles; no spline shortcuts. */
export function positionAlongPath(path: Pick<TraversalPath, 'points' | 'length'>, travelled: number): { position: RoutePoint; yaw: number; pitch: number } | undefined {
  if (path.points.length < 2) return undefined;
  let remaining = Math.max(0, Math.min(path.length, travelled));
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1]!;
    const b = path.points[i]!;
    const length = distance(a, b);
    if (remaining <= length || i === path.points.length - 1) {
      const t = length ? Math.min(1, remaining / length) : 0;
      return { position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, yaw: Math.atan2(b.x - a.x, b.z - a.z), pitch: -Math.atan2(b.y - a.y, length) };
    }
    remaining -= length;
  }
  return undefined;
}

export function gradeViolations(segment: Pick<TransportSegment, 'points' | 'mode'>): number {
  return segment.points.reduce((n, p, i) => n + (i > 0 && Math.abs(p.y - segment.points[i - 1]!.y) / distance(p, segment.points[i - 1]!) > gradeLimit(segment.mode) + 0.00001 ? 1 : 0), 0);
}
