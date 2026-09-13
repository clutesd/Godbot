import { describe, expect, it } from 'vitest';
import { buildSocialGroups, placeInGroup } from '../src/render/people/PeoplePresentation';
import { Simulation } from '../src/sim/Simulation';
import { advanceSocialDynamics } from '../src/sim/people/SocialDynamicsSystem';
import type { Person, SimulationState } from '../src/sim/types';

const traits = {
  curiosity: 0.5, cooperation: 0.7, sociability: 0.72, aggression: 0.25, ambition: 0.5, riskTolerance: 0.5,
  empathy: 0.68, conformity: 0.5, courage: 0.5, patience: 0.5, conscientiousness: 0.6, loyalty: 0.65,
};

const person = (id: string, overrides: Partial<Person> = {}): Person => ({
  id,
  name: id,
  sex: 'female',
  ageMonths: 30 * 12,
  bornMonth: 0,
  parents: [],
  children: [],
  householdId: `house-${id}`,
  homeId: 'settlement-1',
  cultureId: 'culture-1',
  position: { x: 0, z: 0 },
  target: { x: 0, z: 0 },
  occupation: 'artisan',
  activity: 'socialize',
  role: 'craft-worker',
  workplaceId: 'settlement-1:workshop',
  health: 1,
  energy: 1,
  prestige: 0.2,
  traits: { ...traits },
  alive: true,
  navigation: {
    destinationKind: 'market',
    destinationId: 'settlement-1:market',
    reason: 'market gathering',
    waypoints: [],
    waypointIndex: 0,
    schedulePhase: 'social',
    traveling: false,
    crossingMode: 'walk',
  },
  ...overrides,
});

const state = (people: Person[], month = 1): SimulationState => ({
  month,
  people,
  socialRelationships: [],
} as unknown as SimulationState);

describe('SocialDynamicsSystem', () => {
  it('records household family ties and workplace colleague ties without scripting decisions', () => {
    const parent = person('person-1', { householdId: 'house-a', workplaceId: 'work-a' });
    const child = person('person-2', { householdId: 'house-a', workplaceId: 'work-b', ageMonths: 12 * 12, role: 'child', occupation: 'child', parents: ['person-1'] });
    parent.children = [child.id];
    const colleague = person('person-3', { householdId: 'house-b', workplaceId: 'work-a' });
    const simulation = state([parent, child, colleague]);

    advanceSocialDynamics(simulation);

    const relationships = simulation.socialRelationships ?? [];
    expect(relationships.some((relationship) => relationship.kind === 'family'
      && new Set([relationship.a, relationship.b]).has(parent.id)
      && new Set([relationship.a, relationship.b]).has(child.id))).toBe(true);
    expect(relationships.some((relationship) => relationship.kind === 'colleague'
      && new Set([relationship.a, relationship.b]).has(parent.id)
      && new Set([relationship.a, relationship.b]).has(colleague.id))).toBe(true);
  });

  it('is maintained automatically by a live simulation', () => {
    const simulation = new Simulation({ seed: 'social-live-integration', startingPopulation: 72, settlementCount: [2, 2], world: { size: 24 } });
    simulation.step(1);

    expect(simulation.state.socialRelationships?.length).toBeGreaterThan(0);
    expect(simulation.state.socialRelationships?.some((relationship) => relationship.kind === 'family' || relationship.kind === 'colleague')).toBe(true);
  });

  it('turns repeated face-to-face contact into a visible social affinity over time', () => {
    const a = person('person-1', { workplaceId: 'work-a' });
    const b = person('person-2', { workplaceId: 'work-b' });
    const simulation = state([a, b]);

    for (let month = 1; month <= 36; month += 1) {
      simulation.month = month;
      advanceSocialDynamics(simulation);
    }

    const friendship = simulation.socialRelationships?.find((relationship) => relationship.kind === 'friend');
    expect(friendship?.strength).toBeGreaterThan(0.25);
    expect((a as Person & { socialAffinityIds?: string[] }).socialAffinityIds).toContain(b.id);
    expect((b as Person & { socialAffinityIds?: string[] }).socialAffinityIds).toContain(a.id);
  });

  it('keeps non-family social degree bounded in a crowded workplace', () => {
    const people = Array.from({ length: 24 }, (_, index) => person(`person-${index + 1}`, {
      householdId: `house-${index + 1}`,
      workplaceId: 'large-workshop',
      navigation: {
        destinationKind: 'workshop', destinationId: 'large-workshop', reason: 'working',
        waypoints: [], waypointIndex: 0, schedulePhase: 'work', traveling: false, crossingMode: 'walk',
      },
    }));
    const simulation = state(people);
    advanceSocialDynamics(simulation);

    for (const candidate of people) {
      const degree = (simulation.socialRelationships ?? [])
        .filter((relationship) => relationship.kind !== 'family' && (relationship.a === candidate.id || relationship.b === candidate.id)).length;
      expect(degree).toBeLessThanOrEqual(7);
    }
  });
});

describe('Socially structured crowd presentation', () => {
  it('places strong companions next to each other in conversational gatherings', () => {
    const people = [
      person('person-1'),
      person('person-2'),
      person('person-3'),
      person('person-4'),
    ];
    (people[0] as Person & { socialAffinityIds?: string[] }).socialAffinityIds = ['person-4'];
    (people[3] as Person & { socialAffinityIds?: string[] }).socialAffinityIds = ['person-1'];

    const group = buildSocialGroups(people).get('market:settlement-1:market')!;
    expect(group.members.slice(0, 2)).toEqual(['person-1', 'person-4']);

    const first = placeInGroup(people[0]!, group, people[0]!.position);
    const companion = placeInGroup(people[3]!, group, people[3]!.position);
    const stranger = placeInGroup(people[1]!, group, people[1]!.position);
    expect(Math.hypot(first.x - companion.x, first.z - companion.z))
      .toBeLessThan(Math.hypot(first.x - stranger.x, first.z - stranger.z));
  });

  it('turns shrine crowds into a spaced audience instead of a single visual knot', () => {
    const people = Array.from({ length: 12 }, (_, index) => person(`person-${index + 1}`, {
      position: { x: 0, z: 0 },
      navigation: {
        destinationKind: 'shrine', destinationId: 'settlement-1:shrine', reason: 'ritual',
        waypoints: [], waypointIndex: 0, schedulePhase: 'ritual', traveling: false, crossingMode: 'walk',
      },
    }));
    const group = buildSocialGroups(people).get('shrine:settlement-1:shrine')!;
    const placements = people.map((candidate) => placeInGroup(candidate, group, candidate.position));
    const distinct = new Set(placements.map((placement) => `${placement.x.toFixed(3)}:${placement.z.toFixed(3)}`));

    expect(distinct.size).toBe(people.length);
    expect(placements.every((placement) => placement.restFacing !== undefined)).toBe(true);
    expect(Math.max(...placements.map((placement) => Math.hypot(placement.x, placement.z)))).toBeGreaterThan(0.6);
  });
});
