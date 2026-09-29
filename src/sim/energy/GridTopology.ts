import { hasKnowledgeCapability as knows } from '../knowledge/CapabilityContract';
import { addMaterial } from '../resources/Inventory';
import { distance, fineSegmentDry } from '../transport/TerrainTraversal';
import type { Settlement, SimulationState, Vec2 } from '../types';
import { buildWork } from './Transmission';
import { GridRouting, gridCorridors, type GridCorridor } from './GridRouting';
import { generatorDefinition } from './Generation';
import { energyAt, energyWorld, type GridEdgeClass, type GridNode, type GridNodeKind } from './types';

export const switchyardId = (s: Settlement): string => `${s.id}:grid:yard`;
export const storageNodeId = (s: Settlement): string => `${s.id}:grid:storage`;
const rating: Record<GridNodeKind, number> = {
  'plant-bus': 240, switchyard: 300, substation: 180, junction: 120, transformer: 48, service: 40, storage: 120,
};
const footprint = (kind: GridNodeKind): number => kind === 'substation' || kind === 'switchyard' ? 0.9
  : kind === 'storage' ? 0.65 : kind === 'transformer' ? 0.3 : 0.12;

/** Extends the existing physical lines; there is still only one dispatch graph and inventory. */
export function constructPhysicalGrid(state: SimulationState): void {
  const world = energyWorld(state);
  world.nodes ??= [];
  const nodes = world.nodes;
  // Old direct wires remain archive evidence, but cannot bypass newly surveyed equipment.
  // Recover installed copper/timber once through normal inventory capacity limits. Plants,
  // batteries and operating histories survive; unsafe old radial geometry is not grandfathered in.
  if (world.topologyVersion !== 1) {
    for (const line of world.lines) if (!line.class && !line.retired) {
      const owner = state.settlements.find(s => s.id === line.from || s.energy?.plants.some(p => p.id === line.from));
      if (owner) {
        const paidWork = Math.max(1, line.points.length * 0.4) * Math.max(0, Math.min(1, line.progress)) * Math.max(0, Math.min(1, line.condition));
        addMaterial(owner, 'copper', paidWork * 0.25);
        addMaterial(owner, 'timber', paidWork * 0.5);
      }
      line.retired = true;
    }
    world.topologyVersion = 1;
  }
  if (!nodes.length && !state.settlements.some(s => s.alive && knows(s, 'electrical-generation')
    && (s.energy?.plants.some(p => generatorDefinition(p.kind).carrier === 'electric')
      || (s.energy?.storageCapacity ?? 0) > 0 || knows(s, 'electric-grid')))) return;
  const routing = new GridRouting(state);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const add = (s: Settlement, id: string, kind: GridNodeKind, position: Vec2, plotId?: string): GridNode => {
    const existing = byId.get(id);
    if (existing) return existing;
    const node: GridNode = { id, settlementId: s.id, kind, position: { ...position }, plotId,
      cultureId: Object.keys(s.cultureShares).sort((a, b) => (s.cultureShares[b] ?? 0) - (s.cultureShares[a] ?? 0) || a.localeCompare(b))[0],
      radius: footprint(kind), capacity: !knows(s, 'electric-grid') && (kind === 'switchyard' || kind === 'substation') ? 32 : rating[kind],
      condition: 1, progress: 0, flow: 0 };
    nodes.push(node); byId.set(id, node); return node;
  };
  const site = (origin: Vec2, kind: GridNodeKind): Vec2 | undefined => {
    const radius = footprint(kind);
    for (let ring = 0; ring < 14; ring++) for (let i = 0; i < (ring ? 16 : 1); i++) {
      const p = { x: origin.x + Math.cos(i * Math.PI / 8) * ring * 0.65,
        z: origin.z + Math.sin(i * Math.PI / 8) * ring * 0.65 };
      if (routing.site(p, radius) && nodes.every(n => distance(n.position, p) > n.radius + radius + 0.18)) return p;
    }
    return undefined;
  };
  const edge = (a: GridNode, b: GridNode, kind: GridEdgeClass, path: Vec2[]): void => {
    const id = `${kind}:${[a.id, b.id].sort().join('>')}`;
    if (world.lines.some(l => l.id === id)) return;
    const points: Vec2[] = [{ ...path[0]! }];
    for (let i = 1; i < path.length; i++) {
      const start = path[i - 1]!, end = path[i]!;
      // Wet spans reach here only from a commissioned bridge survey. No support is put in water.
      const steps = kind === 'transmission' && !fineSegmentDry(state.world, start, end) ? 1
        : Math.max(1, Math.ceil(distance(start, end) / (kind === 'transmission' ? 6 : 3)));
      for (let j = 1; j <= steps; j++) points.push({ x: start.x + (end.x - start.x) * j / steps, z: start.z + (end.z - start.z) * j / steps });
    }
    const length = points.slice(1).reduce((sum, p, i) => sum + distance(points[i]!, p), 0);
    world.lines.push({ id, from: a.id, to: b.id, class: kind, points,
      capacity: kind === 'transmission' ? 240 : kind === 'service' ? 40 : kind === 'connection' ? Math.min(rating[a.kind], rating[b.kind]) : 120,
      loss: Math.min(0.2, length * (kind === 'transmission' ? 0.0006 : 0.002)),
      progress: 0, condition: 1, flow: 0 });
  };
  const attach = (s: Settlement, parent: GridNode, id: string, kind: GridNodeKind,
    origin: Vec2, edgeClass: GridEdgeClass, corridors: GridCorridor[], plotId?: string): GridNode | undefined => {
    const existing = byId.get(id);
    if (existing) return existing;
    const p = site(origin, kind);
    if (!p) return undefined;
    const path = routing.route(parent.position, p, corridors, nodes);
    if (!path) return undefined;
    let attachment: Vec2[] | undefined;
    if (plotId) {
      const plot = s.structurePlots?.find(plot => plot.id === plotId);
      if (!plot) return undefined;
      const c = 1, sn = 0;
      const terminals = [[plot.width / 2 + 0.2, 0], [-plot.width / 2 - 0.2, 0],
        [0, plot.depth / 2 + 0.2], [0, -plot.depth / 2 - 0.2]].map(([x, z]) => ({
          x: plot.worldX + c * x! + sn * z!, z: plot.worldZ - sn * x! + c * z!,
        })).sort((a, b) => distance(a, p) - distance(b, p));
      for (const terminal of terminals) {
        attachment = routing.route(p, terminal, [], nodes);
        if (attachment) break;
      }
      if (!attachment) return undefined;
    }
    const node = add(s, id, kind, p, plotId);
    node.attachment = attachment;
    if (edgeClass === 'distribution') {
      let last = parent;
      for (const point of path.slice(1, -1)) {
        const junction = add(s, `${s.id}:grid:j:${point.x.toFixed(4)}:${point.z.toFixed(4)}`, 'junction', point);
        if (junction.id !== last.id) edge(last, junction, edgeClass, [last.position, junction.position]);
        last = junction;
      }
      edge(last, node, edgeClass, [last.position, node.position]);
    } else edge(parent, node, edgeClass, path);
    return node;
  };
  for (const s of [...state.settlements].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!s.alive || !knows(s, 'electrical-generation')) continue;
    const e = energyAt(s), corridors = gridCorridors(state, s);
    const plants = e.plants.filter(p => generatorDefinition(p.kind).carrier === 'electric');
    // Grid import is also a valid reason to survey a settlement's receiving equipment.
    if (!plants.length && e.storageCapacity <= 0 && !knows(s, 'electric-grid')) continue;
    let yard = byId.get(switchyardId(s));
    if (!yard) {
      const plot = s.structurePlots?.find(p => p.id === plants[0]?.plotId);
      const origin = plot ? { x: plot.worldX + plot.radius + 1.5, z: plot.worldZ } : corridors[0]?.a ?? s.position;
      const position = site(origin, 'switchyard');
      if (!position) continue;
      yard = add(s, switchyardId(s), 'switchyard', position);
    }
    const hub = attach(s, yard, `${s.id}:grid:substation`, 'substation',
      corridors[0]?.a ?? yard.position, 'connection', corridors);
    if (!hub) continue;
    for (const plant of plants) {
      const plot = s.structurePlots?.find(p => p.id === plant.plotId);
      if (!plot || plot.accessRestricted || plot.development?.status !== 'active') continue;
      attach(s, yard, plant.id, 'plant-bus', { x: plot.worldX + plot.radius + 0.35, z: plot.worldZ }, 'connection', [], plot.id);
    }
    const base = attach(s, hub, `${s.id}:grid:local`, 'transformer', hub.position, 'distribution', corridors);
    if (base) attach(s, base, s.id, 'service', base.position, 'service', []);
    if (e.storageCapacity > 0) attach(s, hub, storageNodeId(s), 'storage', hub.position, 'connection', []);
    for (const plot of [...(s.structurePlots ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
      if (plot.development?.status !== 'active' || plot.accessRestricted || byId.has(plot.id)) continue;
      const origin = { x: plot.worldX + plot.radius + 0.35, z: plot.worldZ };
      let transformer = nodes.filter(n => n.settlementId === s.id && n.kind === 'transformer' && !n.retired
        && distance(n.position, origin) < 5).sort((a, b) => distance(a.position, origin) - distance(b.position, origin) || a.id.localeCompare(b.id))[0];
      if (!transformer) transformer = attach(s, hub, `${plot.id}:transformer`, 'transformer', origin, 'distribution', corridors);
      if (transformer) attach(s, transformer, plot.id, 'service', origin, 'service', [], plot.id);
    }
  }
  for (const route of state.tradeRoutes.filter(r => r.active).sort((a, b) => a.id.localeCompare(b.id))) {
    const a = state.settlements.find(s => s.id === route.a && s.alive), b = state.settlements.find(s => s.id === route.b && s.alive);
    if (!a || !b || !knows(a, 'electric-grid') || !knows(b, 'electric-grid')) continue;
    const from = byId.get(switchyardId(a)), to = byId.get(switchyardId(b));
    if (!from || !to || world.lines.some(l => l.class === 'transmission' && (l.from === from.id && l.to === to.id || l.from === to.id && l.to === from.id))) continue;
    const project = Object.values(state.transportation.projects).find(p =>
      (p.a === a.id && p.b === b.id || p.a === b.id && p.b === a.id) && p.segmentIds.length
      && p.segmentIds.every(id => { const segment = state.transportation.segments[id]; return segment?.status === 'complete' && segment.mode !== 'water'; }));
    const ids = project?.segmentIds ?? route.transport?.path?.segmentIds;
    if (!ids?.length || !ids.every(id => { const segment = state.transportation.segments[id]; return segment?.status === 'complete' && segment.mode !== 'water' && segment.points.length >= 2; })) continue;
    // Respect segment order and orientation; never flatMap disjoint/reversed corridor points.
    let cursor = from.position;
    const path: Vec2[] = [cursor];
    let valid = true;
    let surveyedSegments = 0;
    const remaining = ids.map(id => state.transportation.segments[id]!);
    while (remaining.length) {
      remaining.sort((x, y) => Math.min(distance(cursor, x.points[0]!), distance(cursor, x.points[x.points.length - 1]!))
        - Math.min(distance(cursor, y.points[0]!), distance(cursor, y.points[y.points.length - 1]!)) || x.id.localeCompare(y.id));
      const segment = remaining.shift()!;
      const points = [...segment.points];
      if (distance(cursor, points[points.length - 1]!) < distance(cursor, points[0]!)) points.reverse();
      if (surveyedSegments > 0 && distance(cursor, points[0]!) > 0.3) { valid = false; break; }
      const start = routing.route(cursor, points[0]!, [], nodes);
      if (!start) { valid = false; break; }
      path.push(...start.slice(1));
      if (segment.kind === 'bridge') {
        if (!routing.bridgeSpan(points[0]!, points[points.length - 1]!)) { valid = false; break; }
        path.push(points[points.length - 1]!);
      } else for (let i = 1; i < points.length; i++) {
          const section = routing.route(points[i - 1]!, points[i]!, [], nodes);
          if (!section) { valid = false; break; }
          path.push(...section.slice(1));
        }
      cursor = points[points.length - 1]!;
      surveyedSegments++;
    }
    const end = valid ? routing.route(cursor, to.position, [], nodes) : undefined;
    if (end) edge(from, to, 'transmission', [...path, ...end.slice(1)]);
  }
  // An unsuccessful receiving-site survey must not leave paid, disconnected yard furniture.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (node.progress === 0 && !world.lines.some(l => !l.retired && (l.from === node.id || l.to === node.id))) {
      nodes.splice(i, 1); byId.delete(node.id);
    }
  }
  // Construction and maintenance use the same canonical stocks and shared worker-month budget.
  for (const node of nodes) {
    const s = state.settlements.find(s => s.id === node.settlementId);
    const plot = node.plotId ? s?.structurePlots?.find(p => p.id === node.plotId) : undefined;
    node.retired = !s?.alive || !!node.plotId && (!plot || plot.accessRestricted || plot.development?.status !== 'active');
    if (!s || node.retired) continue;
    const large = node.kind === 'substation' || node.kind === 'switchyard';
    const work = large ? 3 : node.kind === 'junction' || node.kind === 'service' ? 0.25 : 1;
    const cost = large ? { copper: 0.8, iron: 1, timber: 0.5 } : { copper: 0.3, iron: 0.1, timber: 0.4 };
    if (node.progress < 1) node.progress = Math.min(1, node.progress + buildWork(state, s, cost, Math.min(0.5, (1 - node.progress) * work)) / work);
    else if (node.condition < 0.95) node.condition = Math.min(1, node.condition + buildWork(state, s, cost, 0.08) * 0.15);
    else if (large && node.capacity < rating[node.kind] && knows(s, 'electric-grid')) {
      node.capacity = Math.min(rating[node.kind], node.capacity + buildWork(state, s,
        { copper: 1, iron: 1, timber: 0.25 }, Math.min(0.3, (rating[node.kind] - node.capacity) / 40)) * 40);
    }
  }
  for (const line of world.lines) {
    if (line.retired) continue;
    const owner = byId.get(line.from), target = byId.get(line.to);
    const s = state.settlements.find(s => s.id === owner?.settlementId);
    if (!s || owner?.retired || target?.retired) continue;
    const work = Math.max(0.3, line.points.slice(1).reduce((sum, p, i) => sum + distance(line.points[i]!, p), 0) * (line.class === 'transmission' ? 0.4 : 0.18));
    const cost = line.class === 'transmission' ? { copper: 0.65, timber: 0.1, iron: 0.9 } : { copper: 0.25, timber: 0.5, iron: 0.05 };
    if (line.progress < 1) line.progress = Math.min(1, line.progress + buildWork(state, s, cost, Math.min(0.6, (1 - line.progress) * work)) / work);
    else if (line.condition < 0.95) line.condition = Math.min(1, line.condition + buildWork(state, s, cost, 0.08) * 0.2);
  }
}
