import { addMaterial, materialEconomy, reconcileBulkStocks, storageRoom, takeMaterial } from '../resources/Inventory';
import { haulUnitsPerWorkerMonth, haulVehicle } from '../transport/FreightEconomy';
import type { ExtractionAccessibility } from '../resources/ExtractionAccessibility';
import { useLabourDetailed, type LabourBudget } from '../resources/Processing';
import type { Occupation, Settlement } from '../types';
import { bump, inputRoom, mixQuality, stockTotal } from './FacilityInventory';
import type { FacilityAccessState, FacilityTierSpec, ProcessingFacility } from './types';

const EPSILON = 1e-9;
const round = (value: number): number => Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;

/** Carriers first; the works' own crew is the last resort, and hauling is less efficient by anyone else's hand. */
const HAUL_CREW: ReadonlyArray<readonly [Occupation, number]> = [['carrier', 1], ['forager', 0.7], ['keeper', 0.7], ['builder', 0.6], ['artisan', 0.5]];

/** Access from the settlement store to the works over the real, surveyed network. */
export function resolveFacilityAccess(
  s: Settlement, f: ProcessingFacility, resolver: ExtractionAccessibility | undefined,
): FacilityAccessState {
  const plot = s.structurePlots?.find(p => p.id === f.plotId);
  const blocked = !plot || plot.accessRestricted || plot.fire || (plot.floodDepth ?? 0) > 0.06;
  const route = blocked ? undefined : resolver?.resolveSite(s, f.id, f.position);
  if (blocked || (resolver && !route)) {
    return { ok: false, mode: 'walk', cost: Infinity, months: 0, vehicle: 'basket', unitsPerWorkerMonth: 0, projectId: f.roadProjectId };
  }
  const mode = route?.networkPath?.mode ?? 'walk';
  const cost = route?.cost ?? 1 + Math.hypot(f.position.x - s.position.x, f.position.z - s.position.z) * 0.06;
  const vehicle = haulVehicle(s, mode);
  return { ok: true, mode, cost, months: route?.months ?? 1, vehicle, unitsPerWorkerMonth: haulUnitsPerWorkerMonth(vehicle, cost), projectId: f.roadProjectId };
}

/** Load carried this month is limited by the crew that can be spared and by route friction. */
function haulCrewAvailable(budget: LabourBudget): number {
  return HAUL_CREW.reduce((sum, [occupation, efficiency]) => sum + Math.max(0, budget[occupation] ?? 0) * efficiency, 0);
}

/** Spends haul labour in crew order; returns units of hauling capacity actually obtained. */
function spendHaulLabour(f: ProcessingFacility, budget: LabourBudget, units: number): number {
  const perWorker = f.access.unitsPerWorkerMonth;
  if (units <= EPSILON || perWorker <= EPSILON) return 0;
  let remaining = units / perWorker;
  let moved = 0;
  for (const [occupation, efficiency] of HAUL_CREW) {
    if (remaining <= EPSILON) break;
    const use = useLabourDetailed(budget, [occupation], remaining / efficiency);
    if (use.total <= 0) continue;
    f.labour.haul += use.total;
    f.labour.byOccupation[occupation] = (f.labour.byOccupation[occupation] ?? 0) + use.total;
    remaining -= use.total * efficiency;
    moved += use.total * efficiency * perWorker;
  }
  return moved;
}

/** Cargo in transit gets one month closer. Called once at the start of a facility's month. */
export function advanceTransit(f: ProcessingFacility): void {
  for (const shipment of f.transit) if (shipment.remainingMonths > 0) shipment.remainingMonths -= 1;
}

/** Cargo that has completed its trip reaches the works, or the store, exactly once. */
export function deliverDue(s: Settlement, f: ProcessingFacility): void {
  if (!f.transit.some(shipment => shipment.remainingMonths <= 0)) return;
  const waiting: typeof f.transit = [];
  for (const shipment of f.transit) {
    if (shipment.remainingMonths > 0) { waiting.push(shipment); continue; }
    if (shipment.direction === 'in') {
      const before = (f.inputs[shipment.material] ?? 0) + (f.outputs[shipment.material] ?? 0);
      mixQuality(f, shipment.material, before, shipment.quantity, shipment.quality);
      f.inputs[shipment.material] = round((f.inputs[shipment.material] ?? 0) + shipment.quantity);
      bump(f.totals.arrived, shipment.material, shipment.quantity);
    } else {
      reconcileBulkStocks(s);
      const accepted = addMaterial(s, shipment.material, shipment.quantity, shipment.quality);
      bump(f.totals.deliveredOut, shipment.material, accepted);
      const refused = shipment.quantity - accepted;
      if (refused > EPSILON) {
        // A full store cannot take it. It goes back to the output yard rather than vanishing.
        f.outputs[shipment.material] = round((f.outputs[shipment.material] ?? 0) + refused);
        bump(f.totals.returned, shipment.material, refused);
      }
    }
  }
  f.transit = waiting;
}

export interface InboundRequest { material: string; quantity: number }

/**
 * Draws wanted inputs out of the settlement store into the yard, limited by what the store can
 * spare (survival reserves are untouched), the yard's free space, and the haul crew's real capacity
 * over this route. A works that cannot be reached, or has nobody to carry for it, gets nothing.
 */
export function dispatchInbound(
  s: Settlement, f: ProcessingFacility, spec: FacilityTierSpec, budget: LabourBudget, wanted: readonly InboundRequest[], month: number,
): number {
  f.freight.inbound = 0;
  if (!f.access.ok) return 0;
  reconcileBulkStocks(s);
  const economy = materialEconomy(s);
  const protectedStock = (id: string) => s.survival?.establishment?.materialDemand[id] ?? 0;
  const candidates = wanted.map(request => {
    const yardRoom = inputRoom(f, spec);
    const spare = Math.max(0, (s.localMaterials[request.material] ?? 0) - protectedStock(request.material));
    economy.demand[request.material] = Math.max(economy.demand[request.material] ?? 0, request.quantity * 2);
    return { ...request, quantity: Math.min(request.quantity, spare, yardRoom) };
  }).filter(request => request.quantity > EPSILON);
  const total = candidates.reduce((sum, request) => sum + request.quantity, 0);
  if (total <= EPSILON) return 0;
  const capacity = Math.min(total, haulCrewAvailable(budget) * f.access.unitsPerWorkerMonth);
  const moved = spendHaulLabour(f, budget, capacity);
  const scale = Math.min(1, moved / total);
  let carried = 0;
  const delay = Math.max(0, f.access.months - 1);
  for (const request of candidates) {
    const room = inputRoom(f, spec);
    const taken = takeMaterial(s, request.material, Math.min(request.quantity * scale, room));
    if (taken <= EPSILON) continue;
    f.transit.push({ direction: 'in', material: request.material, quantity: taken, quality: economy.quality[request.material] ?? 0.5, remainingMonths: delay });
    bump(f.totals.dispatchedIn, request.material, taken);
    carried += taken;
  }
  f.freight.inbound = carried;
  void month;
  return carried;
}

/** Finished goods and waste leave the output yard only as fast as the crew can carry them. */
export function dispatchOutbound(
  s: Settlement, f: ProcessingFacility, spec: FacilityTierSpec, budget: LabourBudget, reserve: Readonly<Record<string, number>>,
): number {
  f.freight.outbound = 0;
  if (!f.access.ok || stockTotal(f.outputs) <= EPSILON) return 0;
  const shippable = Object.entries(f.outputs)
    .map(([id, amount]) => ({ id, quantity: Math.max(0, amount - (reserve[id] ?? 0)) }))
    .filter(entry => entry.quantity > EPSILON);
  const total = shippable.reduce((sum, entry) => sum + entry.quantity, 0);
  if (total <= EPSILON) return 0;
  // Plan against the space the store will have, so a full store leaves stock on the yard instead of shuttling it.
  let storeRoom = storageRoom(s);
  const plan = shippable.map(entry => {
    const quantity = Math.min(entry.quantity, storeRoom);
    storeRoom -= quantity;
    return { ...entry, quantity };
  }).filter(entry => entry.quantity > EPSILON);
  const planned = plan.reduce((sum, entry) => sum + entry.quantity, 0);
  if (planned <= EPSILON) return 0;
  const capacity = Math.min(planned, haulCrewAvailable(budget) * f.access.unitsPerWorkerMonth);
  const moved = spendHaulLabour(f, budget, capacity);
  const scale = Math.min(1, moved / planned);
  const delay = Math.max(0, f.access.months - 1);
  let carried = 0;
  for (const entry of plan) {
    const quantity = round(Math.min(entry.quantity * scale, f.outputs[entry.id] ?? 0));
    if (quantity <= EPSILON) continue;
    f.outputs[entry.id] = round((f.outputs[entry.id] ?? 0) - quantity);
    bump(f.totals.dispatchedOut, entry.id, quantity);
    f.transit.push({ direction: 'out', material: entry.id, quantity, quality: f.quality[entry.id] ?? 0.5, remainingMonths: delay });
    carried += quantity;
  }
  f.freight.outbound = carried;
  void spec;
  return carried;
}

