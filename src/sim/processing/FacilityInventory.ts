import type { MaterialLedger } from '../resources/MaterialLedger';
import type { FacilityStock, FacilityTierSpec, FacilityTotals, ProcessingFacility } from './types';

const EPSILON = 1e-9;
const round = (value: number): number => Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;

export const emptyTotals = (): FacilityTotals => ({
  dispatchedIn: {}, arrived: {}, consumed: {}, produced: {}, dispatchedOut: {}, deliveredOut: {}, returned: {}, spoiled: {},
});

export const stockTotal = (stock: FacilityStock): number =>
  Object.values(stock).reduce((sum, amount) => sum + Math.max(0, amount), 0);

export const bump = (record: Record<string, number>, id: string, amount: number): void => {
  if (amount > 0) record[id] = round((record[id] ?? 0) + amount);
};

export const inTransit = (f: ProcessingFacility, direction: 'in' | 'out'): number =>
  f.transit.filter(shipment => shipment.direction === direction).reduce((sum, shipment) => sum + shipment.quantity, 0);

export const inTransitOf = (f: ProcessingFacility, direction: 'in' | 'out', id: string): number =>
  f.transit.filter(shipment => shipment.direction === direction && shipment.material === id)
    .reduce((sum, shipment) => sum + shipment.quantity, 0);

export function inputRoom(f: ProcessingFacility, spec: FacilityTierSpec): number {
  return Math.max(0, spec.yard - stockTotal(f.inputs) - inTransit(f, 'in'));
}
export function outputRoom(f: ProcessingFacility, spec: FacilityTierSpec): number {
  return Math.max(0, spec.yard - stockTotal(f.outputs) - inTransit(f, 'out'));
}

/** Weighted-average quality merge shared by hauling and production. */
export function mixQuality(f: ProcessingFacility, id: string, existing: number, added: number, quality: number): void {
  const total = existing + added;
  if (total <= EPSILON) return;
  f.quality[id] = ((f.quality[id] ?? 0.5) * existing + quality * added) / total;
}

/**
 * Ledger a recipe executor uses while a facility is the place of work. Inputs come from the input
 * yard first; materials the same facility also produces (`internal`, e.g. iron feeding a steel
 * furnace in an integrated works) may come straight from the output yard. Everything the
 * executor takes or adds is written to the facility's audit totals at that moment.
 */
export function facilityLedger(f: ProcessingFacility, spec: FacilityTierSpec, internal: ReadonlySet<string>): MaterialLedger {
  return {
    amount: id => Math.max(0, f.inputs[id] ?? 0) + (internal.has(id) ? Math.max(0, f.outputs[id] ?? 0) : 0),
    take(id, requested) {
      let remaining = Math.max(0, requested);
      let taken = 0;
      const fromInput = Math.min(remaining, Math.max(0, f.inputs[id] ?? 0));
      if (fromInput > 0) { f.inputs[id] = round((f.inputs[id] ?? 0) - fromInput); taken += fromInput; remaining -= fromInput; }
      if (remaining > EPSILON && internal.has(id)) {
        const fromOutput = Math.min(remaining, Math.max(0, f.outputs[id] ?? 0));
        if (fromOutput > 0) { f.outputs[id] = round((f.outputs[id] ?? 0) - fromOutput); taken += fromOutput; }
      }
      bump(f.totals.consumed, id, taken);
      return taken;
    },
    add(id, requested, quality = 0.5) {
      const accepted = Math.min(Math.max(0, requested), outputRoom(f, spec));
      if (accepted <= EPSILON) return 0;
      mixQuality(f, id, (f.outputs[id] ?? 0) + (f.inputs[id] ?? 0), accepted, quality);
      f.outputs[id] = round((f.outputs[id] ?? 0) + accepted);
      bump(f.totals.produced, id, accepted);
      return accepted;
    },
    quality: id => f.quality[id] ?? 0.5,
    room: () => outputRoom(f, spec),
  };
}

/**
 * Largest per-material violation of the facility's own accounting identity:
 *   (drawn from the store - still in transit) + produced - consumed - sent out = stock on the yards.
 * Zero means nothing was created or destroyed inside the facility.
 */
export function facilityConservationError(f: ProcessingFacility): number {
  const ids = new Set<string>([
    ...Object.keys(f.totals.dispatchedIn), ...Object.keys(f.totals.arrived), ...Object.keys(f.totals.consumed),
    ...Object.keys(f.totals.produced), ...Object.keys(f.totals.dispatchedOut), ...Object.keys(f.inputs), ...Object.keys(f.outputs),
  ]);
  let worst = 0;
  for (const id of ids) {
    const flowIn = (f.totals.arrived[id] ?? 0) + (f.totals.returned[id] ?? 0) + (f.totals.produced[id] ?? 0);
    const flowOut = (f.totals.consumed[id] ?? 0) + (f.totals.dispatchedOut[id] ?? 0) + (f.totals.spoiled[id] ?? 0);
    const stock = (f.inputs[id] ?? 0) + (f.outputs[id] ?? 0);
    worst = Math.max(worst, Math.abs(flowIn - flowOut - stock));
  }
  return worst;
}

/** Store <-> facility identity: everything drawn from the store either arrived or is still moving. */
export function transitConservationError(f: ProcessingFacility): number {
  const ids = new Set<string>([...Object.keys(f.totals.dispatchedIn), ...Object.keys(f.totals.arrived)]);
  let worst = 0;
  for (const id of ids) worst = Math.max(worst, Math.abs((f.totals.dispatchedIn[id] ?? 0) - (f.totals.arrived[id] ?? 0) - inTransitOf(f, 'in', id)));
  return worst;
}
