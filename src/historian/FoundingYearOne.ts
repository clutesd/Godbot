import type { HistoricalEvent, SimulationState } from '../sim/types';
import { foundingChapterBaseline, type FoundingChapterBaseline, type FoundingCommunityBaseline } from './FoundingChapter';
import {
  FOUNDING_CONTINUITY_GRACE_END_MONTH,
  foundingCommunitySnapshot,
  foundingContinuityProgress,
  type FoundingCommunitySnapshot,
} from './FoundingContinuity';
import { Historian } from './Historian';
import { PresentationDirector } from './PresentationDirector';
import type { CandidateScoreBreakdown, ObservationCandidate } from './types';

export const FOUNDING_YEAR_ONE_MONTH = 12;
export const FOUNDING_YEAR_ONE_LATEST_START_MONTH = 24;
export const FOUNDING_YEAR_ONE_MONTHS_PER_SECOND = 0.08;

export interface FoundingYearOneSnapshot {
  readonly observedMonth: number;
  readonly yearEndMonth: number;
  readonly foundingPopulation: number;
  readonly yearOnePopulation: number;
  readonly births: number;
  readonly deaths: number;
  readonly activeFoundingCommunities: number;
  readonly permanentStructuresFounded: number;
  readonly firstContacts: number;
  readonly tradeRoutesEstablished: number;
  readonly knowledgeAdded: number;
  readonly significantEvents: readonly string[];
  readonly communities: readonly FoundingCommunitySnapshot[];
}

export interface FoundingYearOneProgress {
  readonly phase: 'unavailable' | 'waiting' | 'ready' | 'payoff' | 'complete' | 'missed';
  readonly nextBeat: number;
  readonly totalBeats: number;
  readonly snapshot?: FoundingYearOneSnapshot;
}

interface YearOneMemory {
  nextBeat: number;
  complete: boolean;
  snapshot: FoundingYearOneSnapshot;
  baseline: FoundingChapterBaseline;
  autoRunBeforePayoff?: boolean;
}

interface HistorianConfigAccess {
  config: { autoRun: boolean };
}

interface CommunityStory {
  community: FoundingCommunityBaseline;
  score: number;
  fact: string;
}

interface UnresolvedStory {
  score: number;
  text: string;
  sourceEntityIds: string[];
  position: { x: number; z: number };
  title: string;
}

const memories = new WeakMap<Historian, YearOneMemory>();
const pacedStates = new WeakSet<SimulationState>();
let pacingInstalled = false;
let installed = false;

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const readable = (value: string): string => value.replaceAll('-', ' ');

function historianConfig(historian: Historian): HistorianConfigAccess['config'] {
  return (historian as unknown as HistorianConfigAccess).config;
}

function holdPayoff(historian: Historian, state: SimulationState, memory: YearOneMemory): void {
  const config = historianConfig(historian);
  if (memory.autoRunBeforePayoff === undefined) memory.autoRunBeforePayoff = config.autoRun;
  config.autoRun = false;
  pacedStates.add(state);
}

function releasePayoff(historian: Historian, state: SimulationState): void {
  pacedStates.delete(state);
  const memory = memories.get(historian);
  if (!memory || memory.autoRunBeforePayoff === undefined) return;
  historianConfig(historian).autoRun = memory.autoRunBeforePayoff;
  delete memory.autoRunBeforePayoff;
}

function breakdown(continuity: number, consequence: number): CandidateScoreBreakdown {
  return {
    novelty: 0.86,
    magnitude: 0.7,
    populationAffected: 0.8,
    rarity: 0.78,
    technological: 0.18,
    political: 0.08,
    cultural: 0.52,
    consequence: clamp(consequence),
    continuity: clamp(continuity),
    repetitionPenalty: 0,
  };
}

function yearOneEvents(state: SimulationState, baseline: FoundingChapterBaseline): HistoricalEvent[] {
  const end = baseline.eventMonth + FOUNDING_YEAR_ONE_MONTH;
  return state.history.filter(event => event.month > baseline.eventMonth && event.month <= end);
}

/**
 * Reconstructs the factual first-year record from lifecycle/event timestamps, while retaining a
 * current community snapshot for the visual comparison beat. The first-year totals therefore stay
 * correct even if the payoff is delayed a few months by an important event or an interrupted 1b.
 */
export function foundingYearOneSnapshot(state: SimulationState): FoundingYearOneSnapshot | undefined {
  const baseline = foundingChapterBaseline(state);
  if (!baseline) return undefined;
  const yearEndMonth = baseline.eventMonth + FOUNDING_YEAR_ONE_MONTH;
  const events = yearOneEvents(state, baseline);
  const births = state.people.filter(person => person.bornMonth > baseline.eventMonth && person.bornMonth <= yearEndMonth).length;
  const deaths = state.people.filter(person => person.diedMonth !== undefined && person.diedMonth > baseline.eventMonth && person.diedMonth <= yearEndMonth).length;
  const abandoned = new Set<string>();
  for (const event of events.filter(candidate => candidate.type === 'settlement-abandoned')) {
    for (const community of baseline.communities) {
      if (event.locationId === community.settlementId || event.actors.includes(community.settlementId)) abandoned.add(community.settlementId);
    }
  }
  const permanentStructuresFounded = state.settlements
    .filter(settlement => baseline.communities.some(community => community.settlementId === settlement.id))
    .flatMap(settlement => settlement.structurePlots ?? [])
    .filter(plot => plot.foundedMonth > baseline.eventMonth && plot.foundedMonth <= yearEndMonth)
    .length;
  const firstContacts = events.filter(event => event.type === 'first-contact').length;
  const tradeRoutesEstablished = events.filter(event => event.type === 'trade-route-established').length;
  const knowledgeAdded = baseline.communities.reduce((sum, community) => {
    const settlement = state.settlements.find(candidate => candidate.id === community.settlementId);
    if (!settlement) return sum;
    return sum + Object.values(settlement.knowledge.records).filter(record => record.discoveredMonth > baseline.eventMonth && record.discoveredMonth <= yearEndMonth).length;
  }, 0);
  const significantEvents = events
    .filter(event => event.significance >= 0.58)
    .sort((a, b) => b.significance - a.significance || a.month - b.month)
    .slice(0, 4)
    .map(event => event.id);
  const communities = baseline.communities
    .map(community => foundingCommunitySnapshot(state, community, baseline))
    .filter((snapshot): snapshot is FoundingCommunitySnapshot => Boolean(snapshot));

  return Object.freeze({
    observedMonth: state.month,
    yearEndMonth,
    foundingPopulation: baseline.population,
    yearOnePopulation: Math.max(0, baseline.population + births - deaths),
    births,
    deaths,
    activeFoundingCommunities: Math.max(0, baseline.expectedCommunityCount - abandoned.size),
    permanentStructuresFounded,
    firstContacts,
    tradeRoutesEstablished,
    knowledgeAdded,
    significantEvents: Object.freeze(significantEvents),
    communities: Object.freeze(communities),
  });
}

function rememberStatement(historian: Historian, scene: ObservationCandidate, state: SimulationState): ObservationCandidate | undefined {
  if (!historian.validateStatement(scene.statement, state)) return undefined;
  if (!historian.statements.some(statement => statement.id === scene.statement.id)) historian.statements.push(scene.statement);
  if (historian.statements.length > 1200) historian.statements.splice(0, historian.statements.length - 1200);
  return scene;
}

function worldPayoffScene(
  historian: Historian,
  state: SimulationState,
  baseline: FoundingChapterBaseline,
  snapshot: FoundingYearOneSnapshot,
): ObservationCandidate | undefined {
  const arrival = state.history.find(event => event.id === baseline.eventId && event.type === 'ARRIVAL_DAY');
  if (!arrival) return undefined;
  const sourceEntityIds = baseline.communities
    .filter(community => state.settlements.some(settlement => settlement.id === community.settlementId))
    .map(community => community.settlementId);
  const contact = snapshot.firstContacts > 0
    ? `${snapshot.firstContacts.toLocaleString()} first-contact ${snapshot.firstContacts === 1 ? 'encounter was' : 'encounters were'} recorded`
    : 'no first contact between landing communities was yet recorded';
  const routes = snapshot.tradeRoutesEstablished > 0
    ? `; ${snapshot.tradeRoutesEstablished.toLocaleString()} trade ${snapshot.tradeRoutesEstablished === 1 ? 'route was' : 'routes were'} established`
    : '';
  const structures = snapshot.permanentStructuresFounded > 0
    ? `${snapshot.permanentStructuresFounded.toLocaleString()} permanent ${snapshot.permanentStructuresFounded === 1 ? 'structure had been founded' : 'structures had been founded'}`
    : 'no permanent structure had yet been completed';
  const knowledge = snapshot.knowledgeAdded > 0
    ? `; ${snapshot.knowledgeAdded.toLocaleString()} new knowledge ${snapshot.knowledgeAdded === 1 ? 'record had' : 'records had'} entered the founding communities`
    : '';
  const text = `The first year is now in the record. From ${snapshot.foundingPopulation.toLocaleString()} founders, ${snapshot.births.toLocaleString()} births and ${snapshot.deaths.toLocaleString()} deaths left a recorded population of ${snapshot.yearOnePopulation.toLocaleString()} after twelve months. ${snapshot.activeFoundingCommunities} of ${baseline.expectedCommunityCount} founding communities remained active; ${structures}; ${contact}${routes}${knowledge}.`;
  const statement = {
    id: `founding-year-one-world-${baseline.eventId}`,
    month: state.month,
    text,
    epistemicStatus: 'derived-statistic' as const,
    sourceEventIds: [arrival.id, ...snapshot.significantEvents],
    sourceEntityIds: ['world', ...sourceEntityIds],
    sourceArchiveIds: [],
    claims: { entityIds: sourceEntityIds },
  };
  return rememberStatement(historian, {
    id: `founding-year-one:world:${baseline.eventId}`,
    subjectId: 'world',
    kind: 'world-establishing',
    position: baseline.center,
    title: 'ONE YEAR AFTER ARRIVAL',
    statement,
    score: 0.94,
    interest: 0.94,
    audioCategory: 'historian',
    breakdown: breakdown(1, 0.86),
  }, state);
}

function communityStory(community: FoundingCommunityBaseline, snapshot: FoundingCommunitySnapshot): CommunityStory {
  const populationDelta = snapshot.population - community.founderCount;
  const foodRatio = snapshot.food / Math.max(1, community.supplies.food);
  const stockDelta = Math.max(
    Math.abs(snapshot.food - community.supplies.food) / Math.max(1, community.supplies.food),
    Math.abs(snapshot.timber - community.supplies.timber) / Math.max(1, community.supplies.timber),
    Math.abs(snapshot.stone - community.supplies.stone) / Math.max(1, community.supplies.stone),
  );
  const founderLosses = Math.max(0, community.founderCount - snapshot.founderSurvivors);
  const candidates: Array<{ score: number; fact: string }> = [
    {
      score: 0.25 + Math.abs(populationDelta) / Math.max(4, community.founderCount),
      fact: populationDelta === 0
        ? `still has ${snapshot.population.toLocaleString()} people, the same number that landed`
        : populationDelta > 0
          ? `has grown from ${community.founderCount.toLocaleString()} founders to ${snapshot.population.toLocaleString()} people`
          : `has fallen from ${community.founderCount.toLocaleString()} founders to ${snapshot.population.toLocaleString()} people`,
    },
    ...(snapshot.buildings > 0 ? [{ score: 0.48 + snapshot.buildings * 0.06, fact: `has ${snapshot.buildings.toLocaleString()} permanent ${snapshot.buildings === 1 ? 'structure' : 'structures'} standing` }] : []),
    ...(snapshot.newKnowledgeIds.length > 0 ? [{ score: 0.5 + snapshot.newKnowledgeIds.length * 0.07, fact: `has added ${snapshot.newKnowledgeIds.slice(0, 2).map(readable).join(' and ')} to its recorded knowledge` }] : []),
    ...(snapshot.workedDeposits > 0 ? [{ score: 0.46 + snapshot.workedDeposits * 0.07, fact: `is working ${snapshot.workedDeposits.toLocaleString()} local ${snapshot.workedDeposits === 1 ? 'resource deposit' : 'resource deposits'}` }] : []),
    ...(founderLosses > 0 ? [{ score: 0.58 + founderLosses / Math.max(4, community.founderCount), fact: `has lost ${founderLosses.toLocaleString()} of its original founders` }] : []),
    ...(foodRatio < 0.7 ? [{ score: 0.55 + (0.7 - foodRatio), fact: `has reduced its founding food reserve from ${Math.round(community.supplies.food).toLocaleString()} to ${Math.round(snapshot.food).toLocaleString()}` }] : []),
    ...(stockDelta > 0.6 ? [{ score: 0.4 + Math.min(0.4, stockDelta * 0.2), fact: 'has materially changed the finite stores it carried through the landing' }] : []),
  ];
  candidates.sort((a, b) => b.score - a.score || a.fact.localeCompare(b.fact));
  const strongest = candidates[0] ?? { score: 0.2, fact: 'remains close to its landing conditions' };
  return { community, score: strongest.score, fact: strongest.fact };
}

function divergenceScene(
  historian: Historian,
  state: SimulationState,
  baseline: FoundingChapterBaseline,
  snapshot: FoundingYearOneSnapshot,
): ObservationCandidate | undefined {
  const arrival = state.history.find(event => event.id === baseline.eventId && event.type === 'ARRIVAL_DAY');
  if (!arrival) return undefined;
  const stories = snapshot.communities
    .map(current => {
      const community = baseline.communities.find(candidate => candidate.settlementId === current.settlementId);
      return community ? communityStory(community, current) : undefined;
    })
    .filter((story): story is CommunityStory => Boolean(story))
    .sort((a, b) => b.score - a.score || a.community.order - b.community.order);
  if (stories.length === 0) return undefined;
  const selected = stories.slice(0, Math.min(2, stories.length));
  const clauses = selected.map(story => `${story.community.settlementName} ${story.fact}`);
  const observed = snapshot.observedMonth <= snapshot.yearEndMonth
    ? 'At the end of the first year'
    : `By Month ${snapshot.observedMonth.toLocaleString()}, with the first year already behind them`;
  const text = `${observed}, the founding landings are no longer interchangeable. ${clauses.join('; while ')}. A common arrival has already become different local histories.`;
  const sourceEntityIds = selected.map(story => story.community.settlementId);
  const statement = {
    id: `founding-year-one-divergence-${baseline.eventId}`,
    month: state.month,
    text,
    epistemicStatus: 'derived-statistic' as const,
    sourceEventIds: [arrival.id],
    sourceEntityIds,
    sourceArchiveIds: [],
    claims: { entityIds: sourceEntityIds },
  };
  return rememberStatement(historian, {
    id: `founding-year-one:divergence:${baseline.eventId}`,
    subjectId: selected[0]?.community.settlementId ?? 'world',
    kind: 'city-growth-timelapse',
    position: selected[0]?.community.position ?? baseline.center,
    title: 'THE LANDINGS DIVERGE',
    statement,
    score: 0.91,
    interest: 0.91,
    audioCategory: 'historian',
    breakdown: breakdown(1, 0.8),
  }, state);
}

function unresolvedStory(baseline: FoundingChapterBaseline, snapshot: FoundingYearOneSnapshot): UnresolvedStory {
  const stories: UnresolvedStory[] = [];
  for (const current of snapshot.communities) {
    const community = baseline.communities.find(candidate => candidate.settlementId === current.settlementId);
    if (!community) continue;
    const founderLosses = Math.max(0, community.founderCount - current.founderSurvivors);
    const foodRatio = current.food / Math.max(1, community.supplies.food);
    if (!current.alive) stories.push({ score: 1, text: `${community.settlementName} is no longer an active community. One of the original landings has already become memory.`, sourceEntityIds: [community.settlementId], position: community.position, title: community.settlementName });
    if (current.foodSecurity < 0.42) stories.push({ score: 0.9 + (0.42 - current.foodSecurity), text: `${community.settlementName} ends this chapter with food security at ${Math.round(current.foodSecurity * 100)}%. Survival there is still materially constrained.`, sourceEntityIds: [community.settlementId], position: community.position, title: community.settlementName });
    if (foodRatio < 0.45) stories.push({ score: 0.82 + (0.45 - foodRatio), text: `${community.settlementName} has less than half of its original food reserve remaining. The founding stores are not an indefinite solution.`, sourceEntityIds: [community.settlementId], position: community.position, title: community.settlementName });
    if (founderLosses > 0) stories.push({ score: 0.7 + founderLosses / Math.max(4, community.founderCount), text: `${community.settlementName} has already lost ${founderLosses.toLocaleString()} of the people who stepped out of its vessel. The founding generation is no longer intact.`, sourceEntityIds: [community.settlementId], position: community.position, title: community.settlementName });
    if (current.buildings === 0 && current.constructionProgress <= 0.04) stories.push({ score: 0.58, text: `${community.settlementName} still has no permanent structure standing. Its landing remains closer to a camp than a settled town.`, sourceEntityIds: [community.settlementId], position: community.position, title: community.settlementName });
    const unused = community.knowledge.filter(id => !current.inheritedKnowledgeUsed.includes(id));
    if (unused.length > 0) stories.push({ score: 0.46 + unused.length * 0.04, text: `${community.settlementName} still carries inherited knowledge that has not yet entered regular practice: ${unused.slice(0, 2).map(readable).join(' and ')}.`, sourceEntityIds: [community.settlementId], position: community.position, title: community.settlementName });
  }
  const traceableIds = snapshot.communities.map(community => community.settlementId);
  if (snapshot.firstContacts === 0) {
    stories.push({ score: 0.72, text: 'The first year closes without a recorded first contact between the separated landing communities. They share an origin, but not yet a common history.', sourceEntityIds: traceableIds, position: baseline.center, title: 'The separated landings' });
  } else if (snapshot.tradeRoutesEstablished === 0) {
    stories.push({ score: 0.62, text: 'The landings have begun to encounter one another, but no trade route was established during the first year. Contact has not yet become a durable corridor.', sourceEntityIds: traceableIds, position: baseline.center, title: 'The spaces between' });
  }
  stories.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return stories[0] ?? {
    score: 0.35,
    text: 'The first year ends without a single dominant crisis. What remains unresolved is which differences between the landings will matter over generations.',
    sourceEntityIds: traceableIds,
    position: baseline.center,
    title: 'The next chapter',
  };
}

function unresolvedScene(
  historian: Historian,
  state: SimulationState,
  baseline: FoundingChapterBaseline,
  snapshot: FoundingYearOneSnapshot,
): ObservationCandidate | undefined {
  const arrival = state.history.find(event => event.id === baseline.eventId && event.type === 'ARRIVAL_DAY');
  if (!arrival) return undefined;
  const unresolved = unresolvedStory(baseline, snapshot);
  const standout = snapshot.significantEvents
    .map(id => state.history.find(event => event.id === id))
    .filter((event): event is HistoricalEvent => Boolean(event))
    .sort((a, b) => b.significance - a.significance)[0];
  const standoutText = standout ? ` The strongest event recorded in that first year was: ${standout.summary}` : '';
  const statement = {
    id: `founding-year-one-unresolved-${baseline.eventId}`,
    month: state.month,
    text: `${unresolved.text}${standoutText} This is where the opening chapter ends; the consequences remain unwritten.`,
    epistemicStatus: 'derived-statistic' as const,
    sourceEventIds: [arrival.id, ...(standout ? [standout.id] : [])],
    sourceEntityIds: unresolved.sourceEntityIds,
    sourceArchiveIds: [],
    claims: { entityIds: unresolved.sourceEntityIds },
  };
  return rememberStatement(historian, {
    id: `founding-year-one:unresolved:${baseline.eventId}`,
    subjectId: unresolved.sourceEntityIds[0] ?? 'world',
    kind: 'historian-context',
    position: unresolved.position,
    title: 'WHAT REMAINS UNRESOLVED',
    statement,
    score: clamp(0.84 + unresolved.score * 0.08),
    interest: clamp(0.84 + unresolved.score * 0.1),
    audioCategory: 'historian',
    breakdown: breakdown(1, unresolved.score),
  }, state);
}

export function foundingYearOneProgress(historian: Historian, state: SimulationState): FoundingYearOneProgress {
  const baseline = foundingChapterBaseline(state);
  if (!baseline || state.arrival?.phase !== 'HISTORY_RUNNING') return { phase: 'unavailable', nextBeat: 0, totalBeats: 3 };
  const memory = memories.get(historian);
  if (memory) return {
    phase: memory.complete ? 'complete' : 'payoff',
    nextBeat: memory.nextBeat,
    totalBeats: 3,
    snapshot: memory.snapshot,
  };
  const dueMonth = baseline.eventMonth + FOUNDING_YEAR_ONE_MONTH;
  if (state.month < dueMonth) return { phase: 'waiting', nextBeat: 0, totalBeats: 3 };
  if (state.month > baseline.eventMonth + FOUNDING_YEAR_ONE_LATEST_START_MONTH) return { phase: 'missed', nextBeat: 0, totalBeats: 3 };
  const continuity = foundingContinuityProgress(historian, state);
  const continuityGraceEnd = baseline.eventMonth + FOUNDING_CONTINUITY_GRACE_END_MONTH;
  if (continuity.bridgeShown && !continuity.complete && state.month <= continuityGraceEnd) return { phase: 'waiting', nextBeat: 0, totalBeats: 3 };
  return { phase: 'ready', nextBeat: 0, totalBeats: 3, snapshot: foundingYearOneSnapshot(state) };
}

/** Three-shot chapter ending: world synthesis, divergence, unresolved thread. */
export function chooseFoundingYearOneScene(historian: Historian, state: SimulationState): ObservationCandidate | undefined {
  pacedStates.delete(state);
  const progress = foundingYearOneProgress(historian, state);
  if (progress.phase === 'unavailable' || progress.phase === 'waiting' || progress.phase === 'missed') return undefined;
  let memory = memories.get(historian);
  if (!memory) {
    const baseline = foundingChapterBaseline(state);
    const snapshot = foundingYearOneSnapshot(state);
    if (!baseline || !snapshot) return undefined;
    memory = { nextBeat: 0, complete: false, snapshot, baseline };
    memories.set(historian, memory);
  }
  if (memory.complete) {
    releasePayoff(historian, state);
    return undefined;
  }
  const beat = memory.nextBeat;
  const scene = beat === 0
    ? worldPayoffScene(historian, state, memory.baseline, memory.snapshot)
    : beat === 1
      ? divergenceScene(historian, state, memory.baseline, memory.snapshot)
      : unresolvedScene(historian, state, memory.baseline, memory.snapshot);
  memory.nextBeat += 1;
  if (memory.nextBeat >= 3) memory.complete = true;
  if (!scene) {
    if (memory.complete) releasePayoff(historian, state);
    return undefined;
  }
  holdPayoff(historian, state, memory);
  return scene;
}

export function installFoundingYearOnePacing(): void {
  if (pacingInstalled) return;
  pacingInstalled = true;
  const targetSpeed = PresentationDirector.prototype.targetSpeed;
  PresentationDirector.prototype.targetSpeed = function yearOneTargetSpeed(
    this: PresentationDirector,
    state: Parameters<typeof targetSpeed>[0],
    observation: Parameters<typeof targetSpeed>[1],
  ): number {
    if (pacedStates.has(state)) return FOUNDING_YEAR_ONE_MONTHS_PER_SECOND;
    return targetSpeed.call(this, state, observation);
  };
  const tickBudget = PresentationDirector.prototype.tickBudget;
  PresentationDirector.prototype.tickBudget = function yearOneTickBudget(
    this: PresentationDirector,
    state: Parameters<typeof tickBudget>[0],
  ): number {
    if (pacedStates.has(state)) return 0;
    return tickBudget.call(this, state);
  };
}

/** Install after 1b. Focused major events retain precedence over the retrospective. */
export function installFoundingYearOne(): void {
  if (installed) return;
  installed = true;
  installFoundingYearOnePacing();
  const chooseScene = Historian.prototype.chooseScene;
  Historian.prototype.chooseScene = function yearOneChooseScene(
    this: Historian,
    state: SimulationState,
    focusEventId?: string,
  ): ObservationCandidate {
    if (focusEventId) return chooseScene.call(this, state, focusEventId);
    const payoff = chooseFoundingYearOneScene(this, state);
    if (payoff) return payoff;
    return chooseScene.call(this, state);
  };
}
