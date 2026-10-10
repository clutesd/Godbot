import type { MaterialEconomy, Settlement } from '../types';
import { MATERIAL_BY_ID } from './catalog';

export function materialEconomy(s: Settlement): MaterialEconomy {
  return s.materialEconomy ??= {
    quality: {}, experience: {}, recipeResearch: {}, inTransit: [], demand: {}, imports: {}, delivered: {}, lastEventMonth: {},
    bulkSnapshot: { wood: s.resources.wood, minerals: s.resources.minerals },
    tools: 0, arms: 0, timberArms: 0, medicineCoverage: 0, energyDemand: 0, energySupplied: 0, labourUsed: 0, shortageMonths: 0,
  };
}

/**
 * Fuel the settlement could actually put under a furnace now, weighted by how hot the material
 * burns, counting the store and its own works' yards alike. Charcoal is far denser fuel than raw
 * timber, so a few charcoal is worth several times its weight in logs, and timber already carried
 * into a saw pit's yard is exactly as combustible as timber in the store.
 *
 * This is present physical capability and nothing else. It reads stock that exists this month; no
 * part of it is earned by having produced fuel in the past, so a settlement that burned through
 * its charcoal has no fuel access until it holds some again.
 */
export function combustibleAccess(s: Settlement): number {
  const heatOf = (id: string): number => MATERIAL_BY_ID.get(id)?.fuelHeat ?? 0;
  let total = 0;
  for (const [id, amount] of Object.entries(s.localMaterials)) total += Math.max(0, amount) * heatOf(id);
  for (const facility of s.processing?.facilities ?? []) {
    for (const stock of [facility.inputs, facility.outputs]) {
      for (const [id, amount] of Object.entries(stock)) total += Math.max(0, amount) * heatOf(id);
    }
  }
  return total;
}

export function storageCapacity(s: Settlement): number {
  const stores = (s.structurePlots ?? []).filter(p => p.development?.status === 'active' && p.development.form === 'store' && !p.accessRestricted)
    .reduce((sum, p) => sum + p.condition * 60, 0);
  return 100 + s.buildings * 20 + stores + s.infrastructure.workshops * 160 + s.infrastructure.factories * 600;
}

export function storedVolume(s: Settlement): number {
  return Object.values(s.localMaterials).reduce((sum, n) => sum + Math.max(0, n), 0)
    + materialEconomy(s).inTransit.reduce((sum, shipment) => sum + shipment.quantity, 0);
}

export function storageRoom(s: Settlement): number { return Math.max(0, storageCapacity(s) - storedVolume(s)); }

/** Existing construction/repair/industry budgets spend these projections. They never create deposits. */
export function publishBulkStocks(s: Settlement): void {
  s.resources.wood = s.localMaterials.timber ?? 0;
  s.resources.minerals = s.localMaterials.stone ?? 0;
  materialEconomy(s).bulkSnapshot = { wood: s.resources.wood, minerals: s.resources.minerals };
}

/** Charge intervening legacy consumers exactly once, then publish the remaining physical inventory. */
export function reconcileBulkStocks(s: Settlement): void {
  const previous = materialEconomy(s).bulkSnapshot;
  for (const [bulk, id] of [['wood', 'timber'], ['minerals', 'stone']] as const) {
    const spent = Math.max(0, previous[bulk] - s.resources[bulk]);
    s.localMaterials[id] = Math.max(0, (s.localMaterials[id] ?? 0) - spent);
  }
  publishBulkStocks(s);
}

export function addMaterial(s: Settlement, id: string, requested: number, quality = 0.5): number {
  reconcileBulkStocks(s);
  const quantity = Math.min(Math.max(0, requested), storageRoom(s));
  if (!quantity) return 0;
  const old = s.localMaterials[id] ?? 0;
  const economy = materialEconomy(s);
  economy.quality[id] = ((economy.quality[id] ?? 0.5) * old + quality * quantity) / (old + quantity);
  s.localMaterials[id] = old + quantity;
  publishBulkStocks(s);
  return quantity;
}

export function takeMaterial(s: Settlement, id: string, requested: number): number {
  reconcileBulkStocks(s);
  const quantity = Math.min(Math.max(0, requested), Math.max(0, s.localMaterials[id] ?? 0));
  s.localMaterials[id] = Math.max(0, (s.localMaterials[id] ?? 0) - quantity);
  publishBulkStocks(s);
  return quantity;
}
