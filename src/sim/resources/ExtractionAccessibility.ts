import { mastery } from '../knowledge/KnowledgeSystem';
import { WalkabilityLayer } from '../people/WalkabilityLayer';
import { TransportNetwork } from '../transport/TransportNetwork';
import { pointKey } from '../transport/TerrainTraversal';
import type { NetworkMode, TraversalPath } from '../transport/types';
import type { ResourceDeposit, Settlement, SimulationState, Vec2, WorldState } from '../types';
import { cellAt } from '../world';

export interface ExtractionAccess {
  path: Vec2[];
  accessPaths: Vec2[][];
  networkPath?: TraversalPath;
  cost: number;
  months: number;
}

/** Integrates cost over the entire route, including intervening mountain/wetland cells. */
export function transportFriction(world: WorldState, path: readonly Vec2[], mode: NetworkMode | 'walk' = 'walk'): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z) / world.cellSize;
    const samples = Math.max(1, Math.ceil(length * 2));
    for (let j = 0; j < samples; j++) {
      const t = (j + 0.5) / samples;
      const c = cellAt(world, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      const terrain = 1 + (c?.slope ?? 1) * 5 + Math.max(0, (c?.movementCost ?? 4) - 1) * 0.5;
      const track = mode === 'walk' ? 1 - (c?.modifications?.track?.intensity ?? 0) * 0.2 : 1;
      cost += length / samples * (mode === 'water' ? 0.07 : mode === 'rail' ? 0.035 * Math.sqrt(terrain) : mode === 'road' ? 0.12 * Math.sqrt(terrain) : 0.28 * terrain * track);
    }
  }
  return 1 + cost;
}

/** Reuses completed surveyed roads, bridges, rail and port-to-port shipping. No invented crossings. */
export class ExtractionAccessibility {
  readonly walking: WalkabilityLayer;
  readonly network: TransportNetwork;
  private cache = new Map<string, ExtractionAccess | null>();
  private revision = '';
  constructor(private readonly state: SimulationState) {
    this.walking = new WalkabilityLayer(state.world);
    this.network = new TransportNetwork(state.world, state.transportation);
  }
  private walk(a: Vec2, b: Vec2): Vec2[] {
    if (!this.walking.isWalkable(a) || !this.walking.isWalkable(b)) return [];
    const path = this.walking.route(a, b);
    const end = path.at(-1);
    return end && Math.hypot(end.x - b.x, end.z - b.z) < 0.1 ? [{ ...a }, ...path] : [];
  }
  resolve(s: Settlement, d: ResourceDeposit): ExtractionAccess | undefined {
    const { world, transportation, month } = this.state;
    const revision = `${world.environmentRevision ?? 0}:${transportation.revision}:${Math.floor(month / 3)}`;
    if (revision !== this.revision) { this.cache.clear(); this.revision = revision; }
    const key = `${s.id}:${s.position.x}:${s.position.z}:${d.id}:${d.worldX}:${d.worldZ}:${s.infrastructure.ports > 0.12}:${mastery(s, 'buoyancy-currents').practice > 0.25}`;
    const cached = this.cache.get(key);
    if (cached !== undefined && (!cached || this.valid(cached))) return cached ?? undefined;
    const target = { x: d.worldX, z: d.worldZ };
    const direct = this.walk(s.position, target);
    let best: ExtractionAccess | undefined = direct.length ? { path: direct, accessPaths: [direct], cost: transportFriction(world, direct),
      months: Math.max(1, Math.ceil((transportFriction(world, direct) - 1) * 1.5)) } : undefined;
    for (const mode of ['road', 'rail', 'water'] as const) {
      if (mode === 'water' && (s.infrastructure.ports <= 0.12 || mastery(s, 'buoyancy-currents').practice <= 0.25)) continue;
      const nodes = new Map<string, { node: string; bank: Vec2 }>();
      if (mode === 'water') {
        for (const stop of Object.values(transportation.stops)) if (stop.kind === 'port' && stop.status === 'complete' && stop.access.length) {
          nodes.set(stop.node, { node: stop.node, bank: stop.access.at(-1)! });
        }
      } else {
        for (const seg of Object.values(transportation.segments)) if (seg.mode === mode && seg.status === 'complete') {
          for (const p of [seg.points[0], seg.points.at(-1)]) if (p) nodes.set(pointKey(p), { node: pointKey(p), bank: p });
        }
      }
      const nearest = (p: Vec2) => [...nodes.values()].filter(n => Math.hypot(n.bank.x - p.x, n.bank.z - p.z) <= world.cellSize * 3)
        .sort((a, b) => Math.hypot(a.bank.x - p.x, a.bank.z - p.z) - Math.hypot(b.bank.x - p.x, b.bank.z - p.z)).slice(0, 3);
      for (const from of nearest(s.position)) for (const to of nearest(target)) {
        const route = this.network.findPath(from.node, to.node, mode);
        if (!route) continue;
        const prefix = this.walk(s.position, from.bank), suffix = this.walk(to.bank, target);
        if (!prefix.length || !suffix.length) continue;
        const cost = transportFriction(world, prefix) + transportFriction(world, suffix) + transportFriction(world, route.points, mode) - 2;
        if (best && best.cost <= cost) continue;
        best = { path: [...prefix, ...route.points, ...suffix], accessPaths: [prefix, suffix], networkPath: route,
          cost, months: Math.max(1, Math.ceil((cost - 1) * 1.5)) };
      }
    }
    if (this.cache.size > 2048) this.cache.clear();
    this.cache.set(key, best ?? null);
    return best;
  }
  valid(access: Pick<ExtractionAccess, 'accessPaths' | 'networkPath'>): boolean {
    return (!access.networkPath || this.network.pathValid(access.networkPath)) && access.accessPaths.every(path => path.every((p, i) =>
      this.walking.isWalkable(p) && (!i || this.walking.isSegmentWalkable(path[i - 1]!, p))));
  }
}
