import type { Person, SimulationState } from '../sim/types';
import { foundingChapterBaseline, foundingChapterProgress, releaseFoundingChapterHold, type FoundingChapterBaseline, type FoundingCommunityBaseline } from './FoundingChapter';
import { Historian } from './Historian';
import { PresentationDirector } from './PresentationDirector';
import type { CandidateScoreBreakdown, ObservationCandidate } from './types';

export const FOUNDING_CAST_TARGET_SIZE = 2;
export const FOUNDING_CAST_LATEST_INTRO_MONTH = 1;
export const FOUNDING_CAST_MONTHS_PER_SECOND = 0.08;
export const FOUNDING_CAST_RELEASE_MONTHS_PER_SECOND = 0.16;

export interface FoundingCastMember {
  readonly personId: string;
  readonly name: string;
  readonly settlementId: string;
  readonly settlementName: string;
  readonly podId: string;
  readonly podName: string;
  readonly communityOrder: number;
  readonly arrivalAgeYears: number;
  readonly sex: Person['sex'];
  readonly selectionScore: number;
}

export interface FoundingCastProgress {
  readonly phase: 'unavailable' | 'waiting' | 'introducing' | 'complete' | 'missed';
  readonly members: readonly FoundingCastMember[];
  readonly introducedPersonIds: readonly string[];
  readonly targetSize: number;
}

interface FoundingCastMemory {
  readonly members: readonly FoundingCastMember[];
  readonly introducedPersonIds: Set<string>;
  readonly normalAppearances: Map<string, number>;
  releaseShown: boolean;
  autoRunBeforeIntroduction?: boolean;
}

interface HistorianConfigAccess {
  config: { autoRun: boolean };
}

interface AnchorCandidate {
  member: FoundingCastMember;
  ageBand: 'young-adult' | 'midlife' | 'older-founder';
  baseScore: number;
}

const memories = new WeakMap<Historian, FoundingCastMemory>();
const pacedStates = new WeakSet<SimulationState>();
const releaseStates = new WeakSet<SimulationState>();
let pacingInstalled = false;
let installed = false;

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const readable = (value: string): string => value.replaceAll('-', ' ');

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function ageBand(age: number): AnchorCandidate['ageBand'] {
  if (age < 27) return 'young-adult';
  if (age >= 43) return 'older-founder';
  return 'midlife';
}

function arrivalAgeYears(person: Person, baseline: FoundingChapterBaseline): number {
  return Math.max(0, Math.floor((baseline.eventMonth - person.bornMonth) / 12));
}

function anchorForCommunity(
  state: SimulationState,
  baseline: FoundingChapterBaseline,
  community: FoundingCommunityBaseline,
): AnchorCandidate | undefined {
  const founders = community.founderIds
    .map(id => state.people.find(person => person.id === id))
    .filter((person): person is Person => Boolean(person));
  if (founders.length === 0) return undefined;

  const ranked = founders.map(person => {
    const age = arrivalAgeYears(person, baseline);
    const ageDistinctiveness = clamp(Math.abs(age - 34) / 20);
    const stableTie = stableUnit(`${baseline.eventId}:${community.podId}:${person.id}`);
    const baseScore = 0.56 + ageDistinctiveness * 0.18 + stableTie * 0.18;
    return {
      member: Object.freeze({
        personId: person.id,
        name: person.name,
        settlementId: community.settlementId,
        settlementName: community.settlementName,
        podId: community.podId,
        podName: community.podName,
        communityOrder: community.order,
        arrivalAgeYears: age,
        sex: person.sex,
        selectionScore: clamp(baseScore),
      }),
      ageBand: ageBand(age),
      baseScore,
    } satisfies AnchorCandidate;
  }).sort((a, b) => b.baseScore - a.baseScore || a.member.personId.localeCompare(b.member.personId));
  return ranked[0];
}

/**
 * A deterministic documentary cast, not a simulation status. Selection spreads attention across
 * founding communities and ages/sexes, using only stable founder identity and Arrival-Day age.
 * No person receives prestige, protection, influence, or historical importance from being chosen.
 */
export function foundingDocumentaryCast(state: SimulationState, targetSize = FOUNDING_CAST_TARGET_SIZE): readonly FoundingCastMember[] {
  const baseline = foundingChapterBaseline(state);
  if (!baseline) return Object.freeze([]);
  const anchors = baseline.communities
    .map(community => anchorForCommunity(state, baseline, community))
    .filter((candidate): candidate is AnchorCandidate => Boolean(candidate));
  const selected: AnchorCandidate[] = [];
  const usedSexes = new Set<Person['sex']>();
  const usedAgeBands = new Set<AnchorCandidate['ageBand']>();
  const limit = Math.min(Math.max(0, targetSize), anchors.length);

  while (selected.length < limit) {
    const remaining = anchors.filter(candidate => !selected.includes(candidate));
    remaining.sort((a, b) => {
      const scoreA = a.baseScore + (usedSexes.has(a.member.sex) ? 0 : 0.08) + (usedAgeBands.has(a.ageBand) ? 0 : 0.09);
      const scoreB = b.baseScore + (usedSexes.has(b.member.sex) ? 0 : 0.08) + (usedAgeBands.has(b.ageBand) ? 0 : 0.09);
      return scoreB - scoreA || a.member.communityOrder - b.member.communityOrder || a.member.personId.localeCompare(b.member.personId);
    });
    const next = remaining[0];
    if (!next) break;
    selected.push(next);
    usedSexes.add(next.member.sex);
    usedAgeBands.add(next.ageBand);
  }

  return Object.freeze(selected.map(candidate => candidate.member).sort((a, b) => a.communityOrder - b.communityOrder));
}

function memoryFor(historian: Historian, state: SimulationState): FoundingCastMemory {
  let memory = memories.get(historian);
  if (!memory) {
    memory = {
      members: foundingDocumentaryCast(state),
      introducedPersonIds: new Set(),
      normalAppearances: new Map(),
      releaseShown: false,
    };
    memories.set(historian, memory);
  }
  return memory;
}

function historianConfig(historian: Historian): HistorianConfigAccess['config'] {
  return (historian as unknown as HistorianConfigAccess).config;
}

function holdIntroduction(historian: Historian, state: SimulationState, memory: FoundingCastMemory): void {
  const config = historianConfig(historian);
  if (memory.autoRunBeforeIntroduction === undefined) memory.autoRunBeforeIntroduction = config.autoRun;
  config.autoRun = false;
  pacedStates.add(state);
}

function releaseIntroduction(historian: Historian, state: SimulationState): void {
  pacedStates.delete(state);
  const memory = memories.get(historian);
  if (!memory || memory.autoRunBeforeIntroduction === undefined) return;
  historianConfig(historian).autoRun = memory.autoRunBeforeIntroduction;
  delete memory.autoRunBeforeIntroduction;
}

function breakdown(continuity: number, consequence = 0.4): CandidateScoreBreakdown {
  return {
    novelty: 0.82,
    magnitude: 0.28,
    populationAffected: 0.05,
    rarity: 0.58,
    technological: 0.12,
    political: 0,
    cultural: 0.48,
    consequence: clamp(consequence),
    continuity: clamp(continuity),
    repetitionPenalty: 0,
  };
}

function pronoun(person: Person): { subject: string; possessive: string } {
  return person.sex === 'female' ? { subject: 'She', possessive: 'her' } : { subject: 'He', possessive: 'his' };
}

function roleLabel(person: Person): string {
  return readable(person.role ?? person.occupation);
}

function expertisePhrase(person: Person): string | undefined {
  const strongest = [...(person.expertise ?? [])].sort((a, b) => b.competence - a.competence || a.domain.localeCompare(b.domain))[0];
  if (!strongest) return undefined;
  const level = strongest.competence >= 0.7 ? 'highly experienced in' : strongest.competence >= 0.4 ? 'practised in' : 'developing expertise in';
  return `${level} ${readable(strongest.domain)}`;
}

function introductionScene(
  historian: Historian,
  state: SimulationState,
  baseline: FoundingChapterBaseline,
  member: FoundingCastMember,
  castIndex: number,
): ObservationCandidate | undefined {
  const person = state.people.find(candidate => candidate.id === member.personId && candidate.alive);
  const settlement = state.settlements.find(candidate => candidate.id === member.settlementId);
  const arrival = state.history.find(event => event.id === baseline.eventId && event.type === 'ARRIVAL_DAY');
  if (!person || !settlement || !arrival) return undefined;
  const words = pronoun(person);
  const strongest = [...(person.expertise ?? [])].sort((a, b) => b.competence - a.competence || a.domain.localeCompare(b.domain))[0];
  const possessive = words.possessive === 'her' ? 'Her' : 'His';
  const anchorFact = strongest
    ? `${possessive} strongest recorded skill is ${readable(strongest.domain)}.`
    : `${words.subject} works as a ${roleLabel(person)}.`;
  const text = `${member.arrivalAgeYears} on Arrival Day. ${anchorFact}`;
  const statement = {
    id: `founding-cast-introduction-${member.personId}`,
    month: state.month,
    text,
    epistemicStatus: 'derived-statistic' as const,
    sourceEventIds: [arrival.id],
    sourceEntityIds: [person.id, settlement.id],
    sourceArchiveIds: [],
    claims: { entityIds: [person.id, settlement.id], eventType: 'ARRIVAL_DAY' as const },
  };
  if (!historian.validateStatement(statement, state)) return undefined;
  if (!historian.statements.some(existing => existing.id === statement.id)) historian.statements.push(statement);
  if (historian.statements.length > 1200) historian.statements.splice(0, historian.statements.length - 1200);
  return {
    id: `founding-cast:introduction:${castIndex}:${member.personId}`,
    subjectId: person.id,
    kind: person.activity === 'travel' || person.activity === 'migrate' || person.activity === 'transport' ? 'traveler-follow' : 'worker-follow',
    position: person.position,
    title: `${person.name} · ${member.settlementName}`,
    statement,
    score: 0.81,
    interest: 0.78,
    audioCategory: 'settlement',
    breakdown: breakdown(1, 0.48),
    event: arrival,
  };
}

export function foundingCastProgress(historian: Historian, state: SimulationState): FoundingCastProgress {
  const baseline = foundingChapterBaseline(state);
  if (!baseline || state.arrival?.phase !== 'HISTORY_RUNNING') return { phase: 'unavailable', members: Object.freeze([]), introducedPersonIds: Object.freeze([]), targetSize: 0 };
  const memory = memories.get(historian);
  const members = memory?.members ?? foundingDocumentaryCast(state);
  const introduced = memory ? [...memory.introducedPersonIds] : [];
  if (memory?.releaseShown && introduced.length >= members.length) {
    return { phase: 'complete', members, introducedPersonIds: Object.freeze(introduced), targetSize: members.length };
  }
  if (state.month > baseline.eventMonth + FOUNDING_CAST_LATEST_INTRO_MONTH) {
    return { phase: 'missed', members, introducedPersonIds: Object.freeze(introduced), targetSize: members.length };
  }
  const founding = foundingChapterProgress(historian, state);
  return {
    phase: founding.phase === 'complete' ? 'introducing' : 'waiting',
    members,
    introducedPersonIds: Object.freeze(introduced),
    targetSize: members.length,
  };
}

function releaseScene(
  historian: Historian,
  state: SimulationState,
  baseline: FoundingChapterBaseline,
  memory: FoundingCastMemory,
): ObservationCandidate | undefined {
  const arrival = state.history.find(event => event.id === baseline.eventId && event.type === 'ARRIVAL_DAY');
  const member = [...memory.members].reverse().find(candidate => memory.introducedPersonIds.has(candidate.personId));
  const person = member ? state.people.find(candidate => candidate.id === member.personId && candidate.alive) : undefined;
  const settlement = member ? state.settlements.find(candidate => candidate.id === member.settlementId) : undefined;
  if (!arrival || !member || !person || !settlement) return undefined;
  const statement = {
    id: `founding-release-${arrival.id}`,
    month: state.month,
    text: 'The first day continues.',
    epistemicStatus: 'recorded-fact' as const,
    sourceEventIds: [arrival.id],
    sourceEntityIds: [settlement.id],
    sourceArchiveIds: [],
    claims: { entityIds: [settlement.id], eventType: 'ARRIVAL_DAY' as const },
  };
  if (!historian.validateStatement(statement, state)) return undefined;
  if (!historian.statements.some(existing => existing.id === statement.id)) historian.statements.push(statement);
  if (historian.statements.length > 1200) historian.statements.splice(0, historian.statements.length - 1200);
  return {
    id: `founding-release:${arrival.id}`,
    subjectId: 'world',
    kind: 'street-observation',
    position: person.position,
    title: 'THE FIRST DAY',
    statement,
    score: 0.86,
    interest: 0.7,
    audioCategory: 'settlement',
    breakdown: breakdown(1, 0.28),
    event: arrival,
  };
}

/**
 * The cast is the final authored beat of Arrival Day: two concise human anchors, then a
 * caption-free release shot. Selection changes no simulation importance. Portraits pause
 * authoritative history; the release restores time and lets ordinary life move.
 */
export function chooseFoundingCastScene(historian: Historian, state: SimulationState): ObservationCandidate | undefined {
  releaseIntroduction(historian, state);
  releaseStates.delete(state);
  const baseline = foundingChapterBaseline(state);
  if (!baseline || state.arrival?.phase !== 'HISTORY_RUNNING') return undefined;
  if (state.month > baseline.eventMonth + FOUNDING_CAST_LATEST_INTRO_MONTH) return undefined;
  const founding = foundingChapterProgress(historian, state);
  if (founding.phase !== 'complete') return undefined;

  // Cast presentation is the immediate handoff from the frozen founding orientation.
  releaseFoundingChapterHold(historian, state);
  const memory = memoryFor(historian, state);

  for (let castIndex = 0; castIndex < memory.members.length; castIndex += 1) {
    const member = memory.members[castIndex]!;
    if (memory.introducedPersonIds.has(member.personId)) continue;
    const scene = introductionScene(historian, state, baseline, member, castIndex);
    if (!scene) continue;
    memory.introducedPersonIds.add(member.personId);
    holdIntroduction(historian, state, memory);
    return scene;
  }

  if (!memory.releaseShown && memory.introducedPersonIds.size >= memory.members.length) {
    const release = releaseScene(historian, state, baseline, memory);
    if (release) {
      memory.releaseShown = true;
      releaseStates.add(state);
      return release;
    }
  }
  return undefined;
}

function recurringCandidate(
  historian: Historian,
  state: SimulationState,
  member: FoundingCastMember,
  normalAppearances: number,
): ObservationCandidate | undefined {
  const person = state.people.find(candidate => candidate.id === member.personId && candidate.alive);
  const settlement = state.settlements.find(candidate => candidate.id === person?.homeId);
  const arrival = foundingChapterBaseline(state);
  if (!person || !settlement || !arrival) return undefined;
  const work = person.activity === 'socialize' ? 'spending time with others' : person.activity === 'rest' ? 'resting' : person.activity;
  const expertise = expertisePhrase(person);
  const statement = {
    id: `founding-cast-current-${person.id}-${state.month}`,
    month: state.month,
    text: `${person.name}, one of ${member.podName}'s original founders, is ${work} near ${settlement.name}. ${person.name} now works as a ${roleLabel(person)}${expertise ? ` and is ${expertise}` : ''}.`,
    epistemicStatus: 'recorded-fact' as const,
    sourceEventIds: [arrival.eventId],
    sourceEntityIds: [person.id, settlement.id],
    sourceArchiveIds: [],
    claims: { entityIds: [person.id, settlement.id], eventType: 'ARRIVAL_DAY' as const },
  };
  if (!historian.validateStatement(statement, state)) return undefined;
  const penalty = Math.min(0.24, normalAppearances * 0.045);
  return {
    id: `founding-cast:current:${person.id}:${state.month}`,
    subjectId: person.id,
    kind: person.activity === 'travel' || person.activity === 'migrate' || person.activity === 'transport' ? 'traveler-follow' : 'worker-follow',
    position: person.position,
    title: person.name,
    statement,
    score: clamp(0.54 + person.prestige * 0.08 - penalty, 0.3, 0.68),
    interest: 0.4,
    audioCategory: person.activity === 'travel' || person.activity === 'migrate' ? 'ambient-wilderness' : 'settlement',
    breakdown: { ...breakdown(0.72, 0.28), repetitionPenalty: penalty },
  };
}

export function installFoundingCastPacing(): void {
  if (pacingInstalled) return;
  pacingInstalled = true;
  const targetSpeed = PresentationDirector.prototype.targetSpeed;
  PresentationDirector.prototype.targetSpeed = function castTargetSpeed(
    this: PresentationDirector,
    state: Parameters<typeof targetSpeed>[0],
    observation: Parameters<typeof targetSpeed>[1],
  ): number {
    if (pacedStates.has(state)) return FOUNDING_CAST_MONTHS_PER_SECOND;
    if (releaseStates.has(state)) return FOUNDING_CAST_RELEASE_MONTHS_PER_SECOND;
    return targetSpeed.call(this, state, observation);
  };
  const tickBudget = PresentationDirector.prototype.tickBudget;
  PresentationDirector.prototype.tickBudget = function castTickBudget(
    this: PresentationDirector,
    state: Parameters<typeof tickBudget>[0],
  ): number {
    if (pacedStates.has(state)) return 0;
    return tickBudget.call(this, state);
  };
}

/** Installed outermost so Arrival Day resolves its human handoff before continuity or Year-One narration. */
export function installFoundingCast(): void {
  if (installed) return;
  installed = true;
  installFoundingCastPacing();

  const candidates = Historian.prototype.candidates;
  Historian.prototype.candidates = function castCandidates(this: Historian, state: SimulationState): ObservationCandidate[] {
    const pool = candidates.call(this, state);
    const memory = memories.get(this);
    if (!memory || memory.introducedPersonIds.size === 0) return pool;
    const existingSubjects = new Set(pool.map(candidate => candidate.subjectId));
    for (const member of memory.members) {
      if (!memory.introducedPersonIds.has(member.personId) || existingSubjects.has(member.personId)) continue;
      const recurring = recurringCandidate(this, state, member, memory.normalAppearances.get(member.personId) ?? 0);
      if (recurring) pool.push(recurring);
    }
    return pool;
  };

  const chooseScene = Historian.prototype.chooseScene;
  Historian.prototype.chooseScene = function castChooseScene(
    this: Historian,
    state: SimulationState,
    focusEventId?: string,
  ): ObservationCandidate {
    if (focusEventId) {
      releaseIntroduction(this, state);
      releaseStates.delete(state);
      return chooseScene.call(this, state, focusEventId);
    }
    const introduction = chooseFoundingCastScene(this, state);
    if (introduction) return introduction;
    const scene = chooseScene.call(this, state);
    const memory = memories.get(this);
    if (memory && memory.introducedPersonIds.has(scene.subjectId)) {
      memory.normalAppearances.set(scene.subjectId, (memory.normalAppearances.get(scene.subjectId) ?? 0) + 1);
    }
    return scene;
  };
}
