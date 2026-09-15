import { describe, expect, it } from 'vitest';
import { travelAnimationFor } from '../src/render/people/PeoplePresentation';
import type { DestinationKind, Person } from '../src/sim/types';

function resourceWorker(destinationId: string, destinationKind: DestinationKind = 'field'): Person {
  return {
    id: 'worker-1',
    name: 'Worker',
    sex: 'female',
    ageMonths: 30 * 12,
    bornMonth: 0,
    parents: [],
    children: [],
    householdId: 'household-1',
    homeId: 'settlement-1',
    cultureId: 'culture-1',
    position: { x: 0, z: 0 },
    target: { x: 0, z: 0 },
    occupation: 'forager',
    activity: 'gather',
    health: 1,
    energy: 1,
    prestige: 0.1,
    traits: {
      curiosity: 0.5, cooperation: 0.5, sociability: 0.5, aggression: 0.2, ambition: 0.4,
      riskTolerance: 0.4, empathy: 0.5, conformity: 0.5, courage: 0.5, patience: 0.5,
      conscientiousness: 0.5, loyalty: 0.5,
    },
    alive: true,
    navigation: {
      destinationKind,
      destinationId,
      reason: 'working a real resource site',
      waypoints: [{ x: 4, z: 4 }],
      waypointIndex: 1,
      schedulePhase: 'work',
      traveling: false,
      crossingMode: 'walk',
    },
  } as Person;
}

describe('resource work presentation', () => {
  it('specializes stationary poses without changing the Step 1B gather activity', () => {
    const timber = resourceWorker('resource-work:timber:timber:forest-1');
    const mineral = resourceWorker('resource-work:mineral:stone:quarry-1', 'industrial-site');
    const plant = resourceWorker('resource-work:plant:wild-herbs:meadow-1');

    expect(timber.activity).toBe('gather');
    expect(mineral.activity).toBe('gather');
    expect(plant.activity).toBe('gather');
    expect(travelAnimationFor(0, timber)).toBe('build');
    expect(travelAnimationFor(0, mineral)).toBe('work');
    expect(travelAnimationFor(0, plant)).toBe('gather');
  });

  it('lets locomotion win while the same resource worker is visibly moving', () => {
    const timber = resourceWorker('resource-work:timber:timber:forest-1');
    timber.navigation!.traveling = true;
    expect(travelAnimationFor(0.4, timber)).toBe('walk');
  });

  it('does not reinterpret an ordinary stationary gatherer as resource work', () => {
    const ordinary = resourceWorker('settlement-1:field');
    expect(travelAnimationFor(0, ordinary)).toBeUndefined();
  });
});
