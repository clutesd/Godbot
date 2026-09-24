import { isFoundingPresentationPhase } from '../sim/founding/FoundingArrival';
import type { SimulationState, Vec2 } from '../sim/types';
import type { HistorianStatement, ObservationCandidate } from './types';
import { Historian } from './Historian';
import { PresentationDirector } from './PresentationDirector';

export interface FoundingSiteBaseline {
  readonly biome: string;
  readonly landform: string;
  readonly elevation: number;
  readonly fertility: number;
  readonly woodland: number;
  readonly waterAccess: number;
  readonly habitability: number;
  readonly parentRock: string;
}

export interface FoundingCommunityBaseline {
  readonly order: number;
  readonly podId: string;
  readonly groupId: string;
  readonly podName: string;
  readonly settlementId: string;
  readonly settlementName: string;
  readonly position: Readonly<Vec2>;
  readonly founderIds: readonly string[];
  readonly founderCount: number;
  readonly domains: readonly string[];
  readonly knowledge: readonly string[];
  readonly supplies: Readonly<{ food: number; goods: number; timber: number; stone: number }>;
  readonly site: FoundingSiteBaseline;
}

export interface FoundingChapterBaseline {
  readonly eventId: string;
  readonly eventMonth: number;
  readonly population: number;
  readonly expectedCommunityCount: number;
  readonly communities: readonly FoundingCommunityBaseline[];
  readonly center: Readonly<Vec2>;
}

export type FoundingChapterPhase = 'unavailable' | 'ready' | 'orientation' | 'complete' | 'missed-opening';

export interface FoundingChapterProgress {
  readonly phase: FoundingChapterPhase;
  readonly nextBeat: number;
  readonly totalBeats: number;
  readonly startedMonth?: number;
  readonly baseline?: FoundingChapterBaseline;
}

interface FoundingChapterMemory {
  nextBeat: number;
  complete: boolean;
  startedMonth: number;
  baseline: FoundingChapterBaseline;
}

const memories = new WeakMap<Historian, FoundingChapterMemory>();
let pacingInstalled = false;
let chapterInstalled = false;

/**
 * A defensive expiry only. Normal 1a playback is frozen at Month 0 while the single orientation
 * beat plays before authoritative monthly history begins. Resumed observations never replay it.
 */
export const FOUNDING_CHAPTER_LATEST_MONTH = 18;

/** The camera may still ask for a presentation speed, but autoRun is held during orientation. */
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

function center(points: readonly Readonly<Vec2>[]): Vec2 {
  if (points.length === 0) return { x: 0, z: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
}

function finitePopulation(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function differingStartingConditions(baseline: FoundingChapterBaseline): boolean {
  const signatures = baseline.communities.map(community => JSON.stringify({
    domains: community.domains,
    knowledge: community.knowledge,
    supplies: community.supplies,
    biome: community.site.biome,
    landform: community.site.landform,
    fertility: community.site.fertility,
    woodland: community.site.woodland,
    waterAccess: community.site.waterAccess,
  }));
  return new Set(signatures).size > 1;
}

function holdFoundingChapter(historian: Historian, state: SimulationState, memory: FoundingChapterMemory): void {
  void historian; void state; void memory;
  // Monthly authority is intentionally frozen by Simulation until the entire orientation/cast
  // presentation has completed. This hook remains presentation-only.
}

/**
 * Release the presentation hold after the final 1a shot. This is exported so the outer 1b wrapper
 * can hand off directly without requiring a dummy Historian scene selection in between.
 */
export function releaseFoundingChapterHold(historian: Historian, state: SimulationState): void {
  void historian; void state;
  // Compatibility hook for the cast layer; no clock mutation is required anymore.
}

/**
 * Stable Year-Zero reference data for both 1a and the later continuity layers. New runs persist
 * their immutable site snapshot inside FoundingArrivalState, which RunArchive already preserves.
 * Older archives without that field fall back to the replayed world cell for compatibility.
 */
export function foundingChapterBaseline(state: SimulationState): FoundingChapterBaseline | undefined {
  const arrival = state.arrival;
  const event = state.history.find(candidate => candidate.type === 'ARRIVAL_DAY');
  if (!arrival || !event) return undefined;

  const communities = arrival.pods.flatMap((pod, order): FoundingCommunityBaseline[] => {
    if (!pod.settlementId) return [];
    const cell = state.world.cells[pod.cellIndex];
    const site = pod.site ?? (cell ? {
      biome: cell.biome,
      landform: cell.landform,
      elevation: cell.elevation,
      fertility: cell.fertility,
      woodland: cell.wood,
      waterAccess: cell.soil?.waterAccess ?? 0,
      habitability: cell.habitability,
      parentRock: cell.geology?.family ?? 'unknown',
    } : undefined);
    if (!site) return [];
    const settlement = state.settlements.find(candidate => candidate.id === pod.settlementId);
    return [Object.freeze({
      order,
      podId: pod.id,
      groupId: pod.groupId,
      podName: pod.name,
      settlementId: pod.settlementId,
      settlementName: settlement?.name ?? `${pod.name} Landing`,
      position: Object.freeze({ x: pod.position.x, z: pod.position.z }),
      founderIds: Object.freeze([...pod.personIds]),
      founderCount: pod.population,
      domains: Object.freeze([...pod.domains]),
      knowledge: Object.freeze([...pod.knowledge]),
      supplies: Object.freeze({ ...pod.supplies }),
      site: Object.freeze({ ...site }),
    })];
  });
  const foundingPopulation = arrival.pods.reduce((sum, pod) => sum + pod.population, 0);
  const positions = communities.length > 0 ? communities.map(community => community.position) : arrival.pods.map(pod => pod.position);

  return Object.freeze({
    eventId: event.id,
    eventMonth: event.month,
    population: finitePopulation(event.context.population, foundingPopulation),
    expectedCommunityCount: arrival.pods.length,
    communities: Object.freeze(communities),
    center: Object.freeze(center(positions)),
  });
}

function rememberStatement(historian: Historian, scene: ObservationCandidate, state: SimulationState): ObservationCandidate | undefined {
  if (!historian.validateStatement(scene.statement, state)) return undefined;
  if (!historian.statements.some(statement => statement.id === scene.statement.id)) historian.statements.push(scene.statement);
  if (historian.statements.length > 1200) historian.statements.splice(0, historian.statements.length - 1200);
  return scene;
}

function overviewScene(historian: Historian, state: SimulationState, baseline: FoundingChapterBaseline): ObservationCandidate | undefined {
  const event = state.history.find(candidate => candidate.id === baseline.eventId && candidate.type === 'ARRIVAL_DAY');
  if (!event) return undefined;
  const count = baseline.expectedCommunityCount;
  const resolvedCount = baseline.communities.length;
  const coverage = resolvedCount === count
    ? `${count} separated communities`
    : `${resolvedCount} traceable communities from ${count} recorded vessels`;
  const thesis = differingStartingConditions(baseline)
    ? 'Their land, knowledge, skills, and supplies differ. This is the last moment their histories are known together. From here, we watch what those differences become.'
    : 'They begin from the same recorded conditions. This is the last moment their histories are known together. From here, we watch how their paths separate.';
  const sourceEntityIds = baseline.communities
    .filter(community => state.settlements.some(settlement => settlement.id === community.settlementId))
    .map(community => community.settlementId);
  const statement = {
    id: `founding-overview-${event.id}`,
    month: state.month,
    text: `${count} vessels placed ${baseline.population.toLocaleString()} founders in ${coverage}. ${thesis}`,
    epistemicStatus: 'recorded-fact' as const,
    sourceEventIds: [event.id],
    sourceEntityIds,
    sourceArchiveIds: [],
    claims: { eventType: 'ARRIVAL_DAY' as const, entityIds: sourceEntityIds },
  };
  return rememberStatement(historian, {
    id: `founding:overview:${event.id}`,
    subjectId: 'world',
    kind: 'world-establishing',
    position: baseline.center,
    title: `ARRIVAL DAY · THE ${count} LANDINGS`,
    statement,
    score: 0.98,
    interest: 1,
    audioCategory: 'historian',
    breakdown: scoreBreakdown(0.8),
    event,
  }, state);
}

export function foundingChapterProgress(historian: Historian, state: SimulationState): FoundingChapterProgress {
  const baseline = foundingChapterBaseline(state);
  if (!baseline || !isFoundingPresentationPhase(state.arrival?.phase)) return { phase: 'unavailable', nextBeat: 0, totalBeats: 0 };
  const memory = memories.get(historian);
  const totalBeats = 1;
  // A resumed run that already crossed into HISTORY_RUNNING must never replay the opening merely
  // because WeakMap presentation memory was recreated with the page.
  if (!memory && state.arrival?.phase === 'HISTORY_RUNNING') return {
    phase: 'complete',
    nextBeat: 1,
    totalBeats,
    startedMonth: baseline.eventMonth,
    baseline,
  };
  if (memory) return {
    phase: memory.complete ? 'complete' : 'orientation',
    nextBeat: memory.nextBeat,
    totalBeats: 1,
    startedMonth: memory.startedMonth,
    baseline: memory.baseline,
  };
  if (state.month > baseline.eventMonth) return { phase: 'missed-opening', nextBeat: 0, totalBeats, baseline };
  return { phase: 'ready', nextBeat: 0, totalBeats, baseline };
}

/**
 * Returns the one grounded post-arrival orientation shot. The landings themselves already carried
 * the geography; this beat states the premise once, then hands directly to human-scale history.
 */
export function chooseFoundingChapterScene(historian: Historian, state: SimulationState): ObservationCandidate | undefined {
  if (!state.arrival || !isFoundingPresentationPhase(state.arrival.phase)) {
    releaseFoundingChapterHold(historian, state);
    return undefined;
  }

  let memory = memories.get(historian);
  if (!memory && state.arrival.phase === 'HISTORY_RUNNING') return undefined;
  if (!memory) {
    const baseline = foundingChapterBaseline(state);
    if (!baseline || state.month > baseline.eventMonth) {
      releaseFoundingChapterHold(historian, state);
      return undefined;
    }
    memory = { nextBeat: 0, complete: false, startedMonth: state.month, baseline };
    memories.set(historian, memory);
  }
  if (memory.complete) {
    releaseFoundingChapterHold(historian, state);
    return undefined;
  }
  if (state.month > FOUNDING_CHAPTER_LATEST_MONTH) {
    memory.complete = true;
    releaseFoundingChapterHold(historian, state);
    return undefined;
  }

  memory.nextBeat = 1;
  memory.complete = true;
  const scene = overviewScene(historian, state, memory.baseline);
  if (scene) {
    holdFoundingChapter(historian, state, memory);
    return scene;
  }

  releaseFoundingChapterHold(historian, state);
  return undefined;
}

/**
 * Restores the Day-0 orientation cursor from archived Historian statements after a page reload.
 * Only FOUNDING_ORIENTATION uses this cursor; a run already in HISTORY_RUNNING never replays 1a.
 */
export function restoreFoundingChapterProgress(
  historian: Historian,
  state: SimulationState,
  statements: readonly HistorianStatement[],
): void {
  if (state.arrival?.phase !== 'FOUNDING_ORIENTATION') return;
  const baseline = foundingChapterBaseline(state);
  if (!baseline) return;
  const progressed = statements.some(statement =>
    statement.id === `founding-overview-${baseline.eventId}`
    || statement.id.startsWith('founding-cast-introduction-')
    || statement.id === `founding-release-${baseline.eventId}`,
  );
  if (!progressed) return;
  memories.set(historian, {
    nextBeat: 1,
    complete: true,
    startedMonth: baseline.eventMonth,
    baseline,
  });
}

export function isFoundingChapterScene(scene: ObservationCandidate): boolean {
  return scene.id.startsWith('founding:');
}

/** Orientation requests cinematic pacing; monthly authority remains frozen until Simulation.beginHistory(). */
export function installFoundingChapterPacing(): void {
  if (pacingInstalled) return;
  pacingInstalled = true;
  const targetSpeed = PresentationDirector.prototype.targetSpeed;
  PresentationDirector.prototype.targetSpeed = function foundingTargetSpeed(
    this: PresentationDirector,
    state: Parameters<typeof targetSpeed>[0],
    observation: Parameters<typeof targetSpeed>[1],
  ): number {
    if (observation.eventType === 'ARRIVAL_DAY') return FOUNDING_CHAPTER_MONTHS_PER_SECOND;
    return targetSpeed.call(this, state, observation);
  };

}

/**
 * Installs the one-time founding chapter over the already-installed Watcher Historian. A focused
 * major event is still allowed to interrupt; otherwise the opening orientation runs before normal
 * Historian scene rotation begins.
 */
export function installFoundingChapter(): void {
  if (chapterInstalled) return;
  chapterInstalled = true;
  installFoundingChapterPacing();

  const chooseScene = Historian.prototype.chooseScene;
  Historian.prototype.chooseScene = function foundingChooseScene(
    this: Historian,
    state: SimulationState,
    focusEventId?: string,
  ): ObservationCandidate {
    if (!focusEventId) {
      const founding = chooseFoundingChapterScene(this, state);
      if (founding) return founding;
    }
    return chooseScene.call(this, state, focusEventId);
  };
}
