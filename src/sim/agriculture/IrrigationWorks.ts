import type { FarmGeometry } from '../../shared/FarmGeometry';
import { farmPoint } from '../../shared/FarmGeometry';
import { infrastructureLabourBudget } from '../people/HumanCapital';
import { takeMaterial } from '../resources/Inventory';
import { practical } from '../knowledge/KnowledgeSystem';
import type { Settlement, SimulationState, Vec2 } from '../types';
import type { AgriculturalField } from './types';
import { cellAt } from '../world';

/** A short paid field distribution ditch. The water authority still owns intake, available
 * water and reliability; these works distribute water from an existing source to the crop. */
export function advanceIrrigationWorks(state: SimulationState, s: Settlement, f: AgriculturalField, geometry: FarmGeometry): void {
  const water = s.development?.water;
  if (!geometry.workable || practical(s, 'irrigation') <= 0 || (water?.irrigation ?? 0) <= 0
    || (water?.availability ?? 0) <= 0.2) return;
  const activeSource = (s.structurePlots ?? []).find(p => p.development?.status === 'active'
    && (p.development.services.water ?? 0) > 0 && !p.accessRestricted);
  // Without a built well/cistern require a physical freshwater intake close to the field.
  const cell = state.world.cells.filter(c => c.river || c.lake)
    .sort((a, b) => Math.hypot(a.worldX - geometry.center.x, a.worldZ - geometry.center.z)
      - Math.hypot(b.worldX - geometry.center.x, b.worldZ - geometry.center.z))[0];
  const source: Vec2 | undefined = activeSource ? { x: activeSource.worldX, z: activeSource.worldZ }
    : cell ? { x: cell.worldX, z: cell.worldZ } : undefined;
  if (!source || Math.hypot(source.x - geometry.center.x, source.z - geometry.center.z) > state.world.cellSize * 3) return;
  const header = farmPoint(geometry, -geometry.width * 0.46, -geometry.depth * 0.5);
  // Survey a short gravity-fed or hand-lifted intake. Reject routes through other structures
  // or across a ridge; larger aqueduct/pumping engineering is intentionally not implied.
  const sourceHeight = cellAt(state.world, source.x, source.z)?.elevation ?? 0;
  for (let i = 1; i <= 12; i++) {
    const x = source.x + (header.x - source.x) * i / 12, z = source.z + (header.z - source.z) * i / 12;
    if ((cellAt(state.world, x, z)?.elevation ?? 0) > sourceHeight + 0.08) return;
    if ((s.structurePlots ?? []).some(p => p.id !== geometry.id && p.id !== activeSource?.id
      && p.development?.form !== 'field' && Math.hypot(p.worldX - x, p.worldZ - z) < 0.3)) return;
  }
  const works = f.irrigationWorks ??= { progress: 0, condition: 1, source, builtMonth: undefined, timberSpent: 0, stoneSpent: 0, labourSpent: 0 };
  const budget = infrastructureLabourBudget(state, s);
  const requiredWork = 2 + Math.hypot(source.x - header.x, source.z - header.z);
  const work = Math.min(budget.remaining, 0.2, works.progress < 1 ? (1 - works.progress) * requiredWork : 0.01,
    (s.localMaterials.timber ?? 0) / 0.3, (s.localMaterials.stone ?? 0) / 0.2);
  if (work <= 0) { works.condition = Math.max(0, works.condition - 0.002); return; }
  works.timberSpent += takeMaterial(s, 'timber', work * 0.3);
  works.stoneSpent += takeMaterial(s, 'stone', work * 0.2);
  budget.remaining -= work; works.labourSpent += work;
  if (works.progress < 1) works.progress = Math.min(1, works.progress + work / requiredWork);
  works.condition = Math.min(1, works.condition + work * 0.25);
  if (works.progress >= 1) works.builtMonth ??= state.month;
}

/** Shared layout for the distribution ditch and its terrain-draped visual banks. */
export function irrigationChannels(f: AgriculturalField, geometry: FarmGeometry): Array<[Vec2, Vec2]> {
  if (!f.irrigationWorks || f.irrigationWorks.progress < 1 || f.irrigationWorks.condition <= 0.25) return [];
  const left = -geometry.width * 0.46;
  const head = farmPoint(geometry, left, -geometry.depth * 0.5);
  const tail = farmPoint(geometry, left, geometry.depth * 0.5);
  const lines: Array<[Vec2, Vec2]> = [[f.irrigationWorks.source, head], [head, tail]];
  for (let row = 0; row <= 4; row++) {
    const z = (row / 4 - 0.5) * geometry.depth;
    lines.push([farmPoint(geometry, left, z), farmPoint(geometry, geometry.width * 0.46, z)]);
  }
  return lines;
}
