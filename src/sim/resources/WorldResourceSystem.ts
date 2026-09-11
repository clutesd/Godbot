import type { ResourceDeposit, WorldCell, WorldState } from '../types';
import type { SeededRandom } from '../prng';
import { RESOURCE_BY_ID, RESOURCE_CATALOG, type ResourceDefinition } from './catalog';

function meetsSite(cell: WorldCell, definition: ResourceDefinition): boolean {
  if (cell.water) return false;
  if (!definition.biomes.includes(cell.biome)) return false;
  if (definition.minFertility !== undefined && cell.fertility < definition.minFertility) return false;
  if (definition.minMoisture !== undefined && cell.moisture < definition.minMoisture) return false;
  if (definition.minWood !== undefined && cell.wood < definition.minWood) return false;
  if (definition.minMinerals !== undefined && cell.minerals < definition.minMinerals) return false;
  if (definition.minRockiness !== undefined && cell.rockiness < definition.minRockiness) return false;
  return true;
}

function localRichness(cell: WorldCell, definition: ResourceDefinition): number {
  switch (definition.category) {
    case 'plant': return Math.min(1, cell.fertility * 0.6 + cell.moisture * 0.4);
    case 'timber': return Math.min(1, cell.wood);
    case 'mineral': return Math.min(1, cell.minerals * 0.6 + cell.rockiness * 0.4);
    default: return 0.5;
  }
}

/**
 * Deterministically sites deposits across the world from the same seeded stream used for
 * everything else in world generation. Only cells that satisfy a resource's biome/geology gates
 * are eligible; eligibility is then thinned by rarity so scarce resources (tin) stay scarce.
 */
export function generateResourceDeposits(world: WorldState, random: SeededRandom): ResourceDeposit[] {
  const deposits: ResourceDeposit[] = [];
  let nextId = 1;
  for (const definition of RESOURCE_CATALOG) {
    for (const cell of world.cells) {
      if (!meetsSite(cell, definition)) continue;
      if (!random.chance(definition.rarity * (definition.category === 'timber' ? 0.6 : definition.id === 'stone' ? 0.35 : 0.16))) continue;
      const richness = localRichness(cell, definition);
      const quality = Math.max(0.1, Math.min(1, definition.baseQuality * (0.55 + richness * 0.6) * random.range(0.85, 1.15)));
      const [minCap, maxCap] = definition.depositCapacityRange;
      const capacity = Math.round((minCap + (maxCap - minCap) * richness) * random.range(0.8, 1.2));
      deposits.push({
        id: `deposit-${nextId++}`,
        resourceId: definition.id,
        cellIndex: cell.z * world.size + cell.x,
        worldX: cell.worldX,
        worldZ: cell.worldZ,
        quality,
        capacity: Math.max(10, capacity),
        abundance: 1,
        renewable: definition.renewable,
        depleted: false,
        overharvested: false,
        discoveredBy: {},
        surfaceShare: definition.surfaceShare ?? 1,
        accessibility: Math.max(0.1, 1 - cell.slope * 0.6 - cell.rockiness * 0.2),
      });
    }
  }
  return deposits;
}

export function harvestSeason(world: WorldState, deposit: ResourceDeposit, month: number): number {
  const cell = world.cells[deposit.cellIndex];
  if (!cell || cell.water) return 0;
  const weather = world.weather?.cells[deposit.cellIndex];
  if ((weather?.snowpack ?? 0) > 0.35 || (weather?.floodDepth ?? 0) > 0.1) return 0;
  const seasonal = cell.temperature > 0.64 ? 0.85 : [0.05, 0.15, 0.45, 0.8, 1, 1, 0.9, 0.75, 0.5, 0.2, 0.05, 0.02][month % 12]!;
  return seasonal * Math.max(0, Math.min(1, cell.moisture * 1.6)) * Math.max(0, 1 - (weather?.cropDamage ?? 0));
}

/** Exactly one world pass, including undiscovered/unworked sites. Timber reads existing forest recovery. */
export function advanceDeposits(world: WorldState, month: number): void {
  for (const deposit of world.resourceDeposits) {
    const definition = RESOURCE_BY_ID.get(deposit.resourceId);
    const cell = world.cells[deposit.cellIndex];
    if (!definition || !cell || !deposit.renewable) continue;
    if (definition.category === 'timber') {
      cell.forestCapacity ??= Math.max(cell.wood, 0.01);
      deposit.abundance = Math.max(0, Math.min(1, cell.wood / Math.max(0.01, cell.forestCapacity)));
    } else {
      const health = Math.min(1, cell.fertility * 1.5) * harvestSeason(world, deposit, month);
      deposit.abundance = Math.min(1, deposit.abundance + definition.regenRate * health * (deposit.overharvested ? 0.35 : 1) * (1 - deposit.abundance));
    }
    if (deposit.abundance > 0.2) deposit.depleted = false;
    if (deposit.abundance > 0.75) deposit.overharvested = false;
  }
}
