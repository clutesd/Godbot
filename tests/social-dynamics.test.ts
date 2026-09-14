import { describe, expect, it } from 'vitest';
import { buildSocialGroups, placeInGroup } from '../src/render/people/PeoplePresentation';
import { Simulation } from '../src/sim/Simulation';
import { HistoricalImportanceSystem } from '../src/sim/people/HistoricalImportance';
import { advanceSocialDynamics, socialInfluenceFor } from '../src/sim/people/SocialDynamicsSystem';
import type { Person, SimulationState, SocialRelationship } from '../src/sim/types';

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

const state = (people: Person[], month = 1, overrides: Partial<SimulationState> = {}): SimulationState => ({
  month,
  people,
  socialRelationships: [],
  institutions: [],
  polities: [],
  wars: [],
  history: [],
  ...overrides,
} as unknown as SimulationState);

const relationship = (overrides: Partial<SocialRelationship> = {}): SocialRelationship => ({
  id: 'social-person-1-person-2',
  a: 'person-1',
  b: 'person-2',
  kind: 'friend',
  trust: 0.8,
  strength: 0.8,
  formedMonth: 1,
  lastContactMonth: 1,
  ...overrides,
});

describe('SocialDynamicsSystem', () => {
  it('records household family ties and workplace colleague ties without scripting decisions', () => {
    const parent = person('person-1', { householdId: 'house-a', workplaceId: 'work-a' });
    const child = person('person-2', { householdId: 'house-a', workplaceId: 'work-b', ageMonths: 12 * 12, role: 'child', occupation: 'child', parents: ['person-1'] });
    parent.children = [child.id];
    const colleague = person('person-3', { householdId: 'house-b', workplaceId: 'work-a' });
    const simulation = state([parent, child, colleague]);

    advanceSocialDynamics(simulation);

    const relationships = simulation.socialRelationships ?? [];
    expect(relationships.some((candidate) => candidate.kind === 'family'
      && new Set([candidate.a, candidate.b]).has(parent.id)
      && new Set([candidate.a, candidate.b]).has(child.id))).toBe(true);
    expect(relationships.some((candidate) => candidate.kind === 'colleague'
      && new Set([candidate.a, candidate.b]).has(parent.id)
      && new Set([candidate.a, candidate.b]).has(colleague.id))).toBe(true);
  });

  it('is maintained automatically by a live simulation', () => {
    const simulation = new Simulation({ seed: 'social-live-integration', startingPopulation: 72, settlementCount: [2, 2], world: { size: 24 } });
    simulation.step(1);

    expect(simulation.state.socialRelationships?.length).toBeGreaterThan(0);
    expect(simulation.state.socialRelationships?.some((candidate) => candidate.kind === 'family' || candidate.kind === 'colleague')).toBe(true);
  });

  it('turns repeated face-to-face contact into a visible social affinity over time', () => {
    const a = person('person-1', { workplaceId: 'work-a' });
    const b = person('person-2', { workplaceId: 'work-b' });
    const simulation = state([a, b]);

    for (let month = 1; month <= 36; month += 1) {
      simulation.month = month;
      advanceSocialDynamics(simulation);
    }

    const friendship = simulation.socialRelationships?.find((candidate) => candidate.kind === 'friend');
    expect(friendship?.strength).toBeGreaterThan(0.25);
    expect((a as Person & { socialAffinityIds?: string[] }).socialAffinityIds).toContain(b.id);
    expect((b as Person & { socialAffinityIds?: string[] }).socialAffinityIds).toContain(a.id);
  });

  it('matures institutions and skilled workplaces into meaningful social roles', () => {
    const councilA = person('person-1', { institutionId: 'council-1', workplaceId: 'work-a', role: 'administrator' });
    const councilB = person('person-2', { institutionId: 'council-1', workplaceId: 'work-b', role: 'merchant' });
    const scholar = person('person-3', { institutionId: 'archive-1', workplaceId: 'archive-a', role: 'scholar', ageMonths: 50 * 12 });
    const researcher = person('person-4', { institutionId: 'archive-1', workplaceId: 'archive-b', role: 'researcher', ageMonths: 28 * 12 });
    const simulation = state([councilA, councilB, scholar, researcher], 1, {
      institutions: [
        { id: 'council-1', kind: 'council' },
        { id: 'archive-1', kind: 'knowledge-keepers' },
      ] as unknown as SimulationState['institutions'],
    });

    advanceSocialDynamics(simulation);

    expect(simulation.socialRelationships?.some((candidate) => candidate.kind === 'political-ally'
      && new Set([candidate.a, candidate.b]).has(councilA.id)
      && new Set([candidate.a, candidate.b]).has(councilB.id))).toBe(true);
    expect(simulation.socialRelationships?.some((candidate) => candidate.kind === 'intellectual-collaborator'
      && new Set([candidate.a, candidate.b]).has(scholar.id)
      && new Set([candidate.a, candidate.b]).has(researcher.id))).toBe(true);
  });

  it('allows intense repeated competition to become a persistent rivalry', () => {
    const competitiveTraits = {
      ...traits,
      cooperation: 0,
      sociability: 0,
      empathy: 0,
      aggression: 1,
      ambition: 1,
    };
    const a = person('person-1', { workplaceId: 'work-a', traits: { ...competitiveTraits } });
    const b = person('person-2', { workplaceId: 'work-b', traits: { ...competitiveTraits }, cultureId: 'culture-2' });
    const simulation = state([a, b]);

    for (const month of [1, 12, 24]) {
      simulation.month = month;
      advanceSocialDynamics(simulation);
    }

    const rivalry = simulation.socialRelationships?.find((candidate) => candidate.kind === 'rival');
    expect(rivalry?.strength).toBeGreaterThan(0.16);
    expect(rivalry?.trust).toBeLessThan(0.4);
    expect((a as Person & { socialAvoidIds?: string[] }).socialAvoidIds).toContain(b.id);
    expect((b as Person & { socialAvoidIds?: string[] }).socialAvoidIds).toContain(a.id);
  });

  it('summarises support, learning, politics, and tension as bounded influence signals', () => {
    const relationships: SocialRelationship[] = [
      relationship({ kind: 'mentor', teaching: { mentorId: 'person-2', learnerId: 'person-1', domain: 'materials', progress: 0.4, lastTaughtMonth: 12 } }),
      relationship({ id: 'social-person-1-person-3', b: 'person-3', kind: 'political-ally', trust: 0.75, strength: 0.72 }),
      relationship({ id: 'social-person-1-person-4', b: 'person-4', kind: 'rival', trust: 0.2, strength: 0.7 }),
    ];
    const influence = socialInfluenceFor('person-1', relationships);

    expect(influence.support).toBeGreaterThan(0);
    expect(influence.learning).toBeGreaterThan(0);
    expect(influence.political).toBeGreaterThan(0);
    expect(influence.tension).toBeGreaterThan(0);
    expect(influence.mentorTies).toBe(1);
    expect(influence.politicalTies).toBe(1);
    expect(influence.rivalTies).toBe(1);
    expect(Math.max(influence.support, influence.learning, influence.political, influence.tension, influence.centrality)).toBeLessThanOrEqual(1);
  });

  it('lets networks nudge prestige without allowing one annual pass to dominate status', () => {
    const a = person('person-1', { prestige: 0.2, workplaceId: 'work-a' });
    const b = person('person-2', { prestige: 0.2, workplaceId: 'work-b' });
    const simulation = state([a, b], 1, {
      socialRelationships: [relationship({ kind: 'political-ally', trust: 0.9, strength: 0.95 })],
    });

    advanceSocialDynamics(simulation);

    expect(a.prestige).toBeGreaterThan(0.2);
    expect(a.prestige).toBeLessThanOrEqual(0.212);
    expect(b.prestige).toBeGreaterThan(0.2);
    expect(b.prestige).toBeLessThanOrEqual(0.212);
  });

  it('lets socially consequential networks inform historical interpretation without creating celebrity by themselves', () => {
    const focal = person('person-1');
    const others = Array.from({ length: 5 }, (_, index) => person(`person-${index + 2}`));
    const socialRelationships: SocialRelationship[] = others.map((other, index) => relationship({
      id: `social-${focal.id}-${other.id}`,
      a: focal.id,
      b: other.id,
      kind: index === 0 ? 'political-ally' : index === 1 ? 'mentor' : 'friend',
      ...(index === 1 ? { teaching: { mentorId: other.id, learnerId: focal.id, domain: 'materials' as const, progress: 0.4, lastTaughtMonth: 1 } } : {}),
      trust: 0.9,
      strength: 0.9,
    }));
    const simulation = state([focal, ...others], 1, { socialRelationships });
    const importance = new HistoricalImportanceSystem();

    const identity = importance.evaluate(focal, simulation, 1);

    expect(identity.reasons).toContain('community-network');
    expect(identity.reasons).toContain('political-network');
    expect(identity.reasons).toContain('mentor-network');
    expect(identity.status).toBe('ordinary');
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
        .filter((tie) => tie.kind !== 'family' && (tie.a === candidate.id || tie.b === candidate.id)).length;
      expect(degree).toBeLessThanOrEqual(7);
    }
  });

  it('keeps family size outside the non-family relationship budget', () => {
    const worker = person('person-1', { householdId: 'large-family', workplaceId: 'shared-work' });
    const relatives = Array.from({ length: 8 }, (_, index) => person(`person-child-${index + 1}`, {
      householdId: 'large-family',
      ageMonths: 10 * 12,
      role: 'child',
      occupation: 'child',
      workplaceId: undefined,
    }));
    const colleague = person('person-99', { householdId: 'other-house', workplaceId: 'shared-work' });
    const simulation = state([worker, ...relatives, colleague]);

    advanceSocialDynamics(simulation);

    const relationships = simulation.socialRelationships ?? [];
    const familyDegree = relationships.filter((candidate) => candidate.kind === 'family'
      && (candidate.a === worker.id || candidate.b === worker.id)).length;
    expect(familyDegree).toBe(8);
    expect(relationships.some((candidate) => candidate.kind === 'colleague'
      && new Set([candidate.a, candidate.b]).has(worker.id)
      && new Set([candidate.a, candidate.b]).has(colleague.id))).toBe(true);
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

  it('keeps known rivals out of the same conversational pair when alternatives exist', () => {
    const people = [
      person('person-1'),
      person('person-2'),
      person('person-3'),
      person('person-4'),
    ];
    (people[0] as Person & { socialAvoidIds?: string[] }).socialAvoidIds = ['person-2'];
    (people[1] as Person & { socialAvoidIds?: string[] }).socialAvoidIds = ['person-1'];

    const group = buildSocialGroups(people).get('market:settlement-1:market')!;

    expect(group.members[0]).toBe('person-1');
    expect(group.members[1]).not.toBe('person-2');
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
