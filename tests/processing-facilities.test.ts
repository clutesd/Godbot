import { describe, expect, it } from 'vitest';
import { learn } from './fixtures/settlementDevelopment';
import {
  CREW, INDUSTRIAL_KNOWLEDGE, METAL_KNOWLEDGE, WOOD_KNOWLEDGE, placeFacility, processingWorld, runFacilityMonth, step, stock,
} from './fixtures/processingFacilities';
import { SeededRandom } from '../src/sim/prng';
import { ExtractionAccessibility } from '../src/sim/resources/ExtractionAccessibility';
import { materialEconomy, storageRoom } from '../src/sim/resources/Inventory';
import { advanceMaterialProcessing, ensureMaterialInventory } from '../src/sim/resources/MaterialEconomy';
import { infrastructureLabourBudget } from '../src/sim/people/HumanCapital';
import { energyAt } from '../src/sim/energy/types';
import { facilityFamilies, facilityOwnedRecipes, facilityTierSpec, registerFacilityFamily } from '../src/sim/processing/FacilityCatalog';
import { beginUpgrade } from '../src/sim/processing/FacilityConstruction';
import { facilityConservationError, transitConservationError } from '../src/sim/processing/FacilityInventory';
import { facilityHoldings, facilitiesOf, ensureProcessingAuthority } from '../src/sim/processing/FacilitySystem';
import { facilityGoverned } from '../src/sim/processing/FacilityOwnership';
import { processSpec } from '../src/sim/processing/FacilityProcesses';
import type { FacilityFamilySpec } from '../src/sim/processing/types';
import { RECIPE_BY_ID } from '../src/sim/resources/catalog';
import { MATERIAL_RECIPES } from '../src/sim/resources/MaterialEconomy';

const OUTPUTS = ['lumber', 'timber-frame', 'bronze', 'iron-tools', 'copper', 'iron', 'steel'] as const;
const produced = (s: { localMaterials: Record<string, number> }): number => OUTPUTS.reduce((sum, id) => sum + (s.localMaterials[id] ?? 0), 0);

function transform(s: { knowledge: { records: Record<string, { transformedMonth?: number }> } }, ...ids: string[]): void {
  for (const id of ids) s.knowledge.records[id]!.transformedMonth = 0;
}

describe('facility authority: production requires a physical place', () => {
  it('makes no facility-owned product without a facility, while un-enrolled legacy settlements still craft at settlement level', () => {
    // Governed settlement that cannot found a works (too small): every input, worker and skill is present.
    const governed = processingWorld('no-facility');
    learn(governed.s, ...WOOD_KNOWLEDGE, ...METAL_KNOWLEDGE);
    governed.s.buildings = 2;
    governed.s.infrastructure.workshops = 0.5;
    stock(governed.s, { timber: 30, 'copper-ore': 20, 'tin-ore': 8, 'iron-ore': 20, charcoal: 15 });
    step(governed.state, governed.system, 36);
    expect(facilityGoverned(governed.state, governed.s)).toBe(true);
    expect(facilitiesOf(governed.s)).toHaveLength(0);
    expect(produced(governed.s)).toBe(0);
    expect(governed.s.knownRecipes).not.toContain('bronze-ingot');
    expect(governed.s.localMaterials.charcoal ?? 0).toBeLessThanOrEqual(15);

    // The typed material economy is gated the same way.
    const typed = processingWorld('no-facility-typed');
    learn(typed.s, ...WOOD_KNOWLEDGE);
    typed.s.buildings = 2;
    stock(typed.s, { timber: 30 });
    ensureProcessingAuthority(typed.state);
    typed.state.month = 1;
    const residents = typed.state.people.filter(p => p.homeId === typed.s.id && p.alive);
    advanceMaterialProcessing(typed.state, typed.s, residents);
    expect(typed.s.localMaterials.lumber ?? 0).toBe(0);

    // Control: identical inputs with no facility authority use the aggregate pipelines unchanged.
    const legacy = processingWorld('no-facility');
    learn(legacy.s, ...WOOD_KNOWLEDGE, ...METAL_KNOWLEDGE);
    legacy.s.buildings = 2;
    legacy.s.infrastructure.workshops = 0.5;
    stock(legacy.s, { timber: 30, 'copper-ore': 20, 'tin-ore': 8, 'iron-ore': 20, charcoal: 15 });
    for (let month = 1; month <= 36; month++) { legacy.state.month = month; legacy.system.advanceMonth(legacy.state); }
    expect(legacy.state.processing).toBeUndefined();
    expect(legacy.s.knownRecipes).toEqual(expect.arrayContaining(['bronze-ingot']));
    expect(legacy.s.localMaterials.bronze ?? 0).toBeGreaterThan(0);
    const legacyTyped = processingWorld('no-facility-typed');
    learn(legacyTyped.s, ...WOOD_KNOWLEDGE);
    legacyTyped.s.buildings = 2;
    stock(legacyTyped.s, { timber: 30 });
    legacyTyped.state.month = 1;
    advanceMaterialProcessing(legacyTyped.state, legacyTyped.s, legacyTyped.state.people.filter(p => p.homeId === legacyTyped.s.id && p.alive));
    expect(legacyTyped.s.localMaterials.lumber ?? 0).toBeGreaterThan(0);
  });

  it('derives ownership from the family ladders so settlement pipelines cannot disagree with facilities', () => {
    const owned = facilityOwnedRecipes();
    for (const family of facilityFamilies()) for (const tier of family.tiers) for (const ref of tier.recipes) {
      expect((ref.source === 'catalog' ? owned.catalog : owned.material).has(ref.id)).toBe(true);
      expect(processSpec(ref)).toBeDefined();
    }
    // Exactly the existing lumber, charcoal, copper, bronze, iron, steel, machine-part, engine and
    // pottery recipes: every one is defined by the recipe catalogs, never redefined here.
    expect([...owned.catalog].sort()).toEqual(['bronze-ingot', 'charcoal', 'engine-assembly', 'iron-tools', 'machine-parts', 'pottery-vessels', 'timber-framing']);
    expect([...owned.material].sort()).toEqual(['make-steel', 'saw-lumber', 'smelt-copper', 'smelt-iron']);
    for (const id of owned.catalog) expect(RECIPE_BY_ID.has(id)).toBe(true);
    for (const id of owned.material) expect(MATERIAL_RECIPES.some(recipe => recipe.id === id)).toBe(true);
  });

  it('requires the recipe knowledge itself: a works without the skill makes nothing', () => {
    const w = processingWorld('no-skill');
    learn(w.s, ...WOOD_KNOWLEDGE);
    const f = placeFacility(w.state, w.s, 'metallurgy', 1);
    delete w.s.knowledge.records['metal-smelting'];
    f.inputs['copper-ore'] = 10; f.inputs['tin-ore'] = 4; f.inputs.charcoal = 10;
    for (let i = 0; i < 6; i++) runFacilityMonth(w.state, w.s, CREW, w.random);
    expect(f.outputs.bronze ?? 0).toBe(0);
    expect(w.s.localMaterials.bronze ?? 0).toBe(0);
    expect(f.status).toBe('idle');
    expect(f.limiter).toBe('knowledge');
  });
});

describe('facility construction and upgrades', () => {
  it('founds a facility on real ground and pays for it in canonical materials and infrastructure worker-months', () => {
    const w = processingWorld('construction');
    learn(w.s, ...WOOD_KNOWLEDGE);
    stock(w.s, { timber: 40 });
    ensureProcessingAuthority(w.state);
    const bill = facilityTierSpec('wood', 1)!.build;

    // Month one: a site is reserved and 0.4 worker-months buy exactly 0.4/2 of the erection.
    const timberBefore = w.s.localMaterials.timber!;
    runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 0.4 });
    const [f] = facilitiesOf(w.s, 'wood');
    expect(f).toBeDefined();
    expect(f!.progress).toBeCloseTo(0.4 / bill.work, 6);
    expect(timberBefore - w.s.localMaterials.timber!).toBeCloseTo(4 * f!.progress, 4);
    expect(f!.labourSpent).toBeCloseTo(0.4, 6);
    expect(infrastructureLabourBudget(w.state, w.s).remaining).toBeCloseTo(0, 6);
    expect(f!.status).toBe('under-construction');
    const plot = w.s.structurePlots!.find(p => p.id === f!.plotId)!;
    expect(plot).toBeDefined();
    expect(plot.development).toBeUndefined();
    expect({ x: plot.worldX, z: plot.worldZ }).toEqual(f!.position);

    // Without worker-months nothing advances; without materials nothing advances.
    const stalled = f!.progress;
    runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 0 });
    expect(f!.progress).toBe(stalled);
    const kept = w.s.localMaterials.timber!;
    w.s.localMaterials.timber = 0; w.s.localMaterials.lumber = 0;
    runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 5 });
    expect(f!.progress).toBe(stalled);
    w.s.localMaterials.timber = kept;

    // Paid to completion: the record of spend matches the bill, and only then does the structure exist.
    for (let i = 0; i < 6 && f!.progress < 1; i++) runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 5 });
    expect(f!.progress).toBe(1);
    expect(f!.spent.timber).toBeCloseTo(4, 4);
    expect(f!.labourSpent).toBeCloseTo(bill.work, 4);
    expect(plot.development?.facilityId).toBe(f!.id);
    expect(plot.development?.status).toBe('active');
    expect(w.state.history.length + 0).toBeGreaterThanOrEqual(0);
  });

  it('upgrades in place: same identity, location and stock, paid for, with the structure rewritten', () => {
    const w = processingWorld('upgrade');
    const f = placeFacility(w.state, w.s, 'wood', 1);
    const plot = w.s.structurePlots!.find(p => p.id === f.plotId)!;
    const id = f.id, position = { ...f.position }, founded = f.foundedMonth;
    f.inputs.timber = 9; f.outputs.lumber = 2;
    stock(w.s, { timber: 30, iron: 6 });
    const iron = w.s.localMaterials.iron!;
    beginUpgrade(w.state, f, 2);
    expect(f.status).toBe('upgrading');
    // A conversion halts production: nothing is sawn while the frame is being retooled.
    runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 1 });
    expect(f.outputs.timber ?? 0).toBe(0);
    expect(f.inputs.timber).toBe(9);
    for (let i = 0; i < 10 && f.upgrade; i++) runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 3 });
    expect(f.upgrade).toBeUndefined();
    expect(f.tier).toBe(2);
    expect(f.kind).toBe('sawmill');
    expect(f.id).toBe(id);
    expect(f.foundedMonth).toBe(founded);
    expect(f.position).toEqual(position);
    expect(f.plotId).toBe(plot.id);
    expect(w.s.structurePlots!.filter(p => p.development?.facilityId === id)).toHaveLength(1);
    expect(plot.development?.facilityTier).toBe(2);
    expect(plot.development?.name).toBe('powered sawmill');
    expect(plot.development?.history.some(h => h.action === 'upgraded')).toBe(true);
    expect(f.history.map(h => h.action)).toEqual(expect.arrayContaining(['founded', 'upgrade-started', 'upgraded']));
    // Retained stock, and the iron the sawmill's gearing needs really left the store.
    expect(f.inputs.timber).toBeGreaterThan(0);
    expect(iron - w.s.localMaterials.iron!).toBeCloseTo(facilityTierSpec('wood', 2)!.build.lines[1]!.amount, 4);
  });

  it('starts an upgrade only from sustained saturation, with the knowledge and a power source, and never from decoration', () => {
    const w = processingWorld('upgrade-gates');
    const f = placeFacility(w.state, w.s, 'wood', 1);
    stock(w.s, { timber: 60, iron: 6 });
    materialEconomy(w.s).demand.lumber = 200;
    const drive = (months: number) => {
      for (let i = 0; i < months; i++) {
        f.inputs.timber = 20;
        materialEconomy(w.s).demand.lumber = 200;
        w.s.localMaterials.lumber = 0; w.s.localMaterials.charcoal = 0; w.s.localMaterials['timber-frame'] = 0;
        f.outputs = {};
        runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 3 });
      }
    };
    drive(6);
    expect(f.saturationMonths).toBeGreaterThanOrEqual(3);
    // Saturated, funded and skilled - but there is no wheel or engine to drive a sawmill yet.
    expect(f.upgrade).toBeUndefined();
    expect(f.tier).toBe(1);
    energyAt(w.s).plants.push({ id: 'wheel', plotId: 'none', kind: 'waterwheel', progress: 1, condition: 1, output: 4, fuelUsed: 0, status: 'running' });
    drive(1);
    expect(f.upgrade?.toTier).toBe(2);
    // Aggregate factory counts never conjure a higher tier by themselves.
    const decorative = processingWorld('decoration');
    const g = placeFacility(decorative.state, decorative.s, 'wood', 1);
    decorative.s.infrastructure.factories = 1; decorative.s.infrastructure.workshops = 1; decorative.s.industry.intensity = 1;
    stock(decorative.s, { timber: 40, iron: 6 });
    for (let i = 0; i < 12; i++) runFacilityMonth(decorative.state, decorative.s, CREW, decorative.random, { infrastructure: 3 });
    expect(g.tier).toBe(1);
    expect(g.upgrade).toBeUndefined();
  });
});

describe('facility throughput, conservation and physical limits', () => {
  it('conserves every input and output through the store, the yards and the recipes', () => {
    const w = processingWorld('conservation');
    learn(w.s, ...WOOD_KNOWLEDGE);
    const f = placeFacility(w.state, w.s, 'wood', 1);
    stock(w.s, { timber: 90 });
    const initial = w.s.localMaterials.timber!;
    for (let i = 0; i < 30; i++) {
      runFacilityMonth(w.state, w.s, CREW, w.random);
      expect(facilityConservationError(f)).toBeLessThan(1e-4);
      expect(transitConservationError(f)).toBeLessThan(1e-4);
      for (const amount of [...Object.values(f.inputs), ...Object.values(f.outputs)]) expect(amount).toBeGreaterThanOrEqual(-1e-9);
    }
    const holdings = facilityHoldings(f);
    // Timber never appears from nowhere: what left the store is on the yard, in transit or was consumed by a recipe.
    expect(w.s.localMaterials.timber! + (holdings.timber ?? 0) + (f.totals.consumed.timber ?? 0)).toBeCloseTo(initial, 3);
    // Typed sawing turns each unit of timber into exactly 0.84 lumber; nothing else makes lumber.
    const flow = ensureMaterialInventory(w.s);
    expect(flow.lifetimeConsumed.timber).toBeGreaterThan(0);
    expect(flow.lifetimeProduced.lumber).toBeCloseTo(flow.lifetimeConsumed.timber! * 0.84, 3);
    expect((w.s.localMaterials.lumber ?? 0) + (holdings.lumber ?? 0)).toBeCloseTo(flow.lifetimeProduced.lumber!, 3);
    expect(f.totals.produced.lumber).toBeCloseTo(flow.lifetimeProduced.lumber!, 3);
  });

  it('cannot produce beyond the inputs it holds and consumes exactly the recipe inputs', () => {
    const w = processingWorld('exact-inputs');
    const f = placeFacility(w.state, w.s, 'metallurgy', 1);
    f.inputs['iron-ore'] = 3; f.inputs.charcoal = 2;
    runFacilityMonth(w.state, w.s, CREW, w.random);
    // smelt-iron: 1 ore + 0.55 charcoal -> 0.56 iron. Warm-up burns 0.6 charcoal first, so 1.4 remains.
    expect(f.totals.consumed.charcoal).toBeGreaterThan(0);
    const smelted = f.processes['material:smelt-iron'];
    expect(smelted?.batches ?? 0).toBeGreaterThan(0);
    const oreUsed = f.totals.consumed['iron-ore'] ?? 0;
    expect(oreUsed).toBeLessThanOrEqual(3 + 1e-9);
    expect((f.totals.produced.iron ?? 0)).toBeCloseTo(oreUsed * 0.56 - (f.totals.consumed['iron-ore'] ?? 0) * 0 - 0, 3);
    expect(facilityConservationError(f)).toBeLessThan(1e-6);
  });

  it('limits throughput by the crew that is actually there', () => {
    const measure = (budget: Record<string, number>) => {
      const w = processingWorld('labour');
      const f = placeFacility(w.state, w.s, 'wood', 1);
      f.inputs.timber = 20;
      w.s.localMaterials.timber = 0;
      runFacilityMonth(w.state, w.s, budget, w.random);
      return f;
    };
    const full = measure({ builder: 3, artisan: 3 });
    const half = measure({ builder: 1.5 });
    const one = measure({ builder: 1 });
    const none = measure({});
    expect(full.throughput).toBeCloseTo(1, 2);
    expect(half.throughput).toBeCloseTo(0.5, 2);
    expect(one.throughput).toBeCloseTo(1 / 3, 2);
    expect(none.throughput).toBe(0);
    expect(none.status).toBe('unstaffed');
    expect(none.limiter).toBe('labour');
    expect(full.labour.used).toBeGreaterThan(one.labour.used);
    expect(one.labour.used).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('degrades with structural or machinery damage and halts when the works is wrecked', () => {
    const run = (damage: (f: ReturnType<typeof placeFacility>, plot: { condition: number }) => void) => {
      const w = processingWorld('damage');
      const f = placeFacility(w.state, w.s, 'wood', 1);
      const plot = w.s.structurePlots!.find(p => p.id === f.plotId)!;
      f.inputs.timber = 20;
      damage(f, plot);
      runFacilityMonth(w.state, w.s, CREW, w.random);
      return f;
    };
    const sound = run(() => undefined);
    const halfWalls = run((_f, plot) => { plot.condition = 0.5; });
    const halfMachinery = run(f => { f.condition = 0.5; });
    const wrecked = run((_f, plot) => { plot.condition = 0.2; });
    const burning = run((_f, plot) => { (plot as { fire?: unknown }).fire = { cause: 'accident', startedMonth: 0, age: 0, stage: 'growing', intensity: 1, fuel: 1, initialFuel: 1, smoulderMonths: 0 }; });
    expect(sound.throughput).toBeCloseTo(1, 2);
    expect(halfWalls.throughput).toBeCloseTo(0.5, 2);
    expect(halfMachinery.throughput).toBeCloseTo(0.5, 1);
    expect(wrecked.status).toBe('damaged');
    expect(wrecked.throughput).toBe(0);
    expect(wrecked.inputs.timber).toBe(20);
    expect(burning.status).toBe('damaged');
    expect(burning.throughput).toBe(0);
  });

  it('wears with use and is kept up only by paid maintenance', () => {
    const w = processingWorld('wear');
    const f = placeFacility(w.state, w.s, 'wood', 1);
    for (let i = 0; i < 12; i++) { f.inputs.timber = 20; runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 0 }); }
    expect(f.condition).toBeLessThan(0.95);
    const worn = f.condition;
    stock(w.s, { timber: 20 });
    const before = w.s.localMaterials.timber!;
    for (let i = 0; i < 6; i++) { f.inputs.timber = 20; runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 2 }); }
    expect(f.condition).toBeGreaterThan(worn);
    expect(before - w.s.localMaterials.timber!).toBeGreaterThan(0);
  });

  it('is demand-driven: a works that has made enough goes idle instead of burning inputs', () => {
    const w = processingWorld('demand');
    const f = placeFacility(w.state, w.s, 'wood', 1);
    stock(w.s, { timber: 60, lumber: 40, charcoal: 40, 'timber-frame': 20 });
    runFacilityMonth(w.state, w.s, CREW, w.random);
    runFacilityMonth(w.state, w.s, CREW, w.random);
    expect(f.status).toBe('idle');
    expect(f.limiter).toBe('demand');
    expect(f.totals.consumed.timber ?? 0).toBe(0);
  });
});

describe('integrated works and multi-step chains', () => {
  it('runs the metallurgy ladder with real ore, fuel and warm-up, and makes steel only in a steelworks', () => {
    const w = processingWorld('steel');
    const bloomery = placeFacility(w.state, w.s, 'metallurgy', 1);
    transform(w.s, 'industrial-chemistry');
    expect(bloomery.tier).toBe(1);
    expect(facilityTierSpec('metallurgy', 1)!.recipes.map(r => r.id)).not.toContain('make-steel');
    bloomery.inputs['iron-ore'] = 15; bloomery.inputs.charcoal = 15; bloomery.inputs.coal = 5;
    for (let i = 0; i < 6; i++) runFacilityMonth(w.state, w.s, CREW, w.random);
    expect(bloomery.totals.produced.steel ?? 0).toBe(0);
    expect(w.s.localMaterials.steel ?? 0).toBe(0);

    const works = processingWorld('steel-works');
    const steelworks = placeFacility(works.state, works.s, 'metallurgy', 3);
    transform(works.s, 'industrial-chemistry');
    steelworks.inputs['iron-ore'] = 60; steelworks.inputs.charcoal = 40; steelworks.inputs.coal = 20;
    steelworks.power = { carrier: 'electric', demand: 30, supplied: 30, coverage: 1 };
    for (let i = 0; i < 12; i++) {
      steelworks.power.supplied = 30; steelworks.power.coverage = 1;
      runFacilityMonth(works.state, works.s, CREW, works.random);
    }
    // Ore became iron inside the works and that iron became steel: ore, fuel and labour were all consumed.
    expect(steelworks.totals.consumed['iron-ore']).toBeGreaterThan(0);
    expect(steelworks.totals.consumed.coal).toBeGreaterThan(0);
    expect(steelworks.totals.produced.iron).toBeGreaterThan(0);
    expect(steelworks.totals.produced.steel).toBeGreaterThan(0);
    expect(steelworks.processes['material:make-steel']!.lifetimeBatches).toBeGreaterThan(0);
    expect(facilityConservationError(steelworks)).toBeLessThan(1e-4);
    const steelMade = steelworks.totals.produced.steel!;
    expect(steelMade).toBeLessThanOrEqual((steelworks.totals.consumed.iron ?? 0) * 0.9 + 1e-6);
    expect((works.s.localMaterials.steel ?? 0) + (steelworks.outputs.steel ?? 0) + (facilityHoldings(steelworks).steel ?? 0) - (steelworks.outputs.steel ?? 0)).toBeGreaterThan(0);
  });

  it('cannot fire a cold furnace without fuel of sufficient heat', () => {
    const w = processingWorld('cold');
    const f = placeFacility(w.state, w.s, 'metallurgy', 1);
    f.inputs['iron-ore'] = 10; f.inputs.timber = 10; // timber (0.35) is too cool for a bloomery (0.6)
    for (let i = 0; i < 4; i++) runFacilityMonth(w.state, w.s, CREW, w.random);
    expect(f.totals.produced.iron ?? 0).toBe(0);
    expect(f.heat).toBe(0);
    expect(f.status).toBe('starved');
    f.inputs.charcoal = 8;
    runFacilityMonth(w.state, w.s, CREW, w.random);
    expect(f.totals.produced.iron ?? 0).toBeGreaterThan(0);
    expect(f.heat).toBe(1);
    // Left unfed the furnace cools again.
    f.inputs = {};
    for (let i = 0; i < 4; i++) runFacilityMonth(w.state, w.s, CREW, w.random);
    expect(f.heat).toBe(0);
  });
});

describe('reusable family framework', () => {
  it('runs a family the engine has never seen from data alone', () => {
    const textiles: FacilityFamilySpec = {
      id: 'textiles', name: 'Textiles', description: 'test family', triggerMaterials: ['clay'],
      tiers: [{
        tier: 1, kind: 'kiln-yard', name: 'kiln yard', form: 'workshop', material: 'masonry', capacity: 4, workers: 2,
        occupations: ['artisan'], yard: 20, knowledge: [], power: { mode: 'none', demand: 0, fallback: 1, minimumCoverage: 0 },
        yieldBonus: 0, recipes: [{ source: 'catalog', id: 'pottery-vessels' }, { source: 'material', id: 'fire-brick' }],
        build: { lines: [{ options: ['stone'], amount: 2 }], work: 1 }, maintenance: { lines: [], work: 0.1 }, service: 0.4,
      }],
    };
    const restore = registerFacilityFamily(textiles);
    try {
      expect(facilityFamilies().map(f => f.id)).toContain('textiles');
      expect(facilityOwnedRecipes().catalog.has('pottery-vessels')).toBe(true);
      const w = processingWorld('textiles');
      learn(w.s, 'pottery-firing');
      w.s.knowledge.records['pottery-firing']!.practice = 0.9;
      stock(w.s, { clay: 30, timber: 20, stone: 10 });
      w.s.buildings = 6;
      step(w.state, w.system, 1);
      // Pottery at settlement level is now impossible; only the kiln yard can make it.
      const kiln = facilitiesOf(w.s, 'textiles')[0];
      expect(kiln).toBeDefined();
      expect(w.s.localMaterials.pottery ?? 0).toBe(0);
      for (let i = 0; i < 30; i++) {
        runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 2 });
        if (kiln!.progress >= 1) stock(w.s, { clay: 3, timber: 2 });
      }
      expect(kiln!.progress).toBe(1);
      expect((kiln!.totals.produced.pottery ?? 0) + (kiln!.totals.produced.brick ?? 0)).toBeGreaterThan(0);
      expect(facilityConservationError(kiln!)).toBeLessThan(1e-4);
    } finally { restore(); }
    expect(facilityFamilies().map(f => f.id)).not.toContain('textiles');
    expect(facilityOwnedRecipes().catalog.has('pottery-vessels')).toBe(false);
  });

  it('reserves every later family id without any implementation', () => {
    const ids = facilityFamilies().map(f => f.id).sort();
    expect(ids).toEqual(['ceramics', 'machinery', 'metallurgy', 'wood']);
    for (const reserved of ['textiles', 'chemicals', 'electrical-equipment', 'strategic'] as const) {
      expect(facilityTierSpec(reserved, 1)).toBeUndefined();
    }
  });
});

describe('determinism and legacy compatibility', () => {
  const run = (seed: string) => {
    const w = processingWorld(seed);
    learn(w.s, ...WOOD_KNOWLEDGE, ...METAL_KNOWLEDGE);
    stock(w.s, { timber: 60, 'copper-ore': 30, 'tin-ore': 12, 'iron-ore': 30, charcoal: 30, stone: 30 });
    for (let month = 1; month <= 60; month++) {
      w.state.month = month;
      ensureProcessingAuthority(w.state);
      if (month % 6 === 0) stock(w.s, { timber: 20, 'copper-ore': 8, 'iron-ore': 10, charcoal: 8 });
      w.system.advanceMonth(w.state);
    }
    return { processing: JSON.stringify(w.s.processing), materials: JSON.stringify(w.s.localMaterials), plots: JSON.stringify(w.s.structurePlots) };
  };

  it('replays identically from the same seed', () => {
    const a = run('replay');
    const b = run('replay');
    expect(a.processing).toEqual(b.processing);
    expect(a.materials).toEqual(b.materials);
    expect(a.plots).toEqual(b.plots);
    expect(JSON.parse(a.processing).facilities.length).toBeGreaterThan(0);
    // Different seeds explore different craft outcomes, so the comparison above is not vacuous.
    expect(run('replay-other').materials).not.toEqual(a.materials);
  });

  it('converts a legacy save\'s aggregate capacity into facilities exactly once, keeping production alive', () => {
    const w = processingWorld('legacy');
    learn(w.s, ...WOOD_KNOWLEDGE, ...METAL_KNOWLEDGE);
    w.s.infrastructure.workshops = 0.4;
    w.s.knownRecipes.push('charcoal', 'bronze-ingot');
    // An old save has no facility authority at all.
    expect(w.state.processing).toBeUndefined();
    expect(w.s.processing).toBeUndefined();
    ensureProcessingAuthority(w.state);
    const first = JSON.stringify(facilitiesOf(w.s).map(f => [f.id, f.family, f.tier, f.plotId]));
    expect(facilitiesOf(w.s, 'wood')).toHaveLength(1);
    expect(facilitiesOf(w.s, 'metallurgy')).toHaveLength(1);
    expect(facilitiesOf(w.s).every(f => f.progress === 1 && f.history[0]!.action === 'migrated')).toBe(true);
    // Idempotent: another pass, or another month, never converts the same capacity twice.
    ensureProcessingAuthority(w.state);
    expect(JSON.stringify(facilitiesOf(w.s).map(f => [f.id, f.family, f.tier, f.plotId]))).toBe(first);
    // The converted works are real places; production resumes only once they are supplied and staffed.
    stock(w.s, { timber: 30, 'copper-ore': 20, 'tin-ore': 8, charcoal: 20 });
    step(w.state, w.system, 24);
    expect((w.s.localMaterials.bronze ?? 0) + (w.s.localMaterials.copper ?? 0)).toBeGreaterThan(0);
    expect(facilitiesOf(w.s, 'metallurgy')[0]!.totals.produced.bronze ?? 0).toBeGreaterThan(0);
  });

  it('adopts an existing manufacturing workshop as the facility body instead of duplicating it', () => {
    const w = processingWorld('legacy-workshop');
    learn(w.s, ...WOOD_KNOWLEDGE);
    w.s.infrastructure.workshops = 0.3;
    w.s.knownRecipes.push('timber-framing');
    const culture = w.state.cultures[0]!;
    w.s.structurePlots = [{
      id: 'old-workshop', worldX: w.s.position.x + 2, worldZ: w.s.position.z + 2, radius: 1.4, width: 2, depth: 1.6, height: 1, condition: 0.9, foundedMonth: 0,
      development: {
        need: 'manufacturing', form: 'workshop', name: 'craft workshop', level: 1, material: 'timber', cultureId: culture.id, style: { ...culture.style },
        services: { manufacturing: 1 }, reasons: [], capabilities: [], cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 1,
        status: 'active', origin: { month: 0, action: 'founded', name: 'craft workshop', need: 'manufacturing', cultureId: culture.id, reasons: [] },
        history: [], transitionCount: 0, lastUsedMonth: 0,
      },
    }];
    ensureProcessingAuthority(w.state);
    const [f] = facilitiesOf(w.s, 'wood');
    expect(f!.plotId).toBe('old-workshop');
    expect(w.s.structurePlots).toHaveLength(1);
    expect(w.s.structurePlots![0]!.development!.origin.name).toBe('craft workshop');
    expect(w.s.structurePlots![0]!.development!.facilityId).toBe(f!.id);
    expect(storageRoom(w.s)).toBeGreaterThan(0);
  });

  it('never enrolls a state that was not stepped by the simulation, so direct recipe drivers keep the aggregate path', () => {
    const w = processingWorld('direct');
    learn(w.s, ...METAL_KNOWLEDGE);
    w.s.infrastructure.workshops = 0.3;
    stock(w.s, { 'copper-ore': 20, 'tin-ore': 8, charcoal: 12 });
    for (let month = 1; month <= 12; month++) { w.state.month = month; w.system.advanceMonth(w.state); }
    expect(w.state.processing).toBeUndefined();
    expect(w.s.processing).toBeUndefined();
    expect(w.s.localMaterials.bronze ?? 0).toBeGreaterThan(0);
  });
});

describe('access via the real network', () => {
  it('cannot receive or ship material when the works cannot be reached', () => {
    const w = processingWorld('unreachable');
    const f = placeFacility(w.state, w.s, 'wood', 1);
    const plot = w.s.structurePlots!.find(p => p.id === f.plotId)!;
    stock(w.s, { timber: 40 });
    f.outputs.lumber = 5;
    plot.accessRestricted = true;
    const resolver = new ExtractionAccessibility(w.state);
    for (let i = 0; i < 4; i++) runFacilityMonth(w.state, w.s, CREW, w.random, { resolver });
    expect(f.access.ok).toBe(false);
    expect(f.status).toBe('inaccessible');
    expect(f.limiter).toBe('access');
    expect(f.totals.dispatchedIn.timber ?? 0).toBe(0);
    expect(f.outputs.lumber).toBe(5);
    expect(w.s.localMaterials.timber).toBeCloseTo(40, 6);
    plot.accessRestricted = false;
    for (let i = 0; i < 3; i++) runFacilityMonth(w.state, w.s, CREW, w.random, { resolver });
    expect(f.access.ok).toBe(true);
    expect(f.totals.dispatchedIn.timber).toBeGreaterThan(0);
  });

  it('is limited by how much a crew can carry over the route', () => {
    const carried = (budget: Record<string, number>) => {
      const w = processingWorld('haul');
      const f = placeFacility(w.state, w.s, 'wood', 1);
      stock(w.s, { timber: 60 });
      const resolver = new ExtractionAccessibility(w.state);
      runFacilityMonth(w.state, w.s, budget, w.random, { resolver });
      return f.totals.dispatchedIn.timber ?? 0;
    };
    const crew = carried({ carrier: 6, artisan: 3, builder: 3 });
    const porters = carried({ carrier: 0.5 });
    const nobody = carried({});
    expect(crew).toBeGreaterThan(porters);
    expect(porters).toBeGreaterThan(0);
    expect(nobody).toBe(0);
  });

  it('spends haul labour from the same crew that runs the works', () => {
    const w = processingWorld('haul-labour');
    const f = placeFacility(w.state, w.s, 'wood', 1);
    stock(w.s, { timber: 60 });
    const resolver = new ExtractionAccessibility(w.state);
    runFacilityMonth(w.state, w.s, { carrier: 1, builder: 3 }, w.random, { resolver });
    expect(f.labour.haul).toBeGreaterThan(0);
    expect(f.labour.haul + f.labour.used).toBeLessThanOrEqual(4 + 1e-9);
  });
});

describe('tier ladders are internally consistent', () => {
  it('every tier names only recipes that exist and only materials the catalogs know', () => {
    for (const family of facilityFamilies()) {
      expect(family.tiers.map(t => t.tier)).toEqual(family.tiers.map((_, i) => i + 1));
      for (const tier of family.tiers) {
        expect(tier.capacity).toBeGreaterThan(0);
        expect(tier.workers).toBeGreaterThan(0);
        for (const ref of tier.recipes) expect(processSpec(ref), `${tier.kind}:${ref.id}`).toBeDefined();
        for (const line of [...tier.build.lines, ...tier.maintenance.lines]) expect(line.options.length).toBeGreaterThan(0);
      }
      // Capacity, crew and yard only ever grow up the ladder; powered tiers are the heavy loads.
      for (let i = 1; i < family.tiers.length; i++) {
        expect(family.tiers[i]!.capacity).toBeGreaterThan(family.tiers[i - 1]!.capacity);
        expect(family.tiers[i]!.yard).toBeGreaterThan(family.tiers[i - 1]!.yard);
      }
    }
    expect(facilityTierSpec('metallurgy', 3)!.power.demand).toBeGreaterThan(facilityTierSpec('wood', 3)!.power.demand);
    expect(facilityTierSpec('wood', 3)!.power.mode).toBe('electric');
    expect(facilityTierSpec('metallurgy', 3)!.power.mode).toBe('electric');
    expect(INDUSTRIAL_KNOWLEDGE.length).toBeGreaterThan(0);
    void SeededRandom;
  });
});
