import type { Settlement } from '../types';
import { MATERIAL_KINDS, materialAmount, type MaterialKind } from './MaterialEconomy';
import { addMaterial, takeMaterial } from './Inventory';

const EPSILON = 1e-9;
const round = (value: number): number => Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;

export interface MaterialShipmentCandidate {
  source: Settlement;
  target: Settlement;
  material: MaterialKind;
  quantity: number;
  score: number;
  targetPressure: number;
}

export interface MaterialDependencyRecord {
  partnerId: string;
  material: MaterialKind;
  imported: number;
  exported: number;
  lostInTransit: number;
  lastShipmentMonth: number;
  lastDeliveryMonth?: number;
}

export interface MaterialLogisticsState {
  dependencies: Record<string, MaterialDependencyRecord>;
  lifetimeImports: Partial<Record<MaterialKind, number>>;
  lifetimeExports: Partial<Record<MaterialKind, number>>;
  lifetimeTransitLosses: Partial<Record<MaterialKind, number>>;
  lastImportMonth?: number;
  lastExportMonth?: number;
}

declare module '../types' {
  interface Settlement {
    /** Physical inter-settlement supply relationships created by real freight movements. */
    materialLogistics?: MaterialLogisticsState;
  }
}

function logistics(settlement: Settlement): MaterialLogisticsState {
  return settlement.materialLogistics ??= {
    dependencies: {},
    lifetimeImports: {},
    lifetimeExports: {},
    lifetimeTransitLosses: {},
  };
}

function dependencyKey(partnerId: string, material: MaterialKind): string {
  return `${partnerId}:${material}`;
}

function sourceReserve(settlement: Settlement, material: MaterialKind): number {
  const pressure = settlement.materialUse?.materials[material];
  const monthlyDemand = pressure?.demand ?? 0;
  const critical = settlement.materialUse?.criticalInputs.includes(material) ?? false;
  // Keep roughly six months of known operating demand at home, with a small strategic floor.
  return round(Math.max(critical ? 1.25 : 0.4, monthlyDemand * 6));
}

function preferredProjectNeed(settlement: Settlement, material: MaterialKind): number {
  const project = settlement.development?.project;
  if (!project?.materialRequirements) return 0;
  let preferredNeed = 0;
  for (const requirement of project.materialRequirements) {
    if (requirement.options[0] !== material) continue;
    const remainingProgress = Math.max(0, 1 - project.progress);
    const remainingBill = requirement.amount * remainingProgress;
    const availableSubstitutes = requirement.options.reduce((sum, option) => sum + materialAmount(settlement, option), 0);
    preferredNeed += Math.max(0, remainingBill - availableSubstitutes);
  }
  return round(preferredNeed);
}

function targetNeed(settlement: Settlement, material: MaterialKind): { need: number; pressure: number; critical: boolean } {
  const materialPressure = settlement.materialUse?.materials[material];
  const operatingCritical = settlement.materialUse?.criticalInputs.includes(material) ?? false;
  const projectNeed = preferredProjectNeed(settlement, material);
  const critical = operatingCritical || projectNeed > EPSILON;
  const pressure = Math.max(materialPressure?.pressure ?? 0, operatingCritical ? 0.65 : 0, projectNeed > EPSILON ? 0.82 : 0);
  if (pressure <= 0.08) return { need: 0, pressure, critical };
  const stock = materialAmount(settlement, material);
  const demand = materialPressure?.demand ?? 0;
  const unmet = materialPressure?.unmet ?? 0;
  // Import enough to cover several future cycles rather than oscillating cargo every month.
  const targetBuffer = Math.max(critical ? 1.5 : 0.6, demand * 4, unmet * 8, stock + projectNeed);
  return { need: round(Math.max(projectNeed, targetBuffer - stock)), pressure, critical };
}

function candidateForDirection(
  source: Settlement,
  target: Settlement,
  material: MaterialKind,
  routeVolume: number,
): MaterialShipmentCandidate | undefined {
  const targetState = targetNeed(target, material);
  if (targetState.need <= EPSILON) return undefined;
  const ownPressure = source.materialUse?.materials[material]?.pressure ?? 0;
  if (ownPressure > 0.28 || source.materialUse?.criticalInputs.includes(material)) return undefined;
  const stock = materialAmount(source, material);
  const surplus = Math.max(0, stock - sourceReserve(source, material));
  if (surplus <= 0.08) return undefined;
  const capacity = Math.max(0.2, routeVolume * 4.2);
  const quantity = round(Math.min(surplus * 0.32, targetState.need, capacity));
  if (quantity <= 0.08) return undefined;
  const strategicWeight = targetState.critical ? 1.7 : 1;
  const scarcityWeight = 0.4 + targetState.pressure * 1.6;
  return {
    source,
    target,
    material,
    quantity,
    targetPressure: targetState.pressure,
    score: quantity * strategicWeight * scarcityWeight,
  };
}

/**
 * Chooses one physically useful material shipment for a route. Demand comes from the shared
 * shortage model plus stalled construction; supply must be a genuine surplus after the exporting
 * settlement's own reserve.
 */
export function chooseMaterialShipment(
  a: Settlement,
  b: Settlement,
  routeVolume: number,
): MaterialShipmentCandidate | undefined {
  let best: MaterialShipmentCandidate | undefined;
  for (const material of MATERIAL_KINDS) {
    for (const [source, target] of [[a, b], [b, a]] as const) {
      const candidate = candidateForDirection(source, target, material, routeVolume);
      if (!candidate) continue;
      if (!best || candidate.score > best.score + EPSILON
        || Math.abs(candidate.score - best.score) <= EPSILON && candidate.material.localeCompare(best.material) < 0) best = candidate;
    }
  }
  return best;
}

/** Cargo leaves canonical source stock immediately and is unavailable to local consumers in transit. */
export function dispatchMaterialShipment(
  source: Settlement,
  target: Settlement,
  material: MaterialKind,
  requested: number,
  month: number,
): number {
  if (requested <= EPSILON) return 0;
  const reserve = sourceReserve(source, material);
  const available = Math.max(0, materialAmount(source, material) - reserve);
  const quantity = round(Math.min(requested, available));
  if (quantity <= EPSILON) return 0;
  const dispatched = round(takeMaterial(source, material, quantity));
  if (dispatched <= EPSILON) return 0;
  const state = logistics(source);
  state.lifetimeExports[material] = round((state.lifetimeExports[material] ?? 0) + dispatched);
  state.lastExportMonth = month;
  const key = dependencyKey(target.id, material);
  const record = state.dependencies[key] ?? {
    partnerId: target.id,
    material,
    imported: 0,
    exported: 0,
    lostInTransit: 0,
    lastShipmentMonth: month,
  };
  record.exported = round(record.exported + dispatched);
  record.lastShipmentMonth = month;
  state.dependencies[key] = record;
  return dispatched;
}

/**
 * Delivery preserves conservation. Transit loss and any quantity the destination cannot store are
 * both explicit losses; only accepted material becomes target stock.
 */
export function deliverMaterialShipment(
  source: Settlement,
  target: Settlement,
  material: MaterialKind,
  dispatched: number,
  deliveryFraction: number,
  month: number,
): number {
  if (dispatched <= EPSILON) return 0;
  const potential = round(dispatched * Math.max(0, Math.min(1, deliveryFraction)));
  const delivered = round(addMaterial(target, material, potential));
  const lost = round(Math.max(0, dispatched - delivered));

  const targetState = logistics(target);
  targetState.lifetimeImports[material] = round((targetState.lifetimeImports[material] ?? 0) + delivered);
  targetState.lifetimeTransitLosses[material] = round((targetState.lifetimeTransitLosses[material] ?? 0) + lost);
  targetState.lastImportMonth = month;
  const targetKey = dependencyKey(source.id, material);
  const targetRecord = targetState.dependencies[targetKey] ?? {
    partnerId: source.id,
    material,
    imported: 0,
    exported: 0,
    lostInTransit: 0,
    lastShipmentMonth: month,
  };
  targetRecord.imported = round(targetRecord.imported + delivered);
  targetRecord.lostInTransit = round(targetRecord.lostInTransit + lost);
  targetRecord.lastDeliveryMonth = month;
  targetState.dependencies[targetKey] = targetRecord;

  const sourceState = logistics(source);
  sourceState.lifetimeTransitLosses[material] = round((sourceState.lifetimeTransitLosses[material] ?? 0) + lost);
  const sourceKey = dependencyKey(target.id, material);
  const sourceRecord = sourceState.dependencies[sourceKey];
  if (sourceRecord) sourceRecord.lostInTransit = round(sourceRecord.lostInTransit + lost);
  return delivered;
}
