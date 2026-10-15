/**
 * Simulation authority behind the repaired architectural pathways. Each pathway opens only with
 * the knowledge, labour, materials and geography that justify it; nothing here is granted.
 */
import { describe, expect, it } from 'vitest';
import { developmentContext, responseForNeed } from '../src/sim/development/SettlementDevelopmentSystem';
import { practisedConstructionTechnology } from '../src/sim/development/ConstructionTechnology';
import { advanceEnergy, waterLiftDemand } from '../src/sim/energy/EnergySystem';
import { energyAt } from '../src/sim/energy/types';
import { generatorDefinition } from '../src/sim/energy/Generation';
import { archetypeForContext } from '../src/render/architecture/ArchetypeRouting';
import { learn, residents, societyFixture, sponsor } from './fixtures/settlementDevelopment';
import type { Settlement, SimulationState } from '../src/sim/types';

function town() {
  const { state, settlements } = societyFixture();
  const s = settlements[0]!;
  return { state, s };
}

/** Grow the fixture's population with ordinary residents, so population gates are real people. */
function populate(state: SimulationState, s: Settlement, count: number): void {
  const template = residents(state, s)[0]!;
  for (let i = 0; i < count; i++) state.people.push({ ...structuredClone(template), id: `${s.id}:extra:${i}`, occupation: i % 3 ? 'farmer' : 'artisan' });
}

describe('dense housing courts', () => {
  it('need administered land and a town large enough to fill them', () => {
    const { state, s } = town();
    const cap = () => responseForNeed(developmentContext(state, s), 'housing', 3)!.level;
    expect(cap()).toBe(2);
    learn(s, 'civic-administration');
    expect(cap()).toBe(2);
    populate(state, s, 120);
    expect(cap()).toBe(3);
    const court = responseForNeed(developmentContext(state, s), 'housing', 3)!;
    expect(court.name).toBe('dense housing court');
    expect(court.services.housing).toBeGreaterThan(responseForNeed(developmentContext(state, s), 'housing', 2)!.services.housing!);
    // Without specialist builders the universal level caps still hold.
    s.prosperity = 0.3;
    expect(cap()).toBe(2);
  });
});

describe('bulk grain storage', () => {
  it('reaches level 3 only with shaft power, enough farmers and a real surplus', () => {
    const { state, s } = town();
    const cell = state.world.cells[s.cellIndex]!; cell.fertility = 0.1; // a store, not a farmstead
    const level = () => responseForNeed(developmentContext(state, s), 'food', 3)!.level;
    expect(level()).toBe(2);
    learn(s, 'mechanical-power');
    s.monthlyBalance.food = -1;
    populate(state, s, 30);
    expect(level()).toBe(2);
    s.monthlyBalance.food = 4;
    expect(level()).toBe(3);
  });
});

describe('perimeter walls', () => {
  it('enclose a settlement only after its garrison is fully developed and conflict persists', () => {
    const { state, s } = town();
    sponsor(state, s, 'military-order');
    s.conflictPressure = 0.6;
    const first = responseForNeed(developmentContext(state, s), 'security', 1)!;
    expect(first.form).toBe('tower');
    expect(first.reasons).not.toContain('perimeter-defence');
    const plot = s.structurePlots!.find(p => p.development?.status === 'active')!;
    plot.development = { ...plot.development!, ...responseForNeed(developmentContext(state, s), 'security', 3)!, level: 3, status: 'active' };
    const wall = responseForNeed(developmentContext(state, s), 'security', 1)!;
    expect(wall.reasons).toContain('perimeter-defence');
    expect(wall.name).toBe('timber palisade');
    expect(wall.cost.wood).toBeGreaterThan(first.cost.wood);
    expect(archetypeForContext({ role: 'gate-tower', period: 'medieval', need: 'security', form: 'tower', level: 1, reasons: wall.reasons })).toBe('boundary-wall');
    s.conflictPressure = 0.1;
    expect(responseForNeed(developmentContext(state, s), 'security', 1)?.reasons ?? []).not.toContain('perimeter-defence');
  });
});

describe('recorded construction technique', () => {
  it('is what the builders practised when the response was chosen, and does not change with the building', () => {
    const { state, s } = town();
    const before = responseForNeed(developmentContext(state, s), 'housing')!;
    expect(before.technology).toEqual(practisedConstructionTechnology(s));
    expect(before.technology).not.toContain('standardized-parts');
    learn(s, 'standardized-parts');
    const after = responseForNeed(developmentContext(state, s), 'housing')!;
    expect(after.technology).toContain('standardized-parts');
    expect(before.technology).not.toContain('standardized-parts');
  });

  it('records kept livestock on a farmstead, which is what lets the farm house it', () => {
    const { state, s } = town();
    for (const person of residents(state, s).slice(0, 8)) person.occupation = 'farmer';
    expect(responseForNeed(developmentContext(state, s), 'food')!.capabilities).not.toContain('animal-husbandry');
    learn(s, 'animal-husbandry');
    const farm = responseForNeed(developmentContext(state, s), 'food')!;
    expect(farm.form).toBe('field');
    expect(farm.capabilities).toContain('animal-husbandry');
  });
});

describe('water lifting and machinery upgrades', () => {
  function waterTown() {
    const { state, s } = town();
    state.settlements = [s];
    const plot = s.structurePlots!.find(p => p.development?.status === 'active')!;
    s.structurePlots = [plot];
    Object.assign(plot.development!, { need: 'water', form: 'store' });
    plot.accessRestricted = false; plot.condition = 1;
    s.development!.water = { evaluatedMonth: 0, availability: 0.2, reliability: 0.3, quality: 0.8, irrigation: 0, sanitation: 0,
      droughtStress: 0.6, floodContamination: 0, surfaceAccess: 0.1, builtService: 1, droughtMonths: 6 };
    s.localMaterials = { timber: 100, stone: 100, textile: 100 };
    Object.assign(state.world.cells[s.cellIndex]!, { river: false, flow: 0, lake: false });
    Object.assign(state.weather.cells[s.cellIndex]!, { wind: 0.5, temperature: 0.6, snowpack: 0, runoff: 0 });
    return { state, s, plot };
  }

  it('has no water to lift without built works, the wheel, or a real shortfall', () => {
    const { s, plot } = waterTown();
    expect(waterLiftDemand(s, 200)).toBe(0);
    learn(s, 'wheel-axle');
    expect(waterLiftDemand(s, 200)).toBeGreaterThan(0);
    s.development!.water!.surfaceAccess = 0.9; s.development!.water!.droughtStress = 0;
    expect(waterLiftDemand(s, 200)).toBe(0);
    s.development!.water!.surfaceAccess = 0.1; s.development!.water!.droughtStress = 0.6;
    plot.development!.need = 'housing';
    expect(waterLiftDemand(s, 200)).toBe(0);
  });

  it('pays for and raises a wind pump at a water works that has water to lift', () => {
    const { state, s, plot } = waterTown();
    learn(s, 'wheel-axle', 'simple-gearing');
    for (let i = 0; i < 30; i++) { state.month++; advanceEnergy(state); }
    const plant = energyAt(s).plants.find(p => p.plotId === plot.id)!;
    expect(plant.kind).toBe('windmill');
    expect(plant.progress).toBe(1);
    expect(100 - s.localMaterials.timber!).toBeGreaterThanOrEqual(generatorDefinition('windmill').cost.timber! - 1e-6);
    expect(energyAt(s).waterLift!.supplied).toBeGreaterThan(0);
    expect(archetypeForContext({ role: 'workshop', period: 'medieval', energyKind: 'windmill', need: 'water', material: plot.development!.material })).toBe('wind-pump');
  });

  it('re-equips a gin with a wind mill once gearing is known, paying for the new machine', () => {
    const { state, s, plot } = waterTown();
    Object.assign(plot.development!, { need: 'energy', form: 'workshop' });
    s.infrastructure.workshops = 0.7;
    learn(s, 'wheel-axle', 'animal-husbandry');
    for (let i = 0; i < 12; i++) { state.month++; advanceEnergy(state); }
    const plant = energyAt(s).plants[0]!;
    expect(plant.kind).toBe('animal');
    expect(plant.progress).toBe(1);
    learn(s, 'simple-gearing');
    const timber = s.localMaterials.timber!;
    state.month++; advanceEnergy(state);
    expect(plant.kind).toBe('windmill');
    expect(plant.replacedKind).toBe('animal');
    expect(plant.progress).toBeLessThan(1);
    for (let i = 0; i < 24 && plant.progress < 1; i++) { state.month++; advanceEnergy(state); }
    expect(plant.progress).toBe(1);
    expect(timber - s.localMaterials.timber!).toBeGreaterThanOrEqual(generatorDefinition('windmill').cost.timber! - 1e-6);
  });
});
