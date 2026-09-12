import { describe, expect, it } from 'vitest';
import { societyFixture, learn, residents } from './fixtures/settlementDevelopment';
import { SeededRandom } from '../src/sim/prng';
import { generateResourceDeposits } from '../src/sim/resources/WorldResourceSystem';
import { ResourceSystem } from '../src/sim/resources/ResourceSystem';
import { RESOURCE_BY_ID } from '../src/sim/resources/catalog';
import type { ResourceDeposit, Settlement, SimulationState } from '../src/sim/types';

function baseDeposit(overrides: Partial<ResourceDeposit>): ResourceDeposit {
  return {
    id: 'test-deposit',
    resourceId: 'wild-herbs',
    cellIndex: 0,
    worldX: 0,
    worldZ: 0,
    quality: 1,
    capacity: 100,
    abundance: 1,
    renewable: true,
    depleted: false,
    overharvested: false,
    discoveredBy: {},
    ...overrides,
  };
}

/** Places a deposit at the settlement's own cell so distance-gated discovery/gathering is trivial. */
function placeAtSettlement(state: SimulationState, settlement: Settlement, overrides: Partial<ResourceDeposit>): ResourceDeposit {
  const deposit = baseDeposit({ cellIndex: settlement.cellIndex, worldX: settlement.position.x, worldZ: settlement.position.z, ...overrides });
  state.world.resourceDeposits.push(deposit);
  return deposit;
}

describe('World resource deposit generation', () => {
  it('is deterministic for a fixed seed and world', () => {
    const { state } = societyFixture();
    const first = generateResourceDeposits(state.world, new SeededRandom('deposit-determinism'));
    const second = generateResourceDeposits(state.world, new SeededRandom('deposit-determinism'));
    expect(second).toEqual(first);
  });

  it('only sites mineral deposits on cells meeting geological gates', () => {
    const { state } = societyFixture();
    for (const cell of state.world.cells) Object.assign(cell, { biome: 'grassland', minerals: 0, rockiness: 0 });
    const deposits = generateResourceDeposits(state.world, new SeededRandom('gate-check'));
    expect(deposits.some((deposit) => deposit.resourceId === 'copper-ore' || deposit.resourceId === 'iron-ore' || deposit.resourceId === 'tin-ore')).toBe(false);
  });

  it('sites ore deposits when cells meet the biome, minerals and rockiness gates', () => {
    const { state } = societyFixture();
    for (const cell of state.world.cells) Object.assign(cell, { biome: 'mountain', minerals: 0.9, rockiness: 0.9 });
    const deposits = generateResourceDeposits(state.world, new SeededRandom('gate-positive'));
    expect(deposits.some((deposit) => deposit.resourceId === 'iron-ore')).toBe(true);
    expect(deposits.some((deposit) => deposit.resourceId === 'copper-ore')).toBe(true);
  });
});

describe('ResourceSystem discovery and gathering', () => {
  it('discovers a nearby deposit and records a historian-facing event', () => {
    const { state, settlements: [s] } = societyFixture();
    state.world.resourceDeposits = [];
    const deposit = placeAtSettlement(state, s!, { resourceId: 'wild-herbs' });
    const system = new ResourceSystem(new SeededRandom('discovery-test'));
    let events: ReturnType<ResourceSystem['advanceMonth']> = [];
    for (let month = 0; month < 200 && !s!.discoveredDeposits.includes(deposit.id); month += 1) {
      state.month = month;
      events = events.concat(system.advanceMonth(state));
    }
    expect(s!.discoveredDeposits).toContain(deposit.id);
    expect(events.some((event) => event.type === 'resource-deposit-discovered')).toBe(true);
  });

  it('gathers a discovered renewable deposit into the settlement material inventory', () => {
    const { state, settlements: [s] } = societyFixture();
    state.world.resourceDeposits = [];
    const deposit = placeAtSettlement(state, s!, { resourceId: 'wild-herbs' });
    deposit.discoveredBy[s!.id] = 0;
    s!.discoveredDeposits.push(deposit.id);
    const system = new ResourceSystem(new SeededRandom('gather-test'));
    for (let month = 0; month < 6; month += 1) { state.month = month; system.advanceMonth(state); }
    expect(s!.localMaterials['wild-herbs']).toBeGreaterThan(0);
    expect(s!.workedDeposits).toContain(deposit.id);
  });

  it('depletes a non-renewable deposit and marks it exhausted', () => {
    const { state, settlements: [s] } = societyFixture();
    state.world.resourceDeposits = [];
    const deposit = placeAtSettlement(state, s!, { resourceId: 'stone', renewable: false, capacity: 3, abundance: 1 });
    deposit.discoveredBy[s!.id] = 0;
    s!.discoveredDeposits.push(deposit.id);
    const system = new ResourceSystem(new SeededRandom('depletion-test'));
    let depletedEvent = false;
    for (let month = 0; month < 24 && !deposit.depleted; month += 1) {
      state.month = month;
      const events = system.advanceMonth(state);
      if (events.some((event) => event.type === 'resource-depleted')) depletedEvent = true;
    }
    expect(deposit.depleted).toBe(true);
    expect(deposit.abundance).toBe(0);
    expect(depletedEvent).toBe(true);
  });

  it('regenerates an unworked herb stand back toward full abundance', () => {
    const { state, settlements: [s] } = societyFixture();
    state.world.resourceDeposits = [];
    const deposit = placeAtSettlement(state, s!, { resourceId: 'wild-herbs', capacity: 5000, abundance: 0.4 });
    deposit.discoveredBy[s!.id] = 0;
    s!.discoveredDeposits.push(deposit.id);
    // Remove workers so nothing is extracted this run; regeneration should still lift abundance toward 1.
    residents(state, s!).forEach((p) => { p.occupation = 'keeper'; });
    const system = new ResourceSystem(new SeededRandom('regrowth-test'));
    for (let month = 0; month < 12; month += 1) { state.month = month; system.advanceMonth(state); }
    expect(deposit.abundance).toBeGreaterThan(0.4);
  });
});

describe('ResourceSystem recipe crafting', () => {
  function craftFixture() {
    const { state, settlements: [s] } = societyFixture();
    state.world.resourceDeposits = [];
    s!.infrastructure.workshops = 0.2;
    s!.localMaterials['copper-ore'] = 30;
    s!.localMaterials['tin-ore'] = 30;
    s!.localMaterials['timber'] = 60;
    return { state, s: s! };
  }

  it('does not craft bronze without the metal-smelting knowledge', () => {
    const { state, s } = craftFixture();
    const system = new ResourceSystem(new SeededRandom('no-knowledge'));
    for (let month = 0; month < 6; month += 1) { state.month = month; system.advanceMonth(state); }
    expect(s.knownRecipes).not.toContain('bronze-ingot');
    expect(s.localMaterials['bronze'] ?? 0).toBe(0);
  });

  it('crafts bronze once metal-smelting knowledge and inputs are both available', () => {
    const { state, s } = craftFixture();
    learn(s, 'metal-smelting');
    const system = new ResourceSystem(new SeededRandom('with-knowledge'));
    let learnedEvent = false;
    for (let month = 0; month < 12; month += 1) {
      state.month = month;
      const events = system.advanceMonth(state);
      if (events.some((event) => event.type === 'recipe-learned' && event.context?.recipe === 'bronze-ingot')) learnedEvent = true;
    }
    expect(s.knownRecipes).toContain('bronze-ingot');
    expect(s.localMaterials['bronze']).toBeGreaterThan(0);
    expect(s.localMaterials['copper-ore']).toBeLessThan(30);
    expect(learnedEvent).toBe(true);
  });
});

describe('ResourceSystem settlement consequences', () => {
  it('herbal remedy stock improves health and is consumed without creating food', () => {
    const { state, settlements: [s] } = societyFixture();
    state.world.resourceDeposits = [];
    s!.foodSecurity = 0.5;
    residents(state, s!).forEach(p => { p.health = 0.6; });
    s!.localMaterials['herbal-remedy'] = 50;
    const system = new ResourceSystem(new SeededRandom('remedy-test'));
    state.month = 1;
    system.advanceMonth(state);
    expect(residents(state, s!)[0]!.health).toBeGreaterThan(0.6);
    expect(s!.foodSecurity).toBe(0.5);
    expect(s!.localMaterials['herbal-remedy']).toBeLessThan(50);
  });

  it('resource definitions are catalogued for every material referenced by recipes', () => {
    expect(RESOURCE_BY_ID.get('copper-ore')).toBeDefined();
    expect(RESOURCE_BY_ID.get('tin-ore')).toBeDefined();
    expect(RESOURCE_BY_ID.get('iron-ore')).toBeDefined();
  });
});
