import { describe, expect, it } from 'vitest';
import { visiblePersonBudgetForDensity } from '../src/render/GodboxRenderer';
import { Simulation } from '../src/sim/Simulation';
import { PeopleSystem, settlementEraRank } from '../src/sim/people/PeopleSystem';
import { WalkabilityLayer } from '../src/sim/people/WalkabilityLayer';
import { createSettlementLayoutPlan, type BuildingDistrict } from '../src/shared/SettlementLayoutPlan';

describe('Purposeful represented people', () => {
  it('grounds every person in a household, supported role, appearance, and walkable home', () => {
    const simulation = new Simulation({ seed: 'people-grounding', startingPopulation: 240, settlementCount: [4, 4] });
    const people = new PeopleSystem(simulation.state.world, simulation.state.seed);

    expect(simulation.state.people.length).toBeGreaterThan(100);
    for (const person of simulation.state.people) {
      const settlement = simulation.state.settlements.find((candidate) => candidate.id === person.homeId);
      expect(settlement).toBeDefined();
      expect(person.householdId).toBeTruthy();
      expect(person.workplaceId).toContain(person.homeId);
      expect(person.navigation?.destinationKind).toBe('home');
      expect(person.navigation?.destinationId).toContain(person.householdId);
      expect(person.appearance?.heightScale).toBeGreaterThanOrEqual(0.85);
      expect(person.appearance?.heightScale).toBeLessThanOrEqual(1.15);
      expect(person.appearance?.buildScale).toBeGreaterThanOrEqual(0.86);
      expect(person.appearance?.buildScale).toBeLessThanOrEqual(1.13);
      expect(people.walkability.isWalkable(person.position)).toBe(true);
      expect(people.roleSupported(person.role!, settlement!, simulation.state)).toBe(true);
    }
  });

  it('assigns deterministic roles, destinations, schedules, and routes', () => {
    const config = { seed: 'people-determinism', startingPopulation: 220, settlementCount: [4, 4] as const };
    const first = new Simulation(config);
    const second = new Simulation(config);
    first.step(72);
    second.step(72);
    const documentaryState = (simulation: Simulation) => simulation.state.people.map((person) => ({
      id: person.id,
      role: person.role,
      activity: person.activity,
      workplaceId: person.workplaceId,
      appearance: person.appearance,
      navigation: person.navigation,
      position: person.position,
    }));
    expect(documentaryState(first)).toEqual(documentaryState(second));
  });

  it('never spawns or walks on water and keeps pedestrian segments traversable', () => {
    for (const seed of ['people-river', 'people-islands', 'people-highlands']) {
      const simulation = new Simulation({ seed, startingPopulation: 200, settlementCount: [4, 4] });
      const walkability = new WalkabilityLayer(simulation.state.world);
      simulation.step(80 * 12);
      for (const person of simulation.state.people) {
        const waterTransport = ['boat', 'ferry'].includes(person.navigation?.crossingMode ?? '');
        if (!waterTransport) {
          expect(walkability.isWalkable(person.position), `${seed}:${person.id} stands on invalid terrain`).toBe(true);
          const navigation = person.navigation;
          const remainingRoute = navigation?.traveling ? [person.position, ...navigation.waypoints.slice(navigation.waypointIndex)] : navigation?.waypoints ?? [];
          expect(walkability.routeIsValid(remainingRoute), `${seed}:${person.id} has an invalid pedestrian route`).toBe(true);
        }
      }
    }
  }, 20_000);

  it('turns settlement functions and active construction into visible work destinations', () => {
    const simulation = new Simulation({ seed: 'people-at-work', startingPopulation: 300, settlementCount: [4, 4] });
    for (const settlement of simulation.state.settlements) {
      settlement.targetBuildings = settlement.buildings + 2;
      settlement.constructionProgress = 0.12;
      settlement.resources.wood += 80;
    }
    simulation.step(18);
    const destinations = new Set(simulation.state.people.map((person) => person.navigation?.destinationKind));
    const roles = new Set(simulation.state.people.map((person) => person.role));
    expect(destinations).toContain('construction-site');
    expect(destinations).toContain('market');
    expect(destinations).toContain('field');
    expect(destinations).toContain('shrine');
    expect(roles).toContain('farmer');
    expect(roles.has('builder') || roles.has('laborer')).toBe(true);
    expect(roles.has('trader') || roles.has('transporter')).toBe(true);
    expect(roles.has('ritual-specialist') || roles.has('priest')).toBe(true);
  });

  it('introduces industrial roles only once the settlement supports them', () => {
    const simulation = new Simulation({ seed: 'people-industry', startingPopulation: 320, settlementCount: [4, 4] });
    expect(simulation.state.people.some((person) => ['factory-worker', 'engineer', 'machinist'].includes(person.role ?? ''))).toBe(false);
    for (const settlement of simulation.state.settlements) {
      settlement.industry.active = true;
      settlement.industry.intensity = 0.7;
      settlement.infrastructure.factories = 0.7;
      settlement.infrastructure.power = 0.5;
      settlement.infrastructure.rail = 0.45;
    }
    simulation.step(12);
    expect(simulation.state.people.some((person) => ['factory-worker', 'engineer', 'machinist', 'railway-worker', 'logistics-worker'].includes(person.role ?? ''))).toBe(true);
  });

  it('clusters work and gathering destinations around the shared city plan', () => {
    const simulation = new Simulation({ seed: 'people-city-plan', startingPopulation: 300, settlementCount: [4, 4] });
    for (const settlement of simulation.state.settlements) {
      settlement.targetBuildings = settlement.buildings + 2;
      settlement.constructionProgress = 0.12;
      settlement.resources.wood += 80;
    }
    simulation.step(18);
    const districts: Partial<Record<string, BuildingDistrict>> = {
      market: 'market', shrine: 'sacred', 'construction-site': 'craft', workshop: 'craft', 'industrial-site': 'industrial', 'civic-building': 'civic',
    };
    let checked = 0;
    for (const person of simulation.state.people) {
      const district = districts[person.navigation?.destinationKind ?? ''];
      if (!district) continue;
      const settlement = simulation.state.settlements.find((candidate) => candidate.id === person.homeId);
      if (!settlement) continue;
      const layout = createSettlementLayoutPlan({ settlement, settlements: simulation.state.settlements, routes: simulation.state.tradeRoutes, eraRank: settlementEraRank(settlement, simulation.state), seed: simulation.state.seed });
      const destination = person.navigation?.waypoints.at(-1) ?? person.position;
      const anchor = layout.anchors[district];
      expect(Math.hypot(destination.x - anchor.worldX, destination.z - anchor.worldZ)).toBeLessThanOrEqual(layout.radius * 1.05);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('sends builders to workshops when no construction project is active', () => {
    const simulation = new Simulation({ seed: 'people-builders-between-projects', startingPopulation: 300, settlementCount: [4, 4] });
    const people = new PeopleSystem(simulation.state.world, simulation.state.seed);
    const builder = simulation.state.people.find((person) => person.ageMonths >= 18 * 12)!;
    const settlement = simulation.state.settlements.find((candidate) => candidate.id === builder.homeId)!;
    builder.role = 'builder';
    builder.energy = 0.8;
    settlement.constructionProgress = 0;
    simulation.state.month = 4;
    people.advancePerson(builder, settlement, simulation.state);
    expect(builder.navigation?.destinationKind).toBe('workshop');
  });

  it('bounds detailed visible people independently of represented population', () => {
    expect(visiblePersonBudgetForDensity(1)).toBe(384);
    expect(visiblePersonBudgetForDensity(0.5)).toBe(192);
    expect(visiblePersonBudgetForDensity(0.05)).toBe(48);
  });
});
