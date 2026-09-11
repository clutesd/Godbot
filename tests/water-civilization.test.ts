import { describe, expect, it } from 'vitest';
import { advanceSettlementDevelopment } from '../src/sim/development/SettlementDevelopmentSystem';
import { nearestIndex } from '../src/sim/terrain/TerrainField';
import type { Settlement, SimulationState } from '../src/sim/types';
import { learn, residents, societyFixture } from './fixtures/settlementDevelopment';

function setDry(state: SimulationState, settlement: Settlement): void {
  const cell = state.world.cells[settlement.cellIndex]!;
  cell.moisture = 0.06;
  cell.river = false;
  cell.lake = false;
  cell.coast = false;
  const weather = state.weather.cells[settlement.cellIndex]!;
  weather.runoff = 0;
  weather.floodDepth = 0;
  weather.floodMonths = 0;
}

function addFreshwater(state: SimulationState, settlement: Settlement): void {
  const { terrain } = state.world;
  const radius = state.world.cellSize * 1.35;
  for (let z = -2; z <= 2; z += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const index = nearestIndex(terrain, settlement.position.x + x / 2 * radius, settlement.position.z + z / 2 * radius);
      terrain.waterLevel[index] = terrain.height[index]! + 0.012;
      terrain.river[index] = 1;
      terrain.flow[index] = 0.72;
    }
  }
  const cell = state.world.cells[settlement.cellIndex]!;
  cell.moisture = 0.68;
  const weather = state.weather.cells[settlement.cellIndex]!;
  weather.runoff = 0.06;
}

function primeEconomy(state: SimulationState, settlement: Settlement): void {
  const people = residents(state, settlement);
  settlement.monthlyBalance.food = 12;
  settlement.resources.food = 600;
  people.forEach((person, index) => {
    person.occupation = index < Math.max(4, Math.floor(people.length * 0.45)) ? 'farmer' : person.occupation;
    person.health = 0.82;
  });
}

function installWaterWorks(settlement: Settlement): void {
  const plot = settlement.structurePlots![0]!;
  const prior = plot.development!;
  plot.development = {
    ...prior,
    need: 'water',
    form: 'works',
    name: 'sanitation works',
    level: 3,
    services: { water: 3.5 },
    capabilities: ['irrigation', 'contagion-patterns', 'civic-administration'],
    reasons: ['water-security'],
    status: 'active',
  };
  plot.condition = 1;
  plot.accessRestricted = false;
}

describe('civilization water feedback', () => {
  it('makes real fine-grid freshwater improve reliability, harvests and health relative to drought', () => {
    const { state, settlements } = societyFixture();
    const wet = settlements[0]!;
    const dry = settlements[1]!;
    primeEconomy(state, wet);
    primeEconomy(state, dry);
    setDry(state, dry);
    addFreshwater(state, wet);

    state.month += 1;
    const wetHealthBefore = residents(state, wet)[0]!.health;
    const dryHealthBefore = residents(state, dry)[0]!.health;
    advanceSettlementDevelopment(state, wet, residents(state, wet), 0);
    advanceSettlementDevelopment(state, dry, residents(state, dry), 0);

    expect(wet.development!.water!.surfaceAccess).toBeGreaterThan(dry.development!.water!.surfaceAccess);
    expect(wet.development!.water!.reliability).toBeGreaterThan(dry.development!.water!.reliability);
    expect(wet.development!.water!.droughtStress).toBeLessThan(dry.development!.water!.droughtStress);
    expect(wet.monthlyBalance.food).toBeGreaterThan(dry.monthlyBalance.food);
    expect(residents(state, wet)[0]!.health - wetHealthBefore).toBeGreaterThan(residents(state, dry)[0]!.health - dryHealthBefore);
  });

  it('lets engineered water works convert knowledge into drought and sanitation resilience', () => {
    const { state, settlements } = societyFixture();
    const engineered = settlements[2]!;
    const exposed = settlements[3]!;
    for (const settlement of [engineered, exposed]) {
      primeEconomy(state, settlement);
      setDry(state, settlement);
      learn(settlement, 'irrigation', 'contagion-patterns', 'civic-administration');
    }
    installWaterWorks(engineered);

    state.month += 1;
    advanceSettlementDevelopment(state, engineered, residents(state, engineered), 0);
    advanceSettlementDevelopment(state, exposed, residents(state, exposed), 0);

    const protectedWater = engineered.development!.water!;
    const exposedWater = exposed.development!.water!;
    expect(protectedWater.builtService).toBeGreaterThan(3);
    expect(protectedWater.reliability).toBeGreaterThan(exposedWater.reliability);
    expect(protectedWater.quality).toBeGreaterThan(exposedWater.quality);
    expect(protectedWater.irrigation).toBeGreaterThan(exposedWater.irrigation);
    expect(protectedWater.sanitation).toBeGreaterThan(exposedWater.sanitation);
    expect(protectedWater.droughtStress).toBeLessThan(exposedWater.droughtStress);
  });

  it('records sustained hydrologic drought as history instead of a one-month weather blip', () => {
    const { state, settlements } = societyFixture();
    const settlement = settlements[0]!;
    setDry(state, settlement);
    primeEconomy(state, settlement);
    const events = [];

    for (let month = 0; month < 6; month += 1) {
      state.month += 1;
      settlement.monthlyBalance.food = 8;
      events.push(...advanceSettlementDevelopment(state, settlement, residents(state, settlement), 0));
    }

    expect(settlement.development!.water!.droughtMonths).toBe(6);
    expect(events.some((event) => event.tags.includes('drought') && event.tags.includes('water'))).toBe(true);
    expect(settlement.development!.water!.lastCrisisMonth).toBe(state.month);
  });

  it('turns water scarcity and contamination into explicit infrastructure pressure', () => {
    const { state, settlements } = societyFixture();
    const settlement = settlements[1]!;
    setDry(state, settlement);
    primeEconomy(state, settlement);
    settlement.pollution = 0.7;
    const weather = state.weather.cells[settlement.cellIndex]!;
    weather.floodDepth = 0.2;
    weather.floodMonths = 2;

    state.month += 1;
    advanceSettlementDevelopment(state, settlement, residents(state, settlement), 0);

    expect(settlement.development!.water!.quality).toBeLessThan(0.6);
    expect(settlement.development!.pressures.water).toBeGreaterThan(settlement.development!.informal.water!);
    expect(settlement.development!.unmet.water).toBeGreaterThan(0.65);
  });
});
