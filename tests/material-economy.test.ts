import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import type { KnowledgeRecord, Settlement } from '../src/sim/types';
import {
  MATERIAL_RECIPES,
  advanceMaterialProcessing,
  ensureMaterialInventory,
  materialAmount,
  validateMaterialRecipes,
} from '../src/sim/resources/MaterialEconomy';
import { addMaterial } from '../src/sim/resources/Inventory';
import {
  advanceSettlementResourceExtraction,
  settlementResourceCatchment,
} from '../src/sim/resources/SettlementResourceExtraction';
import type { DepositResourceKind } from '../src/sim/resources/WorldResources';

const depositKinds: readonly DepositResourceKind[] = [
  'stone', 'clay', 'copper-ore', 'tin-ore', 'iron-ore', 'coal', 'uranium-ore',
];

function simulation(seed: string): Simulation {
  return new Simulation({ seed, startingPopulation: 320, settlementCount: [4, 4] });
}

function peopleAt(sim: Simulation, settlement: Settlement) {
  return sim.state.people.filter((person) => person.alive && person.homeId === settlement.id);
}

function installKnowledge(settlement: Settlement, id: string, practice = 0.9, transformed = false): KnowledgeRecord {
  const record: KnowledgeRecord = {
    id,
    theory: practice,
    practice,
    discoveredMonth: 0,
    lastUsedMonth: 0,
    originSettlementId: settlement.id,
    lineageId: `test:${id}`,
    parentLineages: [],
    source: 'discovery',
    dormant: false,
    adoptedMonth: 0,
    ...(transformed ? { transformedMonth: 0 } : {}),
  };
  settlement.knowledge.records[id] = record;
  return record;
}

function clearCatchment(sim: Simulation, settlement: Settlement): ReturnType<typeof settlementResourceCatchment> {
  const cells = settlementResourceCatchment(sim.state, settlement);
  for (const cell of cells) {
    const resources = cell.naturalResources;
    if (!resources) continue;
    resources.lastRegeneratedMonth = 1;
    for (const renewable of Object.values(resources.renewables)) renewable.stock = 0;
    for (const kind of depositKinds) {
      const deposit = resources.deposits[kind];
      if (deposit) deposit.reserve = 0;
    }
  }
  return cells;
}

describe('canonical material economy', () => {
  it('keeps the advanced production graph acyclic and leaves duplicate modern recipes to ResourceSystem', () => {
    expect(validateMaterialRecipes()).toEqual([]);
    expect(new Set(MATERIAL_RECIPES.map((recipe) => recipe.id)).size).toBe(MATERIAL_RECIPES.length);
    expect(MATERIAL_RECIPES.some((recipe) => recipe.id === 'burn-charcoal')).toBe(false);
    expect(MATERIAL_RECIPES.some((recipe) => recipe.id === 'alloy-bronze')).toBe(false);
  });

  it('normalizes materials.stock into the exact canonical localMaterials object', () => {
    const sim = simulation('material-single-authority');
    const settlement = sim.state.settlements[0]!;
    const inventory = ensureMaterialInventory(settlement);

    expect(inventory.stock).toBe(settlement.localMaterials);
    inventory.stock.steel = 3;
    expect(settlement.localMaterials.steel).toBe(3);
    settlement.localMaterials.steel = 1.5;
    expect(inventory.stock.steel).toBe(1.5);
    expect(materialAmount(settlement, 'steel')).toBe(1.5);
  });

  it('extracts only supplemental legacy-only resources and never double-depletes modern timber, stone or metal ore', () => {
    const sim = simulation('material-supplemental-extraction');
    const settlement = sim.state.settlements[0]!;
    const cells = clearCatchment(sim, settlement);
    const home = cells[0]!;
    if (!home.naturalResources) throw new Error('Expected physical resources');
    home.naturalResources.deposits.stone = { reserve: 100, initialReserve: 100, grade: 1, accessibility: 1 };
    home.naturalResources.deposits['copper-ore'] = { reserve: 80, initialReserve: 80, grade: 1, accessibility: 1 };
    home.naturalResources.deposits.clay = { reserve: 50, initialReserve: 50, grade: 1, accessibility: 1 };
    home.naturalResources.renewables.timber = { stock: 100, capacity: 100, regenerationPerYear: 0, accessibility: 1 };
    home.naturalResources.renewables['medicinal-flora'] = { stock: 20, capacity: 20, regenerationPerYear: 0.1, accessibility: 1 };
    home.naturalResources.renewables['plant-fiber'] = { stock: 20, capacity: 20, regenerationPerYear: 0.1, accessibility: 1 };

    for (const [index, person] of peopleAt(sim, settlement).entries()) {
      person.occupation = index < 24 ? 'forager' : index < 48 ? 'builder' : 'artisan';
      person.health = 1;
    }
    sim.state.month = 1;
    settlement.infrastructure.workshops = 0.5;
    const result = advanceSettlementResourceExtraction(sim.state, settlement, peopleAt(sim, settlement));

    expect(result.authoritative).toBe(true);
    expect(result.harvestedWood).toBe(0);
    expect(result.deposits.stone).toBeUndefined();
    expect(result.deposits['copper-ore']).toBeUndefined();
    expect(result.deposits.clay ?? 0).toBeGreaterThan(0);
    expect(materialAmount(settlement, 'clay')).toBeGreaterThan(0);
    expect(materialAmount(settlement, 'medicinal-flora')).toBeGreaterThan(0);
    expect(materialAmount(settlement, 'plant-fiber')).toBeGreaterThan(0);
    expect(home.naturalResources.renewables.timber.stock).toBe(100);
    expect(home.naturalResources.deposits.stone.reserve).toBe(100);
    expect(home.naturalResources.deposits['copper-ore'].reserve).toBe(80);
  });

  it('does not process metal ore before the required knowledge is socially adopted', () => {
    const sim = simulation('material-knowledge-gate');
    const settlement = sim.state.settlements[0]!;
    const residents = peopleAt(sim, settlement);
    settlement.infrastructure.workshops = 1;
    ensureMaterialInventory(settlement);
    addMaterial(settlement, 'copper-ore', 10);
    addMaterial(settlement, 'charcoal', 10);

    sim.state.month = 1;
    advanceMaterialProcessing(sim.state, settlement, residents);
    expect(materialAmount(settlement, 'copper')).toBe(0);
    expect(materialAmount(settlement, 'copper-ore')).toBe(10);

    installKnowledge(settlement, 'metal-smelting', 0.9);
    sim.state.month = 2;
    const processed = advanceMaterialProcessing(sim.state, settlement, residents);
    expect(processed.recipes['smelt-copper'] ?? 0).toBeGreaterThan(0);
    expect(materialAmount(settlement, 'copper')).toBeGreaterThan(0);
    expect(materialAmount(settlement, 'copper-ore')).toBeLessThan(10);
    expect(materialAmount(settlement, 'charcoal')).toBeLessThan(10);
  });

  it('requires transformed industrial chemistry for reliable steel production', () => {
    const sim = simulation('material-steel-stage');
    const settlement = sim.state.settlements[0]!;
    const residents = peopleAt(sim, settlement);
    settlement.infrastructure.workshops = 1;
    ensureMaterialInventory(settlement);
    addMaterial(settlement, 'iron', 10);
    addMaterial(settlement, 'coal', 10);
    installKnowledge(settlement, 'iron-working', 0.9);
    const chemistry = installKnowledge(settlement, 'industrial-chemistry', 0.9);

    sim.state.month = 1;
    advanceMaterialProcessing(sim.state, settlement, residents);
    expect(materialAmount(settlement, 'steel')).toBe(0);

    chemistry.transformedMonth = 2;
    sim.state.month = 2;
    advanceMaterialProcessing(sim.state, settlement, residents);
    expect(materialAmount(settlement, 'steel')).toBeGreaterThan(0);
    expect(materialAmount(settlement, 'iron')).toBeLessThan(10);
    expect(materialAmount(settlement, 'coal')).toBeLessThan(10);
  });

  it('processes canonical stock at most once per month', () => {
    const sim = simulation('material-processing-idempotence');
    const settlement = sim.state.settlements[0]!;
    const residents = peopleAt(sim, settlement);
    settlement.infrastructure.workshops = 1;
    installKnowledge(settlement, 'stone-composites', 0.9);
    const inventory = ensureMaterialInventory(settlement);
    addMaterial(settlement, 'timber', 20);

    sim.state.month = 1;
    const first = advanceMaterialProcessing(sim.state, settlement, residents);
    const timberAfterFirst = materialAmount(settlement, 'timber');
    const lumberAfterFirst = materialAmount(settlement, 'lumber');
    const second = advanceMaterialProcessing(sim.state, settlement, residents);

    expect(first.processed).toBe(true);
    expect(second.processed).toBe(false);
    expect(materialAmount(settlement, 'timber')).toBe(timberAfterFirst);
    expect(materialAmount(settlement, 'lumber')).toBe(lumberAfterFirst);
    expect(inventory.stock).toBe(settlement.localMaterials);
    expect(Object.values(settlement.localMaterials).every((amount) => amount >= 0 && Number.isFinite(amount))).toBe(true);
  });

  it('does not extract or ledger the same supplemental deposit twice in one month', () => {
    const sim = simulation('material-extraction-idempotence');
    const settlement = sim.state.settlements[0]!;
    const cells = clearCatchment(sim, settlement);
    const home = cells[0]!;
    if (!home.naturalResources) throw new Error('Expected physical resources');
    home.naturalResources.deposits.clay = { reserve: 50, initialReserve: 50, grade: 1, accessibility: 1 };
    settlement.infrastructure.workshops = 1;
    for (const person of peopleAt(sim, settlement)) { person.occupation = 'artisan'; person.health = 1; }

    sim.state.month = 1;
    const first = advanceSettlementResourceExtraction(sim.state, settlement, peopleAt(sim, settlement));
    const reserveAfterFirst = home.naturalResources.deposits.clay.reserve;
    const lifetimeAfterFirst = settlement.materials?.lifetimeExtracted.clay;
    const second = advanceSettlementResourceExtraction(sim.state, settlement, peopleAt(sim, settlement));

    expect(first.extractedMinerals).toBeGreaterThan(0);
    expect(second.extractedMinerals).toBeCloseTo(first.extractedMinerals);
    expect(home.naturalResources.deposits.clay.reserve).toBe(reserveAfterFirst);
    expect(settlement.materials?.lifetimeExtracted.clay).toBe(lifetimeAfterFirst);
  });
});
