import type { ResourceDeposit, WorldCell, WorldState } from '../types';
import type { SeededRandom } from '../prng';
import { clamp01, fbm } from '../terrain/noise';
import { RESOURCE_BY_ID, RESOURCE_CATALOG, type ResourceDefinition } from './catalog';

export function meetsSite(cell: WorldCell, definition: ResourceDefinition): boolean {
  if (cell.water || !definition.biomes.includes(cell.biome)) return false;
  if (definition.minFertility !== undefined && cell.fertility < definition.minFertility) return false;
  if (definition.minMoisture !== undefined && cell.moisture < definition.minMoisture) return false;
  if (definition.minWood !== undefined && cell.wood < definition.minWood) return false;
  if (definition.minMinerals !== undefined && cell.minerals < definition.minMinerals) return false;
  if (definition.minRockiness !== undefined && cell.rockiness < definition.minRockiness) return false;
  if (definition.geology && (!cell.geology || (definition.geology.families && !definition.geology.families.includes(cell.geology.family))
    || (cell.geology.potential[definition.id] ?? 0) < Math.max(definition.geology.minPotential, (1 - definition.rarity) * 0.6))) return false;
  if (definition.minSoilDepth && (cell.soil?.depth ?? 0) < definition.minSoilDepth) return false;
  if (definition.temperatureRange && (cell.temperature < definition.temperatureRange[0] || cell.temperature > definition.temperatureRange[1])) return false;
  return true;
}

function localRichness(cell: WorldCell, definition: ResourceDefinition): number {
  switch (definition.category) {
    case 'plant': return clamp01(cell.fertility * 0.5 + cell.moisture * 0.3 + (cell.soil?.depth ?? 0.3) * 0.2 - cell.wood * 0.15);
    case 'timber': return clamp01(cell.wood * (0.6 + Math.min(1, (cell.ecology?.ageYears ?? 100) / 150) * 0.4));
    case 'mineral': return cell.geology?.potential[definition.id] ?? cell.rockiness;
  }
}

/** Connected geological/ecological footprints, bounded into workable districts. No random pickups.
 * Each cell belongs to at most one province of a material. Local capacities sum to its inventory. */
export function generateResourceDeposits(world: WorldState, random: SeededRandom): ResourceDeposit[] {
  const deposits: ResourceDeposit[] = [];
  for (const definition of RESOURCE_CATALOG) {
    const eligible = new Set<number>();
    for (let i = 0; i < world.cells.length; i++) {
      const cell = world.cells[i]!;
      if (!meetsSite(cell, definition)) continue;
      if (definition.category === 'plant' && fbm(`${random.seed}:herb-habitat`, cell.x * 0.18, cell.z * 0.18, 3) < 0.49) continue;
      eligible.add(i);
    }
    while (eligible.size) {
      const start = eligible.values().next().value!;
      const queue = [start];
      eligible.delete(start);
      const footprint: number[] = [];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const i = queue[cursor]!;
        footprint.push(i);
        const c = world.cells[i]!;
        for (const [dx, dz] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
          const x = c.x + dx, z = c.z + dz;
          const next = z * world.size + x;
          if (queue.length >= 24 || x < 0 || x >= world.size || z < 0 || z >= world.size || !eligible.has(next)) continue;
          if (definition.category === 'mineral' && world.cells[next]!.geology?.family !== c.geology?.family) continue;
          eligible.delete(next); queue.push(next);
        }
      }
      const cells = footprint.map(cellIndex => {
        const cell = world.cells[cellIndex]!;
        const richness = localRichness(cell, definition);
        const [lo, hi] = definition.depositCapacityRange;
        return { cellIndex, capacity: Math.max(10, Math.round(lo + (hi - lo) * richness)),
          quality: clamp01(definition.baseQuality * (0.55 + richness * 0.65)) };
      });
      const capacity = cells.reduce((n, c) => n + c.capacity, 0);
      const entry = [...cells].sort((a, b) => {
        const score = (i: number) => (world.cells[i]!.geology?.exposure ?? 0.3) - world.cells[i]!.slope * 1.8;
        return score(b.cellIndex) - score(a.cellIndex) || a.cellIndex - b.cellIndex;
      })[0]!;
      const cell = world.cells[entry.cellIndex]!;
      const exposure = definition.category === 'mineral' ? cell.geology?.exposure ?? 0.3 : 1;
      const depth = definition.category === 'mineral' ? clamp01(0.85 - exposure * 0.65 + (definition.id === 'tin-ore' ? 0.1 : 0)) : 0;
      const surfaceShare = definition.category === 'mineral' ? clamp01((definition.surfaceShare ?? 0.3) * (0.35 + exposure * 1.8)) : 1;
      deposits.push({ id: `province-${definition.id}-${start}`, provinceName: `${definition.name} ${definition.category === 'mineral' ? 'district' : definition.category === 'timber' ? 'woodland' : 'meadow'}`,
        cells, resourceId: definition.id, cellIndex: entry.cellIndex, worldX: cell.worldX, worldZ: cell.worldZ,
        quality: cells.reduce((n, c) => n + c.capacity * c.quality, 0) / capacity, capacity,
        abundance: 1, renewable: definition.renewable, depleted: false, overharvested: false, discoveredBy: {},
        exposure, depth, surfaceShare, extractionDifficulty: clamp01(depth * 0.45 + cell.slope * 0.4 + (1 - entry.quality) * 0.15),
        accessibility: Math.max(0.1, 1 - cell.slope * 0.6 - cell.rockiness * 0.2), extracted: 0 });
    }
  }
  return deposits;
}

export function harvestSeason(world: WorldState, deposit: ResourceDeposit, month: number): number {
  const cell = world.cells[deposit.cellIndex];
  if (!cell || cell.water) return 0;
  const weather = world.weather?.cells[deposit.cellIndex];
  if ((weather?.snowpack ?? 0) > 0.35 || (weather?.floodDepth ?? 0) > 0.1) return 0;
  const seasonal = cell.temperature > 0.64 ? 0.85 : [0.05, 0.15, 0.45, 0.8, 1, 1, 0.9, 0.75, 0.5, 0.2, 0.05, 0.02][((month % 12) + 12) % 12]!;
  return seasonal * clamp01(cell.moisture * 1.6) * clamp01(1 - (weather?.cropDamage ?? 0));
}

export function advanceDeposits(world: WorldState, month: number): void {
  for (const deposit of world.resourceDeposits) {
    const definition = RESOURCE_BY_ID.get(deposit.resourceId);
    const cell = world.cells[deposit.cellIndex];
    if (!definition || !cell || !deposit.renewable) continue;
    if (definition.category === 'timber') {
      const locals = deposit.cells ?? [{ cellIndex: deposit.cellIndex, capacity: deposit.capacity }];
      deposit.abundance = locals.reduce((n, local) => {
        const c = world.cells[local.cellIndex]!;
        c.forestCapacity ??= Math.max(c.wood, 0.01);
        return n + local.capacity * clamp01(c.wood / Math.max(0.01, c.forestCapacity));
      }, 0) / deposit.capacity;
    } else {
      const health = clamp01(cell.fertility * 1.5) * harvestSeason(world, deposit, month) * (1 - (cell.ecology?.disturbance ?? 0))
        * (1 - (cell.modifications?.farmland?.intensity ?? 0));
      deposit.abundance = Math.min(1, deposit.abundance + definition.regenRate * health * (deposit.overharvested ? 0.35 : 1) * (1 - deposit.abundance));
    }
    if (deposit.abundance > 0.2) deposit.depleted = false;
    if (deposit.abundance > 0.75) deposit.overharvested = false;
  }
}
