import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { KnowledgeSystem } from '../src/sim/knowledge/KnowledgeSystem';
import { SeededRandom } from '../src/sim/prng';
import { addMaterial, beginMaterialFlowMonth, materialAccess, materialReserve, publishBulkStocks, takeMaterial } from '../src/sim/resources/Inventory';
import { recordKnowledgeWork } from '../src/sim/knowledge/WorkExperience';
import { reinvestSurplusLabour } from '../src/sim/people/HumanCapital';
import { advanceEnergy } from '../src/sim/energy/EnergySystem';
import { accessibleRiverFlow, eligibleGenerator, generatorDefinition } from '../src/sim/energy/Generation';
import { nearestIndex } from '../src/sim/terrain/TerrainField';
import { energyAt } from '../src/sim/energy/types';
import { establishFacility, ensureProcessingAuthority, advanceProcessingFacilities, tierKnowledgeMet } from '../src/sim/processing/FacilitySystem';
import { facilityTierSpec } from '../src/sim/processing/FacilityCatalog';
import { facilityConservationError } from '../src/sim/processing/FacilityInventory';
import { auditProgressionReachability } from '../src/sim/knowledge/ReachabilityAudit';
import { foodExportable, tradeOpportunity } from '../src/sim/transport/FreightEconomy';
import { settlementPresentationEra } from '../src/render/assets/SettlementEra';
import { advanceIrrigationWorks, irrigationChannels } from '../src/sim/agriculture/IrrigationWorks';
import { advanceField, createField } from '../src/sim/agriculture/AgricultureSystem';
import { farmGeometries } from '../src/shared/FarmGeometry';
import { consumeMaterials } from '../src/sim/resources/Consumption';
import { MATERIAL_BY_ID } from '../src/sim/resources/catalog';
import { advanceSettlementDevelopment } from '../src/sim/development/SettlementDevelopmentSystem';
import { connect, learn, residents, societyFixture, sponsor } from './fixtures/settlementDevelopment';

function setup() {
  const fixture = societyFixture();
  const s = fixture.settlements[0]!;
  const system = new KnowledgeSystem(configWith({ seed: 'progression-repair' }), new SeededRandom('progression-repair:knowledge'));
  beginMaterialFlowMonth(s, fixture.state.month);
  return { ...fixture, s, system };
}

describe('production-supported progression', () => {
  it('starts a paid energy-site installment below the full bill and stops before unpaid completion', () => {
    const { state, s } = setup();
    s.industry.intensity = 1; s.infrastructure.workshops = 1;
    s.resources = { food: 2000, wood: 2, minerals: 2, goods: 2, wealth: 2 };
    s.localMaterials = { timber: 2, stone: 2, 'timber-frame': 2, 'dressed-stone': 2 };
    publishBulkStocks(s);
    s.development!.nextAttemptMonth = 0;
    state.month = 12;
    advanceSettlementDevelopment(state, s, residents(state, s), 0);
    const project = s.development!.project!;
    expect(project, JSON.stringify(s.development!.lastAttempt)).toBeDefined();
    expect(project.response.need).toBe('energy');
    expect(project.response.cost.wood).toBeGreaterThan(2);
    state.month++;
    advanceSettlementDevelopment(state, s, residents(state, s), 100);
    expect(project.progress).toBeGreaterThan(0);
    expect(project.progress).toBeLessThan(1);
    expect(project.spent.wood).toBeGreaterThan(0);
    expect(s.structurePlots!.find(p => p.id === project.plotId)?.development?.status).not.toBe('active');
    expect(s.resources.wood).toBeGreaterThanOrEqual(0);
  });
  it('requires experiment materials rather than unrelated quarry stock for refractory ceramics', () => {
    const { state, s, system } = setup();
    learn(s, 'combustion-dynamics'); sponsor(state, s, 'craft-circle');
    s.localMaterials = { stone: 100 };
    expect(system.canDiscover(state, s, 'high-temperature-ceramics')).toBe(false);
    s.localMaterials = { clay: 3 };
    expect(system.canDiscover(state, s, 'high-temperature-ceramics')).toBe(true);
    expect(s.localMaterials.clay).toBe(3);
    expect(s.localMaterials.stone).toBeUndefined();
  });
  it('surveys real nearby freshwater for dry-bank mills and rejects absent water or high banks', () => {
    const { state, s } = setup(); learn(s, 'wheel-axle', 'simple-gearing');
    const field = state.world.terrain;
    field.height.fill(0.45); field.waterLevel.fill(-1); field.river.fill(0); field.flow.fill(0);
    const index = nearestIndex(field, s.position.x, s.position.z) + 1;
    field.river[index] = 1; field.waterLevel[index] = 0.46; field.height[index] = 0.44; field.flow[index] = 0.9;
    const cell = state.world.cells[s.cellIndex]!; cell.river = false; cell.flow = 0; cell.elevation = 0.45;
    expect(accessibleRiverFlow(state, s)).toBeCloseTo(0.9);
    expect(eligibleGenerator(state, s, generatorDefinition('waterwheel'))).toBe(true);
    cell.elevation = 0.7; state.month++;
    expect(eligibleGenerator(state, s, generatorDefinition('waterwheel'))).toBe(false);
    cell.elevation = 0.45; field.river[index] = 0; state.month++;
    expect(eligibleGenerator(state, s, generatorDefinition('waterwheel'))).toBe(false);
  });
  it('keeps extraction demand out of spendable stocks and charges upkeep to real materials', () => {
    const { sim, state, s } = setup();
    state.settlements = [s]; s.localMaterials = {}; publishBulkStocks(s);
    const economy = sim as unknown as { runEconomy(): void };
    economy.runEconomy();
    expect(s.monthlyBalance.wood).toBeGreaterThan(0);
    expect(s.resources.wood).toBe(0); expect(s.localMaterials.timber ?? 0).toBe(0);
    expect(s.resources.minerals).toBe(0);
    s.localMaterials = { timber: 5, stone: 5 }; publishBulkStocks(s);
    economy.runEconomy();
    expect(s.resources.wood).toBeCloseTo(s.localMaterials.timber!, 6);
    expect(s.resources.minerals).toBeCloseTo(s.localMaterials.stone!, 6);
    expect(s.resources.wood).toBeLessThan(5); expect(s.resources.minerals).toBeLessThan(5);
    expect(s.materialEconomy!.flows!.consumed.timber).toBeGreaterThan(0);
  });
  it('issues real household equipment and replaces only wear or population demand', () => {
    const { state, s } = setup();
    const people = residents(state, s);
    s.localMaterials = { pottery: 100, textile: 100 };
    const budget = { carrier: 20, keeper: 20, artisan: 0 };
    consumeMaterials(state, s, people, budget, []);
    const equipment = s.materialEconomy!.householdEquipment!;
    expect(equipment.pottery).toBeCloseTo(people.length * 0.25);
    expect(equipment.textile).toBeCloseTo(people.length * 0.5);
    const spoilage = MATERIAL_BY_ID.get('pottery')!.spoilage ?? 0;
    expect(s.localMaterials.pottery! / (1 - spoilage) + equipment.pottery!).toBeCloseTo(100);
    expect(s.localMaterials.textile! / (1 - (MATERIAL_BY_ID.get('textile')?.spoilage ?? 0)) + equipment.textile!).toBeCloseTo(100);
    const stock = s.localMaterials.pottery!;
    consumeMaterials(state, s, people, { carrier: 20, keeper: 20, artisan: 0 }, []);
    expect(stock - s.localMaterials.pottery! / (1 - spoilage)).toBeCloseTo(people.length * 0.25 * 0.003);
    s.localMaterials.pottery = 0;
    consumeMaterials(state, s, people, { carrier: 20, keeper: 20, artisan: 0 }, []);
    expect(equipment.pottery).toBeCloseTo(people.length * 0.25 * 0.997);
  });
  it('practises household fire only when real fuel and tending labour are available', () => {
    const { state, s } = setup();
    const record = s.knowledge.records['fire-control']!; record.practice = 0;
    s.localMaterials = { timber: 10 };
    consumeMaterials(state, s, residents(state, s), { carrier: 1 }, []);
    expect(record.practice).toBeGreaterThan(0);
    expect(s.localMaterials.timber).toBeLessThan(10);
    const practice = record.practice;
    consumeMaterials(state, s, residents(state, s), {}, []);
    expect(record.practice).toBe(practice);
    s.localMaterials.timber = 0;
    consumeMaterials(state, s, residents(state, s), { carrier: 1 }, []);
    expect(record.practice).toBe(practice);
  });
  it('recognizes reliable delivered timber without creating spendable construction inputs', () => {
    const { state, s, system } = setup();
    learn(s, 'leverage', 'stone-composites');
    residents(state, s).slice(0, 3).forEach(p => { p.occupation = 'carrier'; });
    s.localMaterials = {}; s.resources.wood = 0;
    for (let month = 1; month <= 12; month++) {
      beginMaterialFlowMonth(s, month); addMaterial(s, 'timber', 2); takeMaterial(s, 'timber', 2);
    }
    expect(s.localMaterials.timber).toBe(0);
    expect(materialAccess(s, 'timber')).toBeGreaterThan(14);
    expect(system.canDiscover(state, s, 'wheel-axle')).toBe(true);
    expect(takeMaterial(s, 'timber', 14)).toBe(0);
    beginMaterialFlowMonth(s, 60);
    expect(system.canDiscover(state, s, 'wheel-axle')).toBe(false);
    expect(system.discoveryBlockers(state, s, 'wheel-axle')).toContainEqual(expect.stringContaining('resource:wood'));
  });

  it('uses delivered trade receipts for material access but excludes internal returns', () => {
    const { state, s, settlements, system } = setup();
    learn(s, 'leverage', 'stone-composites');
    residents(state, s).slice(0, 3).forEach(p => { p.occupation = 'builder'; });
    residents(state, s).slice(3, 6).forEach(p => { p.occupation = 'carrier'; });
    const source = settlements[1]!;
    source.localMaterials = { timber: 40 }; s.localMaterials = {};
    source.materialEconomy!.demand.timber = 12; s.materialEconomy!.demand.timber = 20;
    expect(materialReserve(source, 'timber')).toBeLessThan(40);
    expect(tradeOpportunity(source, s)).toBeGreaterThan(0);
    const cargo = takeMaterial(source, 'timber', 16);
    addMaterial(s, 'timber', cargo * 0.96); takeMaterial(s, 'timber', cargo * 0.96);
    expect(materialAccess(s, 'timber')).toBeGreaterThan(14);
    s.resources.wood = 0;
    expect(system.canDiscover(state, s, 'wheel-axle')).toBe(true);
    const access = materialAccess(s, 'timber');
    addMaterial(s, 'timber', 1, 0.5, false); takeMaterial(s, 'timber', 1);
    expect(materialAccess(s, 'timber')).toBeCloseTo(access);
    expect(source.localMaterials.timber! + cargo).toBe(40);
  });
  it('rotates teaching on actual encounters even when every shipment arrives in the same annual phase', () => {
    const { state, s, settlements, system } = setup();
    const target = settlements[1]!;
    target.knowledge.records = {}; target.knowledge.exposure = {};
    const ids = ['fire-control', 'seasonal-observation', 'stone-composites', 'leverage', 'pottery-firing',
      'material-testing', 'counting-measure', 'durable-records', 'wheel-axle', 'simple-gearing',
      'electromagnetism', 'electrical-generation'];
    learn(s, ...ids);
    connect(state, s, target);
    const route = state.tradeRoutes[0]!;
    for (let i = 0; i < 6; i++) { state.month += 12; system.diffuseTrade(state, s, target, route); }
    const heard = new Set([...Object.keys(target.knowledge.exposure), ...Object.keys(target.knowledge.records)]);
    for (const id of ids) expect(heard.has(id)).toBe(true);
    expect(target.energy?.plants ?? []).toHaveLength(0);
    expect(target.knowledge.records['electrical-generation']?.adoptedMonth).toBeUndefined();
  });

  it('keeps stock targets below extraction ceilings and permits food exports at normalized security', () => {
    const { s } = setup();
    s.materialEconomy!.demand.timber = 30; s.localMaterials.timber = 60;
    expect(materialReserve(s, 'timber')).toBeLessThan(60);
    s.foodSecurity = 1; s.resources.food = 1000;
    expect(foodExportable(s, 60)).toBe(true);
    s.resources.food = 60;
    expect(foodExportable(s, 60)).toBe(false);
  });

  it('trains one new specialist from sustained surplus, and preserves the agricultural base under scarcity', () => {
    const { state, s } = setup();
    state.month = 120; s.foodSecurity = 1;
    const workers = residents(state, s);
    workers.forEach(p => { p.occupation = 'farmer'; p.ageMonths = 30 * 12; p.health = 1; p.career = undefined; });
    s.survival!.food = { month: 120, population: workers.length, need: 20, target: 100, production: 30, consumed: 20, spoiled: 0, overflow: 0, extraProduction: 0 };
    s.materialEconomy!.flows!.produced.food = 30;
    const before = workers.filter(p => p.occupation === 'farmer').length;
    reinvestSurplusLabour(state);
    expect(workers.filter(p => p.occupation === 'farmer')).toHaveLength(before - 1);
    expect(workers.some(p => p.career?.reason === 'surplus-apprenticeship')).toBe(true);
    s.resources.food = 20; state.month += 12;
    reinvestSurplusLabour(state);
    expect(workers.filter(p => p.occupation === 'farmer')).toHaveLength(before - 1);
  });

  it('grows practice from actual work, with diminishing returns from larger teams', () => {
    const measure = (count: number, work: number) => {
      const { state, s, system } = setup();
      learn(s, 'wheel-axle');
      residents(state, s).forEach((p, i) => { p.occupation = i < count ? 'carrier' : i < count + 3 ? 'builder' : 'farmer'; });
      Object.assign(s.localMaterials, { timber: 100 });
      s.resources.wood = 100; s.knowledge.records['wheel-axle']!.practice = 0.5;
      recordKnowledgeWork(s, 'transport', work);
      system.advanceYear(state);
      return s.knowledge.records['wheel-axle']!.practice - 0.5;
    };
    expect(measure(8, 0)).toBeLessThanOrEqual(0);
    const small = measure(2, 1000), large = measure(12, 1000);
    expect(small).toBeGreaterThan(0); expect(large).toBeGreaterThan(small); expect(large).toBeLessThan(small * 6);
  });

  it('constructs and operates a waterwheel and productive sawmill without precision machinery or electricity', () => {
    const { state, s } = setup();
    learn(s, 'wheel-axle', 'simple-gearing', 'metal-smelting');
    expect(s.knowledge.records['rotary-machinery']).toBeUndefined();
    expect(tierKnowledgeMet(s, facilityTierSpec('wood', 2)!)).toBe(true);
    s.localMaterials = { timber: 100, stone: 100, iron: 20, charcoal: 10 };
    ensureProcessingAuthority(state);
    const facility = establishFacility(state, s, 'wood', 2, { origin: 'placed' })!;
    expect(facility).toBeDefined();
    s.infrastructure.workshops = 0.5;
    Object.assign(state.world.cells[s.cellIndex]!, { river: true, flow: 0.9 });
    Object.assign(state.weather.cells[s.cellIndex]!, { temperature: 0.6, snowpack: 0, runoff: 0 });
    const timber = s.localMaterials.timber!;
    for (let m = 0; m < 36; m++) {
      state.month++; advanceEnergy(state);
      advanceProcessingFacilities(state, s, { artisan: 20, builder: 20, carrier: 20, forager: 20 }, new SeededRandom(`mill:${m}`));
    }
    const wheel = energyAt(s).plants.find(p => p.kind === 'waterwheel');
    expect(wheel?.progress).toBe(1); expect(wheel?.output).toBeGreaterThan(0);
    expect(facility.power.supplied).toBeGreaterThan(0);
    expect(facility.totals.produced.lumber).toBeGreaterThan(0);
    expect(s.localMaterials.timber).toBeLessThan(timber);
    expect(facilityConservationError(facility)).toBeLessThan(0.0001);
    expect(s.energy!.ledgers.electric.supplied).toBe(0);
    expect(s.energy!.lit).toBe(false);
    const cell = state.world.cells[s.cellIndex]!, weather = state.weather.cells[s.cellIndex]!;
    weather.floodDepth = 0; weather.wind = 0; weather.blizzard = 0; cell.moisture = 0.5;
    const grain = createField('grain', cell, s.cellIndex, state.month);
    grain.stage = 'mature'; grain.harvestRemaining = 200; grain.biomass = 1; grain.thermalTime = 5;
    grain.plantedMonth = state.month - 6;
    const manual = structuredClone(grain), unpowered = structuredClone(s); unpowered.energy = undefined;
    // Even abundant kiln fuel cannot stand in for a mill's actual shaft power.
    unpowered.materialEconomy!.energySupplied = 100;
    advanceField(grain, structuredClone(cell), weather, s, state.month, 1, 3, 0);
    advanceField(manual, structuredClone(cell), weather, unpowered, state.month, 1, 3, 0);
    expect(grain.production).toBeGreaterThan(manual.production);
    expect(grain.harvestRemaining + grain.production).toBeLessThanOrEqual(200);
  });

  it('does not render discovered electricity as an industrial settlement or functioning grid', () => {
    const { state, s } = setup();
    learn(s, 'electromagnetism', 'electrical-generation');
    s.localMaterials = {}; s.resources.wood = 0;
    for (let i = 0; i < 12; i++) { state.month++; advanceEnergy(state); }
    expect(s.energy!.ledgers.electric.supplied).toBe(0);
    expect(s.energy!.lit).toBe(false);
    expect(['industrial', 'advanced']).not.toContain(settlementPresentationEra(s));
    const landmark = s.structurePlots!.find(p => p.development?.status === 'active')!;
    landmark.development!.level = 3; landmark.development!.form = 'works';
    expect(['industrial', 'advanced']).not.toContain(settlementPresentationEra(s));
  });

  it('checks the full structural network and detects a deliberately circular chain', () => {
    const audit = auditProgressionReachability();
    expect(audit.missingReferences).toEqual([]); expect(audit.unresolved).toEqual([]);
    expect(audit.reachable).toContain('power:mechanical'); expect(audit.reachable).toContain('knowledge:electric-grid');
    const cyclic = auditProgressionReachability([{ id: 'wheel', paths: [['mill']] }, { id: 'mill', paths: [['wheel']] }]);
    expect(cyclic.unresolved.map(n => n.id)).toEqual(['wheel', 'mill']);
    expect(cyclic.unresolvedCycles).toEqual([['mill', 'wheel']]);
  });

  it('pays for field channels before their visual network can exist', () => {
    const { state, s } = setup();
    learn(s, 'irrigation');
    const fieldPlot = s.structurePlots!.find(p => p.development?.status === 'active')!;
    fieldPlot.development!.form = 'field'; fieldPlot.development!.need = 'food';
    const geometry = farmGeometries(s).find(f => f.id === fieldPlot.id)!;
    expect(geometry).toBeDefined();
    const field = createField(fieldPlot.id, state.world.cells[s.cellIndex]!, s.cellIndex, 0);
    s.fields = [field]; s.localMaterials = { timber: 10, stone: 10 };
    Object.assign(state.world.cells[s.cellIndex]!, { river: true, flow: 0.9 });
    s.development!.water = { evaluatedMonth: 0, availability: 1, irrigation: 1, reliability: 1, quality: 1, sanitation: 0, droughtStress: 0, floodContamination: 0, surfaceAccess: 1, builtService: 0, droughtMonths: 0 };
    expect(irrigationChannels(field, geometry)).toEqual([]);
    for (let i = 0; i < 100; i++) { state.month++; advanceIrrigationWorks(state, s, field, geometry); }
    expect(field.irrigationWorks?.progress).toBe(1);
    expect(field.irrigationWorks?.timberSpent).toBeGreaterThan(0);
    expect(field.irrigationWorks?.stoneSpent).toBeGreaterThan(0);
    expect(irrigationChannels(field, geometry).length).toBe(7);
  });
});
