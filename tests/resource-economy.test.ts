import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { societyFixture, learn, residents, connect, sponsor } from './fixtures/settlementDevelopment';
import { Simulation } from '../src/sim/Simulation';
import { SeededRandom } from '../src/sim/prng';
import { ResourceSystem, extractableQuantity } from '../src/sim/resources/ResourceSystem';
import { addMaterial, materialEconomy, publishBulkStocks, reconcileBulkStocks, storageCapacity, storedVolume, takeMaterial } from '../src/sim/resources/Inventory';
import { processRecipes, recipeRequirementsMet } from '../src/sim/resources/Processing';
import { MATERIAL_BY_ID, RECIPE_CATALOG, RECIPE_BY_ID } from '../src/sim/resources/catalog';
import { advanceDeposits, harvestSeason } from '../src/sim/resources/WorldResourceSystem';
import { TransportationSystem } from '../src/sim/transport/TransportationSystem';
import { deriveMilitaryProfile } from '../src/sim/war/MilitaryCapability';
import { KnowledgeSystem } from '../src/sim/knowledge/KnowledgeSystem';
import { configWith } from '../src/config';
import { advanceSettlementDevelopment, developmentContext, responseForNeed } from '../src/sim/development/SettlementDevelopmentSystem';
import { ResourceSiteRenderer } from '../src/render/resources/ResourceSiteRenderer';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { pointKey } from '../src/sim/transport/TerrainTraversal';
import type { ResourceDeposit, Settlement, SimulationState } from '../src/sim/types';

function fixture() {
  const { state, sim, settlements } = societyFixture();
  const s = settlements[0]!;
  state.world.resourceDeposits = [];
  for (const town of settlements) {
    town.alive = town === s; town.materials = {}; town.materialEconomy = undefined;
    town.discoveredDeposits = []; town.workedDeposits = []; town.knownRecipes = [];
    publishBulkStocks(town);
  }
  for (const cell of state.world.cells) { cell.forestCapacity = 0.8; cell.wood = 0.8; cell.temperature = 0.5; }
  for (const weather of state.weather.cells) { weather.snowpack = 0; weather.blizzard = 0; weather.cropDamage = 0; }
  return { state, sim, s, other: settlements[1]!, system: new ResourceSystem(new SeededRandom('resource-acceptance')) };
}
function site(state: SimulationState, s: Settlement, resourceId: string, overrides: Partial<ResourceDeposit> = {}) {
  const d: ResourceDeposit = { id: `test:${resourceId}:${state.world.resourceDeposits.length}`, resourceId, cellIndex: s.cellIndex,
    worldX: s.position.x, worldZ: s.position.z, quality: 0.9, capacity: 300, abundance: 1, surfaceShare: 1,
    renewable: resourceId === 'timber' || resourceId === 'wild-herbs', depleted: false, overharvested: false,
    discoveredBy: { [s.id]: 0 }, ...overrides };
  state.world.resourceDeposits.push(d); s.discoveredDeposits.push(d.id); return d;
}

describe('Material lifecycle and accounting', () => {
  it('does not grant inventory for nearby undiscovered deposits or absent labour', () => {
    const { state, s, system } = fixture();
    site(state, s, 'stone'); s.discoveredDeposits = [];
    residents(state, s).forEach(p => { p.occupation = 'farmer'; });
    for (let month = 1; month <= 24; month++) { state.month = month; system.advanceMonth(state); }
    expect(s.materials.stone).toBe(0); expect(s.discoveredDeposits).toEqual([]);
  });
  it('deducts extraction before transport and conserves finite ore across all settlers', () => {
    const { state, s, other, system } = fixture();
    other.alive = true; other.position = { ...s.position }; other.cellIndex = s.cellIndex;
    // This test isolates extraction from stone processing.
    s.knowledge.records = {}; other.knowledge.records = {};
    const d = site(state, s, 'stone', { capacity: 3 }); other.discoveredDeposits.push(d.id);
    state.month = 4; system.advanceMonth(state);
    expect(s.materials.stone).toBe(0);
    expect(materialEconomy(s).inTransit.length).toBeGreaterThan(0);
    state.month++; const events = system.advanceMonth(state);
    const total = [s, other].reduce((n, town) => n + (town.materials.stone ?? 0) + materialEconomy(town).inTransit.reduce((m, cargo) => m + cargo.quantity, 0), 0);
    expect(total + d.abundance * d.capacity).toBeCloseTo(3, 8);
    expect(d.depleted).toBe(true); expect(events.some(e => e.type === 'resource-site-abandoned') || d.abandonedMonth !== undefined).toBe(true);
  });
  it('blocks unrecognized ore, then deeper reserves until extraction capability exists', () => {
    const { state, s } = fixture();
    const d = site(state, s, 'iron-ore', { surfaceShare: 0.25 });
    expect(extractableQuantity(s, d)).toBe(0);
    learn(s, 'material-testing'); expect(extractableQuantity(s, d)).toBeCloseTo(75);
    d.abundance = 0.75; expect(extractableQuantity(s, d)).toBe(0);
    learn(s, 'iron-working'); s.infrastructure.workshops = 0.3;
    expect(extractableQuantity(s, d)).toBeGreaterThan(0);
    d.abundance = 0; d.depleted = true; expect(extractableQuantity(s, d)).toBe(0);
  });
  it('enforces foreign site control and rejects water at the resource destination', () => {
    const { state, s, other, system } = fixture(); other.alive = true;
    const d = site(state, s, 'stone', { controlledBy: other.id, lastWorkedMonth: 0 });
    state.month = 4; system.advanceMonth(state); expect(d.abundance).toBe(1);
    d.controlledBy = undefined; state.world.cells[d.cellIndex]!.water = true;
    state.month++; system.advanceMonth(state); expect(d.abundance).toBe(1);
  });
  it('bounds storage, preserves quality and charges legacy construction exactly once', () => {
    const { s } = fixture();
    expect(addMaterial(s, 'timber', 10, 0.2)).toBe(10);
    addMaterial(s, 'timber', 10, 0.8); expect(materialEconomy(s).quality.timber).toBeCloseTo(0.5);
    s.resources.wood -= 7; reconcileBulkStocks(s); reconcileBulkStocks(s);
    expect(s.materials.timber).toBe(13); expect(takeMaterial(s, 'timber', 100)).toBe(13);
    expect(s.resources.wood).toBe(0);
    addMaterial(s, 'stone', 100000); expect(storedVolume(s)).toBeCloseTo(storageCapacity(s));
    expect(addMaterial(s, 'iron-ore', 10)).toBe(0);
  });
  it('does not extract into a full store or multiply regeneration with settlement count', () => {
    const { state, s, system } = fixture(); const d = site(state, s, 'stone');
    addMaterial(s, 'slag', storageCapacity(s));
    state.month = 4; system.advanceMonth(state); expect(d.abundance).toBe(1);
    const herb = site(state, s, 'wild-herbs', { abundance: 0.3, discoveredBy: {} });
    s.discoveredDeposits = []; residents(state, s).forEach(p => { p.occupation = 'farmer'; });
    const copy = structuredClone(state.world); advanceDeposits(copy, 5);
    state.month = 5; system.advanceMonth(state);
    expect(herb.abundance).toBeCloseTo(copy.resourceDeposits.at(-1)!.abundance);
  });
});

describe('Ecology and research', () => {
  it('uses season, snow and ecological health for herbs', () => {
    const { state, s } = fixture(); const d = site(state, s, 'wild-herbs');
    expect(harvestSeason(state.world, d, 5)).toBeGreaterThan(harvestSeason(state.world, d, 11));
    state.weather.cells[d.cellIndex]!.snowpack = 1; expect(harvestSeason(state.world, d, 5)).toBe(0);
    d.abundance = 0.2; advanceDeposits(state.world, 5); expect(d.abundance).toBe(0.2);
  });
  it('logging changes standing woodland and uses existing slow forest recovery', () => {
    const { state, s, system } = fixture(); const d = site(state, s, 'timber', { capacity: 20 });
    state.month = 4; system.advanceMonth(state);
    const cell = state.world.cells[d.cellIndex]!;
    expect(cell.wood).toBeLessThan(0.8); expect(cell.lastLoggingMonth).toBe(4);
    const depleted = d.abundance;
    // WeatherSystem owns this slow stock recovery; ResourceSystem only observes it.
    cell.wood += (cell.forestCapacity! - cell.wood) * 0.002;
    advanceDeposits(state.world, 5); expect(d.abundance).toBeGreaterThan(depleted);
    expect(d.abundance - depleted).toBeLessThanOrEqual(0.002);
  });
  it('regenerates an undiscovered herb stand with no settlement or harvesting', () => {
    const { state, s, system } = fixture(); const d = site(state, s, 'wild-herbs', { abundance: 0.3, discoveredBy: {} });
    s.alive = false;
    for (let month = 1; month <= 12; month++) { state.month = month; system.advanceMonth(state); }
    expect(d.abundance).toBeGreaterThan(0.3);
  });
  it('requires physical ore samples for metallurgy discovery regardless of elapsed years', () => {
    const { state, s } = fixture();
    learn(s, 'combustion-dynamics', 'material-testing'); addMaterial(s, 'timber', 30);
    const knowledge = new KnowledgeSystem(configWith({ seed: 'sample-gates' }), new SeededRandom('sample-gates'));
    state.month = 100000;
    expect(knowledge.canDiscover(state, s, 'metal-smelting')).toBe(false);
    addMaterial(s, 'copper-ore', 3); expect(knowledge.canDiscover(state, s, 'metal-smelting')).toBe(true);
  });
});

describe('Blueprints, production and consequences', () => {
  it('supports institution and industry requirements for later specialized recipes', () => {
    const { state, s } = fixture(); learn(s, 'metal-smelting'); s.infrastructure.workshops = 0.8;
    const blueprint = { ...RECIPE_BY_ID.get('bronze-ingot')!, minIndustrialIntensity: 0.8, requiredInstitutions: ['knowledge-keepers' as const] };
    expect(recipeRequirementsMet(s, blueprint, state)).toBe(false);
    s.industry.intensity = 0.9; expect(recipeRequirementsMet(s, blueprint, state)).toBe(false);
    sponsor(state, s, 'knowledge-keepers'); expect(recipeRequirementsMet(s, blueprint, state)).toBe(true);
    expect(recipeRequirementsMet(s, blueprint)).toBe(false);
  });
  it('catalogues every recipe input, output, byproduct and fuel', () => {
    for (const recipe of RECIPE_CATALOG) {
      for (const id of [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs), ...Object.keys(recipe.byproducts ?? {}), ...(recipe.energy ? [recipe.energy.fuel] : [])]) expect(MATERIAL_BY_ID.has(id)).toBe(true);
    }
  });
  it.each(['knowledge', 'tin', 'fuel', 'workshop', 'labour'])('cannot cast bronze without %s', missing => {
    const { state, s } = fixture(); learn(s, 'metal-smelting'); s.infrastructure.workshops = 0.2;
    for (const [id, n] of Object.entries({ 'copper-ore': 20, 'tin-ore': 8, charcoal: 12 })) addMaterial(s, id, n);
    if (missing === 'knowledge') delete s.knowledge.records['metal-smelting'];
    if (missing === 'tin') takeMaterial(s, 'tin-ore', 100);
    if (missing === 'fuel') takeMaterial(s, 'charcoal', 100);
    if (missing === 'workshop') s.infrastructure.workshops = 0;
    for (let month = 1; month <= 12; month++) { state.month = month; processRecipes(state, s, { artisan: missing === 'labour' ? 0 : 4 }, new SeededRandom(`missing:${month}`)); }
    expect(s.materials.bronze ?? 0).toBe(0); expect(s.knownRecipes).not.toContain('bronze-ingot');
  });
  it('rejects insufficient fuel heat even with knowledge and infrastructure', () => {
    const { s } = fixture(); learn(s, 'metal-smelting'); s.infrastructure.workshops = 1;
    const recipe = RECIPE_BY_ID.get('bronze-ingot')!;
    expect(recipeRequirementsMet(s, recipe)).toBe(true);
    expect(recipeRequirementsMet(s, { ...recipe, energy: { ...recipe.energy!, minimumHeat: 0.99 } })).toBe(false);
  });
  it('does not reuse the same artisan budget across bronze and iron production', () => {
    const { state, s } = fixture(); learn(s, 'metal-smelting', 'iron-working'); s.infrastructure.workshops = 0.2;
    for (const [id, n] of Object.entries({ 'copper-ore': 20, 'tin-ore': 8, 'iron-ore': 20, charcoal: 30 })) addMaterial(s, id, n);
    const budget = { artisan: 1.2 };
    processRecipes(state, s, budget, new SeededRandom('shared-workers'));
    expect(materialEconomy(s).labourUsed).toBeLessThanOrEqual(1.2);
    expect(budget.artisan).toBeGreaterThanOrEqual(0);
    expect((s.materials['copper-ore']! < 20 ? 1 : 0) + (s.materials['iron-ore']! < 20 ? 1 : 0)).toBe(1);
  });
  it('keeps learned blueprints dormant when their practical knowledge is lost', () => {
    const { state, s } = fixture(); learn(s, 'metal-smelting'); s.infrastructure.workshops = 0.2;
    s.knownRecipes.push('bronze-ingot'); s.knowledge.records['metal-smelting']!.dormant = true;
    for (const [id, n] of Object.entries({ 'copper-ore': 20, 'tin-ore': 8, charcoal: 12 })) addMaterial(s, id, n);
    processRecipes(state, s, { artisan: 4 }, new SeededRandom('dormant'));
    expect(s.materials.bronze ?? 0).toBe(0); expect(s.materials['copper-ore']).toBe(20);
  });
  it('completes discovery through medicine use without seeded inventories', () => {
    const { state, s, system } = fixture(); const d = site(state, s, 'wild-herbs');
    s.discoveredDeposits = []; d.discoveredBy = {}; learn(s, 'anatomical-observation');
    residents(state, s).forEach(p => { p.health = 0.5; });
    const events = [];
    for (let month = 1; month <= 240; month++) { state.month = month; events.push(...system.advanceMonth(state)); }
    expect(events.map(e => e.type)).toEqual(expect.arrayContaining(['resource-deposit-discovered', 'resource-site-established', 'recipe-learned']));
    expect(s.knownRecipes).toContain('herbal-remedy'); expect(residents(state, s)[0]!.health).toBeGreaterThan(0.5);
    expect(materialEconomy(s).experience['wild-herbs']).toBeGreaterThan(0);
  });
  it('turns physical timber, copper, tin and iron into learned metallurgy and useful equipment', () => {
    const { state, s, system } = fixture();
    learn(s, 'material-testing', 'metal-smelting', 'iron-working'); s.infrastructure.workshops = 0.3;
    for (const id of ['timber', 'copper-ore', 'tin-ore', 'iron-ore']) site(state, s, id);
    const events = [];
    for (let month = 1; month <= 240; month++) { state.month = month; events.push(...system.advanceMonth(state)); }
    expect(s.knownRecipes).toEqual(expect.arrayContaining(['charcoal', 'bronze-ingot', 'iron-tools']));
    expect(events.filter(e => e.type === 'recipe-learned' && e.context?.recipe === 'bronze-ingot')).toHaveLength(1);
    expect(materialEconomy(s).tools).toBeGreaterThan(0); expect(materialEconomy(s).arms).toBeGreaterThan(0);
    expect(state.world.cells[s.cellIndex]!.wood).toBeLessThan(0.8);
  });
  it('requires equipped weapons, and consumes metal into tools rather than creating wealth', () => {
    const { state, s, system } = fixture(); learn(s, 'iron-working'); s.infrastructure.workshops = 0.5;
    expect(deriveMilitaryProfile(s).equipment).not.toContain('metal-weapons');
    addMaterial(s, 'iron-tools', 10); const wealth = s.resources.wealth;
    for (let month = 1; month <= 8; month++) { state.month = month; system.advanceMonth(state); }
    expect(materialEconomy(s).tools).toBeGreaterThan(0); expect(s.materials['iron-tools']).toBeLessThan(10);
    expect(s.resources.wealth).toBe(wealth);
    const arms = materialEconomy(s).arms; materialEconomy(s).arms = 10;
    expect(deriveMilitaryProfile(s).equipment).toContain('metal-weapons'); materialEconomy(s).arms = arms;
  });
  it('selects timber buildings only after learning framing and pays the actual frames', () => {
    const { state, s } = fixture(); addMaterial(s, 'timber', 40); addMaterial(s, 'stone', 12);
    expect(responseForNeed(developmentContext(state, s), 'housing')!.material).toBe('earth');
    s.knownRecipes.push('timber-framing'); addMaterial(s, 'timber-frame', 10);
    expect(responseForNeed(developmentContext(state, s), 'housing')!.material).toBe('timber');
    const initial = s.materials['timber-frame']!;
    // Housing demand exceeds the four founding shelters.
    state.people.forEach(p => { p.homeId = s.id; });
    for (let month = 12; month <= 48; month++) { state.month = month; advanceSettlementDevelopment(state, s, residents(state, s), 0.1); }
    expect(s.materials['timber-frame']).toBeLessThan(initial);
    expect(s.structurePlots?.some(p => p.development?.material === 'timber')).toBe(true);
  });
});

describe('Trade, rendering and replay', () => {
  it('ships missing ore through existing freight with no duplication or delivery before arrival', () => {
    const { state, s, other } = fixture(); other.alive = true;
    connect(state, s, other); const route = state.tradeRoutes[0]!; route.transport!.nextDispatchMonth = 0;
    const segment = state.transportation.segments['fixture-road']!;
    segment.from = pointKey(segment.points[0]!); segment.to = pointKey(segment.points.at(-1)!);
    addMaterial(s, 'tin-ore', 30); materialEconomy(s).demand['tin-ore'] = 3; materialEconomy(other).demand['tin-ore'] = 10;
    const transport = new TransportationSystem(state);
    transport.advanceFreight(route, s, other);
    const trip = route.transport!.trip!; expect(trip.materialId).toBe('tin-ore');
    expect(other.materials['tin-ore'] ?? 0).toBe(0); expect(s.materials['tin-ore']! + trip.quantity).toBeCloseTo(30);
    route.active = false; state.month++; transport.advanceFreight(route, s, other); expect(trip.status).toBe('blocked');
    route.active = true;
    for (let month = 2; month < 100 && trip.status !== 'arrived'; month++) { state.month = month; transport.advanceFreight(route, s, other); }
    expect(trip.status).toBe('arrived'); expect(other.materials['tin-ore']).toBeCloseTo(trip.quantity * 0.96);
    const delivered = other.materials['tin-ore']; transport.advanceFreight(route, s, other); expect(other.materials['tin-ore']).toBe(delivered);
  });
  it('renders worked and abandoned deposits without mutating simulation state', () => {
    const { state, s } = fixture(); const d = site(state, s, 'stone');
    const renderer = new ResourceSiteRenderer(state.world, new TerrainSurface(state.world));
    renderer.update(); const mesh = renderer.group.children[0] as THREE.InstancedMesh; expect(mesh.count).toBe(0);
    d.establishedMonth = 2; d.abandonedMonth = 4; const before = JSON.stringify(state.world);
    renderer.update(); expect(mesh.count).toBe(1); expect(JSON.stringify(state.world)).toBe(before);
    mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose();
  });
  it('replays complete material state and histories for a fixed seed and resets on restart', () => {
    const run = (seed: string) => {
      const sim = new Simulation({ seed, startingPopulation: 80, settlementCount: [2, 2], world: { size: 20 } }); sim.step(48);
      return { sim, snapshot: JSON.stringify({ deposits: sim.state.world.resourceDeposits, settlements: sim.state.settlements.map(s => [s.materials, s.materialEconomy, s.knownRecipes]), events: sim.state.history.filter(e => e.tags.includes('resource')) }) };
    };
    const first = run('material-replay'); expect(first.snapshot).toBe(run('material-replay').snapshot);
    expect(first.snapshot).not.toBe(run('material-other').snapshot);
    first.sim.restart(); first.sim.step(48);
    expect(JSON.stringify({ deposits: first.sim.state.world.resourceDeposits, settlements: first.sim.state.settlements.map(s => [s.materials, s.materialEconomy, s.knownRecipes]), events: first.sim.state.history.filter(e => e.tags.includes('resource')) })).toBe(first.snapshot);
  });
});
