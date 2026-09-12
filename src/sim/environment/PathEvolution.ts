import { capabilityPractice } from '../knowledge/CapabilityContract';
import { consumeMaterial } from '../resources/MaterialUse';
import type { LandModification } from './types';
import type { Settlement, SimulationState, WorldCell } from '../types';

export type MovementPathStage = 'none' | 'desire-path' | 'footpath' | 'packed-track' | 'cart-road' | 'engineered-road';

const FOOTPATH_VISIBLE = 0.022;
const FOOTPATH_WORN = 0.08;
const TRACK_PROMOTION = 0.11;
const CART_PROMOTION = 0.18;
const ROAD_PROMOTION = 0.32;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function active(mark: LandModification | undefined, month: number, toleranceMonths = 30): boolean {
  return Boolean(mark && month - mark.lastMonth <= toleranceMonths && mark.intensity > 0.001);
}

function upsert(cell: WorldCell, kind: 'track' | 'cart-road' | 'road', target: number, month: number, ownerId: string): LandModification {
  cell.modifications ??= {};
  const previous = cell.modifications[kind];
  const next: LandModification = {
    intensity: clamp01(Math.max(previous?.intensity ?? 0, target)),
    firstMonth: previous?.firstMonth ?? month,
    lastMonth: month,
    ownerId,
  };
  cell.modifications[kind] = next;
  return next;
}

/** Read-only classification used by rendering, diagnostics and tests. */
export function movementPathStage(cell: WorldCell): MovementPathStage {
  const use = cell.modifications;
  if ((use?.road?.intensity ?? 0) >= 0.06) return 'engineered-road';
  if ((use?.['cart-road']?.intensity ?? 0) >= 0.06) return 'cart-road';
  if ((use?.track?.intensity ?? 0) >= 0.06) return 'packed-track';
  const foot = use?.footpath?.intensity ?? 0;
  if (foot >= FOOTPATH_WORN) return 'footpath';
  if (foot >= FOOTPATH_VISIBLE) return 'desire-path';
  return 'none';
}

export function movementPathStrength(cell: WorldCell): number {
  const use = cell.modifications;
  const road = use?.road?.intensity ?? 0;
  const cart = use?.['cart-road']?.intensity ?? 0;
  const track = use?.track?.intensity ?? 0;
  const foot = use?.footpath?.intensity ?? 0;
  return Math.max(road * 1.45, cart * 1.28, track * 1.12, foot);
}

function ownerFor(state: SimulationState, mark: LandModification): Settlement | undefined {
  if (!mark.ownerId) return undefined;
  return state.settlements.find(settlement => settlement.id === mark.ownerId && settlement.alive);
}

function canAffordRoadSurface(settlement: Settlement, requested: number, month: number): number {
  if (!settlement.materials) return 0;
  let supplied = consumeMaterial(settlement, 'stone', requested, month);
  if (supplied + 1e-9 < requested) supplied += consumeMaterial(settlement, 'brick', requested - supplied, month);
  return supplied;
}

/**
 * Converts repeated movement into physical transport capital. This runs annually and never invents
 * a road in a place people do not actually use. Wear first compacts a footpath into a track; wheel
 * practice can turn a busy track into a cart road; engineered roads additionally require road
 * knowledge, wealth, workshops and real stone/brick consumption.
 */
export function advanceMovementPaths(state: SimulationState): void {
  if (state.month % 12 !== 0) return;
  const roadGain = new Map<string, number>();

  for (const cell of state.world.cells) {
    if (cell.water) continue;
    const foot = cell.modifications?.footpath;
    if (!foot || !active(foot, state.month) || foot.intensity < TRACK_PROMOTION) continue;
    const settlement = ownerFor(state, foot);
    if (!settlement) continue;

    const ageMonths = state.month - foot.firstMonth;
    if (ageMonths < 6) continue;

    // Any society can compact a genuinely busy footpath simply through repeated use and upkeep.
    const trackTarget = clamp01(0.05 + foot.intensity * 0.62 + Math.min(0.16, ageMonths / 600));
    const track = upsert(cell, 'track', trackTarget, state.month, settlement.id);

    const wheel = capabilityPractice(settlement, 'wheel-axle', 'adopted');
    if (foot.intensity < CART_PROMOTION || track.intensity < 0.11 || wheel < 0.16 || settlement.resources.wealth < 3) continue;

    // Cart roads are still mostly compacted earth: traffic, wheels and modest local upkeep are enough.
    const cartTarget = clamp01(0.04 + track.intensity * 0.72 + wheel * 0.18);
    const cart = upsert(cell, 'cart-road', cartTarget, state.month, settlement.id);

    const improvedRoads = capabilityPractice(settlement, 'improved-roads', 'adopted');
    if (foot.intensity < ROAD_PROMOTION || cart.intensity < 0.16 || improvedRoads < 0.22) continue;
    if (settlement.infrastructure.workshops < 0.08 || settlement.resources.wealth < 8) continue;

    // Surfacing cost is intentionally small per world cell but conservation-safe. A long road now
    // competes for the same stone/brick inventory as bridges, structures and other capital.
    const requested = 0.018 + 0.032 * Math.min(1, foot.intensity);
    const supplied = canAffordRoadSurface(settlement, requested, state.month);
    if (supplied < requested * 0.82) continue;

    const roadTarget = clamp01(0.05 + cart.intensity * 0.68 + improvedRoads * 0.22);
    upsert(cell, 'road', roadTarget, state.month, settlement.id);
    roadGain.set(settlement.id, (roadGain.get(settlement.id) ?? 0) + 1);
  }

  // The settlement-level scalar remains useful to the economy/military, but it now rises partly
  // because real local corridors were built rather than only because an abstract project existed.
  for (const [settlementId, cells] of roadGain) {
    const settlement = state.settlements.find(candidate => candidate.id === settlementId);
    if (!settlement) continue;
    settlement.infrastructure.roads = clamp01(settlement.infrastructure.roads + Math.min(0.012, cells * 0.0008));
  }
}
