import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { advanceSettlementDevelopment } from '../src/sim/development/SettlementDevelopmentSystem';
import {
  advanceSettlementResourceExtraction,
  settlementResourceCatchment,
} from '../src/sim/resources/SettlementResourceExtraction';
import { beginResourceWorkMonth, resourceWorkAssignments } from '../src/sim/resources/ResourceWorkAssignments';
import { isResourceWorkDestinationId, resourceWorkDestinationId } from '../src/sim/people/ResourceWorkRouting';
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
    resources.lastRegeneratedMonth = 1;
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

    // This is a stock-conservation fixture: provide sufficient available labour for the requested harvest.
    sim.state.people.filter(p => p.homeId === settlement.id).forEach((p, i) => { p.occupation = i < 32 ? 'forager' : 'artisan'; p.health = 1; });
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

    const assignments = resourceWorkAssignments(sim.state).filter((assignment) => assignment.settlementId === settlement.id);
    const timberWork = assignments.filter((assignment) => assignment.resourceId === 'timber');
    const stoneWork = assignments.filter((assignment) => assignment.resourceId === 'stone');
    expect(timberWork.reduce((sum, assignment) => sum + assignment.amountExtracted, 0)).toBeCloseTo(12);
    expect(stoneWork.reduce((sum, assignment) => sum + assignment.amountExtracted, 0)).toBeCloseTo(8);
    expect([...timberWork, ...stoneWork].every((assignment) => assignment.source === 'world-resource')).toBe(true);
    expect(timberWork[0]?.worldPosition).toEqual({ x: home.worldX, z: home.worldZ });
    expect(stoneWork[0]?.worldPosition).toEqual({ x: home.worldX, z: home.worldZ });
    expect(timberWork.reduce((sum, assignment) => sum + assignment.labourUsed, 0)).toBeGreaterThan(0);
    expect(stoneWork.reduce((sum, assignment) => sum + assignment.labourUsed, 0)).toBeGreaterThan(0);

    // A second presentation initializer in the same month must never erase work recorded by the
    // other resource authority. Month rollover, not repeated access, is the reset boundary.
    beginResourceWorkMonth(sim.state);
    expect(resourceWorkAssignments(sim.state)).toEqual(assignments);

    sim.state.month = 2;
    expect(resourceWorkAssignments(sim.state)).toEqual([]);
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

  it('routes a bounded cast of real eligible residents to the exact resource work sites', () => {
    const sim = simulation('resource-worker-routing');
    let routed = sim.state.people.filter((person) => isResourceWorkDestinationId(person.navigation?.destinationId));
    for (let month = 0; month < 8 && routed.length === 0; month += 1) {
      sim.step(1);
      routed = sim.state.people.filter((person) => person.alive && isResourceWorkDestinationId(person.navigation?.destinationId));
    }

    const assignments = resourceWorkAssignments(sim.state);
    expect(assignments.length).toBeGreaterThan(0);
    expect(routed.length).toBeGreaterThan(0);
    const assignmentByDestination = new Map(assignments.map((assignment) => [resourceWorkDestinationId(assignment), assignment]));
    const perSite = new Map<string, number>();
    const perSettlement = new Map<string, number>();

    for (const worker of routed) {
      const navigation = worker.navigation!;
      const assignment = assignmentByDestination.get(navigation.destinationId);
      expect(assignment).toBeDefined();
      expect(worker.homeId).toBe(assignment!.settlementId);
      expect(assignment!.gatherOccupations).toContain(worker.occupation);
      // Step 1C may specialize the rendered pose, but Step 1B's simulation-level meaning remains
      // unchanged: resource representatives either travel to the site or gather there.
      expect(['travel', 'gather']).toContain(worker.activity);
      expect(navigation.waypoints.length).toBeGreaterThan(0);
      const endpoint = navigation.waypoints[navigation.waypoints.length - 1]!;
      expect(Math.hypot(endpoint.x - assignment!.worldPosition.x, endpoint.z - assignment!.worldPosition.z))
        .toBeLessThanOrEqual(sim.state.world.cellSize * 6.1);
      perSite.set(assignment!.siteId, (perSite.get(assignment!.siteId) ?? 0) + 1);
      perSettlement.set(assignment!.settlementId, (perSettlement.get(assignment!.settlementId) ?? 0) + 1);
    }

    expect([...perSite.values()].every((count) => count <= 4)).toBe(true);
    expect([...perSettlement.values()].every((count) => count <= 12)).toBe(true);
  });
});
