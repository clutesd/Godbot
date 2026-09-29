import type { Settlement, SimulationState } from '../types';
import { energyAt, energyWorld, type EnergyPlant, type GeneratorKind, type SettlementEnergy } from './types';

export const BATTERY_CHARGE_EFFICIENCY = 0.93;
export const BATTERY_DISCHARGE_EFFICIENCY = 0.92;
const BATTERY_RATE_FRACTION = 0.32;
const BATTERY_CALENDAR_DEGRADATION = 0.00015;
const BATTERY_CYCLE_DEGRADATION = 0.0008;

export interface StorageTransfer {
  input: number;
  output: number;
  loss: number;
}

export function usableStorageCapacity(energy: SettlementEnergy): number {
  const condition = energy.storageState?.condition ?? 1;
  return Math.max(0, energy.storageCapacity * Math.max(0.55, condition));
}

export function prepareStorageMonth(energy: SettlementEnergy): void {
  energy.storageState ??= { condition: 1, cycles: 0, throughput: 0, charged: 0, discharged: 0 };
  energy.storageState.throughput = 0;
  energy.storageState.charged = 0;
  energy.storageState.discharged = 0;
  energy.storage = Math.min(Math.max(0, energy.storage), usableStorageCapacity(energy));
}

export function storageChargeInputCapacity(energy: SettlementEnergy): number {
  if (energy.storageCapacity <= 0) return 0;
  const usable = usableStorageCapacity(energy);
  const room = Math.max(0, usable - energy.storage);
  const state = energy.storageState ?? { condition: 1, cycles: 0, throughput: 0, charged: 0, discharged: 0 };
  const rate = Math.max(0, energy.storageCapacity * BATTERY_RATE_FRACTION * state.condition - state.charged);
  return Math.max(0, Math.min(rate, room / BATTERY_CHARGE_EFFICIENCY));
}

export function storageDischargeOutputCapacity(energy: SettlementEnergy): number {
  if (energy.storageCapacity <= 0 || energy.storage <= 0) return 0;
  const state = energy.storageState ?? { condition: 1, cycles: 0, throughput: 0, charged: 0, discharged: 0 };
  const rate = Math.max(0, energy.storageCapacity * BATTERY_RATE_FRACTION * state.condition - state.discharged);
  return Math.max(0, Math.min(rate, energy.storage * BATTERY_DISCHARGE_EFFICIENCY));
}

export function chargeStorage(energy: SettlementEnergy, requestedInput: number): StorageTransfer {
  const input = Math.min(Math.max(0, requestedInput), storageChargeInputCapacity(energy));
  const output = input * BATTERY_CHARGE_EFFICIENCY;
  energy.storage += output;
  energy.storageState ??= { condition: 1, cycles: 0, throughput: 0, charged: 0, discharged: 0 };
  energy.storageState.throughput += input;
  energy.storageState.charged += input;
  return { input, output, loss: input - output };
}

export function dischargeStorage(energy: SettlementEnergy, requestedOutput: number): StorageTransfer {
  const output = Math.min(Math.max(0, requestedOutput), storageDischargeOutputCapacity(energy));
  const input = output / BATTERY_DISCHARGE_EFFICIENCY;
  energy.storage = Math.max(0, energy.storage - input);
  energy.storageState ??= { condition: 1, cycles: 0, throughput: 0, charged: 0, discharged: 0 };
  energy.storageState.throughput += input;
  energy.storageState.discharged += output;
  return { input, output, loss: input - output };
}

export function finalizeStorageMonth(energy: SettlementEnergy): void {
  const state = energy.storageState;
  if (!state || energy.storageCapacity <= 0) return;
  const equivalentCycles = state.throughput / Math.max(1, energy.storageCapacity * 2);
  state.cycles += equivalentCycles;
  state.condition = Math.max(0.55,
    state.condition - BATTERY_CALENDAR_DEGRADATION - equivalentCycles * BATTERY_CYCLE_DEGRADATION);
  energy.storage = Math.min(energy.storage, usableStorageCapacity(energy));
}

function regionalNeighbours(state: SimulationState, settlementId: string): string[] {
  const settlementIds = new Set(state.settlements.filter(s => s.alive).map(s => s.id));
  const neighbours: string[] = [];
  for (const line of energyWorld(state).lines) {
    if (line.progress < 1 || line.condition <= 0.25 || line.capacity <= 80) continue;
    if (!settlementIds.has(line.from) || !settlementIds.has(line.to)) continue;
    if (line.from === settlementId) neighbours.push(line.to);
    else if (line.to === settlementId) neighbours.push(line.from);
  }
  return neighbours.sort();
}

/** Existing commissioned regional transmission defines the dispatch island. */
export function gridComponent(state: SimulationState, origin: Settlement): Settlement[] {
  const byId = new Map(state.settlements.filter(s => s.alive).map(s => [s.id, s] as const));
  const seen = new Set<string>([origin.id]);
  const queue = [origin.id];
  for (let i = 0; i < queue.length; i++) {
    for (const next of regionalNeighbours(state, queue[i]!)) {
      if (seen.has(next) || !byId.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [...seen].map(id => byId.get(id)!).sort((a, b) => a.id.localeCompare(b.id));
}

export function gridComponentDemand(state: SimulationState, settlement: Settlement): number {
  return gridComponent(state, settlement)
    .reduce((sum, member) => sum + energyAt(member).ledgers.electric.demand, 0);
}

export function gridComponentStorageInputCapacity(state: SimulationState, settlement: Settlement): number {
  return gridComponent(state, settlement)
    .reduce((sum, member) => sum + storageChargeInputCapacity(energyAt(member)), 0);
}

export function dispatchPriority(kind: GeneratorKind): number {
  if (kind === 'wind' || kind === 'solar' || kind === 'hydro') return 0;
  if (kind === 'nuclear') return 1;
  if (kind === 'coal') return 2;
  if (kind === 'gas') return 3;
  if (kind === 'generator') return 4;
  return 5;
}

export function zeroMarginalGeneration(kind: GeneratorKind): boolean {
  return kind === 'wind' || kind === 'solar' || kind === 'hydro';
}

export function nuclearBuildJustified(state: SimulationState, settlement: Settlement): boolean {
  const demand = gridComponentDemand(state, settlement);
  // A reactor should only appear where an existing electrical system can absorb a meaningful
  // fraction of its output. Regional interconnection can justify it even if the host is smaller.
  return demand >= 42 && energyAt(settlement).reliability >= 0.55;
}

export function nuclearDispatchTarget(
  plant: EnergyPlant,
  capacity: number,
  componentDemand: number,
  remainingDemand: number,
  storageInputCapacity: number,
): number {
  if (componentDemand <= 0) return 0;
  const previous = Math.max(0, plant.output);
  const minimumStable = capacity * 0.52;
  const preferred = Math.min(capacity * 0.92,
    Math.max(minimumStable, Math.min(componentDemand * 0.72, remainingDemand + storageInputCapacity)));
  if (previous <= 0) return componentDemand >= capacity * 0.18 ? Math.min(preferred, capacity * 0.58) : 0;
  const downRamp = capacity * 0.12;
  const upRamp = capacity * 0.08;
  return Math.max(0, Math.min(previous + upRamp, Math.max(previous - downRamp, preferred)));
}

export function generationDispatchRequest(
  kind: GeneratorKind,
  plant: EnergyPlant,
  capacity: number,
  componentDemand: number,
  remainingDemand: number,
  storageInputCapacity: number,
): number {
  if (zeroMarginalGeneration(kind)) return Math.max(0, remainingDemand + storageInputCapacity);
  if (kind === 'nuclear') return nuclearDispatchTarget(plant, capacity, componentDemand, remainingDemand, storageInputCapacity);
  // Fuel-burning generators follow residual demand instead of burning fuel merely to be curtailed.
  return Math.max(0, remainingDemand);
}
