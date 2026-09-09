import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { PersonMissionDirector, describeMission, missionForPerson } from '../src/sim/people/PersonMissionSystem';
import type { Person, Settlement, SimulationState, TradeRoute } from '../src/sim/types';

const referenceWorld = new Simulation({ seed: 'mission-test-world', startingPopulation: 40, settlementCount: [2, 2] }).state.world;

function person(id: string, homeId: string, age = 32, role: Person['role'] = 'merchant'): Person {
  return {
    id,
    name: id === 'merchant-1' ? 'Akisai' : id,
    sex: 'female',
    ageMonths: age * 12,
    bornMonth: 0,
    parents: [],
    children: [],
    householdId: `house-${id}`,
    homeId,
    cultureId: 'culture-a',
    position: { x: 0, z: 0 },
    target: { x: 0, z: 0 },
    occupation: role === 'merchant' ? 'carrier' : 'keeper',
    activity: 'rest',
    health: 0.9,
    energy: 0.9,
    prestige: 0.55,
    role,
    traits: {
      curiosity: 0.7, cooperation: 0.75, sociability: 0.8, aggression: 0.2, ambition: 0.6,
      riskTolerance: 0.65, empathy: 0.65, conformity: 0.45, courage: 0.65, patience: 0.65,
      conscientiousness: 0.7, loyalty: 0.7,
    },
    alive: true,
  };
}

function settlement(id: string, name: string, x: number): Settlement {
  return {
    id,
    name,
    position: { x, z: 0 },
    cellIndex: 0,
    foundedMonth: 0,
    cultureShares: { 'culture-a': 1 },
    resources: { food: 100, wood: 100, minerals: 100, goods: 100, wealth: 100 },
    monthlyBalance: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
    buildings: 10,
    targetBuildings: 10,
    constructionProgress: 0,
    specialization: 'exchange',
    foodSecurity: 0.8,
    prosperity: 0.7,
    knowledge: { records: {}, lost: {}, experimentation: {} as Settlement['knowledge']['experimentation'], exposure: {}, literacy: 0.5, preservation: 0.5 },
    infrastructure: { roads: 0.5, ports: 0, bridges: 0.2, workshops: 0.3, archives: 0.2, rail: 0, power: 0, factories: 0 },
    industry: { active: false, intensity: 0, stage: 'pre-industrial', stageProgress: 0, route: [], vulnerableInputs: [] },
    pollution: 0,
    urbanization: 0.2,
    climateStress: 0.1,
    conflictPressure: 0.1,
    crisisMonths: 0,
    depopulationMonths: 0,
    politicalPower: { personalPrestige: 0.2, kinship: 0.2, military: 0.2, religious: 0.2, merchant: 0.2, council: 0.2, institutional: 0.2, wealth: 0.2 },
    polityId: `polity-${id}`,
    institutionIds: [],
    alive: true,
  };
}

function world(people: Person[]): SimulationState {
  const a = settlement('a', 'Natala', 0);
  const b = settlement('b', 'Aven', 20);
  const route: TradeRoute = {
    id: 'route-a-b', a: 'a', b: 'b', volume: 0.9, ageMonths: 60, caravanProgress: 0.2,
    caravanDirection: 1, mode: 'land', knowledgeFlow: 0.1, cumulativeKnowledge: 1, active: true,
  };
  return {
    seed: 'mission-test', month: 120, world: referenceWorld, people, settlements: [a, b], tradeRoutes: [route], relations: [], wars: [],
  } as unknown as SimulationState;
}

describe('PersonMissionDirector', () => {
  it('turns a representative merchant into a purposeful inter-settlement traveler', () => {
    const merchant = person('merchant-1', 'a');
    const state = world([merchant]);
    const director = new PersonMissionDirector(state);
    director.beforeMonth(state);

    const mission = missionForPerson(merchant);
    expect(mission?.kind).toBe('trade-delegation');
    expect(mission?.originId).toBe('a');
    expect(mission?.targetId).toBe('b');
    expect(describeMission(merchant, state)).toContain('traveling from Natala to Aven');
    expect(describeMission(merchant, state)).toContain('carrying exchange');
  });

  it('does not pull children into representative missions', () => {
    const child = person('child-1', 'a', 12, 'child');
    const state = world([child]);
    const director = new PersonMissionDirector(state);
    director.beforeMonth(state);
    expect(missionForPerson(child)).toBeUndefined();
  });

  it('keeps authoritative history identical while mission presentation runs', () => {
    const config = { seed: 'mission-independence', startingPopulation: 90, settlementCount: [3, 3] as [number, number] };
    const baseline = new Simulation(config);
    const observed = new Simulation(config);
    const director = new PersonMissionDirector(observed.state);

    baseline.step(240);
    for (let month = 0; month < 240; month += 1) {
      director.beforeMonth(observed.state);
      observed.step(1);
      director.afterMonth(observed.state);
    }

    expect(observed.state.history).toEqual(baseline.state.history);
    expect(observed.state.stats).toEqual(baseline.state.stats);
  }, 20_000);
});
