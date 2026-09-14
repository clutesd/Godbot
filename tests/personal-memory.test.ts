import { describe, expect, it } from 'vitest';
import { buildSocialGroups, humanStoryCueFor, placeInGroup } from '../src/render/people/PeoplePresentation';
import { advancePersonalMemory, memoriesFor, memoryInfluenceFor, type MemoryPerson } from '../src/sim/people/PersonalMemorySystem';
import type { HistoricalEvent, Person, SimulationState, SocialRelationship } from '../src/sim/types';

const traits = {
  curiosity: 0.6, cooperation: 0.7, sociability: 0.65, aggression: 0.2, ambition: 0.55, riskTolerance: 0.45,
  empathy: 0.8, conformity: 0.4, courage: 0.6, patience: 0.55, conscientiousness: 0.7, loyalty: 0.8,
};

const person = (id: string, overrides: Partial<Person> = {}): MemoryPerson => ({
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
  workplaceId: 'workshop-1',
  health: 1,
  energy: 1,
  prestige: 0.2,
  traits: { ...traits },
  alive: true,
  navigation: {
    destinationKind: 'market', destinationId: 'market-1', reason: 'social', waypoints: [], waypointIndex: 0,
    schedulePhase: 'social', traveling: false, crossingMode: 'walk',
  },
  ...overrides,
});

const event = (overrides: Partial<HistoricalEvent>): HistoricalEvent => ({
  id: 'event-1',
  month: 11,
  type: 'death',
  actors: ['person-dead'],
  causes: ['age'],
  context: {},
  outcome: 'ended',
  affectedPopulation: 1,
  magnitude: 0.1,
  significance: 0.3,
  tags: ['life'],
  summary: 'A life ended.',
  ...overrides,
});

const state = (people: Person[], overrides: Partial<SimulationState> = {}): SimulationState => ({
  month: 12,
  people,
  socialRelationships: [],
  history: [],
  institutions: [],
  polities: [],
  wars: [],
  ...overrides,
} as unknown as SimulationState);

const relation = (overrides: Partial<SocialRelationship> = {}): SocialRelationship => ({
  id: 'social-person-dead-person-1',
  a: 'person-dead',
  b: 'person-1',
  kind: 'family',
  trust: 0.9,
  strength: 0.9,
  formedMonth: 1,
  lastContactMonth: 11,
  ...overrides,
});

describe('PersonalMemorySystem', () => {
  it('turns the death of a close relation into a durable personal loss memory', () => {
    const survivor = person('person-1');
    const simulation = state([survivor], {
      history: [event({})],
      socialRelationships: [relation()],
    });

    advancePersonalMemory(simulation);

    const memories = memoriesFor(survivor);
    expect(memories).toHaveLength(1);
    expect(memories[0]?.kind).toBe('loss');
    expect(memories[0]?.subjectId).toBe('person-dead');
    expect(memories[0]?.reason).toBe('family-loss');
    expect(memoryInfluenceFor(survivor, 12).grief).toBeGreaterThan(0.5);
  });

  it('is idempotent when the same recent event is visible on two monthly passes', () => {
    const survivor = person('person-1');
    const simulation = state([survivor], { history: [event({})], socialRelationships: [relation()] });

    advancePersonalMemory(simulation);
    advancePersonalMemory(simulation);

    expect(memoriesFor(survivor)).toHaveLength(1);
  });

  it('records mentorship as a lineage memory that survives independent of the live relationship graph', () => {
    const student = person('person-1', { ageMonths: 24 * 12 });
    const mentor = person('person-2', { ageMonths: 52 * 12 });
    const simulation = state([student, mentor], {
      socialRelationships: [relation({ id: 'social-person-1-person-2', a: student.id, b: mentor.id, kind: 'mentor', strength: 0.75, trust: 0.8, teaching: { mentorId: mentor.id, learnerId: student.id, domain: 'materials', progress: 0.2, lastTaughtMonth: 12 } })],
    });

    advancePersonalMemory(simulation);
    simulation.socialRelationships = [];

    expect(memoriesFor(student).some((memory) => memory.kind === 'mentorship' && memory.subjectId === mentor.id)).toBe(true);
    expect(memoryInfluenceFor(student, 12).legacy).toBeGreaterThan(0);
  });

  it('records migration only for represented people who actually moved', () => {
    const moved = person('person-1');
    const stayed = person('person-2');
    const migration = event({
      id: 'migration-1', month: 12, type: 'major-migration', actors: ['settlement-1', 'settlement-2', moved.id],
      causes: ['conflict'], significance: 0.7, locationId: 'settlement-1', tags: ['migration'],
    });
    const simulation = state([moved, stayed], { history: [migration] });

    advancePersonalMemory(simulation);

    expect(memoriesFor(moved).some((memory) => memory.kind === 'migration' && memory.reason === 'displaced-by-conflict')).toBe(true);
    expect(memoriesFor(stayed)).toHaveLength(0);
  });

  it('keeps the personal memory budget bounded at six consequential experiences', () => {
    const witness = person('person-1');
    const history = Array.from({ length: 10 }, (_, index) => event({
      id: `catastrophe-${index}`,
      month: 12,
      type: 'natural-catastrophe',
      actors: ['settlement-1'],
      locationId: 'settlement-1',
      significance: 0.55 + index * 0.03,
      tags: ['weather'],
    }));
    const simulation = state([witness], { history });

    advancePersonalMemory(simulation);

    expect(memoriesFor(witness)).toHaveLength(6);
    expect(memoriesFor(witness).every((memory) => memory.kind === 'catastrophe')).toBe(true);
  });
});

describe('memory-aware people presentation', () => {
  it('gives a recently bereaved person a readable story cue', () => {
    const bereaved = person('person-1');
    bereaved.personalMemories = [{
      id: 'memory-loss', kind: 'loss', month: 359, subjectId: 'person-dead', emotionalWeight: 0.9, valence: -1, reason: 'family-loss',
    }];
    bereaved.ageMonths = 30 * 12;

    expect(humanStoryCueFor(bereaved)).toBe('bereaved');
  });

  it('lets recent shock pull a person subtly toward the edge of a conversational gathering', () => {
    const ordinary = person('person-1');
    const bereaved = person('person-2');
    const companion = person('person-3');
    bereaved.personalMemories = [{
      id: 'memory-loss', kind: 'loss', month: 359, subjectId: 'person-dead', emotionalWeight: 0.95, valence: -1, reason: 'family-loss',
    }];
    const people = [ordinary, bereaved, companion];
    const group = buildSocialGroups(people).get('market:market-1')!;

    const normalPlacement = placeInGroup(ordinary, group, ordinary.position);
    const bereavedPlacement = placeInGroup(bereaved, group, bereaved.position);
    const normalRadius = Math.hypot(normalPlacement.x - group.centerX, normalPlacement.z - group.centerZ);
    const bereavedRadius = Math.hypot(bereavedPlacement.x - group.centerX, bereavedPlacement.z - group.centerZ);

    expect(bereavedRadius).toBeGreaterThan(normalRadius * 0.8);
  });
});
