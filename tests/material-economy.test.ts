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

describe('typed material economy', () => {
  it('keeps the production graph acyclic, finite and mass-conserving', () => {
    expect(validateMaterialRecipes()).toEqual([]);
    expect(new Set(MATERIAL_RECIPES.map((recipe) => recipe.id)).size).toBe(MATERIAL_RECIPES.length);
  });

  it('records exact physical extraction identities without inventing aggregate-only material', () => {
    const sim = simulation('material-ledger-extraction');
    const settlement = sim.state.settlements[0]!;
    const cells = clearCatchment(sim, settlement);
    const home = cells[0]!;
    if (!home.naturalResources) throw new Error('Expected physical resources');
    home.naturalResources.deposits.stone = {
      reserve: 100,
      initialReserve: 100,
      grade: 1,
      accessibility: 1,
    };
    home.naturalResources.renewables['medicinal-flora'] = {
      stock: 20,
      capacity: 20,
      regenerationPerYear: 0.1,
      accessibility: 1,
    };
    home.naturalResources.renewables['plant-fiber'] = {
      stock: 20,
      capacity: 20,
      regenerationPerYear: 0.1,
      accessibility: 1,
    };

    sim.state.month = 1;
    settlement.monthlyBalance.wood = 0;
    settlement.monthlyBalance.minerals = 5;
    settlement.resources.minerals += 5;
    const result = advanceSettlementResourceExtraction(sim.state, settlement, peopleAt(sim, settlement));

    expect(result.deposits.stone).toBeCloseTo(5);
    expect(settlement.materials?.lastFlow?.extracted.stone).toBeCloseTo(5);
    expect(settlement.materials?.lastFlow?.extracted['medicinal-flora'] ?? 0).toBeGreaterThan(0);
    expect(settlement.materials?.lastFlow?.extracted['plant-fiber'] ?? 0).toBeGreaterThan(0);
    expect(home.naturalResources.deposits.stone.reserve).toBeCloseTo(95);
  });

  it('does not process metal ore before the required knowledge is socially adopted', () => {
    const sim = simulation('material-knowledge-gate');
    const settlement = sim.state.settlements[0]!;
    const residents = peopleAt(sim, settlement);
    settlement.infrastructure.workshops = 1;
    const inventory = ensureMaterialInventory(settlement);
    inventory.stock['copper-ore'] = 10;
    inventory.stock.charcoal = 10;

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
    const inventory = ensureMaterialInventory(settlement);
    inventory.stock.iron = 10;
    inventory.stock.coal = 10;
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

  it('processes each settlement at most once per month and never mutates legacy aggregates twice', () => {
    const sim = simulation('material-processing-idempotence');
    const settlement = sim.state.settlements[0]!;
    const residents = peopleAt(sim, settlement);
    settlement.infrastructure.workshops = 1;
    const inventory = ensureMaterialInventory(settlement);
    inventory.stock.timber = 20;
    const legacyBefore = { ...settlement.resources };

    sim.state.month = 1;
    const first = advanceMaterialProcessing(sim.state, settlement, residents);
    const afterFirst = { ...inventory.stock };
    const second = advanceMaterialProcessing(sim.state, settlement, residents);

    expect(first.processed).toBe(true);
    expect(second.processed).toBe(false);
    expect(inventory.stock).toEqual(afterFirst);
    expect(settlement.resources).toEqual(legacyBefore);
    expect(Object.values(inventory.stock).every((amount) => amount >= 0 && Number.isFinite(amount))).toBe(true);
  });

  it('does not extract or ledger the same monthly production twice', () => {
    const sim = simulation('material-extraction-idempotence');
    const settlement = sim.state.settlements[0]!;
    const cells = clearCatchment(sim, settlement);
    const home = cells[0]!;
    if (!home.naturalResources) throw new Error('Expected physical resources');
    home.naturalResources.deposits.stone = {
      reserve: 50,
      initialReserve: 50,
      grade: 1,
      accessibility: 1,
    };

    sim.state.month = 1;
    settlement.monthlyBalance.minerals = 6;
    settlement.resources.minerals += 6;
    const first = advanceSettlementResourceExtraction(sim.state, settlement, peopleAt(sim, settlement));
    const reserveAfterFirst = home.naturalResources.deposits.stone.reserve;
    const lifetimeAfterFirst = settlement.materials?.lifetimeExtracted.stone;
    const second = advanceSettlementResourceExtraction(sim.state, settlement, peopleAt(sim, settlement));

    expect(first.extractedMinerals).toBeCloseTo(6);
    expect(second.extractedMinerals).toBeCloseTo(6);
    expect(home.naturalResources.deposits.stone.reserve).toBe(reserveAfterFirst);
    expect(settlement.materials?.lifetimeExtracted.stone).toBe(lifetimeAfterFirst);
  });
});
