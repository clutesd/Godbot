import { nearestIndex } from '../terrain/TerrainField';
import { clamp01 } from '../terrain/noise';
import type { WorldCell, WorldState } from '../types';
import { geologySampler, parentGeology } from './GeologySystem';

/** Linear-time outlet compression reuses the acyclic drainage graph from terrain generation. */
function catchments(world: WorldState): Int32Array {
  const downstream = world.terrain.drainage?.downstream;
  const outlets = new Int32Array(world.terrain.height.length).fill(-1);
  if (!downstream) return outlets;
  for (let start = 0; start < outlets.length; start++) {
    if (outlets[start]! >= 0) continue;
    const path: number[] = [];
    let i = start;
    while (outlets[i]! < 0) {
      path.push(i);
      const next = downstream[i] ?? -1;
      if (next < 0 || next === i) { outlets[i] = i; break; }
      i = next;
    }
    for (const index of path) outlets[index] = outlets[i]!;
  }
  return outlets;
}

export function initializeEnvironment(world: WorldState, seed: string, abundance = 1): void {
  const sample = geologySampler(seed);
  const outlets = catchments(world);
  for (const cell of world.cells) cell.geology = parentGeology(cell, sample(cell.x, cell.z));
  for (const cell of world.cells) {
    let waterAccess = cell.river || cell.lake ? 1 : cell.flow * 0.4;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const x = cell.x + dx, z = cell.z + dz;
      const other = x >= 0 && z >= 0 && x < world.size && z < world.size ? world.cells[z * world.size + x] : undefined;
      if (other?.river || other?.lake) waterAccess = Math.max(waterAccess, 1 / (1 + Math.hypot(dx, dz)));
    }
    const geology = cell.geology!;
    const alluvium = waterAccess * (1 - cell.slope) * 0.45 + geology.sediment;
    const depth = clamp01(0.35 + alluvium * 0.6 + cell.wood * 0.2 - cell.slope * 0.6 - geology.exposure * 0.25);
    const drainage = clamp01(0.4 + cell.slope * 0.6 - geology.potential.clay! * 0.4);
    const retention = clamp01(0.2 + depth * 0.5 + geology.potential.clay! * 0.25);
    const parentFertility = clamp01(0.3 + depth * 0.32 + alluvium * 0.2
      + (geology.family === 'volcanic' || geology.family === 'limestone' ? 0.15 : 0));
    cell.soil = { depth, drainage, retention, parentFertility,
      erosionRisk: clamp01(cell.slope * 0.65 + (1 - depth) * 0.2), waterAccess,
      catchment: outlets[nearestIndex(world.terrain, cell.worldX, cell.worldZ)] ?? -1 };
    if (cell.water) continue;
    cell.moisture = clamp01(cell.moisture + waterAccess * retention * 0.12);
    cell.fertility = clamp01(cell.fertility * 0.5 + parentFertility * 0.5);
    cell.forestCapacity = clamp01(cell.wood * (0.5 + depth * 0.5 + retention * 0.35));
    cell.wood = cell.forestCapacity;
    cell.minerals = clamp01(Math.max(geology.potential['copper-ore']!, geology.potential['tin-ore']!, geology.potential['iron-ore']!) * (0.7 + geology.exposure * 0.3) * abundance);
    cell.habitability = clamp01(cell.habitability * 0.8 + cell.fertility * 0.12 + waterAccess * 0.08);
    cell.ecology = { family: forestFamily(cell), ageYears: 30 + depth * 140 + cell.moisture * 70,
      disturbance: 0, lastDisturbanceMonth: -1 };
  }
}

export function forestFamily(cell: WorldCell): NonNullable<WorldCell['ecology']>['family'] {
  return cell.temperature < 0.28 || cell.elevation > 0.79 ? 'alpine'
    : cell.temperature < 0.4 || cell.elevation > 0.64 ? 'conifer'
      : (cell.soil?.waterAccess ?? 0) > 0.4 ? 'riverbank' : cell.moisture < 0.36 ? 'dry' : 'broadleaf';
}
