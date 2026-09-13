import type { HistoricalEvent, Person, SimulationState, SocialRelationship } from '../types';

export type PersonalMemoryKind =
  | 'loss'
  | 'migration'
  | 'catastrophe'
  | 'war'
  | 'mentorship'
  | 'discovery'
  | 'achievement'
  | 'leadership';

export interface PersonalMemory {
  id: string;
  kind: PersonalMemoryKind;
  month: number;
  eventId?: string;
  subjectId?: string;
  settlementId?: string;
  emotionalWeight: number;
  valence: -1 | 0 | 1;
  /** Human-readable but deterministic source; useful to the Historian and debug panels. */
  reason: string;
}

export interface MemoryInfluenceProfile {
  grief: number;
  displacement: number;
  adversity: number;
  achievement: number;
  legacy: number;
  recentShock: number;
  count: number;
}

export interface MemoryPerson extends Person {
  /** Bounded, consequential memories only. This intentionally is not a diary. */
  personalMemories?: PersonalMemory[];
}

const MAX_MEMORIES = 6;
const RECENT_WINDOW_MONTHS = 30;
const LOCAL_EVENT_KINDS = new Set<HistoricalEvent['type']>([
  'natural-catastrophe', 'harvest-crisis', 'civilization-collapse', 'pandemic', 'ecological-crisis', 'climate-crisis', 'resource-crisis',
]);
const WAR_EVENT_KINDS = new Set<HistoricalEvent['type']>(['war-declared', 'war-campaign', 'battle', 'war-ended', 'nuclear-crisis', 'nuclear-use', 'nuclear-exchange']);

/**
 * Converts already-recorded simulation truth into a tiny personal memory layer.
 *
 * The system deliberately scans only the current and immediately previous month. This lets a death
 * event reach surviving social ties on the next monthly pass before SocialDynamics prunes the dead
 * endpoint, while per-person event ids make the pass idempotent. Memories are capped and scored so
 * deep-time runs never grow an unbounded diary.
 */
export function advancePersonalMemory(state: SimulationState): void {
  const people = state.people as MemoryPerson[];
  if (people.length === 0) return;
  const livingById = new Map(people.filter((person) => person.alive).map((person) => [person.id, person]));
  const recentEvents = state.history.filter((event) => event.month >= state.month - 1 && event.month <= state.month);

  for (const event of recentEvents) {
    if (event.type === 'death') {
      rememberDeath(event, livingById, state.socialRelationships ?? []);
      continue;
    }
    if (event.type === 'major-migration') {
      for (const actorId of event.actors) {
        const person = livingById.get(actorId);
        if (!person) continue;
        addMemory(person, {
          id: `memory:${event.id}:${person.id}:migration`,
          kind: 'migration', month: event.month, eventId: event.id, settlementId: event.locationId,
          emotionalWeight: clamp(0.44 + event.significance * 0.34), valence: 0,
          reason: event.causes.includes('conflict') ? 'displaced-by-conflict' : event.causes.includes('climate-stress') ? 'climate-migration' : 'resettlement',
        });
      }
      continue;
    }

    if (event.type === 'discovery' || event.type === 'knowledge-rediscovered') {
      rememberDirectActors(event, livingById, 'discovery', 1, 'discovery');
      continue;
    }
    if (event.type === 'leadership-succession' || event.type === 'political-transition' || event.type === 'institution-formed') {
      rememberDirectActors(event, livingById, 'leadership', 1, 'public-leadership');
      continue;
    }
    if (WAR_EVENT_KINDS.has(event.type)) {
      rememberDirectActors(event, livingById, 'war', -1, 'war-experience');
      rememberLocalWitnesses(event, people, 'war', -1, 'war-witness');
      continue;
    }
    if (LOCAL_EVENT_KINDS.has(event.type)) {
      rememberLocalWitnesses(event, people, 'catastrophe', -1, event.type);
    }
  }

  // Existing mentor relationships are meaningful even before a headline event occurs. Once the tie
  // is strong enough, record it as a durable lineage memory; this survives the mentor's later death.
  for (const relationship of state.socialRelationships ?? []) {
    if (relationship.kind !== 'mentor' || relationship.strength < 0.3) continue;
    const a = livingById.get(relationship.a);
    const b = livingById.get(relationship.b);
    if (!a || !b) continue;
    const younger = a.ageMonths <= b.ageMonths ? a : b;
    const older = younger === a ? b : a;
    addMemory(younger, {
      id: `memory:mentor:${younger.id}:${older.id}`,
      kind: 'mentorship', month: relationship.formedMonth, subjectId: older.id, settlementId: younger.homeId,
      emotionalWeight: clamp(0.42 + relationship.strength * 0.38), valence: 1, reason: 'mentor-lineage',
    });
  }
}

export function memoriesFor(person: Person): readonly PersonalMemory[] {
  return (person as MemoryPerson).personalMemories ?? [];
}

export function memoryInfluenceFor(person: Person, month = person.bornMonth + person.ageMonths): MemoryInfluenceProfile {
  let grief = 0;
  let displacement = 0;
  let adversity = 0;
  let achievement = 0;
  let legacy = 0;
  let recentShock = 0;
  const memories = memoriesFor(person);

  for (const memory of memories) {
    const ageMonths = Math.max(0, month - memory.month);
    const recency = Math.exp(-ageMonths / 72);
    if (memory.kind === 'loss') grief += memory.emotionalWeight * recency;
    if (memory.kind === 'migration') displacement += memory.emotionalWeight * (0.35 + recency * 0.65);
    if (memory.kind === 'catastrophe' || memory.kind === 'war') adversity += memory.emotionalWeight * (0.45 + recency * 0.55);
    if (memory.kind === 'discovery' || memory.kind === 'achievement' || memory.kind === 'leadership') achievement += memory.emotionalWeight * (0.55 + recency * 0.45);
    if (memory.kind === 'mentorship' || (memory.subjectId && memory.kind === 'loss')) legacy += memory.emotionalWeight * (0.55 + recency * 0.45);
    if (ageMonths <= RECENT_WINDOW_MONTHS && memory.valence < 0) recentShock += memory.emotionalWeight * (1 - ageMonths / RECENT_WINDOW_MONTHS);
  }

  return {
    grief: clamp(grief),
    displacement: clamp(displacement),
    adversity: clamp(adversity),
    achievement: clamp(achievement),
    legacy: clamp(legacy),
    recentShock: clamp(recentShock),
    count: memories.length,
  };
}

/** A small read-only presentation signal: recent loss/adversity makes a person less crowd-seeking. */
export function socialWithdrawalFor(person: Person): number {
  const memory = memoryInfluenceFor(person);
  return clamp(memory.recentShock * 0.72 + memory.grief * 0.24);
}

function rememberDeath(event: HistoricalEvent, livingById: ReadonlyMap<string, MemoryPerson>, relationships: readonly SocialRelationship[]): void {
  const deceasedId = event.actors.find((actor) => actor.startsWith('person-'));
  if (!deceasedId) return;
  for (const relationship of relationships) {
    if (relationship.a !== deceasedId && relationship.b !== deceasedId) continue;
    const survivorId = relationship.a === deceasedId ? relationship.b : relationship.a;
    const survivor = livingById.get(survivorId);
    if (!survivor) continue;
    const closeness = relationship.kind === 'family' ? 1 : relationship.kind === 'friend' || relationship.kind === 'mentor' ? 0.82 : relationship.kind === 'rival' ? 0.28 : 0.48;
    const emotionalWeight = clamp((0.32 + relationship.strength * 0.48 + relationship.trust * 0.2) * closeness);
    if (emotionalWeight < 0.24) continue;
    addMemory(survivor, {
      id: `memory:${event.id}:${survivor.id}:loss`,
      kind: 'loss', month: event.month, eventId: event.id, subjectId: deceasedId, settlementId: event.locationId,
      emotionalWeight, valence: -1,
      reason: relationship.kind === 'mentor' ? 'lost-mentor' : relationship.kind === 'family' ? 'family-loss' : 'social-loss',
    });
  }
}

function rememberDirectActors(
  event: HistoricalEvent,
  livingById: ReadonlyMap<string, MemoryPerson>,
  kind: PersonalMemoryKind,
  valence: -1 | 0 | 1,
  reason: string,
): void {
  for (const actorId of event.actors) {
    const person = livingById.get(actorId);
    if (!person) continue;
    addMemory(person, {
      id: `memory:${event.id}:${person.id}:${kind}`,
      kind, month: event.month, eventId: event.id, settlementId: event.locationId,
      emotionalWeight: clamp(0.38 + event.significance * 0.5), valence, reason,
    });
  }
}

function rememberLocalWitnesses(
  event: HistoricalEvent,
  people: readonly MemoryPerson[],
  kind: PersonalMemoryKind,
  valence: -1 | 0 | 1,
  reason: string,
): void {
  if (!event.locationId || event.significance < 0.48) return;
  const local = people.filter((person) => person.alive && person.homeId === event.locationId)
    .sort((a, b) => witnessPriority(b) - witnessPriority(a) || a.id.localeCompare(b.id))
    .slice(0, 12);
  for (const person of local) {
    addMemory(person, {
      id: `memory:${event.id}:${person.id}:${kind}`,
      kind, month: event.month, eventId: event.id, settlementId: event.locationId,
      emotionalWeight: clamp(0.24 + event.significance * 0.46 + person.traits.empathy * 0.08), valence, reason,
    });
  }
}

function addMemory(person: MemoryPerson, memory: PersonalMemory): void {
  const memories = (person.personalMemories ??= []);
  if (memories.some((existing) => existing.id === memory.id || (memory.eventId && existing.eventId === memory.eventId && existing.kind === memory.kind))) return;
  memories.push(memory);
  memories.sort((a, b) => memoryScore(b, person) - memoryScore(a, person) || b.month - a.month || a.id.localeCompare(b.id));
  if (memories.length > MAX_MEMORIES) memories.length = MAX_MEMORIES;
}

function memoryScore(memory: PersonalMemory, person: Person): number {
  const personal = memory.subjectId ? 0.16 : 0;
  const temperament = memory.valence < 0 ? person.traits.empathy * 0.08 + person.traits.loyalty * 0.08 : person.traits.ambition * 0.06;
  const lineage = memory.kind === 'mentorship' ? 0.12 : memory.kind === 'discovery' || memory.kind === 'leadership' ? 0.08 : 0;
  return memory.emotionalWeight + personal + temperament + lineage;
}

function witnessPriority(person: Person): number {
  return person.prestige * 0.3 + person.traits.empathy * 0.25 + person.traits.loyalty * 0.2 + person.traits.curiosity * 0.15 + person.ageMonths / (100 * 12) * 0.1;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
