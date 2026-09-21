import { settlementRepresentedPopulation } from '../sim/Population';
import { shelterCapacity } from '../sim/development/Shelter';
import type { SimulationState } from '../sim/types';
import {
  foundingChapterBaseline,
  foundingChapterProgress,
  releaseFoundingChapterHold,
  type FoundingChapterBaseline,
  type FoundingCommunityBaseline,
} from './FoundingChapter';
import { Historian } from './Historian';
import { PresentationDirector } from './PresentationDirector';
import type { CandidateScoreBreakdown, ObservationCandidate } from './types';

export const FOUNDING_CONTINUITY_PRIMARY_END_MONTH = 12;
export const FOUNDING_CONTINUITY_GRACE_END_MONTH = 18;
export const FOUNDING_CONTINUITY_MONTHS_PER_SECOND = 0.12;

export interface FoundingCommunitySnapshot {
  readonly month: number;
  readonly settlementId: string;
  readonly settlementName: string;
  readonly alive: boolean;
  readonly population: number;
  readonly founderSurvivors: number;
  readonly buildings: number;
  readonly temporaryShelters: number;
  readonly shelterCapacity: number;
  readonly constructionProgress: number;
  readonly food: number;
  readonly goods: number;
  readonly timber: number;
  readonly stone: number;
  readonly foodSecurity: number;
  readonly discoveredDeposits: number;
  readonly workedDeposits: number;
  readonly knownRecipes: number;
  readonly knowledgeIds: readonly string[];
  readonly newKnowledgeIds: readonly string[];
  readonly inheritedKnowledgeUsed: readonly string[];
}

export interface FoundingContinuityProgress {
  readonly bridgeShown: boolean;
  readonly visitedSettlementIds: readonly string[];
  readonly totalCommunities: number;
  readonly complete: boolean;
}

interface FoundingContinuityMemory {
  bridgeShown: boolean;
  readonly visitedSettlementIds: Set<string>;
  lastVisitMonth?: number;
}

interface ChangeFact {
  readonly weight: number;
  readonly text: string;
}

const memories = new WeakMap<Historian, FoundingContinuityMemory>();
const pacedStates = new WeakSet<SimulationState>();
let pacingInstalled = false;
let installed = false;

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const readable = (value: string): string => value.replaceAll('-', ' ');
const rounded = (value: number): string => Number(value.toFixed(Math.abs(value) < 10 ? 1 : 0)).toLocaleString();

function elapsedLabel(months: number): string {
  if (months <= 0) return 'At the end of Arrival Day';
  if (months === 1) return 'One month after Arrival Day';
  return `${months.toLocaleString()} months after Arrival Day`;
}

function breakdown(score: number): CandidateScoreBreakdown {
  return {
    novelty: 0.72,
    magnitude: clamp(0.35 + score * 0.45),
    populationAffected: 0.45,
    rarity: 0.35,
    technological: 0.2,
    political: 0,
    cultural: 0.35,
    consequence: clamp(0.35 + score * 0.5),
    continuity: 1,
    repetitionPenalty: 0,
  };
}

function memoryFor(historian: Historian): FoundingContinuityMemory {
  let memory = memories.get(historian);
  if (!memory) {
    memory = { bridgeShown: false, visitedSettlementIds: new Set() };
    memories.set(historian, memory);
  }
  return memory;
}

export function foundingCommunitySnapshot(
  state: SimulationState,
  community: FoundingCommunityBaseline,
  suppliedBaseline?: FoundingChapterBaseline,
): FoundingCommunitySnapshot | undefined {
  const baseline = suppliedBaseline ?? foundingChapterBaseline(state);
  if (!baseline) return undefined;
  const settlement = state.settlements.find(candidate => candidate.id === community.settlementId);
  if (!settlement) return undefined;

  const founderIds = new Set(community.founderIds);
  const founderSurvivors = state.people.reduce((count, person) => count + Number(person.alive && founderIds.has(person.id)), 0);
  const knowledgeIds = Object.keys(settlement.knowledge.records)
    .filter(id => (settlement.knowledge.records[id]?.discoveredMonth ?? Number.POSITIVE_INFINITY) <= state.month)
    .sort();
  const inherited = new Set(community.knowledge);
  const newKnowledgeIds = knowledgeIds.filter(id => {
    const record = settlement.knowledge.records[id];
    return !inherited.has(id) && (record?.discoveredMonth ?? baseline.eventMonth) > baseline.eventMonth;
  });
  const inheritedKnowledgeUsed = community.knowledge.filter(id => {
    const record = settlement.knowledge.records[id];
    return Boolean(record && (record.lastUsedMonth > baseline.eventMonth || record.practice > 0.025));
  });

  return Object.freeze({
    month: state.month,
    settlementId: settlement.id,
    settlementName: settlement.name,
    alive: settlement.alive,
    population: settlementRepresentedPopulation(state, settlement.id),
    founderSurvivors,
    buildings: (settlement.structurePlots ?? []).filter(p => p.development?.status === 'active' && !p.development.temporary).length,
    temporaryShelters: (settlement.structurePlots ?? []).filter(p => p.development?.status === 'active' && p.development.temporary && (p.development.services.housing ?? 0) > 0).length,
    shelterCapacity: shelterCapacity(settlement, state).capacity,
    constructionProgress: settlement.development?.project?.response.temporary ? 0 : clamp(settlement.constructionProgress),
    food: settlement.resources.food,
    goods: settlement.resources.goods,
    timber: settlement.localMaterials['timber'] ?? 0,
    stone: settlement.localMaterials['stone'] ?? 0,
    foodSecurity: settlement.foodSecurity,
    discoveredDeposits: settlement.discoveredDeposits.length,
    workedDeposits: settlement.workedDeposits.length,
    knownRecipes: settlement.knownRecipes.length,
    knowledgeIds: Object.freeze(knowledgeIds),
    newKnowledgeIds: Object.freeze(newKnowledgeIds),
    inheritedKnowledgeUsed: Object.freeze(inheritedKnowledgeUsed),
  });
}

function populationFact(snapshot: FoundingCommunitySnapshot, community: FoundingCommunityBaseline): ChangeFact {
  const delta = snapshot.population - community.founderCount;
  if (delta > 0) return { weight: clamp(0.3 + delta / Math.max(4, community.founderCount)), text: `it now has ${snapshot.population.toLocaleString()} people, ${delta.toLocaleString()} more than landed` };
  if (delta < 0) return { weight: clamp(0.42 + Math.abs(delta) / Math.max(4, community.founderCount)), text: `its population has fallen from ${community.founderCount.toLocaleString()} to ${snapshot.population.toLocaleString()}` };
  return { weight: 0.14, text: `its population remains ${snapshot.population.toLocaleString()}, unchanged from the landing` };
}

function stockFact(label: string, start: number, current: number): ChangeFact | undefined {
  const delta = current - start;
  const relative = Math.abs(delta) / Math.max(1, Math.abs(start));
  if (Math.abs(delta) < 0.75 || relative < 0.12) return undefined;
  const direction = delta < 0 ? 'fallen' : 'risen';
  return {
    weight: clamp(0.18 + relative * 0.34),
    text: `${label} stores have ${direction} from ${rounded(start)} to ${rounded(current)}`,
  };
}

function changeFacts(snapshot: FoundingCommunitySnapshot, community: FoundingCommunityBaseline): ChangeFact[] {
  const facts: ChangeFact[] = [populationFact(snapshot, community)];
  const founderLosses = Math.max(0, community.founderCount - snapshot.founderSurvivors);
  if (founderLosses > 0) facts.push({
    weight: clamp(0.48 + founderLosses / Math.max(4, community.founderCount)),
    text: `${snapshot.founderSurvivors.toLocaleString()} of the original ${community.founderCount.toLocaleString()} founders remain alive`,
  });

  if (!snapshot.alive) facts.push({ weight: 1, text: 'the founding settlement is no longer an active community' });
  else if (snapshot.buildings > 0) facts.push({
    weight: clamp(0.3 + snapshot.buildings * 0.09),
    text: `${snapshot.buildings.toLocaleString()} permanent ${snapshot.buildings === 1 ? 'structure now stands' : 'structures now stand'} at the landing`,
  });
  else if (snapshot.constructionProgress > 0.04) facts.push({
    weight: clamp(0.24 + snapshot.constructionProgress * 0.3),
    text: `its first permanent construction is ${Math.round(snapshot.constructionProgress * 100)}% complete`,
  });

  const stocks = [
    stockFact('Food', community.supplies.food, snapshot.food),
    stockFact('Goods', community.supplies.goods, snapshot.goods),
    stockFact('Timber', community.supplies.timber, snapshot.timber),
    stockFact('Stone', community.supplies.stone, snapshot.stone),
  ].filter((fact): fact is ChangeFact => Boolean(fact));
  if (snapshot.temporaryShelters > 0) facts.push({ weight: 0.6,
    text: `${snapshot.temporaryShelters} temporary shelters now stand, with physical protection for ${snapshot.shelterCapacity.toFixed(0)} people including the landing vessel` });
  stocks.sort((a, b) => b.weight - a.weight);
  if (stocks[0]) facts.push(stocks[0]);

  if (snapshot.workedDeposits > 0) facts.push({
    weight: clamp(0.32 + snapshot.workedDeposits * 0.08),
    text: `the community is actively working ${snapshot.workedDeposits.toLocaleString()} local ${snapshot.workedDeposits === 1 ? 'resource deposit' : 'resource deposits'}`,
  });
  else if (snapshot.discoveredDeposits > 0) facts.push({
    weight: clamp(0.23 + snapshot.discoveredDeposits * 0.05),
    text: `it has identified ${snapshot.discoveredDeposits.toLocaleString()} nearby ${snapshot.discoveredDeposits === 1 ? 'resource deposit' : 'resource deposits'}`,
  });

  if (snapshot.newKnowledgeIds.length > 0) {
    const names = snapshot.newKnowledgeIds.slice(0, 2).map(readable);
    const suffix = snapshot.newKnowledgeIds.length > 2 ? ` and ${snapshot.newKnowledgeIds.length - 2} more` : '';
    facts.push({ weight: clamp(0.36 + snapshot.newKnowledgeIds.length * 0.07), text: `new recorded knowledge now includes ${names.join(' and ')}${suffix}` });
  } else if (snapshot.inheritedKnowledgeUsed.length > 0) {
    facts.push({
      weight: clamp(0.2 + snapshot.inheritedKnowledgeUsed.length * 0.05),
      text: `${snapshot.inheritedKnowledgeUsed.slice(0, 2).map(readable).join(' and ')} ${snapshot.inheritedKnowledgeUsed.length === 1 ? 'is' : 'are'} now being practised`,
    });
  }

  facts.sort((a, b) => b.weight - a.weight);
  return facts;
}

function rememberStatement(historian: Historian, scene: ObservationCandidate, state: SimulationState): ObservationCandidate | undefined {
  if (!historian.validateStatement(scene.statement, state)) return undefined;
  if (!historian.statements.some(statement => statement.id === scene.statement.id)) historian.statements.push(scene.statement);
  if (historian.statements.length > 1200) historian.statements.splice(0, historian.statements.length - 1200);
  return scene;
}

function bridgeScene(historian: Historian, state: SimulationState, baseline: FoundingChapterBaseline): ObservationCandidate | undefined {
  const event = state.history.find(candidate => candidate.id === baseline.eventId && candidate.type === 'ARRIVAL_DAY');
  if (!event) return undefined;
  const sourceEntityIds = baseline.communities
    .filter(community => state.settlements.some(settlement => settlement.id === community.settlementId))
    .map(community => community.settlementId);
  const statement = {
    id: `founding-continuity-bridge-${event.id}`,
    month: state.month,
    text: `Arrival Day is over. The ${baseline.expectedCommunityCount} landing communities now enter their first seasons with finite stores, different inherited knowledge, and different terrain. From here, change can be measured against what each landing began with.`,
    epistemicStatus: 'recorded-fact' as const,
    sourceEventIds: [event.id],
    sourceEntityIds,
    sourceArchiveIds: [],
    claims: { eventType: 'ARRIVAL_DAY' as const, entityIds: sourceEntityIds },
  };
  return rememberStatement(historian, {
    id: `founding-continuity:bridge:${event.id}`,
    subjectId: 'world',
    kind: 'historian-context',
    position: baseline.center,
    title: 'THE FIRST SEASONS',
    statement,
    score: 0.82,
    interest: 0.82,
    audioCategory: 'historian',
    breakdown: breakdown(0.35),
  }, state);
}

function communityScene(
  historian: Historian,
  state: SimulationState,
  baseline: FoundingChapterBaseline,
  community: FoundingCommunityBaseline,
): ObservationCandidate | undefined {
  const snapshot = foundingCommunitySnapshot(state, community, baseline);
  if (!snapshot) return undefined;
  const event = state.history.find(candidate => candidate.id === baseline.eventId && candidate.type === 'ARRIVAL_DAY');
  if (!event) return undefined;

  const facts = changeFacts(snapshot, community);
  const selected = facts.slice(0, 3);
  const score = selected.reduce((sum, fact, index) => sum + fact.weight * (index === 0 ? 0.55 : index === 1 ? 0.3 : 0.15), 0);
  const elapsed = Math.max(0, state.month - baseline.eventMonth);
  const sentence = selected.map(fact => fact.text).join('; ');
  const statement = {
    id: `founding-continuity-${community.podId}-${state.month}`,
    month: state.month,
    text: `${elapsedLabel(elapsed)}, ${community.settlementName}: ${sentence}.`,
    epistemicStatus: 'derived-statistic' as const,
    sourceEventIds: [event.id],
    sourceEntityIds: [community.settlementId],
    sourceArchiveIds: [],
    claims: {
      population: { month: state.month, value: snapshot.population, scopeEntityId: community.settlementId },
      entityIds: [community.settlementId],
      eventType: 'ARRIVAL_DAY' as const,
    },
  };

  return rememberStatement(historian, {
    id: `founding-continuity:community:${community.podId}:${state.month}`,
    subjectId: community.settlementId,
    kind: snapshot.buildings > 0 || snapshot.constructionProgress > 0.04 ? 'city-growth-timelapse' : 'settlement-approach',
    position: community.position,
    title: `${community.settlementName} · ${elapsedLabel(elapsed).toUpperCase()}`,
    statement,
    score: clamp(0.66 + score * 0.24),
    interest: clamp(0.68 + score * 0.25),
    audioCategory: 'settlement',
    breakdown: breakdown(score),
  }, state);
}

export function foundingContinuityProgress(historian: Historian, state: SimulationState): FoundingContinuityProgress {
  const baseline = foundingChapterBaseline(state);
  const memory = memories.get(historian);
  const visited = memory ? [...memory.visitedSettlementIds] : [];
  return {
    bridgeShown: memory?.bridgeShown ?? false,
    visitedSettlementIds: Object.freeze(visited),
    totalCommunities: baseline?.communities.length ?? 0,
    complete: Boolean(baseline && visited.length >= baseline.communities.length),
  };
}

/**
 * First-year continuity layer. Arrival Day now releases time through the human cast before this
 * layer begins. Each traceable founding community receives one grounded revisit, spaced across
 * authoritative months rather than presented as another opening carousel. New continuity starts
 * only in the primary 12-month window; an already-started chapter can finish through Month 18.
 */
export function chooseFoundingContinuityScene(historian: Historian, state: SimulationState): ObservationCandidate | undefined {
  pacedStates.delete(state);
  const founding = foundingChapterProgress(historian, state);
  if (founding.phase === 'ready' || founding.phase === 'orientation' || founding.phase === 'unavailable') return undefined;
  if (founding.phase === 'complete') releaseFoundingChapterHold(historian, state);
  const baseline = founding.baseline ?? foundingChapterBaseline(state);
  if (!baseline || state.month > baseline.eventMonth + FOUNDING_CONTINUITY_GRACE_END_MONTH) return undefined;

  let memory = memories.get(historian);
  if (!memory) {
    if (state.month > baseline.eventMonth + FOUNDING_CONTINUITY_PRIMARY_END_MONTH) return undefined;
    memory = memoryFor(historian);
  }
  if (!memory.bridgeShown) {
    memory.bridgeShown = true;
    if (state.month <= baseline.eventMonth) {
      const bridge = bridgeScene(historian, state, baseline);
      if (bridge) pacedStates.add(state);
      return bridge;
    }
  }

  const unvisited = baseline.communities.filter(community => !memory.visitedSettlementIds.has(community.settlementId));
  if (unvisited.length === 0) return undefined;

  // Continuity is history unfolding, not a second orientation carousel. Never show two founding
  // community revisits in the same authoritative month; let the world change between observations.
  if (memory.lastVisitMonth !== undefined && state.month <= memory.lastVisitMonth) return undefined;

  for (const community of unvisited.sort((a, b) => a.order - b.order)) {
    const scene = communityScene(historian, state, baseline, community);
    if (!scene) continue;
    memory.visitedSettlementIds.add(community.settlementId);
    memory.lastVisitMonth = state.month;
    pacedStates.add(state);
    return scene;
  }
  return undefined;
}

export function installFoundingContinuityPacing(): void {
  if (pacingInstalled) return;
  pacingInstalled = true;
  const targetSpeed = PresentationDirector.prototype.targetSpeed;
  PresentationDirector.prototype.targetSpeed = function continuityTargetSpeed(
    this: PresentationDirector,
    state: Parameters<typeof targetSpeed>[0],
    observation: Parameters<typeof targetSpeed>[1],
  ): number {
    if (pacedStates.has(state)) return FOUNDING_CONTINUITY_MONTHS_PER_SECOND;
    return targetSpeed.call(this, state, observation);
  };
}

/** Install after installFoundingChapter(); the founding orientation retains precedence. */
export function installFoundingContinuity(): void {
  if (installed) return;
  installed = true;
  installFoundingContinuityPacing();
  const chooseScene = Historian.prototype.chooseScene;
  Historian.prototype.chooseScene = function continuityChooseScene(
    this: Historian,
    state: SimulationState,
    focusEventId?: string,
  ): ObservationCandidate {
    if (focusEventId) {
      pacedStates.delete(state);
      return chooseScene.call(this, state, focusEventId);
    }
    const founding = foundingChapterProgress(this, state);
    if (founding.phase === 'ready' || founding.phase === 'orientation') {
      pacedStates.delete(state);
      return chooseScene.call(this, state);
    }
    if (founding.phase === 'complete') releaseFoundingChapterHold(this, state);
    const continuity = chooseFoundingContinuityScene(this, state);
    if (continuity) return continuity;
    return chooseScene.call(this, state);
  };
}
