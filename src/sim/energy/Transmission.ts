import { infrastructureLabourBudget } from '../people/HumanCapital';
import { materialEconomy, reconcileBulkStocks, takeMaterial } from '../resources/Inventory';
import type { Settlement, SimulationState } from '../types';
import { energyAt, type PowerLine, type GridNode } from './types';
import { constructPhysicalGrid } from './GridTopology';

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
export const constructGrid = constructPhysicalGrid;
export function activeLine(l: PowerLine): boolean { return !l.retired && l.progress >= 1 && l.condition > 0.25; }
/** Deterministic breadth-first residual path. Edges are physical, bidirectional and capacity limited. */
export function powerPath(lines: PowerLine[], from: string, to: string, nodes?: GridNode[]): PowerLine[] | undefined {
  const usable = (id: string): boolean => !nodes || nodes.some(n => n.id === id && !n.retired && n.progress >= 1 && n.condition > 0.25 && n.flow < n.capacity * n.condition);
  if (!usable(from) || !usable(to)) return undefined;
  const queue: { id: string; path: PowerLine[] }[] = [{ id: from, path: [] }];
  const seen = new Set([from]);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    if (node.id === to) return node.path;
    for (const l of lines) {
      if (!activeLine(l) || l.flow >= l.capacity * l.condition) continue;
      const next = l.from === node.id ? l.to : l.to === node.id ? l.from : undefined;
      if (next && usable(next) && !seen.has(next)) { seen.add(next); queue.push({ id: next, path: [...node.path, l] }); }
    }
  }
  return undefined;
}
export function deliver(lines: PowerLine[], from: string, to: string, available: number, requested: number, nodes?: GridNode[]): { sent: number; received: number } {
  const path = powerPath(lines, from, to, nodes);
  if (!path) return { sent: 0, received: 0 };
  const efficiency = path.reduce((n, l) => n * (1 - l.loss), 1);
  let sent = Math.max(0, Math.min(available, requested / efficiency)), factor = 1;
  const visited: { node: GridNode; factor: number }[] = [];
  let cursor = from;
  const visit = (id: string, factor: number): void => {
    const node = nodes?.find(n => n.id === id);
    if (node) { sent = Math.min(sent, Math.max(0, node.capacity * node.condition - node.flow) / factor); visited.push({ node, factor }); }
  };
  visit(cursor, 1);
  for (const l of path) { sent = Math.min(sent, (l.capacity * l.condition - l.flow) / factor); factor *= 1 - l.loss; cursor = l.from === cursor ? l.to : l.from; visit(cursor, factor); }
  for (const entry of visited) entry.node.flow += Math.max(0, sent) * entry.factor;
  let received = Math.max(0, sent);
  for (const l of path) { l.flow += received; received *= 1 - l.loss; }
  return { sent: Math.max(0, sent), received };
}

/** Read-only dispatch sizing using the existing delivery solver and temporary flow counters.
 * A restricted plant connection must leave residual demand for connected backup generation. */
export function dispatchInputCapacity(lines: PowerLine[], nodes: GridNode[] | undefined, from: string,
  available: number, sinks: readonly { node: string; demand: number }[]): number {
  const scratchLines = lines.map(line => ({ ...line }));
  const scratchNodes = nodes?.map(node => ({ ...node }));
  let remaining = available;
  for (const sink of sinks) {
    if (remaining <= 1e-9) break;
    remaining -= deliver(scratchLines, from, sink.node, remaining, sink.demand, scratchNodes).sent;
  }
  return available - remaining;
}
