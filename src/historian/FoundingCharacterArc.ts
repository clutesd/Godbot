import type { HistoricalEvent, Person, SimulationState, Vec2 } from '../sim/types';
import { memoriesFor } from '../sim/people/PersonalMemorySystem';
import { foundingDocumentaryCast, type FoundingCastMember } from './FoundingCast';
import { foundingCharacterObservation } from './FoundingCharacterMemory';
import { foundingChapterBaseline } from './FoundingChapter';
import { Historian } from './Historian';
import { PresentationDirector } from './PresentationDirector';
import type { CandidateScoreBreakdown, FoundingCharacterObserverMemory, HistorianStatement, ObservationCandidate } from './types';

export const FOUNDING_CHARACTER_ARC_MIN_MONTHS = 12;
export const FOUNDING_CHARACTER_ARC_COOLDOWN_MONTHS = 18;
export const FOUNDING_CHARACTER_ARC_MAX_SCENES = 4;
export const FOUNDING_CHARACTER_ARC_MONTHS_PER_SECOND = 0.18;
export const FOUNDING_CHARACTER_ENDING_MONTHS_PER_SECOND = 0.1;

interface ArcRecord {
  readonly member: FoundingCastMember;
  readonly observations: FoundingCharacterObserverMemory[];
  readonly observedSceneIds: Set<string>;
  readonly shownSignalKeys: Set<string>;
  lastArcMonth: number;
  arcScenesShown: number;
  endingEventId?: string;
}

interface ArcState {
  readonly records: Map<string, ArcRecord>;
  readonly completedPersonIds: Set<string>;
}

interface ArcSignal {
  readonly key: string;
  readonly score: number;
  readonly text: string;
  readonly eventIds: readonly string[];
  readonly entityIds: readonly string[];
  readonly kind: 'migration' | 'career' | 'family' | 'expertise' | 'teaching' | 'historical' | 'experience' | 'event';
}

interface PendingArcScene {
  readonly personId: string;
  readonly signalKeys: readonly string[];
  readonly canonicalStatement: HistorianStatement;
}

const states = new WeakMap<Historian, ArcState>();
const pendingScenes = new WeakMap<Historian, Map<string, PendingArcScene>>();
const pacingModes = new WeakMap<SimulationState, 'arc' | 'ending'>();
let pacingInstalled = false;
let installed = false;

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const readable = (value: string): string => value.replaceAll('-', ' ');
const unique = (values: readonly string[]): string[] => [...new Set(values)];

function stateFor(historian: Historian): ArcState {
  let state = states.get(historian);
  if (!state) {
    state = { records: new Map(), completedPersonIds: new Set() };
    states.set(historian, state);
  }
  return state;
}

function pendingFor(historian: Historian): Map<string, PendingArcScene> {
  let pending = pendingScenes.get(historian);
  if (!pending) {
    pending = new Map();
    pendingScenes.set(historian, pending);
  }
  return pending;
}

function recordFor(historian: Historian, state: SimulationState, personId: string): ArcRecord | undefined {
  const memory = stateFor(historian);
  const existing = memory.records.get(personId);
  if (existing) return existing;
  const member = foundingDocumentaryCast(state).find(candidate => candidate.personId === personId);
  if (!member) return undefined;
  const created: ArcRecord = {
    member,
    observations: [],
    observedSceneIds: new Set(),
    shownSignalKeys: new Set(),
    lastArcMonth: Number.NEGATIVE_INFINITY,
    arcScenesShown: 0,
  };
  memory.records.set(personId, created);
  return created;
}

function rememberObservation(historian: Historian, state: SimulationState, snapshot: FoundingCharacterObserverMemory): void {
  const record = recordFor(historian, state, snapshot.personId);
  if (!record || record.observedSceneIds.has(snapshot.sceneId)) return;
  record.observedSceneIds.add(snapshot.sceneId);
  record.observations.push({ ...snapshot });
  record.observations.sort((a, b) => a.observedMonth - b.observedMonth || a.sceneId.localeCompare(b.sceneId));
  if (record.observations.length > 24) record.observations.splice(1, record.observations.length - 24);
}

function currentPerson(state: SimulationState, member: FoundingCastMember): Person | undefined {
  return state.people.find(person => person.id === member.personId);
}

function significantPersonalEvents(state: SimulationState, personId: string, afterMonth: number, beforeMonth: number): HistoricalEvent[] {
  return state.history
    .filter(event => event.month > afterMonth
      && event.month <= beforeMonth
      && event.type !== 'ARRIVAL_DAY'
      && event.type !== 'birth'
      && event.type !== 'death'
      && event.actors.includes(personId)
      && event.significance >= 0.42)
    .sort((a, b) => b.significance - a.significance || b.month - a.month || a.id.localeCompare(b.id));
}

function successorsFor(state: SimulationState, personId: string): Person[] {
  return state.people
    .filter(person => person.id !== personId
      && (person.expertise ?? []).some(expertise => expertise.teacherId === personId && expertise.competence >= 0.18))
    .sort((a, b) => {
      const aSkill = Math.max(0, ...(a.expertise ?? []).filter(expertise => expertise.teacherId === personId).map(expertise => expertise.competence));
      const bSkill = Math.max(0, ...(b.expertise ?? []).filter(expertise => expertise.teacherId === personId).map(expertise => expertise.competence));
      return bSkill - aSkill || a.id.localeCompare(b.id);
    });
}

function arcSignals(
  state: SimulationState,
  record: ArcRecord,
  current: FoundingCharacterObserverMemory,
): ArcSignal[] {
  const first = record.observations[0];
  const person = currentPerson(state, record.member);
  if (!first || !person) return [];
  const signals: ArcSignal[] = [];

  if (first.homeId !== current.homeId) {
    signals.push({
      key: `migration:${first.homeId}->${current.homeId}`,
      score: 0.92,
      text: `${record.member.name} no longer lives where I first met ${person.sex === 'female' ? 'her' : 'him'}; the record now places ${person.sex === 'female' ? 'her' : 'him'} at ${current.homeName}, rather than ${first.homeName}.`,
      eventIds: [],
      entityIds: unique([record.member.personId, first.homeId, current.homeId]),
      kind: 'migration',
    });
  }

  if (first.role !== current.role) {
    signals.push({
      key: `career:${first.role}->${current.role}`,
      score: 0.76,
      text: `The role attached to ${record.member.name} has changed from ${first.role} to ${current.role}.`,
      eventIds: [],
      entityIds: [record.member.personId],
      kind: 'career',
    });
  } else if (first.occupation !== current.occupation) {
    signals.push({
      key: `occupation:${first.occupation}->${current.occupation}`,
      score: 0.7,
      text: `${record.member.name}'s economic work has shifted from ${readable(first.occupation)} to ${readable(current.occupation)}.`,
      eventIds: [],
      entityIds: [record.member.personId],
      kind: 'career',
    });
  }

  if (current.childrenCount > first.childrenCount) {
    signals.push({
      key: `family:${current.childrenCount}`,
      score: 0.62 + Math.min(0.12, current.childrenCount * 0.025),
      text: `The family record now names ${current.childrenCount.toLocaleString()} ${current.childrenCount === 1 ? 'child' : 'children'} for ${record.member.name}; there were ${first.childrenCount.toLocaleString()} when I first watched this life.`,
      eventIds: [],
      entityIds: [record.member.personId, ...person.children.slice(0, 4)],
      kind: 'family',
    });
  }

  if (current.strongestExpertise) {
    const firstSkill = first.strongestExpertise;
    const growth = firstSkill?.domain === current.strongestExpertise.domain
      ? current.strongestExpertise.competence - firstSkill.competence
      : current.strongestExpertise.competence;
    if (growth >= 0.18 || current.strongestExpertise.competence >= 0.72) {
      signals.push({
        key: `expertise:${current.strongestExpertise.domain}:${Math.floor(current.strongestExpertise.competence * 5)}`,
        score: 0.68 + Math.min(0.12, Math.max(0, growth) * 0.35),
        text: `${record.member.name}'s strongest recorded expertise is now ${readable(current.strongestExpertise.domain)}, at ${Math.round(current.strongestExpertise.competence * 100)}% competence.`,
        eventIds: [],
        entityIds: [record.member.personId],
        kind: 'expertise',
      });
    }
  }

  const successors = successorsFor(state, record.member.personId);
  if (successors.length > 0) {
    const living = successors.filter(personCandidate => personCandidate.alive);
    signals.push({
      key: `teaching:${successors.length}:${living.length}`,
      score: 0.88 + Math.min(0.08, successors.length * 0.015),
      text: `${successors.length.toLocaleString()} ${successors.length === 1 ? 'person carries' : 'people carry'} expertise explicitly taught by ${record.member.name}${living.length !== successors.length ? `; ${living.length.toLocaleString()} remain alive` : ''}.`,
      eventIds: [],
      entityIds: [record.member.personId, ...successors.slice(0, 4).map(successor => successor.id)],
      kind: 'teaching',
    });
  }

  if (current.historicalStatus !== first.historicalStatus && current.historicalStatus !== 'ordinary') {
    signals.push({
      key: `historical:${current.historicalStatus}`,
      score: current.historicalStatus === 'historical' ? 0.97 : 0.88,
      text: `The civilization's own historical-importance system now marks ${record.member.name} as ${current.historicalStatus}.`,
      eventIds: person.historical?.eventIds ?? [],
      entityIds: [record.member.personId],
      kind: 'historical',
    });
  }

  const personalMemories = memoriesFor(person)
    .filter(memory => ['loss', 'migration', 'catastrophe', 'war', 'discovery', 'leadership'].includes(memory.kind))
    .sort((a, b) => b.emotionalWeight - a.emotionalWeight || b.month - a.month);
  const strongestMemory = personalMemories[0];
  if (strongestMemory && strongestMemory.emotionalWeight >= 0.58) {
    const readableKind = strongestMemory.kind === 'loss' ? 'personal loss' : readable(strongestMemory.kind);
    signals.push({
      key: `experience:${strongestMemory.id}`,
      score: 0.72 + strongestMemory.emotionalWeight * 0.12,
      text: `${record.member.name}'s own bounded memory record now carries ${readableKind} from this period of life.`,
      eventIds: strongestMemory.eventId ? [strongestMemory.eventId] : [],
      entityIds: [record.member.personId, ...(strongestMemory.subjectId ? [strongestMemory.subjectId] : [])],
      kind: 'experience',
    });
  }

  const events = significantPersonalEvents(state, record.member.personId, first.observedMonth, state.month);
  if (events.length > 0) {
    const event = events[0]!;
    signals.push({
      key: `event:${event.id}`,
      score: 0.82 + event.significance * 0.12,
      text: `The wider chronicle now links ${record.member.name} directly to ${event.summary.charAt(0).toLowerCase()}${event.summary.slice(1)}`,
      eventIds: [event.id],
      entityIds: [record.member.personId],
      kind: 'event',
    });
  }

  return signals.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

function arcBreakdown(score: number, repetitionPenalty: number): CandidateScoreBreakdown {
  return {
    novelty: 0.72,
    magnitude: 0.3,
    populationAffected: 0.06,
    rarity: 0.62,
    technological: 0.12,
    political: 0.08,
    cultural: 0.48,
    consequence: clamp(score),
    continuity: 0.98,
    repetitionPenalty: clamp(repetitionPenalty),
  };
}

function sourceEntitiesThatExist(state: SimulationState, ids: readonly string[]): string[] {
  const eventActors = new Set(state.history.flatMap(event => event.actors));
  const entityIds = new Set([
    ...state.people.map(person => person.id),
    ...state.settlements.map(settlement => settlement.id),
    ...state.cultures.map(culture => culture.id),
    ...state.institutions.map(institution => institution.id),
    ...state.tradeRoutes.map(route => route.id),
    ...state.wars.map(war => war.id),
    ...state.polities.map(polity => polity.id),
    ...eventActors,
  ]);
  return unique(ids).filter(id => entityIds.has(id));
}

export function foundingCharacterArcCandidate(
  historian: Historian,
  state: SimulationState,
  personId: string,
): ObservationCandidate | undefined {
  const record = stateFor(historian).records.get(personId);
  const person = record ? currentPerson(state, record.member) : undefined;
  if (!record || !person?.alive || record.observations.length < 2 || record.arcScenesShown >= FOUNDING_CHARACTER_ARC_MAX_SCENES) return undefined;
  const first = record.observations[0]!;
  if (state.month - first.observedMonth < FOUNDING_CHARACTER_ARC_MIN_MONTHS) return undefined;
  if (state.month - record.lastArcMonth < FOUNDING_CHARACTER_ARC_COOLDOWN_MONTHS) return undefined;
  const current = foundingCharacterObservation(state, record.member, `founding-character-arc-preview:${person.id}:${state.month}`);
  if (!current) return undefined;
  const available = arcSignals(state, record, current).filter(signal => !record.shownSignalKeys.has(signal.key));
  if (available.length === 0) return undefined;
  const selected = available.slice(0, 2);
  if ((selected[0]?.score ?? 0) < 0.84 && selected.length < 2) return undefined;

  const arrival = foundingChapterBaseline(state);
  if (!arrival) return undefined;
  const sourceEventIds = unique([arrival.eventId, ...selected.flatMap(signal => signal.eventIds)])
    .filter(id => state.history.some(event => event.id === id));
  const sourceEntityIds = sourceEntitiesThatExist(state, [person.id, current.homeId, first.homeId, ...selected.flatMap(signal => signal.entityIds)]);
  const spanMonths = Math.max(0, state.month - first.observedMonth);
  const opening = `I first watched ${record.member.name} at ${first.homeName}, recorded as ${/^([aeiou])/i.test(first.role) ? 'an' : 'a'} ${first.role}.`;
  const text = `${opening} ${selected.map(signal => signal.text).join(' ')} Across ${Math.max(1, Math.floor(spanMonths / 12)).toLocaleString()} ${Math.floor(spanMonths / 12) === 1 ? 'year' : 'years'}, this is no longer a single appearance; it has become a life with continuity in the record.`;
  const signalKey = encodeURIComponent(selected.map(signal => signal.key).join('|'));
  const id = `founding-character-arc:${person.id}:${state.month}:${signalKey}`;
  const statement: HistorianStatement = {
    id,
    month: state.month,
    text,
    epistemicStatus: 'derived-statistic',
    sourceEventIds,
    sourceEntityIds,
    sourceArchiveIds: [],
    claims: { entityIds: sourceEntityIds },
  };
  if (!historian.validateStatement(statement, state)) return undefined;
  const topScore = selected[0]?.score ?? 0.6;
  const repetitionPenalty = Math.min(0.28, record.arcScenesShown * 0.08);
  const candidate: ObservationCandidate = {
    id,
    subjectId: person.id,
    kind: selected.some(signal => signal.kind === 'migration') || ['travel', 'migrate', 'transport'].includes(person.activity) ? 'traveler-follow' : 'worker-follow',
    position: person.position,
    title: `${person.name} · A LIFE IN MOTION`,
    statement,
    score: clamp(0.62 + topScore * 0.17 - repetitionPenalty, 0.56, 0.82),
    interest: clamp(0.62 + topScore * 0.16, 0.62, 0.84),
    audioCategory: ['travel', 'migrate'].includes(person.activity) ? 'ambient-wilderness' : 'historian',
    breakdown: arcBreakdown(topScore, repetitionPenalty),
  };
  pendingFor(historian).set(id, {
    personId: person.id,
    signalKeys: selected.map(signal => signal.key),
    canonicalStatement: {
      ...statement,
      sourceEventIds: [...statement.sourceEventIds],
      sourceEntityIds: [...statement.sourceEntityIds],
      sourceArchiveIds: [...statement.sourceArchiveIds],
      claims: { ...statement.claims, entityIds: [...(statement.claims.entityIds ?? [])] },
    },
  });
  return candidate;
}

function deathEventFor(state: SimulationState, personId: string): HistoricalEvent | undefined {
  return [...state.history].reverse().find(event => event.type === 'death' && event.actors.includes(personId));
}

function deathPosition(state: SimulationState, record: ArcRecord, death?: HistoricalEvent): Vec2 {
  if (death?.location) return death.location;
  const person = currentPerson(state, record.member);
  const home = state.settlements.find(settlement => settlement.id === person?.homeId);
  if (home) return home.position;
  const founding = foundingChapterBaseline(state)?.communities.find(community => community.settlementId === record.member.settlementId);
  return founding?.position ?? { x: 0, z: 0 };
}

function endingArcFacts(state: SimulationState, record: ArcRecord, person: Person): ArcSignal[] {
  const last = foundingCharacterObservation(state, record.member, `founding-character-ending-preview:${person.id}:${state.month}`);
  if (!last || record.observations.length === 0) return [];
  return arcSignals(state, record, last)
    .filter(signal => signal.kind !== 'family')
    .slice(0, 2);
}

export function chooseFoundingCharacterEndingScene(
  historian: Historian,
  state: SimulationState,
): ObservationCandidate | undefined {
  const memory = stateFor(historian);
  const records = [...memory.records.values()].sort((a, b) => a.member.communityOrder - b.member.communityOrder);
  for (const record of records) {
    if (memory.completedPersonIds.has(record.member.personId) || record.observations.length === 0) continue;
    const person = currentPerson(state, record.member);
    if (!person || person.alive || person.diedMonth === undefined) continue;
    const death = deathEventFor(state, person.id);
    if (record.endingEventId && (!death || record.endingEventId === death.id)) continue;
    const first = record.observations[0]!;
    const age = Math.floor(person.ageMonths / 12);
    const watchedMonths = Math.max(0, person.diedMonth - first.observedMonth);
    const watchedYears = Math.max(0, Math.floor(watchedMonths / 12));
    const arcFacts = endingArcFacts(state, record, person);
    const successors = successorsFor(state, person.id);
    const livingSuccessors = successors.filter(successor => successor.alive);
    const children = person.children.length;
    const home = state.settlements.find(settlement => settlement.id === person.homeId);
    const deathSentence = death?.summary ?? `${person.name} died at ${age.toLocaleString()} in ${home?.name ?? first.homeName}.`;
    const watching = record.observations.length === 1
      ? `I had watched this life once before its ending.`
      : `I returned to this life ${record.observations.length.toLocaleString()} times across ${watchedYears.toLocaleString()} ${watchedYears === 1 ? 'year' : 'years'}.`;
    const continuation: string[] = [];
    if (children > 0) continuation.push(`The family record names ${children.toLocaleString()} ${children === 1 ? 'child' : 'children'}.`);
    if (successors.length > 0) continuation.push(`${successors.length.toLocaleString()} ${successors.length === 1 ? 'person carries' : 'people carry'} expertise taught by ${person.name}${livingSuccessors.length !== successors.length ? `, with ${livingSuccessors.length.toLocaleString()} still alive` : ''}.`);
    if (person.historical?.status && person.historical.status !== 'ordinary') continuation.push(`By death, the civilization's own record marked ${person.name} as ${person.historical.status}.`);
    const text = `I first watched ${person.name} as one of ${record.member.podName}'s founders, age ${record.member.arrivalAgeYears} on Arrival Day. ${deathSentence} ${watching} ${arcFacts.map(signal => signal.text).join(' ')} ${continuation.join(' ')} This life is complete in the record; what continues belongs to the people and places that remain.`.replace(/\s+/g, ' ').trim();
    const arrival = foundingChapterBaseline(state);
    const sourceEventIds = unique([
      ...(arrival ? [arrival.eventId] : []),
      ...(death ? [death.id] : []),
      ...arcFacts.flatMap(signal => signal.eventIds),
      ...(person.historical?.eventIds ?? []),
    ]).filter(id => state.history.some(event => event.id === id));
    const sourceEntityIds = sourceEntitiesThatExist(state, [
      person.id,
      person.homeId,
      ...person.children.slice(0, 4),
      ...livingSuccessors.slice(0, 4).map(successor => successor.id),
    ]);
    const endingKey = death?.id ?? `month-${person.diedMonth}`;
    const statement: HistorianStatement = {
      id: `founding-character-ending:${person.id}:${endingKey}`,
      month: state.month,
      text,
      epistemicStatus: 'derived-statistic',
      sourceEventIds,
      sourceEntityIds,
      sourceArchiveIds: [],
      claims: { entityIds: sourceEntityIds },
    };
    if (!historian.validateStatement(statement, state)) continue;
    if (!historian.statements.some(existing => existing.id === statement.id)) historian.statements.push(statement);
    if (historian.statements.length > 1200) historian.statements.splice(0, historian.statements.length - 1200);
    record.endingEventId = endingKey;
    memory.completedPersonIds.add(person.id);
    pacingModes.set(state, 'ending');
    return {
      id: statement.id,
      subjectId: person.id,
      kind: 'aftermath-pullback',
      position: deathPosition(state, record, death),
      title: `${person.name} · ${age.toLocaleString()} YEARS`,
      statement,
      score: 0.97,
      interest: 0.95,
      audioCategory: 'historian',
      breakdown: arcBreakdown(0.98, 0),
      ...(death ? { event: death } : {}),
    };
  }
  return undefined;
}

function restoreArcStatement(record: ArcRecord, statement: HistorianStatement): void {
  if (statement.id.startsWith(`founding-character-ending:${record.member.personId}:`)) {
    record.endingEventId = statement.id.slice(`founding-character-ending:${record.member.personId}:`.length);
    return;
  }
  const match = statement.id.match(new RegExp(`^founding-character-arc:${record.member.personId}:(\\d+):(.+)$`));
  if (!match) return;
  record.lastArcMonth = Math.max(record.lastArcMonth, Number(match[1]));
  record.arcScenesShown += 1;
  try {
    for (const key of decodeURIComponent(match[2] ?? '').split('|').filter(Boolean)) record.shownSignalKeys.add(key);
  } catch {
    // Old or hand-authored statement IDs should never prevent the run from resuming.
  }
}

/** Rebuilds 2c presentation memory from archived statements after deterministic simulation replay. */
export function restoreFoundingCharacterArcs(
  historian: Historian,
  state: SimulationState,
  statements: readonly HistorianStatement[],
): void {
  const memory = stateFor(historian);
  memory.records.clear();
  memory.completedPersonIds.clear();
  const ordered = [...statements].sort((a, b) => a.month - b.month || a.id.localeCompare(b.id));
  for (const statement of ordered) {
    const snapshot = statement.observerMemory;
    if (snapshot?.kind === 'founding-character') rememberObservation(historian, state, snapshot);
  }
  for (const statement of ordered) {
    for (const record of memory.records.values()) {
      restoreArcStatement(record, statement);
      if (record.endingEventId) memory.completedPersonIds.add(record.member.personId);
    }
  }
}

export function foundingCharacterArcStatus(historian: Historian, personId: string): {
  observations: number;
  arcsShown: number;
  completed: boolean;
  lastArcMonth?: number;
} | undefined {
  const memory = stateFor(historian);
  const record = memory.records.get(personId);
  if (!record) return undefined;
  return {
    observations: record.observations.length,
    arcsShown: record.arcScenesShown,
    completed: memory.completedPersonIds.has(personId),
    ...(Number.isFinite(record.lastArcMonth) ? { lastArcMonth: record.lastArcMonth } : {}),
  };
}

function restoreCanonicalArcStatement(historian: Historian, scene: ObservationCandidate): void {
  const pending = pendingFor(historian).get(scene.id);
  if (!pending) return;
  const observerMemory = scene.statement.observerMemory;
  scene.statement.text = pending.canonicalStatement.text;
  scene.statement.epistemicStatus = pending.canonicalStatement.epistemicStatus;
  scene.statement.sourceEventIds = [...pending.canonicalStatement.sourceEventIds];
  scene.statement.sourceEntityIds = [...pending.canonicalStatement.sourceEntityIds];
  scene.statement.sourceArchiveIds = [...pending.canonicalStatement.sourceArchiveIds];
  scene.statement.claims = {
    ...pending.canonicalStatement.claims,
    entityIds: [...(pending.canonicalStatement.claims.entityIds ?? [])],
  };
  if (observerMemory) scene.statement.observerMemory = observerMemory;
  const record = stateFor(historian).records.get(pending.personId);
  if (record) {
    for (const key of pending.signalKeys) record.shownSignalKeys.add(key);
    record.lastArcMonth = scene.statement.month;
    record.arcScenesShown += 1;
  }
  pendingFor(historian).delete(scene.id);
}

export function installFoundingCharacterArcPacing(): void {
  if (pacingInstalled) return;
  pacingInstalled = true;
  const targetSpeed = PresentationDirector.prototype.targetSpeed;
  PresentationDirector.prototype.targetSpeed = function characterArcTargetSpeed(
    this: PresentationDirector,
    state: Parameters<typeof targetSpeed>[0],
    observation: Parameters<typeof targetSpeed>[1],
  ): number {
    const mode = pacingModes.get(state);
    if (mode === 'ending') return FOUNDING_CHARACTER_ENDING_MONTHS_PER_SECOND;
    if (mode === 'arc') return FOUNDING_CHARACTER_ARC_MONTHS_PER_SECOND;
    return targetSpeed.call(this, state, observation);
  };
}

/** Installed outermost: endings can interrupt ordinary rotation, while focused major events still win. */
export function installFoundingCharacterArcs(): void {
  if (installed) return;
  installed = true;
  installFoundingCharacterArcPacing();

  const candidates = Historian.prototype.candidates;
  Historian.prototype.candidates = function characterArcCandidates(this: Historian, state: SimulationState): ObservationCandidate[] {
    const pool = candidates.call(this, state);
    const memory = stateFor(this);
    for (const record of memory.records.values()) {
      const candidate = foundingCharacterArcCandidate(this, state, record.member.personId);
      if (candidate) pool.push(candidate);
    }
    return pool;
  };

  const chooseScene = Historian.prototype.chooseScene;
  Historian.prototype.chooseScene = function characterArcChooseScene(
    this: Historian,
    state: SimulationState,
    focusEventId?: string,
  ): ObservationCandidate {
    pacingModes.delete(state);
    if (focusEventId) return chooseScene.call(this, state, focusEventId);
    const ending = chooseFoundingCharacterEndingScene(this, state);
    if (ending) return ending;
    const scene = chooseScene.call(this, state);
    restoreCanonicalArcStatement(this, scene);
    const snapshot = scene.statement.observerMemory;
    if (snapshot?.kind === 'founding-character') rememberObservation(this, state, snapshot);
    if (scene.id.startsWith('founding-character-arc:')) pacingModes.set(state, 'arc');
    return scene;
  };
}
