import { capabilityPractice } from '../knowledge/CapabilityContract';
import { materialEconomy } from '../resources/Inventory';
import { chooseMaterialShipment } from '../resources/MaterialLogistics';
import type { Settlement, TradeRoute } from '../types';
import type { FreightVehicle, TransportMode, TraversalPath } from './types';

/** Shared by contact decisions and dispatch. Geography-driven production supplies the surplus. */
export function tradeOpportunity(a: Settlement, b: Settlement): number {
  let score = chooseMaterialShipment(a, b, 1)?.score ?? 0;
  for (const [source, target] of [[a, b], [b, a]] as const) {
    for (const [id, demand] of Object.entries(materialEconomy(target).demand)) {
      const reserve = Math.max(0.4, (materialEconomy(source).demand[id] ?? 0) * 6);
      score = Math.max(score, Math.min(Math.max(0, (source.localMaterials[id] ?? 0) - reserve), Math.max(0, demand * 4 - (target.localMaterials[id] ?? 0))));
    }
    if (target.foodSecurity < 0.9 && source.foodSecurity > 1.1) score = Math.max(score, Math.min(4, source.resources.food * 0.02));
  }
  return score / (1 + Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) * 0.025);
}

export function railReady(a: Settlement, b: Settlement, route: TradeRoute): boolean {
  return (route.transport?.recentFreight ?? 0) >= 12 && (route.transport?.deliveries ?? 0) >= 8
    && [a, b].every(s => capabilityPractice(s, 'rail-transport', 'transformed') > 0.34
      && capabilityPractice(s, 'iron-working', 'adopted') > 0.3
      && capabilityPractice(s, 'mechanical-power', 'adopted') > 0.3
      && s.infrastructure.rail > 0.16 && s.infrastructure.workshops > 0.3);
}

export const FREIGHT_CAPACITY: Record<FreightVehicle, number> = {
  basket: 0.6, merchant: 1.2, 'pack-animal': 3, cart: 5, caravan: 12, barge: 22, train: 40, truck: 16,
};
export const FREIGHT_SPEED: Record<FreightVehicle, number> = {
  basket: 0.7, merchant: 0.9, 'pack-animal': 1.2, cart: 1.4, caravan: 1.6, barge: 2.1, train: 3.8, truck: 3,
};

/** Choose the cheapest sufficient technology. Small consignments retain older transport. */
export function freightVehicle(source: Settlement, target: Settlement, route: TradeRoute, path: TraversalPath, demand: number): FreightVehicle {
  if (path.mode === 'water') return 'barge';
  if (path.mode === 'rail') return 'train';
  const completedRoad = path.segmentIds.length > 0;
  const trade = route.transport;
  if (completedRoad && demand > 5 && (trade?.recentFreight ?? 0) > 8
    && [source, target].every(s => s.infrastructure.roads >= 0.3)
    && capabilityPractice(source, 'internal-combustion', 'adopted') > 0.4
    && capabilityPractice(source, 'precision-manufacturing', 'adopted') > 0.4
    && source.infrastructure.factories > 0.14
    && materialEconomy(source).energySupplied >= 0.5
    && (source.localMaterials.charcoal ?? 0) >= 0.1
    && Math.max(source.localMaterials.steel ?? 0, source.localMaterials['iron-tools'] ?? 0) >= 0.05) return 'truck';
  if (demand > 1.2 && completedRoad && capabilityPractice(source, 'wheel-axle', 'adopted') > 0.22) {
    return demand > 5 && (trade?.deliveries ?? 0) >= 4 && capabilityPractice(source, 'animal-husbandry', 'adopted') > 0.25 ? 'caravan' : 'cart';
  }
  if (demand > 1.2 && capabilityPractice(source, 'animal-husbandry', 'adopted') > 0.25 && source.foodSecurity > 0.9) return 'pack-animal';
  return (trade?.deliveries ?? 0) >= 2 ? 'merchant' : 'basket';
}

/**
 * Vehicle a settlement really has for hauling between its store and a works it built, over the
 * surveyed access it resolved (path, road, rail or barge). Same technology gates as trade freight.
 */
export function haulVehicle(s: Settlement, mode: TransportMode): FreightVehicle {
  if (mode === 'rail') return 'train';
  if (mode === 'water') return 'barge';
  if (mode === 'road') {
    if (capabilityPractice(s, 'internal-combustion', 'adopted') > 0.4 && capabilityPractice(s, 'precision-manufacturing', 'adopted') > 0.4
      && (s.localMaterials.charcoal ?? 0) + (s.localMaterials.coal ?? 0) >= 0.1) return 'truck';
    if (capabilityPractice(s, 'wheel-axle', 'adopted') > 0.22) return 'cart';
  }
  if (capabilityPractice(s, 'animal-husbandry', 'adopted') > 0.25 && s.foodSecurity > 0.9) return 'pack-animal';
  return 'basket';
}

/** Loads one worker moves per month over a route: vehicle payload x trips, divided by route friction. */
export const HAUL_TRIPS_PER_MONTH = 12;
export function haulUnitsPerWorkerMonth(vehicle: FreightVehicle, routeCost: number): number {
  return FREIGHT_CAPACITY[vehicle] * HAUL_TRIPS_PER_MONTH / Math.max(1, routeCost);
}
