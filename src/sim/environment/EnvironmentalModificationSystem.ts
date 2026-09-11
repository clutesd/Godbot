import { cellAt } from '../world';
import { clamp01 } from '../terrain/noise';
import type { ResourceDeposit, SimulationState, Vec2, WorldCell, WorldState } from '../types';
import type { ModificationKind } from './types';
import { forestFamily } from './SoilSystem';

/** Bounded slots per cell preserve land history without accumulating per-harvest records. */
export function modifyLand(cell: WorldCell, kind: ModificationKind, intensity: number, month: number, ownerId?: string): void {
  cell.modifications ??= {};
  const old = cell.modifications[kind];
  cell.modifications[kind] = { firstMonth: old?.firstMonth ?? month, lastMonth: month,
    intensity: clamp01(Math.max(old?.intensity ?? 0, intensity)), ownerId };
}

export function disturbForest(cell: WorldCell, fraction: number, month: number): void {
  if (!cell.ecology) return;
  cell.ecology.disturbance = clamp01(cell.ecology.disturbance + fraction);
  cell.ecology.ageYears *= 1 - clamp01(fraction);
  cell.ecology.lastDisturbanceMonth = month;
}

export function forestRecoveryTarget(cell: WorldCell): number {
  const use = cell.modifications;
  const occupied = Math.max(use?.farmland?.intensity ?? 0, use?.industry?.intensity ?? 0,
    (use?.mine?.intensity ?? 0) * 0.8, (use?.quarry?.intensity ?? 0) * 0.8);
  return (cell.forestCapacity ?? cell.wood) * (1 - occupied);
}

/** Deplete the closest standing cells first: nearby clearings broaden under sustained pressure. */
export function logProvince(world: WorldState, deposit: ResourceDeposit, amount: number, month: number, ownerId: string): void {
  const locals = deposit.cells ?? [{ cellIndex: deposit.cellIndex, capacity: deposit.capacity }];
  let remaining = amount;
  const ordered = [...locals].sort((a, b) => {
    const range = (i: number) => Math.hypot(world.cells[i]!.worldX - deposit.worldX, world.cells[i]!.worldZ - deposit.worldZ);
    return range(a.cellIndex) - range(b.cellIndex) || a.cellIndex - b.cellIndex;
  });
  for (const local of ordered) {
    if (remaining <= 1e-9) break;
    const cell = world.cells[local.cellIndex]!;
    cell.forestCapacity ??= Math.max(0.01, cell.wood);
    const taken = Math.min(remaining, local.capacity * clamp01(cell.wood / Math.max(0.01, cell.forestCapacity)));
    if (taken <= 0) continue;
    const fraction = taken / local.capacity;
    cell.wood = Math.max(0, cell.wood - fraction * cell.forestCapacity);
    cell.lastLoggingMonth = month;
    disturbForest(cell, fraction, month);
    modifyLand(cell, 'logging', 1 - cell.wood / Math.max(0.01, cell.forestCapacity), month, ownerId);
    remaining -= taken;
  }
}

/** Wear creates a foot track, not free engineered roads or bridges. Those remain transport projects. */
export function wearExtractionPath(world: WorldState, path: Vec2[], amount: number, month: number, ownerId: string): void {
  const seen = new Set<WorldCell>();
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)]!, b = path[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / world.cellSize));
    for (let j = 0; j <= steps; j++) {
      const cell = cellAt(world, a.x + (b.x - a.x) * j / steps, a.z + (b.z - a.z) * j / steps);
      if (!cell || cell.water || seen.has(cell)) continue;
      seen.add(cell);
      modifyLand(cell, 'track', (cell.modifications?.track?.intensity ?? 0) + amount * 0.001, month, ownerId);
    }
  }
}

/** Annual succession, soil loss and land-use footprint. Wood regrowth remains in WeatherSystem. */
export function advanceEnvironment(state: SimulationState): void {
  if (state.month % 12 !== 0) return;
  const living = new Set(state.settlements.filter(s => s.alive).map(s => s.id));
  for (const s of state.settlements) {
    const home = state.world.cells[s.cellIndex];
    if (!home || home.water) continue;
    if (!s.alive) { modifyLand(home, 'ruin', Math.min(1, s.buildings / 12), state.month); continue; }
    const farming = state.people.filter(p => p.alive && p.homeId === s.id && p.occupation === 'farmer').length;
    if (farming > 0 || s.specialization === 'agriculture') {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = home.x + dx, z = home.z + dz;
        const cell = x >= 0 && z >= 0 && x < state.world.size && z < state.world.size ? state.world.cells[z * state.world.size + x] : undefined;
        if (!cell || cell.water || cell.slope > 0.3) continue;
        const fraction = Math.min(0.8, (0.03 + farming * 0.006) * cell.fertility);
        modifyLand(cell, 'farmland', fraction, state.month, s.id);
        const target = forestRecoveryTarget(cell);
        if (cell.wood > target) { disturbForest(cell, (cell.wood - target) / Math.max(0.01, cell.forestCapacity ?? 1), state.month); cell.wood = target; }
      }
    }
    if (s.industry.intensity > 0.05) modifyLand(home, 'industry', s.industry.intensity, state.month, s.id);
  }
  for (const cell of state.world.cells) {
    if (cell.water) continue;
    for (const [kind, mark] of Object.entries(cell.modifications ?? {})) {
      if ((mark.ownerId && !living.has(mark.ownerId)) || state.month - mark.lastMonth > 120) mark.abandonedMonth ??= state.month;
      if (mark.abandonedMonth !== undefined) {
        // A quarry or ruin remains legible for millennia; fields and tracks recover over decades.
        mark.intensity *= ['mine', 'quarry', 'ruin'].includes(kind) ? 0.9995 : kind === 'industry' ? 0.995 : 0.975;
      }
    }
    if (cell.ecology) {
      cell.ecology.ageYears = Math.min(1200, cell.ecology.ageYears + cell.wood / Math.max(0.01, cell.forestCapacity ?? 1));
      cell.ecology.disturbance *= 0.96;
      cell.ecology.family = forestFamily(cell);
    }
    if (cell.soil) {
      const cleared = 1 - clamp01(cell.wood / Math.max(0.01, cell.forestCapacity ?? 1));
      const erosion = cell.soil.erosionRisk * cleared * cell.moisture * 0.001;
      cell.soil.depth = Math.max(0.02, cell.soil.depth - erosion + cell.wood * 0.00008);
      const pollution = (cell.modifications?.industry?.intensity ?? 0) * 0.0005;
      cell.fertility = clamp01(cell.fertility - erosion - pollution + (cell.soil.parentFertility - cell.fertility) * 0.0008);
    }
  }
}
