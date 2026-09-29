import { describe, expect, it } from 'vitest';
import {
  BATTERY_CHARGE_EFFICIENCY,
  BATTERY_DISCHARGE_EFFICIENCY,
  chargeStorage,
  dischargeStorage,
  finalizeStorageMonth,
  generationDispatchRequest,
  gridComponentDemand,
  nuclearBuildJustified,
  nuclearDispatchTarget,
  prepareStorageMonth,
  storageChargeInputCapacity,
  storageDischargeOutputCapacity,
} from '../src/sim/energy/AdvancedEnergy';
import { generatorDefinition } from '../src/sim/energy/Generation';
import { energyAt, energyWorld, type EnergyPlant } from '../src/sim/energy/types';
import { RECIPE_BY_ID } from '../src/sim/resources/catalog';
import { societyFixture } from './fixtures/settlementDevelopment';

function nuclearPlant(output = 0): EnergyPlant {
  return {
    id: 'reactor', plotId: 'reactor-site', kind: 'nuclear', progress: 1, condition: 1,
    output, fuelUsed: 0, status: output > 0 ? 'running' : 'idle',
  };
}

describe('advanced energy storage and grid operation', () => {
  it('charges and discharges batteries through bounded rates and explicit conversion losses', () => {
    const { settlements } = societyFixture();
    const energy = energyAt(settlements[0]!);
    energy.storageCapacity = 100;
    energy.storage = 20;
    prepareStorageMonth(energy);

    expect(storageChargeInputCapacity(energy)).toBeCloseTo(32, 6);
    const charge = chargeStorage(energy, 100);
    expect(charge.input).toBeCloseTo(32, 6);
    expect(charge.output).toBeCloseTo(32 * BATTERY_CHARGE_EFFICIENCY, 6);
    expect(charge.loss).toBeGreaterThan(0);
    expect(storageChargeInputCapacity(energy)).toBeCloseTo(0, 6);

    const beforeDischarge = energy.storage;
    expect(storageDischargeOutputCapacity(energy)).toBeCloseTo(32, 6);
    const discharge = dischargeStorage(energy, 100);
    expect(discharge.output).toBeCloseTo(32, 6);
    expect(discharge.input).toBeCloseTo(32 / BATTERY_DISCHARGE_EFFICIENCY, 6);
    expect(discharge.loss).toBeGreaterThan(0);
    expect(energy.storage).toBeLessThan(beforeDischarge);

    finalizeStorageMonth(energy);
    expect(energy.storageState!.cycles).toBeGreaterThan(0);
    expect(energy.storageState!.condition).toBeLessThan(1);
  });

  it('treats commissioned regional transmission as one dispatch island', () => {
    const { state, settlements } = societyFixture();
    const a = settlements[0]!, b = settlements[1]!;
    energyAt(a).ledgers.electric.demand = 45;
    energyAt(b).ledgers.electric.demand = 35;
    energyWorld(state).lines = [{
      id: 'regional', from: a.id, to: b.id, points: [a.position, b.position],
      capacity: 100, loss: 0.03, progress: 1, condition: 1, flow: 0,
    }];

    expect(gridComponentDemand(state, a)).toBeCloseTo(80, 6);
    expect(gridComponentDemand(state, b)).toBeCloseTo(80, 6);

    energyWorld(state).lines[0]!.condition = 0.2;
    expect(gridComponentDemand(state, a)).toBeCloseTo(45, 6);
  });

  it('does not burn dispatchable fuel after residual grid demand is already covered', () => {
    const plant = nuclearPlant();
    expect(generationDispatchRequest('coal', plant, 55, 100, 0, 40)).toBe(0);
    expect(generationDispatchRequest('gas', plant, 65, 100, 0, 40)).toBe(0);
    expect(generationDispatchRequest('wind', plant, 28, 100, 0, 40)).toBe(40);
  });
});

describe('advanced nuclear generation', () => {
  it('requires a credible grid demand before a reactor is justified', () => {
    const { state, settlements } = societyFixture();
    const settlement = settlements[0]!;
    const energy = energyAt(settlement);
    energy.reliability = 0.9;
    energy.ledgers.electric.demand = 69;
    expect(nuclearBuildJustified(state, settlement)).toBe(false);
    energy.ledgers.electric.demand = 70;
    expect(nuclearBuildJustified(state, settlement)).toBe(true);
  });

  it('operates nuclear as slow-ramping baseload rather than an instantaneous peaker', () => {
    const plant = nuclearPlant();
    const capacity = generatorDefinition('nuclear').capacity;
    const startup = nuclearDispatchTarget(plant, capacity, 120, 120, 30);
    expect(startup).toBeGreaterThan(capacity * 0.4);
    expect(startup).toBeLessThanOrEqual(capacity * 0.55);

    plant.output = startup;
    const next = nuclearDispatchTarget(plant, capacity, 220, 220, 40);
    expect(next - startup).toBeLessThanOrEqual(capacity * 0.08 + 1e-9);

    plant.output = next;
    const reduced = nuclearDispatchTarget(plant, capacity, 80, 0, 0);
    expect(next - reduced).toBeLessThanOrEqual(capacity * 0.12 + 1e-9);
    expect(reduced).toBeGreaterThan(0);
  });

  it('makes first fuel fabrication reachable before civil reactor operation and keeps fuel out of construction cost', () => {
    const recipe = RECIPE_BY_ID.get('nuclear-fuel')!;
    const requirements = recipe.requiredKnowledge.map(k => k.id);
    expect(requirements).toContain('nuclear-fission');
    expect(requirements).toContain('industrial-chemistry');
    expect(requirements).toContain('precision-manufacturing');
    expect(requirements).not.toContain('nuclear-energy');

    const reactor = generatorDefinition('nuclear');
    expect(reactor.cost['nuclear-fuel']).toBeUndefined();
    expect(reactor.fuel).toBe('nuclear-fuel');
    expect(reactor.efficiency).toBeGreaterThan(500);
  });
});
