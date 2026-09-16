import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { advanceSettlementDevelopment } from '../src/sim/development/SettlementDevelopmentSystem';
import {
  advanceSettlementResourceExtraction,
  settlementResourceCatchment,
} from '../src/sim/resources/SettlementResourceExtraction';
import { beginResourceWorkMonth, resourceWorkAssignments } from '../src/sim/resources/ResourceWorkAssignments';
import { isResourceWorkDestinationId, resourceWorkDestinationId } from '../src/sim/people/ResourceWorkRouting';
import { addMaterial } from '../src/sim/resources/Inventory';
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
    for (const renewable of Object.values(resources.renewables)) renewable.stock = 0;
    resources.lastRegeneratedMonth = 1;
    for (const kind of depositKinds) {
      const deposit = resources.deposits[kind];
      if (deposit) deposit.reserve = 0;
    }
  }
  return { settlement, cells };
}

describe('settlement supplemental resource extraction', () => {
  it('leaves modern timber, stone and metal ores untouched while gathering missing supplemental resources', () => {
    const sim = simulation('resource-extraction-single-authority');
    const { settlement, cells } = emptyCatchment(sim);
    const home = cells[0];
    if (!home?.naturalResources) throw new Error('Expected physical home resources');

    home.naturalResources.renewables.timber = { stock: 100, capacity: 100, regenerationPerYear: 0, accessibility: 1 };
    home.naturalResources.deposits.stone = { reserve: 100, initialReserve: 100, grade: 1, accessibility: 1 };
    home.naturalResources.deposits['iron-ore'] = { reserve: 60, initialReserve: 60, grade: 1, accessibility: 1 };
    home.naturalResources.deposits.clay = { reserve: 50, initialReserve: 50, grade: 1, accessibility: 1 };
    home.naturalResources.renewables['plant-fiber'] = { stock: 30, capacity: 30, regenerationPerYear: 0.05, accessibility: 1 };
    home.naturalResources.renewables['medicinal-flora'] = { stock: 20, capacity: 20, regenerationPerYear: 0.05, accessibility: 1 };

    sim.state.month = 1;
    settlement.infrastructure.workshops = 0.5;
    sim.state.people.filter(p => p.homeId === settlement.id).forEach((p, i) => {
      p.occupation = i < 24 ? 'forager' : i < 48 ? 'builder' : 'artisan';
      p.health = 1;
    });
    const result = advanceSettlementResourceExtraction(sim.state, settlement);

    expect(result.authoritative).toBe(true);
    expect(result.harvestedWood).toBe(0);
    expect(result.deposits.stone).toBeUndefined();
    expect(result.deposits['iron-ore']).toBeUndefined();
    expect(result.deposits.clay ?? 0).toBeGreaterThan(0);
    expect(home.naturalResources.renewables.timber.stock).toBe(100);
    expect(home.naturalResources.deposits.stone.reserve).toBe(100);
    expect(home.naturalResources.deposits['iron-ore'].reserve).toBe(60);
    expect(settlement.localMaterials.clay ?? 0).toBeGreaterThan(0);
    expect(settlement.localMaterials['plant-fiber'] ?? 0).toBeGreaterThan(0);

    const assignments = resourceWorkAssignments(sim.state).filter((assignment) => assignment.settlementId === settlement.id);
    expect(assignments.some((assignment) => assignment.resourceId === 'clay')).toBe(true);
    expect(assignments.some((assignment) => assignment.resourceId === 'plant-fiber')).toBe(true);
    expect(assignments.some((assignment) => assignment.resourceId === 'timber')).toBe(false);
    expect(assignments.some((assignment) => assignment.resourceId === 'stone')).toBe(false);
  });

  it('does not claw back modern aggregate production when the supplemental catchment is exhausted', () => {
    const sim = simulation('resource-extraction-no-balance-rewrite');
    const { settlement } = emptyCatchment(sim);
    sim.state.month = 1;

    // Isolate extraction from the advanced processor, which legitimately spends canonical timber.
    sim.state.people.filter(p => p.homeId === settlement.id).forEach((p) => {
      p.occupation = 'forager';
      p.health = 1;
    });
    settlement.monthlyBalance.wood = 15;
    settlement.monthlyBalance.minerals = 9;
    const woodBefore = settlement.resources.wood;
    const mineralsBefore = settlement.resources.minerals;

    const result = advanceSettlementResourceExtraction(sim.state, settlement);

    expect(result.harvestedWood).toBe(0);
    expect(result.extractedMinerals).toBe(0);
    expect(settlement.monthlyBalance.wood).toBe(15);
    expect(settlement.monthlyBalance.minerals).toBe(9);
    expect(settlement.resources.wood).toBe(woodBefore);
    expect(settlement.resources.minerals).toBe(mineralsBefore);
  });

  it('is wired into development without changing canonical timber or stone owned by ResourceSystem', () => {
    const sim = simulation('resource-extraction-development-hook');
    const { settlement } = emptyCatchment(sim);
    sim.state.month = 1;
    const residents = sim.state.people.filter((person) => person.alive && person.homeId === settlement.id);

    // Isolate extraction from legitimate operating consumption and advanced processing.
    settlement.infrastructure.roads = 0;
    settlement.infrastructure.bridges = 0;
    settlement.infrastructure.ports = 0;
    settlement.infrastructure.workshops = 0;
    settlement.infrastructure.factories = 0;
    settlement.infrastructure.rail = 0;
    settlement.infrastructure.power = 0;
    settlement.industry.intensity = 0;
    settlement.conflictPressure = 0;
    settlement.politicalPower.military = 0;
    residents.forEach((person) => {
      person.occupation = 'forager';
      person.health = 1;
    });

    addMaterial(settlement, 'timber', 12);
    addMaterial(settlement, 'stone', 8);
    const timberBefore = settlement.localMaterials.timber;
    const stoneBefore = settlement.localMaterials.stone;

    advanceSettlementDevelopment(sim.state, settlement, residents, 0);

    expect(settlement.localMaterials.timber).toBe(timberBefore);
    expect(settlement.localMaterials.stone).toBe(stoneBefore);
  });

  it('does not regenerate the same overlapping supplemental catchment twice in one simulation month', () => {
    const sim = simulation('resource-extraction-idempotent-regrowth');
    const settlement = sim.state.settlements[0];
    if (!settlement) throw new Error('Expected settlement');
    const cell = settlementResourceCatchment(sim.state, settlement)
      .find((candidate) => (candidate.naturalResources?.renewables['plant-fiber'].capacity ?? 0) > 0);
    if (!cell?.naturalResources) throw new Error('Expected plant-fiber resource');

    const fiber = cell.naturalResources.renewables['plant-fiber'];
    fiber.stock = fiber.capacity * 0.5;
    cell.naturalResources.lastRegeneratedMonth = 0;
    sim.state.month = 12;

    advanceSettlementResourceExtraction(sim.state, settlement);
    const once = fiber.stock;
    advanceSettlementResourceExtraction(sim.state, settlement);
    const twice = fiber.stock;

    expect(once).toBeGreaterThan(fiber.capacity * 0.5);
    expect(twice).toBe(once);
  });

  it('keeps resource-work presentation initialization idempotent within a month', () => {
    const sim = simulation('resource-work-month-boundary');
    const { settlement, cells } = emptyCatchment(sim);
    const home = cells[0];
    if (!home?.naturalResources) throw new Error('Expected resources');
    home.naturalResources.deposits.clay = { reserve: 50, initialReserve: 50, grade: 1, accessibility: 1 };
    settlement.infrastructure.workshops = 0.5;
    sim.state.people.filter(p => p.homeId === settlement.id).forEach(p => { p.occupation = 'artisan'; p.health = 1; });
    sim.state.month = 1;

    advanceSettlementResourceExtraction(sim.state, settlement);
    const assignments = resourceWorkAssignments(sim.state);
    expect(assignments.length).toBeGreaterThan(0);
    beginResourceWorkMonth(sim.state);
    expect(resourceWorkAssignments(sim.state)).toEqual(assignments);
    sim.state.month = 2;
    expect(resourceWorkAssignments(sim.state)).toEqual([]);
  });

  it('routes a bounded cast of real eligible residents to exact resource work sites', () => {
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
