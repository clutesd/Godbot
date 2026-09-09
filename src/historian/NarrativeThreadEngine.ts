import type { HistoricalEvent, HistoricalEventType, SimulationState } from '../sim/types';
import type { ObservationCandidate } from './types';

export type NarrativeThreadKind =
  | 'rivalry'
  | 'settlement-arc'
  | 'crisis-cycle'
  | 'knowledge-lineage'
  | 'civilizational-threshold';

export type NarrativeThreadStatus = 'active' | 'dormant' | 'resolved';

export interface NarrativeThread {
  id: string;
  kind: NarrativeThreadKind;
  title: string;
  entityIds: string[];
  eventIds: string[];
  firstMonth: number;
  lastMonth: number;
  eventCount: number;
  peakSignificance: number;
  averageSignificance: number;
  reversals: number;
  interestingness: number;
  status: NarrativeThreadStatus;
}

export interface NarrativeThreadContext {
  thread: NarrativeThread;
  text: string;
  sourceEventIds: string[];
}

interface ThreadSeed {
  id: string;
  kind: NarrativeThreadKind;
  title: string;
  entityIds: string[];
}

interface WorkingThread extends ThreadSeed {
  events: HistoricalEvent[];
}

const CONFLICT_EVENTS = new Set<HistoricalEventType>([
  'alliance-ended',
  'war-declared',
  'battle',
  'war-ended',
  'nuclear-crisis',
  'nuclear-use',
  'nuclear-exchange',
]);

const SETTLEMENT_ARC_EVENTS = new Set<HistoricalEventType>([
  'settlement-founded',
  'settlement-abandoned',
  'major-migration',
  'first-contact',
  'trade-route-established',
  'discovery',
  'knowledge-lost',
  'knowledge-rediscovered',
  'knowledge-adopted',
  'technology-transformation',
  'technology-widespread',
  'infrastructure-built',
  'archive-destroyed',
  'industrialization-stage',
  'industrialization',
  'institution-formed',
  'political-transition',
  'leadership-succession',
  'cultural-shift',
  'harvest-crisis',
  'recovery',
  'natural-catastrophe',
]);

const CRISIS_EVENTS = new Set<HistoricalEventType>([
  'harvest-crisis',
  'pandemic',
  'ecological-crisis',
  'climate-crisis',
  'resource-crisis',
  'autonomous-weapons-crisis',
  'nuclear-crisis',
  'natural-catastrophe',
  'civilization-collapse',
  'recovery',
  'civilization-recovery',
]);

const KNOWLEDGE_EVENTS = new Set<HistoricalEventType>([
  'discovery',
  'knowledge-lost',
  'knowledge-rediscovered',
  'knowledge-adopted',
  'technology-transformation',
  'technology-widespread',
]);

const THRESHOLD_EVENTS = new Set<HistoricalEventType>([
  'statistical-transition',
  'industrialization',
  'atomic-threshold',
  'nuclear-weapons-developed',
  'machine-intelligence-transition',
  'first-orbit',
  'offworld-settlement',
  'interplanetary-transition',
  'civilization-collapse',
  'civilization-recovery',
  'planetary-stability',
  'post-biological-transition',
  'observation-lost',
  'outcome-classified',
]);

const REVERSAL_PAIRS: ReadonlyArray<readonly [HistoricalEventType, HistoricalEventType]> = [
  ['war-declared', 'war-ended'],
  ['knowledge-lost', 'knowledge-rediscovered'],
  ['harvest-crisis', 'recovery'],
  ['civilization-collapse', 'civilization-recovery'],
  ['settlement-founded', 'settlement-abandoned'],
  ['alliance-formed', 'alliance-ended'],
];

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

/**
 * Converts authoritative historical events into a small number of long-running stories.
 *
 * It does not create causes, events or simulation state. Threads are a read-only interpretation
 * of relationships already present in the record. The cache is rebuilt whenever the bounded
 * history window changes, so resumed observations regain their story structure automatically.
 */
export class NarrativeThreadEngine {
  private cacheSignature = '';
  private cachedThreads: NarrativeThread[] = [];
  private readonly shown = new Map<string, number>();
  private lastThreadId = '';

  contextFor(scene: ObservationCandidate, state: SimulationState): NarrativeThreadContext | undefined {
    const threads = this.threads(state);
    if (threads.length === 0) return undefined;

    const sceneIds = new Set<string>([
      scene.subjectId,
      ...scene.statement.sourceEntityIds,
      ...(scene.event?.actors ?? []),
      ...(scene.event?.locationId ? [scene.event.locationId] : []),
    ]);

    const candidates = threads
      .map((thread) => ({ thread, relevance: this.relevance(thread, scene, sceneIds, state.month) }))
      .filter((candidate) => candidate.relevance >= 0.3)
      .sort((a, b) => b.relevance - a.relevance);

    const chosen = candidates[0]?.thread;
    if (!chosen) return undefined;

    const timesShown = this.shown.get(chosen.id) ?? 0;
    // Repetition is useful for continuity, but not if every scene becomes the same explanation.
    if (timesShown >= 2 && chosen.id === this.lastThreadId && scene.event === undefined) return undefined;

    this.shown.set(chosen.id, timesShown + 1);
    this.lastThreadId = chosen.id;

    return {
      thread: chosen,
      text: this.explain(chosen, scene, state),
      sourceEventIds: this.sourceEvents(chosen, scene, state),
    };
  }

  threads(state: SimulationState): NarrativeThread[] {
    const first = state.history[0]?.id ?? '-';
    const last = state.history[state.history.length - 1]?.id ?? '-';
    const signature = `${state.history.length}:${first}:${last}`;
    if (signature === this.cacheSignature) return this.cachedThreads;

    this.cacheSignature = signature;
    this.cachedThreads = this.buildThreads(state);
    return this.cachedThreads;
  }

  private buildThreads(state: SimulationState): NarrativeThread[] {
    const working = new Map<string, WorkingThread>();

    const add = (seed: ThreadSeed, event: HistoricalEvent): void => {
      const existing = working.get(seed.id);
      if (existing) {
        if (!existing.events.some((candidate) => candidate.id === event.id)) existing.events.push(event);
        for (const id of seed.entityIds) if (!existing.entityIds.includes(id)) existing.entityIds.push(id);
        return;
      }
      working.set(seed.id, { ...seed, events: [event] });
    };

    for (const event of state.history) {
      for (const seed of this.seedsForEvent(event, state)) add(seed, event);
    }

    return [...working.values()]
      .map((thread) => this.finalize(thread, state))
      .filter((thread): thread is NarrativeThread => thread !== undefined)
      .sort((a, b) => b.interestingness - a.interestingness)
      .slice(0, 120);
  }

  private seedsForEvent(event: HistoricalEvent, state: SimulationState): ThreadSeed[] {
    const seeds: ThreadSeed[] = [];
    const settlements = this.settlementActors(event, state);

    if (CONFLICT_EVENTS.has(event.type) && settlements.length >= 2) {
      const pair = settlements.slice(0, 2).sort((a, b) => a.id.localeCompare(b.id));
      const a = pair[0];
      const b = pair[1];
      if (a && b) {
        seeds.push({
          id: `rivalry:${a.id}:${b.id}`,
          kind: 'rivalry',
          title: `${a.name} and ${b.name}`,
          entityIds: [a.id, b.id],
        });
      }
    }

    if (SETTLEMENT_ARC_EVENTS.has(event.type)) {
      const location = event.locationId ? state.settlements.find((settlement) => settlement.id === event.locationId) : undefined;
      const settlement = location ?? settlements[0];
      if (settlement) {
        seeds.push({
          id: `settlement:${settlement.id}`,
          kind: 'settlement-arc',
          title: settlement.name,
          entityIds: [settlement.id],
        });
      }
    }

    if (CRISIS_EVENTS.has(event.type)) {
      const location = event.locationId ? state.settlements.find((settlement) => settlement.id === event.locationId) : undefined;
      const scope = location ?? settlements[0];
      const scopeId = scope?.id ?? 'world';
      const scopeName = scope?.name ?? 'the world';
      seeds.push({
        id: `crisis:${scopeId}`,
        kind: 'crisis-cycle',
        title: `Pressure around ${scopeName}`,
        entityIds: scope ? [scope.id] : ['world'],
      });
    }

    if (KNOWLEDGE_EVENTS.has(event.type)) {
      const knowledge = typeof event.context.knowledge === 'string'
        ? event.context.knowledge
        : typeof event.context.name === 'string'
          ? event.context.name
          : undefined;
      if (knowledge) {
        seeds.push({
          id: `knowledge:${knowledge}`,
          kind: 'knowledge-lineage',
          title: knowledge.replaceAll('-', ' '),
          entityIds: settlements.map((settlement) => settlement.id),
        });
      }
    }

    if (THRESHOLD_EVENTS.has(event.type)) {
      seeds.push({
        id: 'threshold:world',
        kind: 'civilizational-threshold',
        title: 'The civilization becoming something new',
        entityIds: ['world'],
      });
    }

    return seeds;
  }

  private finalize(thread: WorkingThread, state: SimulationState): NarrativeThread | undefined {
    const events = [...thread.events].sort((a, b) => a.month - b.month);
    if (events.length < 2) return undefined;

    const first = events[0];
    const last = events[events.length - 1];
    if (!first || !last) return undefined;

    const peak = Math.max(...events.map((event) => event.significance));
    const average = events.reduce((sum, event) => sum + event.significance, 0) / events.length;
    const spanMonths = Math.max(0, last.month - first.month);
    const reversals = this.reversalCount(events);
    const consequence = clamp(events.reduce((sum, event) => sum + Math.min(1, event.causes.length * 0.12 + event.tags.length * 0.05), 0) / events.length);
    const longevity = clamp(Math.log2(1 + spanMonths / 12) / 9);
    const continuity = clamp(Math.log2(1 + events.length) / 5);
    const reversalScore = clamp(reversals / 3);
    const interestingness = clamp(
      peak * 0.28
      + average * 0.18
      + continuity * 0.19
      + longevity * 0.13
      + reversalScore * 0.14
      + consequence * 0.08,
    );

    return {
      id: thread.id,
      kind: thread.kind,
      title: thread.title,
      entityIds: [...thread.entityIds],
      eventIds: events.map((event) => event.id),
      firstMonth: first.month,
      lastMonth: last.month,
      eventCount: events.length,
      peakSignificance: peak,
      averageSignificance: average,
      reversals,
      interestingness,
      status: this.status(thread.kind, events, state.month),
    };
  }

  private relevance(thread: NarrativeThread, scene: ObservationCandidate, sceneIds: Set<string>, month: number): number {
    const directEvent = scene.event ? thread.eventIds.includes(scene.event.id) : false;
    const entityOverlap = thread.entityIds.some((id) => sceneIds.has(id));
    const currentEventOverlap = scene.event?.actors.some((id) => thread.entityIds.includes(id)) ?? false;
    const ageMonths = Math.max(0, month - thread.lastMonth);
    const recency = clamp(1 - ageMonths / (180 * 12));
    const repetitionPenalty = Math.min(0.3, (this.shown.get(thread.id) ?? 0) * 0.055);
    const immediateRepeatPenalty = thread.id === this.lastThreadId ? 0.12 : 0;
    const semanticFit = this.semanticFit(thread.kind, scene.event?.type);

    return thread.interestingness * 0.45
      + (directEvent ? 0.38 : 0)
      + (entityOverlap ? 0.22 : 0)
      + (currentEventOverlap ? 0.12 : 0)
      + semanticFit
      + recency * 0.08
      - repetitionPenalty
      - immediateRepeatPenalty;
  }

  private semanticFit(kind: NarrativeThreadKind, eventType: HistoricalEventType | undefined): number {
    if (!eventType) return 0;
    if (kind === 'rivalry' && CONFLICT_EVENTS.has(eventType)) return 0.2;
    if (kind === 'knowledge-lineage' && KNOWLEDGE_EVENTS.has(eventType)) return 0.2;
    if (kind === 'crisis-cycle' && CRISIS_EVENTS.has(eventType)) return 0.17;
    if (kind === 'civilizational-threshold' && THRESHOLD_EVENTS.has(eventType)) return 0.22;
    if (kind === 'settlement-arc' && SETTLEMENT_ARC_EVENTS.has(eventType)) return 0.035;
    return 0;
  }

  private explain(thread: NarrativeThread, scene: ObservationCandidate, state: SimulationState): string {
    const years = Math.max(1, Math.floor((thread.lastMonth - thread.firstMonth) / 12));
    const events = thread.eventIds
      .map((id) => state.history.find((event) => event.id === id))
      .filter((event): event is HistoricalEvent => event !== undefined);
    const latest = events[events.length - 1];
    const currentIsThreadEvent = scene.event ? thread.eventIds.includes(scene.event.id) : false;

    switch (thread.kind) {
      case 'rivalry': {
        const [aId, bId] = thread.entityIds;
        const a = state.settlements.find((settlement) => settlement.id === aId)?.name ?? 'one settlement';
        const b = state.settlements.find((settlement) => settlement.id === bId)?.name ?? 'another';
        const returns = events.filter((event) => event.type === 'war-declared' || event.type === 'nuclear-crisis').length;
        if (thread.status === 'resolved') {
          return `This belongs to a ${years.toLocaleString()}-year rivalry between ${a} and ${b}. The latest recorded turn ended the fighting, though the history between them remains.`;
        }
        return `This is part of a rivalry between ${a} and ${b} that has returned to the record ${Math.max(1, returns).toLocaleString()} ${Math.max(1, returns) === 1 ? 'time' : 'times'} across ${years.toLocaleString()} years.`;
      }
      case 'settlement-arc': {
        const founded = events.find((event) => event.type === 'settlement-founded');
        const abandoned = [...events].reverse().find((event) => event.type === 'settlement-abandoned');
        const turningPoints = events.filter((event) => event.significance >= 0.55).length;
        if (abandoned && latest?.id === abandoned.id) {
          return `This is not merely an abandonment. It closes a ${years.toLocaleString()}-year recorded arc for ${thread.title}, after ${turningPoints.toLocaleString()} major turning points.`;
        }
        if (founded) {
          return `${thread.title} has been accumulating consequences for ${years.toLocaleString()} years; this scene belongs to a story with ${turningPoints.toLocaleString()} major turning points since its founding.`;
        }
        return `This scene is one chapter in ${thread.title}'s longer arc: ${thread.eventCount.toLocaleString()} linked changes have accumulated across ${years.toLocaleString()} years.`;
      }
      case 'crisis-cycle': {
        const crises = events.filter((event) => event.type !== 'recovery' && event.type !== 'civilization-recovery').length;
        const recoveries = events.length - crises;
        if (recoveries > 0) {
          return `The pressure here has a history: ${crises.toLocaleString()} crises and ${recoveries.toLocaleString()} recoveries are linked across ${years.toLocaleString()} years. Survival has been a process, not a single event.`;
        }
        return `This is part of a recurring pressure pattern with ${crises.toLocaleString()} recorded crises across ${years.toLocaleString()} years.`;
      }
      case 'knowledge-lineage': {
        const lost = events.some((event) => event.type === 'knowledge-lost');
        const rediscovered = events.some((event) => event.type === 'knowledge-rediscovered');
        if (lost && rediscovered) {
          return `${thread.title} has its own history: it was discovered, lost, and found again. This moment belongs to a lineage spanning ${years.toLocaleString()} years.`;
        }
        return `${thread.title} has moved through ${thread.eventCount.toLocaleString()} recorded stages of discovery, adoption or transformation across ${years.toLocaleString()} years.`;
      }
      case 'civilizational-threshold': {
        const thresholdCount = events.filter((event) => event.significance >= 0.55).length;
        if (currentIsThreadEvent) {
          return `This is not an isolated milestone. It is the latest of ${thresholdCount.toLocaleString()} major thresholds in a transformation unfolding across ${years.toLocaleString()} years.`;
        }
        return `The civilization is living inside a longer transformation: ${thresholdCount.toLocaleString()} major thresholds have changed what it is capable of becoming.`;
      }
    }
  }

  private sourceEvents(thread: NarrativeThread, scene: ObservationCandidate, state: SimulationState): string[] {
    const events = thread.eventIds
      .map((id) => state.history.find((event) => event.id === id))
      .filter((event): event is HistoricalEvent => event !== undefined && event.month <= state.month);
    if (events.length === 0) return [];

    const anchors: HistoricalEvent[] = [];
    const first = events[0];
    const last = events[events.length - 1];
    if (first) anchors.push(first);
    if (last && last.id !== first?.id) anchors.push(last);
    if (scene.event && thread.eventIds.includes(scene.event.id) && !anchors.some((event) => event.id === scene.event?.id)) anchors.push(scene.event);

    const reversal = [...events].reverse().find((event) => ['war-ended', 'knowledge-rediscovered', 'recovery', 'civilization-recovery', 'settlement-abandoned'].includes(event.type));
    if (reversal && !anchors.some((event) => event.id === reversal.id)) anchors.push(reversal);
    return anchors.slice(0, 4).map((event) => event.id);
  }

  private settlementActors(event: HistoricalEvent, state: SimulationState): SimulationState['settlements'] {
    const ids = new Set(event.actors);
    if (event.locationId) ids.add(event.locationId);
    return state.settlements.filter((settlement) => ids.has(settlement.id));
  }

  private reversalCount(events: readonly HistoricalEvent[]): number {
    let count = 0;
    for (const [opening, closing] of REVERSAL_PAIRS) {
      let seenOpening = false;
      for (const event of events) {
        if (event.type === opening) seenOpening = true;
        else if (event.type === closing && seenOpening) {
          count += 1;
          seenOpening = false;
        }
      }
    }
    return count;
  }

  private status(kind: NarrativeThreadKind, events: readonly HistoricalEvent[], month: number): NarrativeThreadStatus {
    const last = events[events.length - 1];
    if (!last) return 'dormant';
    if (kind === 'rivalry' && last.type === 'war-ended') return 'resolved';
    if (kind === 'settlement-arc' && last.type === 'settlement-abandoned') return 'resolved';
    if (kind === 'civilizational-threshold' && (last.type === 'outcome-classified' || last.type === 'observation-lost')) return 'resolved';
    return month - last.month <= 80 * 12 ? 'active' : 'dormant';
  }
}
