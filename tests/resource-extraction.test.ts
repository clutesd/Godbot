import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { advanceSettlementDevelopment } from '../src/sim/development/SettlementDevelopmentSystem';
import {
  advanceSettlementResourceExtraction,
  settlementResourceCatchment,
} from '../src/sim/resources/SettlementResourceExtraction';
import type { DepositResourceKind } from '../src/sim/resources/WorldResources';

const depositKinds: readonly DepositResourceKind[] = [
  'stone', 'clay', 'copper-ore', 'tin-ore', 'iron-ore', 'coal', 'uranium-ore',
];

function simulation(seed: string): Simulation {
  return new Simulation({ seed, startingPopulation: 360, settlementCount: [4, 4] });
}

function emptyCatchment(sim: Simulation, settlementIndex = 0) {
  const settlement = sim.state.settlements[settlementIndex];
  if (!settlement) throw new Error('Expected settlement');
  const cells = settlementResourceCatchment(sim.state, settlement);
  if (cells.length === 0) throw new Error('Expected resource catchment');
  for (const cell of cells) {
    const resources = cell.naturalResources;
    if (!resources) continue;
    resources.renewables.timber.stock = 0;
    for (const kind of depositKinds) {
      const deposit = resources.deposits[kind];
      if (deposit) deposit.reserve = 0;
    }
  }
  return { settlement, cells };
}

describe('settlement resource extraction', () => {
  it('harvests real timber and finite deposits instead of creating legacy stock from terrain', () => {
    const sim = simulation('resource-extraction-physical-stock');
    const { settlement, cells } = emptyCatchment(sim);
    const home = cells[0];
    if (!home?.naturalResources) throw new Error('Expected authoritative home resources');

    home.naturalResources.renewables.timber = {
      stock: 100,
      capacity: 100,
      regenerationPerYear: 0.04,
      accessibility: 1,
    };
    home.naturalResources.deposits.stone = {
      reserve: 100,
      initialReserve: 100,
      grade: 1,
      accessibility: 1,
    };
    home.naturalResources.deposits['uranium-ore'] = {
      reserve: 50,
      initialReserve: 50,
      grade: 1,
      accessibility: 1,
    };

    sim.state.month = 1;
    const beforeWood = settlement.resources.wood;
    const beforeMinerals = settlement.resources.minerals;
    settlement.monthlyBalance.wood = 12;
    settlement.monthlyBalance.minerals = 8;
    settlement.resources.wood += 12;
    settlement.resources.minerals += 8;

    const result = advanceSettlementResourceExtraction(sim.state, settlement);

    expect(result.authoritative).toBe(true);
    expect(result.harvestedWood).toBeCloseTo(12);
    expect(result.extractedMinerals).toBeCloseTo(8);
    expect(result.deposits.stone).toBeCloseTo(8);
    expect(home.naturalResources.renewables.timber.stock).toBeCloseTo(88);
    expect(home.naturalResources.deposits.stone.reserve).toBeCloseTo(92);
    expect(home.naturalResources.deposits['uranium-ore'].reserve).toBe(50);
    expect(settlement.resources.wood).toBeCloseTo(beforeWood + 12);
    expect(settlement.resources.minerals).toBeCloseTo(beforeMinerals + 8);
    expect(home.naturalResources.lastRegeneratedMonth).toBe(1);
  });

  it('caps legacy production when the local physical resource catchment is exhausted', () => {
    const sim = simulation('resource-extraction-exhaustion');
    const { settlement } = emptyCatchment(sim);
    sim.state.month = 1;

    const beforeWood = settlement.resources.wood;
    const beforeMinerals = settlement.resources.minerals;
    settlement.monthlyBalance.wood = 15;
    settlement.monthlyBalance.minerals = 9;
    settlement.resources.wood += 15;
    settlement.resources.minerals += 9;

    const result = advanceSettlementResourceExtraction(sim.state, settlement);

    expect(result.harvestedWood).toBe(0);
    expect(result.extractedMinerals).toBe(0);
    expect(settlement.monthlyBalance.wood).toBe(0);
    expect(settlement.monthlyBalance.minerals).toBe(0);
    expect(settlement.resources.wood).toBeCloseTo(beforeWood);
    expect(settlement.resources.minerals).toBeCloseTo(beforeMinerals);
  });

  it('is wired into the monthly settlement-development pass before construction can spend phantom output', () => {
    const sim = simulation('resource-extraction-development-hook');
    const { settlement } = emptyCatchment(sim);
    sim.state.month = 1;
    const residents = sim.state.people.filter((person) => person.alive && person.homeId === settlement.id);

    const beforeWood = settlement.resources.wood;
    const beforeMinerals = settlement.resources.minerals;
    settlement.monthlyBalance.wood = 11;
    settlement.monthlyBalance.minerals = 7;
    settlement.resources.wood += 11;
    settlement.resources.minerals += 7;

    advanceSettlementDevelopment(sim.state, settlement, residents, 0);

    expect(settlement.monthlyBalance.wood).toBe(0);
    expect(settlement.monthlyBalance.minerals).toBe(0);
    expect(settlement.resources.wood).toBeCloseTo(beforeWood);
    expect(settlement.resources.minerals).toBeCloseTo(beforeMinerals);
  });

  it('does not regenerate the same overlapping catchment twice in one simulation month', () => {
    const sim = simulation('resource-extraction-idempotent-regrowth');
    const settlement = sim.state.settlements[0];
    if (!settlement) throw new Error('Expected settlement');
    const cell = settlementResourceCatchment(sim.state, settlement).find((candidate) => (candidate.naturalResources?.renewables.timber.capacity ?? 0) > 0);
    if (!cell?.naturalResources) throw new Error('Expected timber resource');

    cell.naturalResources.renewables.timber.stock = cell.naturalResources.renewables.timber.capacity * 0.5;
    cell.naturalResources.lastRegeneratedMonth = 0;
    settlement.monthlyBalance.wood = 0;
    settlement.monthlyBalance.minerals = 0;
    sim.state.month = 12;

    advanceSettlementResourceExtraction(sim.state, settlement);
    const once = cell.naturalResources.renewables.timber.stock;
    advanceSettlementResourceExtraction(sim.state, settlement);
    const twice = cell.naturalResources.renewables.timber.stock;

    expect(once).toBeGreaterThan(cell.naturalResources.renewables.timber.capacity * 0.5);
    expect(twice).toBe(once);
  });
});
