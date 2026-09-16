import type { HistoricalEvent, Person, SimulationState } from '../sim/types';
import { foundingDocumentaryCast, type FoundingCastMember } from './FoundingCast';
import { foundingChapterBaseline } from './FoundingChapter';
import { Historian } from './Historian';
import type {
  CandidateScoreBreakdown,
  FoundingCharacterObserverMemory,
  HistorianStatement,
  ObservationCandidate,
} from './types';

export const FOUNDING_CHARACTER_GENERIC_RECALL_MONTHS = 12;
export const FOUNDING_CHARACTER_DEEP_MEMORY_MONTHS = 8 * 12;
export const FOUNDING_CHARACTER_MIN_REVISIT_MONTHS = 3;

export interface FoundingCharacterNarrativeMemory {
  readonly personId: string;
  readonly name: string;
  readonly firstObservedMonth: number;
  readonly lastObservedMonth: number;
  readonly appearances: number;
  readonly callbacks: number;
  readonly lastObservation: FoundingCharacterObserverMemory;
  readonly rememberedEventIds: readonly string[];
}

interface CharacterMemoryRecord {
  readonly member: FoundingCastMember;
  firstObservedMonth: number;
  lastObservation: FoundingCharacterObserverMemory;
  appearances: number;
  callbacks: number;
  readonly rememberedEventIds: Set<string>;
}

interface MemoryFact {
  readonly weight: number;
  readonly text: string;
  readonly eventId?: string;
}

interface CallbackResult {
  readonly text: string;
  readonly eventIds: readonly string[];
  readonly sourceEntityIds: readonly string[];
}

const memories = new WeakMap<Historian, Map<string, CharacterMemoryRecord>>();
let installed = false;

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const readable = (value: string): string => value.replaceAll('-', ' ');
const unique = (values: readonly string[]): string[] => [...new Set(values)];

function article(value: string): string {
  return /^[aeiou]/i.test(value) ? 'an' : 'a';
}

function pronouns(person: Person): { subject: string; subjectLower: string; possessive: string } {
  return person.sex === 'female'
    ? { subject: 'She', subjectLower: 'she', possessive: 'Her' }
    : { subject: 'He', subjectLower: 'he', possessive: 'His' };
}

function roleLabel(person: Person): string {
  return readable(person.role ?? person.occupation);
}

function activityLabel(activity: string): string {
  if (activity === 'socialize') return 'spending time with others';
  if (activity === 'rest') return 'resting';
  return readable(activity);
}

function elapsedPhrase(months: number): string {
  if (months <= 1) return 'one month';
  if (months < 12) return `${months.toLocaleString()} months`;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  if (remainder === 0) return `${years.toLocaleString()} ${years === 1 ? 'year' : 'years'}`;
  return `${years.toLocaleString()} ${years === 1 ? 'year' : 'years'} and ${remainder.toLocaleString()} ${remainder === 1 ? 'month' : 'months'}`;
}

function strongestExpertise(person: Person): FoundingCharacterObserverMemory['strongestExpertise'] {
  const strongest = [...(person.expertise ?? [])]
    .sort((a, b) => b.competence - a.competence || a.domain.localeCompare(b.domain))[0];
  return strongest ? { domain: strongest.domain, competence: strongest.competence } : undefined;
}

export function foundingCharacterObservation(
  state: SimulationState,
  member: FoundingCastMember,
  sceneId: string,
  introduction = false,
): FoundingCharacterObserverMemory | undefined {
  const person = state.people.find(candidate => candidate.id === member.personId);
  if (!person) return undefined;
  const home = state.settlements.find(candidate => candidate.id === person.homeId);
  return {
    kind: 'founding-character',
    personId: person.id,
    observedMonth: state.month,
    homeId: person.homeId,
    homeName: home?.name ?? person.homeId,
    role: roleLabel(person),
    occupation: person.occupation,
    activity: person.activity,
    ...(person.partnerId ? { partnerId: person.partnerId } : {}),
    childrenCount: person.children.length,
    ...(strongestExpertise(person) ? { strongestExpertise: strongestExpertise(person) } : {}),
    historicalStatus: person.historical?.status ?? 'ordinary',
    sceneId,
    introduction,
    callbackApplied: false,
  };
}

function memoryMap(historian: Historian): Map<string, CharacterMemoryRecord> {
  let map = memories.get(historian);
  if (!map) {
    map = new Map();
    memories.set(historian, map);
  }
  return map;
}

function statusRank(status: FoundingCharacterObserverMemory['historicalStatus']): number {
  return status === 'historical' ? 2 : status === 'notable' ? 1 : 0;
}

function personalEventBetween(
  state: SimulationState,
  personId: string,
  previousMonth: number,
  currentMonth: number,
  excludedIds: ReadonlySet<string>,
): HistoricalEvent | undefined {
  return state.history
    .filter(event => event.month > previousMonth
      && event.month <= currentMonth
      && event.type !== 'ARRIVAL_DAY'
      && !excludedIds.has(event.id)
      && event.actors.includes(personId)
      && event.type !== 'birth'
      && event.significance >= 0.25)
    .sort((a, b) => b.significance - a.significance || b.month - a.month)[0];
}

function changeFacts(
  state: SimulationState,
  member: FoundingCastMember,
  previous: FoundingCharacterObserverMemory,
  current: FoundingCharacterObserverMemory,
  excludedEventIds: ReadonlySet<string>,
): MemoryFact[] {
  const person = state.people.find(candidate => candidate.id === member.personId);
  if (!person) return [];
  const words = pronouns(person);
  const elapsed = current.observedMonth - previous.observedMonth;
  const facts: MemoryFact[] = [];

  if (current.homeId !== previous.homeId) facts.push({
    weight: 1,
    text: `${words.subject} now lives at ${current.homeName}, rather than ${previous.homeName}.`,
  });
  if (current.role !== previous.role) facts.push({
    weight: 0.92,
    text: `${words.possessive} recorded role has changed from ${previous.role} to ${current.role}.`,
  });
  if (current.partnerId !== previous.partnerId) {
    const text = !previous.partnerId && current.partnerId
      ? `A partner is now recorded in ${words.possessive.toLowerCase()} life.`
      : previous.partnerId && !current.partnerId
        ? `The partnership recorded at the last observation is no longer present.`
        : `${words.possessive} recorded partner has changed.`;
    facts.push({ weight: 0.86, text });
  }
  if (current.childrenCount > previous.childrenCount) facts.push({
    weight: 0.82,
    text: `${words.possessive} recorded family has grown from ${previous.childrenCount.toLocaleString()} to ${current.childrenCount.toLocaleString()} ${current.childrenCount === 1 ? 'child' : 'children'}.`,
  });
  if (current.strongestExpertise && previous.strongestExpertise) {
    if (current.strongestExpertise.domain !== previous.strongestExpertise.domain) facts.push({
      weight: 0.76,
      text: `${words.possessive} strongest recorded expertise has shifted from ${readable(previous.strongestExpertise.domain)} to ${readable(current.strongestExpertise.domain)}.`,
    });
    else if (current.strongestExpertise.competence - previous.strongestExpertise.competence >= 0.12) facts.push({
      weight: 0.68,
      text: `${words.possessive} recorded competence in ${readable(current.strongestExpertise.domain)} has deepened noticeably since then.`,
    });
  }
  if (statusRank(current.historicalStatus) > statusRank(previous.historicalStatus)) facts.push({
    weight: 0.72,
    text: `The historical record now marks ${member.name} as ${current.historicalStatus}.`,
  });

  const event = personalEventBetween(state, member.personId, previous.observedMonth, current.observedMonth, excludedEventIds);
  if (event) facts.push({
    weight: 0.88 + event.significance * 0.08,
    text: `The interval also records: ${event.summary}`,
    eventId: event.id,
  });

  if (facts.length === 0 && elapsed >= 4 && current.activity !== previous.activity) facts.push({
    weight: 0.32,
    text: `${words.possessive} immediate activity has changed from ${activityLabel(previous.activity)} to ${activityLabel(current.activity)}.`,
  });

  return facts.sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text));
}

export function foundingCharacterCallback(
  state: SimulationState,
  member: FoundingCastMember,
  previous: FoundingCharacterObserverMemory,
  current: FoundingCharacterObserverMemory,
  excludedEventIds: readonly string[] = [],
  existingText = '',
): CallbackResult | undefined {
  const elapsed = current.observedMonth - previous.observedMonth;
  if (elapsed <= 0) return undefined;
  const person = state.people.find(candidate => candidate.id === member.personId);
  if (!person) return undefined;
  const words = pronouns(person);
  const facts = changeFacts(state, member, previous, current, new Set(excludedEventIds));
  const selected = facts.slice(0, 2);
  const sourceEntityIds = [member.personId, current.homeId];
  if (previous.homeId !== current.homeId && state.settlements.some(settlement => settlement.id === previous.homeId)) sourceEntityIds.push(previous.homeId);

  if (selected.length > 0) {
    const opening = `When I last watched ${member.name} ${elapsedPhrase(elapsed)} ago, ${words.subjectLower} was recorded as ${article(previous.role)} ${previous.role} at ${previous.homeName}.`;
    return {
      text: `${opening} ${selected.map(fact => fact.text).join(' ')}`,
      eventIds: selected.flatMap(fact => fact.eventId ? [fact.eventId] : []),
      sourceEntityIds: unique(sourceEntityIds),
    };
  }

  if (elapsed >= FOUNDING_CHARACTER_GENERIC_RECALL_MONTHS
    && elapsed < FOUNDING_CHARACTER_DEEP_MEMORY_MONTHS
    && !existingText.includes('I have returned to')) {
    return {
      text: `I last watched ${member.name} ${elapsedPhrase(elapsed)} ago at ${previous.homeName}. ${words.subject} is still recorded as ${article(current.role)} ${current.role} at ${current.homeName}.`,
      eventIds: [],
      sourceEntityIds: unique(sourceEntityIds),
    };
  }
  return undefined;
}

function publicMemory(record: CharacterMemoryRecord): FoundingCharacterNarrativeMemory {
  return Object.freeze({
    personId: record.member.personId,
    name: record.member.name,
    firstObservedMonth: record.firstObservedMonth,
    lastObservedMonth: record.lastObservation.observedMonth,
    appearances: record.appearances,
    callbacks: record.callbacks,
    lastObservation: Object.freeze({ ...record.lastObservation }),
    rememberedEventIds: Object.freeze([...record.rememberedEventIds]),
  });
}

export function foundingCharacterNarrativeMemory(
  historian: Historian,
  personId: string,
): FoundingCharacterNarrativeMemory | undefined {
  const record = memories.get(historian)?.get(personId);
  return record ? publicMemory(record) : undefined;
}

export function foundingCharacterMemories(historian: Historian): readonly FoundingCharacterNarrativeMemory[] {
  const records = memories.get(historian);
  if (!records) return Object.freeze([]);
  return Object.freeze([...records.values()]
    .sort((a, b) => a.member.communityOrder - b.member.communityOrder)
    .map(publicMemory));
}

/**
 * Rebuild presentation memory from the run archive after deterministic simulation replay. The
 * snapshots came from prior watched scenes; they never alter people, settlements, or history.
 */
export function restoreFoundingCharacterMemory(
  historian: Historian,
  state: SimulationState,
  statements: readonly HistorianStatement[],
): void {
  const cast = new Map(foundingDocumentaryCast(state).map(member => [member.personId, member] as const));
  const map = memoryMap(historian);
  for (const statement of statements) {
    const snapshot = statement.observerMemory;
    if (!snapshot || snapshot.kind !== 'founding-character') continue;
    const member = cast.get(snapshot.personId);
    if (!member) continue;
    const existing = map.get(snapshot.personId);
    if (!existing) {
      map.set(snapshot.personId, {
        member,
        firstObservedMonth: snapshot.observedMonth,
        lastObservation: { ...snapshot },
        appearances: 1,
        callbacks: snapshot.callbackApplied ? 1 : 0,
        rememberedEventIds: new Set(statement.sourceEventIds),
      });
      continue;
    }
    existing.firstObservedMonth = Math.min(existing.firstObservedMonth, snapshot.observedMonth);
    existing.appearances += 1;
    if (snapshot.callbackApplied) existing.callbacks += 1;
    for (const eventId of statement.sourceEventIds) existing.rememberedEventIds.add(eventId);
    if (snapshot.observedMonth >= existing.lastObservation.observedMonth) existing.lastObservation = { ...snapshot };
  }
}

/** Apply human-scale memory to a chosen cast scene. Exported separately for deterministic tests. */
export function observeFoundingCharacterScene(
  historian: Historian,
  state: SimulationState,
  scene: ObservationCandidate,
): ObservationCandidate {
  const member = foundingDocumentaryCast(state).find(candidate => candidate.personId === scene.subjectId);
  if (!member) return scene;
  const introduction = scene.id.startsWith('founding-cast:introduction:');
  const current = foundingCharacterObservation(state, member, scene.id, introduction);
  if (!current) return scene;
  const map = memoryMap(historian);
  let record = map.get(member.personId);
  let callbackApplied = false;
  let usedEventIds: readonly string[] = [];

  if (record && !introduction) {
    const callback = foundingCharacterCallback(
      state,
      member,
      record.lastObservation,
      current,
      scene.statement.sourceEventIds,
      scene.statement.text,
    );
    if (callback) {
      const original = {
        text: scene.statement.text,
        epistemicStatus: scene.statement.epistemicStatus,
        sourceEventIds: [...scene.statement.sourceEventIds],
        sourceEntityIds: [...scene.statement.sourceEntityIds],
        claimEntityIds: [...(scene.statement.claims.entityIds ?? [])],
      };
      scene.statement.text = `${callback.text} ${scene.statement.text}`.trim();
      scene.statement.epistemicStatus = 'derived-statistic';
      scene.statement.sourceEventIds = unique([...scene.statement.sourceEventIds, ...callback.eventIds]);
      scene.statement.sourceEntityIds = unique([...scene.statement.sourceEntityIds, ...callback.sourceEntityIds]);
      scene.statement.claims.entityIds = unique([...(scene.statement.claims.entityIds ?? []), ...callback.sourceEntityIds]);
      if (historian.validateStatement(scene.statement, state)) {
        callbackApplied = true;
        usedEventIds = callback.eventIds;
      } else {
        scene.statement.text = original.text;
        scene.statement.epistemicStatus = original.epistemicStatus;
        scene.statement.sourceEventIds = original.sourceEventIds;
        scene.statement.sourceEntityIds = original.sourceEntityIds;
        scene.statement.claims.entityIds = original.claimEntityIds;
      }
    }
  }

  const archivedSnapshot: FoundingCharacterObserverMemory = { ...current, callbackApplied };
  scene.statement.observerMemory = archivedSnapshot;

  if (!record) {
    record = {
      member,
      firstObservedMonth: current.observedMonth,
      lastObservation: archivedSnapshot,
      appearances: 1,
      callbacks: callbackApplied ? 1 : 0,
      rememberedEventIds: new Set(usedEventIds),
    };
    map.set(member.personId, record);
  } else {
    record.firstObservedMonth = Math.min(record.firstObservedMonth, current.observedMonth);
    record.lastObservation = archivedSnapshot;
    record.appearances += 1;
    if (callbackApplied) record.callbacks += 1;
    for (const eventId of usedEventIds) record.rememberedEventIds.add(eventId);
  }
  return scene;
}

function breakdown(continuity: number, repetitionPenalty: number): CandidateScoreBreakdown {
  return {
    novelty: 0.46,
    magnitude: 0.22,
    populationAffected: 0.04,
    rarity: 0.42,
    technological: 0.08,
    political: 0,
    cultural: 0.36,
    consequence: 0.28,
    continuity: clamp(continuity),
    repetitionPenalty: clamp(repetitionPenalty),
  };
}

function restoredRecurringCandidate(
  historian: Historian,
  state: SimulationState,
  record: CharacterMemoryRecord,
): ObservationCandidate | undefined {
  const person = state.people.find(candidate => candidate.id === record.member.personId && candidate.alive);
  const home = state.settlements.find(candidate => candidate.id === person?.homeId);
  const arrival = foundingChapterBaseline(state);
  if (!person || !home || !arrival) return undefined;
  const elapsed = state.month - record.lastObservation.observedMonth;
  if (elapsed < FOUNDING_CHARACTER_MIN_REVISIT_MONTHS) return undefined;
  const expertise = strongestExpertise(person);
  const statement: HistorianStatement = {
    id: `founding-character-memory-current-${person.id}-${state.month}`,
    month: state.month,
    text: `${person.name}, one of ${record.member.podName}'s original founders, is ${activityLabel(person.activity)} near ${home.name}. ${person.name} is currently recorded as ${article(roleLabel(person))} ${roleLabel(person)}${expertise ? `, with ${readable(expertise.domain)} as ${person.sex === 'female' ? 'her' : 'his'} strongest expertise` : ''}.`,
    epistemicStatus: 'recorded-fact',
    sourceEventIds: [arrival.eventId],
    sourceEntityIds: [person.id, home.id],
    sourceArchiveIds: [],
    claims: { entityIds: [person.id, home.id], eventType: 'ARRIVAL_DAY' },
  };
  if (!historian.validateStatement(statement, state)) return undefined;
  const repetitionPenalty = Math.min(0.28, record.appearances * 0.035);
  const gapBoost = Math.min(0.12, elapsed / 120);
  return {
    id: `founding-character-memory:current:${person.id}:${state.month}`,
    subjectId: person.id,
    kind: person.activity === 'travel' || person.activity === 'migrate' || person.activity === 'transport' ? 'traveler-follow' : 'worker-follow',
    position: person.position,
    title: person.name,
    statement,
    score: clamp(0.52 + gapBoost + person.prestige * 0.06 - repetitionPenalty, 0.28, 0.67),
    interest: clamp(0.38 + gapBoost),
    audioCategory: person.activity === 'travel' || person.activity === 'migrate' ? 'ambient-wilderness' : 'settlement',
    breakdown: breakdown(0.86, repetitionPenalty),
  };
}

/** Install after the 2a cast layer so memory sees introductions and every later scene selection. */
export function installFoundingCharacterMemory(): void {
  if (installed) return;
  installed = true;

  const candidates = Historian.prototype.candidates;
  Historian.prototype.candidates = function characterMemoryCandidates(this: Historian, state: SimulationState): ObservationCandidate[] {
    const pool = candidates.call(this, state);
    const records = memories.get(this);
    if (!records || records.size === 0) return pool;
    const existingSubjects = new Set(pool.map(candidate => candidate.subjectId));
    for (const record of records.values()) {
      if (existingSubjects.has(record.member.personId)) continue;
      const recurring = restoredRecurringCandidate(this, state, record);
      if (recurring) pool.push(recurring);
    }
    return pool;
  };

  const chooseScene = Historian.prototype.chooseScene;
  Historian.prototype.chooseScene = function characterMemoryChooseScene(
    this: Historian,
    state: SimulationState,
    focusEventId?: string,
  ): ObservationCandidate {
    const scene = chooseScene.call(this, state, focusEventId);
    return observeFoundingCharacterScene(this, state, scene);
  };
}
