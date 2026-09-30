import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { advanceAgriculture, advanceField, createField, ensureFields, farmerField, fieldHarvestable, summarizeAgriculture } from '../src/sim/agriculture/AgricultureSystem';
import { farmGeometries } from '../src/shared/FarmGeometry';
import { farmPresentationState, farmerCanPresent, sampleFarmAction } from '../src/render/farming/FarmActionPresentation';
import { FarmFieldRenderer } from '../src/render/farming/FarmFieldRenderer';
import { createResourceWorkMotion } from '../src/render/animation/ResourceWorkMotion';
import { learn } from './fixtures/settlementDevelopment';
import { advanceSettlementWater } from '../src/sim/development/WaterCivilization';

function fixture() {
  const sim = new Simulation({ seed: 'field-ecology', startingPopulation: 32, settlementCount: [2, 2], world: { size: 20 } });
  const state = sim.state, s = state.settlements[0]!, cell = state.world.cells[s.cellIndex]!;
  cell.moisture = 0.6; cell.fertility = 0.65; cell.water = false;
  Object.assign(cell.soil!, { drainage: 0.65, retention: 0.6, parentFertility: 0.75 });
  const w = state.weather.cells[s.cellIndex]!;
  Object.assign(w, { temperature: 0.61, floodDepth: 0, snowpack: 0, wind: 0.2, kind: 'clear', precipitation: 'none', blizzard: 0, cropDamage: 0 });
  s.knowledge.records = {};
  const f = createField('test-field', cell, s.cellIndex, 0);
  f.stage = 'flowering'; f.action = 'tend'; f.plantedMonth = 0; f.thermalTime = 0.52; f.biomass = 0.5;
  s.fields = [f];
  return { sim, state, s, cell, w, f };
}

function grow(dry: boolean, irrigated = false) {
  const x = fixture();
  x.cell.moisture = dry ? 0.06 : 0.6; x.f.soilMoisture = x.cell.moisture;
  if (irrigated) learn(x.s, 'irrigation');
  let production = 0;
  for (let month = 1; month <= 3; month++) {
    if (month > 2) x.cell.moisture = 0.6;
    advanceField(x.f, x.cell, x.w, x.s, month, 1000, 3, irrigated ? 0.4 : 0);
    production += x.f.production;
  }
  return { ...x, production };
}

describe('persistent field ecology', () => {
  it('preserves reproductive drought losses after rain returns and irrigation protects final harvest', () => {
    const wet = grow(false), dry = grow(true), irrigated = grow(true, true);
    expect(wet.production).toBeGreaterThan(0);
    expect(dry.production).toBeLessThan(wet.production * 0.65);
    expect(irrigated.production).toBeGreaterThan(dry.production);
    expect(dry.f.yieldPotential).toBeLessThan(wet.f.yieldPotential);
  });
  it('drainage changes flood damage for otherwise identical fields', () => {
    const poor = fixture(), good = fixture();
    for (const x of [poor, good]) { x.w.floodDepth = 0.12; x.cell.moisture = 0.85; x.f.soilMoisture = 0.85; }
    poor.cell.soil!.drainage = 0.05; good.cell.soil!.drainage = 0.95;
    for (let month = 1; month <= 3; month++) for (const x of [poor, good]) advanceField(x.f, x.cell, x.w, x.s, month, 8, 3, 0);
    expect(poor.f.waterlogging).toBeGreaterThan(good.f.waterlogging);
    expect(poor.f.health).toBeLessThan(good.f.health);
  });
  it('ties frost and storm losses to real signals and sensitive stages', () => {
    const frost = fixture(), storm = fixture(), control = fixture();
    frost.w.temperature = 0.28;
    storm.f.stage = 'filling'; storm.w.kind = 'windstorm'; storm.w.wind = 0.95; storm.w.intensity = 0.9;
    for (const x of [frost, storm, control]) advanceField(x.f, x.cell, x.w, x.s, 1, 8, 3, 0);
    expect(frost.f.frostDamage).toBeGreaterThan(0);
    expect(storm.f.stormDamage).toBeGreaterThan(0);
    expect(control.f.frostDamage + control.f.stormDamage).toBe(0);
    control.w.cropDamage = 0.99;
    const before = control.f.health;
    advanceField(control.f, control.cell, control.w, control.s, 2, 8, 3, 0);
    expect(control.f.health).toBe(before);
  });
  it('recovers existing soil fertility with fallow and legumes rather than a duplicate soil ledger', () => {
    const fallow = fixture(), legume = fixture(), cereal = fixture();
    for (const x of [fallow, legume, cereal]) x.cell.fertility = 0.3;
    fallow.f.stage = 'fallow'; legume.f.crop = 'legume';
    for (let month = 1; month <= 4; month++) {
      advanceField(fallow.f, fallow.cell, fallow.w, fallow.s, month, 0, 3, 0);
      for (const x of [legume, cereal]) advanceField(x.f, x.cell, x.w, x.s, month, 8, 3, 0);
    }
    expect(fallow.cell.fertility).toBeGreaterThan(0.3);
    expect(legume.cell.fertility).toBeGreaterThan(cereal.cell.fertility);
    expect(fallow.f.fertility).toBe(fallow.cell.fertility);
    expect(fallow.f.fallowMonths).toBe(4);
  });
  it('knowledge changes crop choice and timing; ideas alone do not irrigate', () => {
    const adapted = fixture(), basic = fixture();
    for (const x of [adapted, basic]) { x.f.stage = 'fallow'; x.cell.moisture = 0.3; x.f.soilMoisture = 0.3; }
    learn(adapted.s, 'crop-selection');
    for (const x of [adapted, basic]) advanceField(x.f, x.cell, x.w, x.s, 1, 8, 3, 0);
    expect(adapted.f.crop).toBe('dryland'); expect(basic.f.crop).toBe('cereal');
    learn(adapted.s, 'seasonal-observation');
    adapted.w.temperature = 0.4; basic.w.temperature = 0.4;
    for (const x of [adapted, basic]) advanceField(x.f, x.cell, x.w, x.s, 2, 8, 3, 0);
    expect(adapted.f.stage).toBe('prepared'); expect(basic.f.stage).toBe('sown');
  });
  it('requires deployed irrigation and safe field work before delivering water', () => {
    const x = fixture(); x.cell.moisture = 0.05; x.f.soilMoisture = 0.05;
    advanceField(x.f, x.cell, x.w, x.s, 1, 8, 3, 0.4);
    expect(x.f.irrigationReceived).toBe(0);
    learn(x.s, 'irrigation');
    advanceField(x.f, x.cell, x.w, x.s, 2, 8, 3, 0.4);
    expect(x.f.irrigationReceived).toBeGreaterThan(0);
    x.w.snowpack = 0.3;
    advanceField(x.f, x.cell, x.w, x.s, 3, 8, 3, 0.4);
    expect(x.f.irrigationReceived).toBe(0);
  });
  it('establishes basic plots progressively and keeps first-five-year food accounting finite', () => {
    const sim = new Simulation({ seed: 'lineage-test', startingPopulation: 240 });
    sim.step();
    expect(sim.state.settlements.every(s => (s.fields?.length ?? 0) === 0)).toBe(true);
    sim.step(59);
    expect(sim.state.settlements.some(s => (s.fields?.length ?? 0) > 0)).toBe(true);
    expect(sim.population).toBeGreaterThan(200);
    for (const s of sim.state.settlements) {
      expect(Number.isFinite(s.resources.food)).toBe(true);
      expect(s.agriculture?.production).toBe(s.fields!.reduce((sum, f) => sum + f.production, 0));
      expect(s.agriculture?.labour).toBe(s.fields!.reduce((sum, f) => sum + f.labour, 0));
    }
  }, 15000);
  it('aggregates only current field harvests, supports zero labour, and does not harvest twice', () => {
    const x = grow(false);
    const summary = summarizeAgriculture(x.s, x.f.evaluatedMonth, 8);
    expect(summary.production).toBe(x.f.production);
    const before = structuredClone(x.f);
    advanceField(x.f, x.cell, x.w, x.s, x.f.evaluatedMonth, 8, 3, 0);
    expect(x.f).toEqual(before);
    const other = structuredClone(x.f); other.id = 'other'; other.production = 7; x.s.fields!.push(other);
    x.f.labour = 0; other.labour = 0;
    expect(summarizeAgriculture(x.s, x.f.evaluatedMonth, 0)).toMatchObject({ production: x.f.production + 7, yieldPerWorker: 0 });
    expect(summarizeAgriculture(x.s, 99, 8).production).toBe(0);
  });
  it('has no production from unbuilt or absent fields and keeps obsolete field histories', () => {
    const x = fixture(); x.s.fields = undefined; x.s.structurePlots = [];
    ensureFields(x.state, x.s); advanceAgriculture(x.state, x.s, 12);
    expect(x.s.fields).toEqual([]); expect(x.s.agriculture!.production).toBe(0);
    expect(farmGeometries(x.s)).toEqual([]);
    x.f.evaluatedMonth = -1; x.s.fields = [x.f];
    advanceAgriculture(x.state, x.s, 12);
    expect(x.s.fields[0]!.labour).toBe(0);
  });
  it('shares one water-service budget deterministically across physical plots', () => {
    const x = fixture(); learn(x.s, 'irrigation');
    x.cell.moisture = 0.05; x.f.soilMoisture = 0.05;
    const other = structuredClone(x.f); other.id = 'test-field-2';
    x.s.fields!.push(other);
    x.s.structurePlots = x.s.fields!.map((f, i) => ({ id: f.id, worldX: x.s.position.x + i * 3,
      worldZ: x.s.position.z, width: 3, depth: 2, height: 0.1, radius: 2, condition: 1, foundedMonth: 0,
      development: { form: 'field', status: 'active' } as NonNullable<typeof x.s.structurePlots>[number]['development'] }));
    x.s.development!.water = { ...x.s.development!.water!, irrigation: 1, reliability: 1 };
    const reversed = structuredClone(x.state); reversed.settlements[0]!.fields!.reverse();
    advanceAgriculture(x.state, x.s, 20);
    advanceAgriculture(reversed, reversed.settlements[0]!, 20);
    expect(x.s.fields!.reduce((sum, f) => sum + f.irrigationReceived, 0)).toBeLessThanOrEqual(0.32 + 1e-8);
    expect(x.s.fields!.map(f => f.irrigationReceived)).toEqual(reversed.settlements[0]!.fields!.reverse().map(f => f.irrigationReceived));
    expect(x.s.fields![0]!.soilMoisture).toBeGreaterThan(x.s.fields![1]!.soilMoisture);
  });
  it('does not apply a second water yield multiplier to field harvests', () => {
    const x = fixture();
    x.s.resources.food = 400;
    const food = x.s.resources.food, balance = x.s.monthlyBalance.food;
    advanceSettlementWater(x.state, x.s, []);
    expect(x.s.resources.food).toBe(food); expect(x.s.monthlyBalance.food).toBe(balance);
  });
  it('renders authoritative crop stages independent of the calendar without mutating simulation', () => {
    const x = fixture(); x.f.labour = 8;
    x.s.structurePlots = [{ id: x.f.id, worldX: x.s.position.x, worldZ: x.s.position.z, width: 3, depth: 2, height: 0.1,
      radius: 2, condition: 1, foundedMonth: 0, development: { form: 'field', status: 'active' } as NonNullable<typeof x.s.structurePlots>[number]['development'] }];
    const before = structuredClone(x.state);
    const renderer = new FarmFieldRenderer(); renderer.update(x.state, () => 0.5, () => true);
    expect(x.state).toEqual(before);
    expect(renderer.renderedFields.get(x.f.id)!.state.stage).toBe('growing');
    expect(farmPresentationState(x.s, 11, x.w, x.f.id).stage).toBe('growing');
    expect(farmPresentationState(x.s, 5, x.w, x.f.id).stage).toBe('growing');
    expect(renderer.group.getObjectByName('Farm crop stalks')).toBeDefined();
  });
  it('assigns farmers to specific fields and permits harvesting only mature available stock', () => {
    const x = fixture(); x.f.labour = 8;
    x.s.structurePlots = [{ id: x.f.id, worldX: x.s.position.x, worldZ: x.s.position.z, width: 3, depth: 2, height: 0.1,
      radius: 2, condition: 1, foundedMonth: 0, development: { form: 'field', status: 'active' } as NonNullable<typeof x.s.structurePlots>[number]['development'] }];
    const p = x.state.people[0]!; p.occupation = 'farmer'; p.role = 'farmer'; p.activity = 'farm'; p.alive = true; p.health = 1;
    p.navigation = { ...p.navigation!, traveling: false, schedulePhase: 'work', destinationKind: 'field', destinationId: x.f.id };
    const geometry = farmerField(x.s, p.id)!;
    let visual = farmPresentationState(x.s, 0, x.w, x.f.id);
    expect(fieldHarvestable(x.f)).toBe(false);
    expect(sampleFarmAction(p, geometry, visual, 2, createResourceWorkMotion()).actionKind).toBe('farm-tend');
    x.f.stage = 'mature'; x.f.harvestRemaining = 12; x.f.action = 'harvest';
    visual = farmPresentationState(x.s, 0, x.w, x.f.id);
    expect(farmerCanPresent(p, geometry, visual, x.w)).toBe(true);
    expect(sampleFarmAction(p, geometry, visual, 2, createResourceWorkMotion()).actionKind).toBe('farm-harvest');
    x.f.harvestRemaining = 0;
    expect(farmPresentationState(x.s, 0, x.w, x.f.id).harvestable).toBe(false);
    p.navigation.destinationId = 'different-field';
    expect(farmerCanPresent(p, geometry, visual, x.w)).toBe(false);
  });
  it('is deterministic across repeated seeded multi-year simulations and serializable mid-cycle', () => {
    const run = () => { const x = fixture(); x.sim.step(36); expect(x.sim.state.month).toBe(36); return x.sim.state; };
    expect(run()).toEqual(run());
    const x = fixture(), restored = JSON.parse(JSON.stringify(x.f)) as typeof x.f;
    const cell = structuredClone(x.cell), s = structuredClone(x.s);
    advanceField(x.f, x.cell, x.w, x.s, 1, 8, 3, 0);
    advanceField(restored, cell, x.w, s, 1, 8, 3, 0);
    expect(restored).toEqual(x.f);
  });
});
