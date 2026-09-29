import { hasKnowledgeCapability as knows } from '../knowledge/CapabilityContract';
import { infrastructureLabourBudget } from '../people/HumanCapital';
import { materialEconomy, reconcileBulkStocks, takeMaterial } from '../resources/Inventory';
import type { Settlement, SimulationState, Vec2 } from '../types';
import { energyAt, energyWorld, type PowerLine } from './types';

/** Each construction increment pays physical inputs and shared worker-months before progressing. */
export function buildWork(state: SimulationState, s: Settlement, cost: Record<string, number>, requested: number): number {
  reconcileBulkStocks(s);
  const labour = infrastructureLabourBudget(state, s);
  let work = Math.min(requested, labour.remaining);
  for (const [id, amount] of Object.entries(cost)) {
    materialEconomy(s).demand[id] = Math.max(materialEconomy(s).demand[id] ?? 0, amount * requested);
    energyAt(s).materialDemand[id] = Math.max(energyAt(s).materialDemand[id] ?? 0, amount * requested * 3);
    work = Math.min(work, (s.localMaterials[id] ?? 0) / amount);
  }
  work = Math.max(0, work);
  for (const [id, amount] of Object.entries(cost)) takeMaterial(s, id, amount * work);
  labour.remaining -= work;
  return work;
}
function line(state: SimulationState, s: Settlement, from: string, to: string, path: Vec2[], regional: boolean): void {
  const world = energyWorld(state);
  const id = `${from}>${to}`;
  let edge = world.lines.find(l => l.id === id);
  if (!edge) {
    const points: Vec2[] = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 6));
      for (let j = 0; j < steps; j++) points.push({ x: a.x + (b.x - a.x) * j / steps, z: a.z + (b.z - a.z) * j / steps });
    }
    if (path.length) points.push(path[path.length - 1]!);
    const length = points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - points[i]!.x, p.z - points[i]!.z), 0);
    edge = { id, from, to, points, capacity: regional ? 100 : 80, loss: Math.min(0.25, length * (regional ? 0.0006 : 0.002)), progress: 0, condition: 1, flow: 0 };
    world.lines.push(edge);
  }
  if (edge.progress < 1) {
    const work = Math.max(1, edge.points.length * 0.4);
    edge.progress = Math.min(1, edge.progress + buildWork(state, s, { copper: 0.25, timber: 0.5 }, Math.min(1, (1 - edge.progress) * work)) / work);
  } else if (edge.condition < 1) edge.condition = Math.min(1, edge.condition + buildWork(state, s, { copper: 0.1, timber: 0.2 }, 0.1) * 0.3);
}
export function constructGrid(state: SimulationState): void {
  for (const s of state.settlements.filter(s => s.alive && knows(s, 'electrical-generation'))) {
    for (const p of energyAt(s).plants.filter(p => p.progress >= 1)) {
      const plot = s.structurePlots?.find(x => x.id === p.plotId);
      if (plot && ['generator', 'coal', 'hydro', 'wind', 'solar', 'gas', 'nuclear'].includes(p.kind)) line(state, s, p.id, s.id, [{ x: plot.worldX, z: plot.worldZ }, s.position], false);
    }
    for (const p of s.structurePlots ?? []) if (p.development?.status === 'active' && !p.accessRestricted) line(state, s, s.id, p.id, [s.position, { x: p.worldX, z: p.worldZ }], false);
  }
  for (const route of state.tradeRoutes.filter(r => r.active)) {
    const a = state.settlements.find(s => s.id === route.a && s.alive), b = state.settlements.find(s => s.id === route.b && s.alive);
    if (!a || !b || !knows(a, 'electric-grid') || !knows(b, 'electric-grid')) continue;
    const segments = Object.values(state.transportation.segments).filter(s => s.status === 'complete' && s.mode !== 'water');
    // Only commissioned land corridors authorize a regional line; no wires across arbitrary ocean gaps.
    const project = Object.values(state.transportation.projects).find(p => (p.a === a.id && p.b === b.id || p.a === b.id && p.b === a.id) && p.segmentIds.length && p.segmentIds.every(id => segments.some(s => s.id === id)));
    if (!project) continue;
    const path = project.segmentIds.flatMap(id => segments.find(s => s.id === id)!.points);
    line(state, a, a.id, b.id, [a.position, ...path, b.position], true);
  }
}
export function activeLine(l: PowerLine): boolean { return l.progress >= 1 && l.condition > 0.25; }
/** Deterministic breadth-first residual path. Edges are physical, bidirectional and capacity limited. */
export function powerPath(lines: PowerLine[], from: string, to: string): PowerLine[] | undefined {
  const queue: { id: string; path: PowerLine[] }[] = [{ id: from, path: [] }];
  const seen = new Set([from]);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    if (node.id === to) return node.path;
    for (const l of lines) {
      if (!activeLine(l) || l.flow >= l.capacity * l.condition) continue;
      const next = l.from === node.id ? l.to : l.to === node.id ? l.from : undefined;
      if (next && !seen.has(next)) { seen.add(next); queue.push({ id: next, path: [...node.path, l] }); }
    }
  }
  return undefined;
}
export function deliver(lines: PowerLine[], from: string, to: string, available: number, requested: number): { sent: number; received: number } {
  const path = powerPath(lines, from, to);
  if (!path) return { sent: 0, received: 0 };
  const efficiency = path.reduce((n, l) => n * (1 - l.loss), 1);
  let sent = Math.min(available, requested / efficiency), factor = 1;
  for (const l of path) { sent = Math.min(sent, (l.capacity * l.condition - l.flow) / factor); factor *= 1 - l.loss; }
  let received = Math.max(0, sent);
  for (const l of path) { l.flow += received; received *= 1 - l.loss; }
  return { sent: Math.max(0, sent), received };
}
