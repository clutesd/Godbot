import type { SimulationState, Vec2 } from '../sim/types';
import type { ObservationCandidate } from './types';
import { Historian } from './Historian';
import { PresentationDirector } from './PresentationDirector';

interface FoundingChapterMemory {
  nextBeat: number;
  complete: boolean;
}

const memories = new WeakMap<Historian, FoundingChapterMemory>();
let pacingInstalled = false;

/**
 * The founding handoff is deliberately short-lived. If an observation is resumed well after the
 * opening, the Historian must not suddenly replay Year Zero as though it were current history.
 */
export const FOUNDING_CHAPTER_LATEST_MONTH = 18;

/**
 * main.ts currently clamps observer time to at least 0.1 months/sec. Requesting slightly less here
 * makes the opening orientation use that floor rather than the normal documentary pace.
 */
export const FOUNDING_CHAPTER_MONTHS_PER_SECOND = 0.08;

const scoreBreakdown = (continuity: number) => ({
  novelty: 1,
  magnitude: 1,
  populationAffected: 1,
  rarity: 1,
  technological: 0.35,
  political: 0,
  cultural: 0.7,
  consequence: 1,
  continuity,
  repetitionPenalty: 0,
});

const readable = (value: string): string => value.replaceAll('-', ' ');

function list(values: readonly string[]): string {
  if (values.length === 0) return 'no named inheritance';
  if (values.length === 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function center(points: readonly Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, z: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
}

function rememberStatement(historian: Historian, scene: ObservationCandidate, state: SimulationState): ObservationCandidate | undefined {
  if (!historian.validateStatement(scene.statement, state)) return undefined;
  historian.statements.push(scene.statement);
  if (historian.statements.length > 1200) historian.statements.splice(0, historian.statements.length - 1200);
  return scene;
}

function overviewScene(historian: Historian, state: SimulationState): ObservationCandidate | undefined {
  const arrival = state.arrival;
  const event = state.history.find(candidate => candidate.type === 'ARRIVAL_DAY');
  if (!arrival || !event) return undefined;
  const settlements = arrival.pods
    .map(pod => state.settlements.find(settlement => settlement.id === pod.settlementId))
    .filter((settlement): settlement is NonNullable<typeof settlement> => Boolean(settlement));
  const population = Number(event.context.population ?? arrival.pods.reduce((sum, pod) => sum + pod.population, 0));
  const names = arrival.pods.map(pod => pod.name);
  const statement = {
    id: `founding-overview-${event.id}`,
    month: state.month,
    text: `Arrival Day is the permanent beginning of this record. Five vessels placed ${population.toLocaleString()} founders across five separated landing communities: ${list(names)}. Each carried a different portion of inherited knowledge into the same untouched world.`,
    epistemicStatus: 'recorded-fact' as const,
    sourceEventIds: [event.id],
    sourceEntityIds: settlements.map(settlement => settlement.id),
    sourceArchiveIds: [],
    claims: { eventType: 'ARRIVAL_DAY' as const, entityIds: settlements.map(settlement => settlement.id) },
  };
  return rememberStatement(historian, {
    id: `founding:overview:${event.id}`,
    subjectId: 'world',
    kind: 'world-establishing',
    position: center(arrival.pods.map(pod => pod.position)),
    title: 'ARRIVAL DAY · THE FIVE LANDINGS',
    statement,
    score: 0.98,
    interest: 1,
    audioCategory: 'historian',
    breakdown: scoreBreakdown(0.8),
    event,
  }, state);
}

function communityScene(historian: Historian, state: SimulationState, podIndex: number): ObservationCandidate | undefined {
  const arrival = state.arrival;
  const event = state.history.find(candidate => candidate.type === 'ARRIVAL_DAY');
  const pod = arrival?.pods[podIndex];
  if (!arrival || !event || !pod?.settlementId) return undefined;
  const settlement = state.settlements.find(candidate => candidate.id === pod.settlementId);
  if (!settlement) return undefined;

  const domains = pod.domains.map(readable);
  const knowledge = pod.knowledge.map(readable);
  const statement = {
    id: `founding-community-${pod.id}`,
    month: state.month,
    text: `${settlement.name} began with ${pod.population.toLocaleString()} founders from ${pod.name}. Their inherited strengths were ${list(domains)}; the knowledge carried through the landing included ${list(knowledge)}. This was one of five communities beginning from different places, skills, and finite supplies.`,
    epistemicStatus: 'recorded-fact' as const,
    sourceEventIds: [event.id],
    sourceEntityIds: [settlement.id],
    sourceArchiveIds: [],
    claims: { eventType: 'ARRIVAL_DAY' as const, entityIds: [settlement.id] },
  };
  return rememberStatement(historian, {
    id: `founding:community:${pod.id}`,
    subjectId: settlement.id,
    kind: 'settlement-approach',
    position: settlement.position,
    title: `${settlement.name} · ${pod.name.toUpperCase()}`,
    statement,
    score: 0.78,
    interest: 0.82,
    audioCategory: 'settlement',
    breakdown: scoreBreakdown(0.72),
    event,
  }, state);
}

/**
 * Returns the next grounded scene in the one-time post-arrival orientation sequence.
 * Beat 0 establishes the whole founding event; beats 1-5 introduce the five communities.
 */
export function chooseFoundingChapterScene(historian: Historian, state: SimulationState): ObservationCandidate | undefined {
  if (!state.arrival || state.arrival.phase !== 'HISTORY_RUNNING' || state.month > FOUNDING_CHAPTER_LATEST_MONTH) return undefined;
  const arrivalEvent = state.history.find(candidate => candidate.type === 'ARRIVAL_DAY');
  if (!arrivalEvent) return undefined;

  let memory = memories.get(historian);
  if (!memory) {
    memory = { nextBeat: 0, complete: false };
    memories.set(historian, memory);
  }
  if (memory.complete) return undefined;

  const beat = memory.nextBeat;
  const scene = beat === 0 ? overviewScene(historian, state) : communityScene(historian, state, beat - 1);
  if (!scene) {
    memory.complete = true;
    return undefined;
  }

  memory.nextBeat += 1;
  if (memory.nextBeat > state.arrival.pods.length) memory.complete = true;
  return scene;
}

export function isFoundingChapterScene(scene: ObservationCandidate): boolean {
  return scene.id.startsWith('founding:');
}

/**
 * Keep authoritative history running, but at the slowest supported viewing cadence while the
 * founding orientation is on screen. This is presentation-only and never changes simulation rules.
 */
export function installFoundingChapterPacing(): void {
  if (pacingInstalled) return;
  pacingInstalled = true;
  const targetSpeed = PresentationDirector.prototype.targetSpeed;
  PresentationDirector.prototype.targetSpeed = function foundingTargetSpeed(
    state: Parameters<typeof targetSpeed>[0],
    observation: Parameters<typeof targetSpeed>[1],
  ): number {
    if (observation.eventType === 'ARRIVAL_DAY') return FOUNDING_CHAPTER_MONTHS_PER_SECOND;
    return targetSpeed.call(this, state, observation);
  };
}
