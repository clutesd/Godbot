import type { HistoricalEvent, HistoricalEventType, SimulationState, Vec2 } from '../sim/types';
import type { NarrativeThread } from './NarrativeThreadEngine';
import type { ObservationCandidate } from './types';

export type DeepProvenanceClass = 'recorded-fact' | 'derived-statistic' | 'historical-interpretation';
export type CausalConfidence =
  | 'recorded-direct-cause'
  | 'strongly-supported-contributor'
  | 'enabling-precondition'
  | 'plausible-interpretation'
  | 'unknown';

export interface DeepProvenance {
  class: DeepProvenanceClass;
  sourceEventIds: string[];
  sourceMemoryIds: string[];
}

export interface CompressedEventMemory {
  id: string;
  eventId: string;
  month: number;
  type: HistoricalEventType;
  label: string;
  entityIds: string[];
  locationId?: string;
  location?: Vec2;
  knowledgeId?: string;
  attributedPersonId?: string;
  affectedPopulation: number;
  magnitude: number;
  contemporarySignificance: number;
  retrospectiveSignificance: number;
  retrospectiveReasons: string[];
  whyRemembered: string;
  provenance: DeepProvenance;
}

export interface DeepEpisodeMemory {
  id: string;
  title: string;
  startMonth: number;
  endMonth: number;
  entityIds: string[];
  keyEventIds: string[];
  turningPointEventIds: string[];
  consequences: string[];
  unresolvedConsequences: string[];
  significance: number;
  provenance: DeepProvenance;
  whyRemembered: string;
}

export interface DeepThreadMemory {
  id: string;
  title: string;
  kind: NarrativeThread['kind'];
  firstMonth: number;
  lastMonth: number;
  entityIds: string[];
  sourceEventIds: string[];
  significance: number;
  reversals: number;
  status: NarrativeThread['status'];
  provenance: DeepProvenance;
}

export interface DeepEraMemory {
  id: string;
  label: string;
  startMonth: number;
  endMonth?: number;
  boundaryEventId?: string;
  structuralSignals: Array<{ type: HistoricalEventType; count: number }>;
  keyMemoryIds: string[];
  significance: number;
  provenance: DeepProvenance;
}

export interface DeepEntityMemory {
  id: string;
  entityId: string;
  kind: 'person' | 'settlement' | 'institution' | 'polity' | 'knowledge' | 'idea' | 'other';
  label: string;
  firstMonth: number;
  lastMonth: number;
  contemporarySignificance: number;
  retrospectiveSignificance: number;
  reasons: string[];
  sourceMemoryIds: string[];
}

export interface CivilizationMemory {
  id: string;
  month: number;
  title: string;
  summary: string;
  significance: number;
  provenance: DeepProvenance;
}

export interface CausalMemoryLink {
  id: string;
  fromEventId: string;
  toEventId: string;
  confidence: 'recorded-direct-cause';
  evidenceEventIds: string[];
}

export interface DeepHistoricalMemorySnapshot {
  version: 1;
  lastProcessedMonth: number;
  processedEventIdsAtMonth: string[];
  events: CompressedEventMemory[];
  episodes: DeepEpisodeMemory[];
  threads: DeepThreadMemory[];
  eras: DeepEraMemory[];
  entities: DeepEntityMemory[];
  civilization: CivilizationMemory[];
  causalLinks: CausalMemoryLink[];
}

export interface DeepEpisodeInput {
  id: string;
  title: string;
  startMonth: number;
  endMonth: number;
  entityIds: readonly string[];
  keyEventIds: readonly string[];
  turningPointEventIds?: readonly string[];
  consequences?: readonly string[];
  unresolvedConsequences?: readonly string[];
  significance: number;
}

export interface DeepHistoryRemark {
  text: string;
  sourceMemoryIds: string[];
  provenance: DeepProvenanceClass;
}

export interface CausalAssessment {
  confidence: CausalConfidence;
  sourceEventId: string;
  targetEventId: string;
  evidenceEventIds: string[];
  text: string;
}

export const DEEP_HISTORY_LIMITS = {
  events: 512,
  episodes: 192,
  threads: 120,
  eras: 64,
  entities: 256,
  civilization: 48,
  causalLinks: 768,
  eventRefsPerRecord: 16,
  memoryRefsPerRecord: 16,
  entityRefsPerRecord: 12,
  reasonsPerRecord: 8,
  structuralSignalsPerEra: 8,
  processedEventRefs: 64,
} as const;

const ALWAYS_RETAIN = new Set<HistoricalEventType>([
  'settlement-founded', 'settlement-abandoned', 'major-migration', 'first-contact', 'trade-route-established',
  'discovery', 'knowledge-lost', 'knowledge-rediscovered', 'knowledge-adopted', 'technology-transformation', 'technology-widespread',
  'infrastructure-built', 'archive-destroyed', 'industrialization-stage', 'industrialization', 'institution-formed',
  'alliance-formed', 'alliance-ended', 'political-transition', 'leadership-succession', 'war-declared', 'war-ended',
  'harvest-crisis', 'recovery', 'pandemic', 'ecological-crisis', 'climate-crisis', 'resource-crisis', 'natural-catastrophe',
  'statistical-transition', 'atomic-threshold', 'nuclear-weapons-developed', 'nuclear-use', 'nuclear-exchange',
  'machine-intelligence-transition', 'first-orbit', 'offworld-settlement', 'interplanetary-transition',
  'civilization-collapse', 'civilization-recovery', 'planetary-stability', 'post-biological-transition', 'observation-lost', 'outcome-classified',
]);

const ERA_BOUNDARIES = new Set<HistoricalEventType>([
  'industrialization', 'political-transition', 'atomic-threshold', 'machine-intelligence-transition', 'first-orbit',
  'offworld-settlement', 'interplanetary-transition', 'civilization-collapse', 'civilization-recovery',
  'planetary-stability', 'post-biological-transition', 'observation-lost',
]);

const TURNING_POINTS = new Set<HistoricalEventType>([
  'war-ended', 'knowledge-rediscovered', 'recovery', 'settlement-abandoned', 'alliance-ended',
  'industrialization', 'atomic-threshold', 'machine-intelligence-transition', 'first-orbit', 'interplanetary-transition',
  'civilization-collapse', 'civilization-recovery', 'post-biological-transition',
]);

const CIVILIZATION_SCALE_EVENTS = new Set<HistoricalEventType>([
  'statistical-transition', 'industrialization', 'atomic-threshold', 'nuclear-use', 'nuclear-exchange',
  'machine-intelligence-transition', 'first-orbit', 'offworld-settlement', 'interplanetary-transition',
  'civilization-collapse', 'civilization-recovery', 'planetary-stability', 'post-biological-transition', 'observation-lost', 'outcome-classified',
]);

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const unique = (values: readonly string[]): string[] => [...new Set(values)];
const readable = (value: string): string => value.replaceAll('-', ' ');

function emptySnapshot(): DeepHistoricalMemorySnapshot {
  return {
    version: 1,
    lastProcessedMonth: -1,
    processedEventIdsAtMonth: [],
    events: [],
    episodes: [],
    threads: [],
    eras: [],
    entities: [],
    civilization: [],
    causalLinks: [],
  };
}

function eventMemoryId(eventId: string): string {
  return `deep:event:${eventId}`;
}

function trimText(value: string, limit = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function memoryPriority(memory: CompressedEventMemory): number {
  const thresholdBonus = CIVILIZATION_SCALE_EVENTS.has(memory.type) ? 0.22 : 0;
  return Math.max(memory.contemporarySignificance, memory.retrospectiveSignificance) + thresholdBonus;
}

export class DeepHistoricalMemory {
  private memory: DeepHistoricalMemorySnapshot;

  constructor(snapshot?: DeepHistoricalMemorySnapshot) {
    this.memory = this.sanitize(snapshot ?? emptySnapshot());
  }

  snapshot(): DeepHistoricalMemorySnapshot {
    return structuredClone(this.memory);
  }

  restore(snapshot?: DeepHistoricalMemorySnapshot): void {
    this.memory = this.sanitize(snapshot ?? emptySnapshot());
  }

  observe(state: SimulationState): void {
    const seenAtMonth = new Set(this.memory.processedEventIdsAtMonth);
    const events = state.history
      .filter((event) => event.month > this.memory.lastProcessedMonth
        || (event.month === this.memory.lastProcessedMonth && !seenAtMonth.has(event.id)))
      .sort((a, b) => a.month - b.month || a.id.localeCompare(b.id));

    for (const event of events) this.processEvent(event, state);
    if (events.length > 0) {
      const latestMonth = events[events.length - 1]?.month ?? this.memory.lastProcessedMonth;
      this.memory.lastProcessedMonth = latestMonth;
      this.memory.processedEventIdsAtMonth = state.history
        .filter((event) => event.month === latestMonth)
        .map((event) => event.id)
        .slice(-DEEP_HISTORY_LIMITS.processedEventRefs);
    }
    this.compact();
  }

  rememberEpisode(input: DeepEpisodeInput): void {
    const sourceMemories = input.keyEventIds.map(eventMemoryId).filter((id) => this.hasMemoryId(id));
    const record: DeepEpisodeMemory = {
      id: input.id.startsWith('deep:episode:') ? input.id : `deep:episode:${input.id}`,
      title: trimText(input.title, 120),
      startMonth: input.startMonth,
      endMonth: input.endMonth,
      entityIds: unique(input.entityIds).slice(0, DEEP_HISTORY_LIMITS.entityRefsPerRecord),
      keyEventIds: unique(input.keyEventIds).slice(-DEEP_HISTORY_LIMITS.eventRefsPerRecord),
      turningPointEventIds: unique(input.turningPointEventIds ?? []).slice(-DEEP_HISTORY_LIMITS.eventRefsPerRecord),
      consequences: unique((input.consequences ?? []).map((item) => trimText(item))).slice(-6),
      unresolvedConsequences: unique((input.unresolvedConsequences ?? []).map((item) => trimText(item))).slice(-4),
      significance: clamp(input.significance),
      provenance: {
        class: 'derived-statistic',
        sourceEventIds: unique(input.keyEventIds).slice(-DEEP_HISTORY_LIMITS.eventRefsPerRecord),
        sourceMemoryIds: sourceMemories.slice(-DEEP_HISTORY_LIMITS.memoryRefsPerRecord),
      },
      whyRemembered: input.turningPointEventIds && input.turningPointEventIds.length > 0
        ? 'It contains a recorded turning point.'
        : 'It concentrates several meaningful observations into one bounded episode.',
    };
    const index = this.memory.episodes.findIndex((item) => item.id === record.id);
    if (index >= 0) this.memory.episodes[index] = record;
    else this.memory.episodes.push(record);
    this.compact();
  }

  rememberThread(thread: NarrativeThread): void {
    const memoryIds = thread.eventIds.map(eventMemoryId).filter((id) => this.hasMemoryId(id));
    const record: DeepThreadMemory = {
      id: `deep:thread:${thread.id}`,
      title: trimText(thread.title, 120),
      kind: thread.kind,
      firstMonth: thread.firstMonth,
      lastMonth: thread.lastMonth,
      entityIds: unique(thread.entityIds).slice(0, DEEP_HISTORY_LIMITS.entityRefsPerRecord),
      sourceEventIds: unique(thread.eventIds).slice(-DEEP_HISTORY_LIMITS.eventRefsPerRecord),
      significance: clamp(thread.interestingness),
      reversals: thread.reversals,
      status: thread.status,
      provenance: {
        class: 'derived-statistic',
        sourceEventIds: unique(thread.eventIds).slice(-DEEP_HISTORY_LIMITS.eventRefsPerRecord),
        sourceMemoryIds: memoryIds.slice(-DEEP_HISTORY_LIMITS.memoryRefsPerRecord),
      },
    };
    const index = this.memory.threads.findIndex((item) => item.id === record.id);
    if (index >= 0) this.memory.threads[index] = record;
    else this.memory.threads.push(record);
    this.compact();
  }

  causalAssessment(sourceEventId: string, targetEventId: string): CausalAssessment {
    const source = this.memory.events.find((item) => item.eventId === sourceEventId);
    const target = this.memory.events.find((item) => item.eventId === targetEventId);
    if (!source || !target || source.month >= target.month) {
      return { confidence: 'unknown', sourceEventId, targetEventId, evidenceEventIds: [], text: 'The compressed record does not support a causal claim.' };
    }

    const direct = this.memory.causalLinks.find((link) => link.fromEventId === sourceEventId && link.toEventId === targetEventId);
    if (direct) {
      return {
        confidence: 'recorded-direct-cause', sourceEventId, targetEventId, evidenceEventIds: direct.evidenceEventIds,
        text: `The record explicitly links ${source.label} as a cause of ${target.label}.`,
      };
    }

    const path = this.shortestCausalPath(sourceEventId, targetEventId, 4);
    if (path && path.length === 3) {
      return {
        confidence: 'strongly-supported-contributor', sourceEventId, targetEventId, evidenceEventIds: path,
        text: `The record supports ${source.label} as a contributor to ${target.label} through an explicit causal chain.`,
      };
    }
    if (path && path.length > 3) {
      return {
        confidence: 'enabling-precondition', sourceEventId, targetEventId, evidenceEventIds: path,
        text: `${source.label} sits earlier in a recorded causal chain leading toward ${target.label}; it is safer to treat it as a precondition than as the sole cause.`,
      };
    }

    const entityOverlap = source.entityIds.some((id) => target.entityIds.includes(id));
    const sameLocation = Boolean(source.locationId && source.locationId === target.locationId);
    if ((entityOverlap || sameLocation) && target.month - source.month <= 200 * 12) {
      return {
        confidence: 'plausible-interpretation', sourceEventId, targetEventId,
        evidenceEventIds: [sourceEventId, targetEventId],
        text: `${source.label} may be related to ${target.label}, but the record does not identify it as a cause.`,
      };
    }

    return { confidence: 'unknown', sourceEventId, targetEventId, evidenceEventIds: [], text: 'The compressed record does not support a causal claim.' };
  }

  callbackFor(scene: ObservationCandidate, state: SimulationState): DeepHistoryRemark | undefined {
    const activeEventIds = new Set(state.history.map((event) => event.id));
    const candidates = this.memory.events.filter((memory) => {
      if (activeEventIds.has(memory.eventId)) return false;
      if (state.month - memory.month < 500 * 12) return false;
      if (memory.retrospectiveSignificance < 0.62) return false;
      const subjectMatch = memory.entityIds.includes(scene.subjectId) || memory.locationId === scene.subjectId;
      const distance = memory.location ? Math.hypot(memory.location.x - scene.position.x, memory.location.z - scene.position.z) : Number.POSITIVE_INFINITY;
      return subjectMatch || distance <= 2.5;
    });
    candidates.sort((a, b) => b.retrospectiveSignificance - a.retrospectiveSignificance || a.month - b.month);
    const chosen = candidates[0];
    if (!chosen) return undefined;

    const years = Math.max(1, Math.floor((state.month - chosen.month) / 12));
    if (chosen.retrospectiveSignificance - chosen.contemporarySignificance >= 0.18 && chosen.retrospectiveReasons.length > 0) {
      return {
        text: `I did not understand the importance of ${chosen.label} when it first entered the record. ${chosen.retrospectiveReasons[0]}`,
        sourceMemoryIds: [chosen.id],
        provenance: 'historical-interpretation',
      };
    }
    return {
      text: `I remember this place ${years.toLocaleString()} years ago, when ${readable(chosen.type)} entered the record.`,
      sourceMemoryIds: [chosen.id],
      provenance: 'recorded-fact',
    };
  }

  hasMemoryId(id: string): boolean {
    return this.allMemoryIds().has(id);
  }

  eventMemory(eventId: string): CompressedEventMemory | undefined {
    const memory = this.memory.events.find((item) => item.eventId === eventId);
    return memory ? structuredClone(memory) : undefined;
  }

  entityMemory(entityId: string): DeepEntityMemory | undefined {
    const memory = this.memory.entities.find((item) => item.entityId === entityId);
    return memory ? structuredClone(memory) : undefined;
  }

  private processEvent(event: HistoricalEvent, state: SimulationState): void {
    const retainTarget = this.shouldRetain(event);
    if (retainTarget) this.rememberEvent(event, state, this.reasonFor(event));

    for (const causeId of event.causes) {
      const cause = state.history.find((candidate) => candidate.id === causeId);
      if (cause) this.rememberEvent(cause, state, 'A later recorded event identifies it in its causal chain.');
      if (this.eventMemory(causeId) && (retainTarget || this.eventMemory(event.id))) {
        this.rememberEvent(event, state, this.reasonFor(event));
        this.addDirectCausalLink(causeId, event.id);
        this.promoteCausalAncestors(event.id, event.significance);
      }
    }

    const retained = this.memory.events.find((item) => item.eventId === event.id);
    if (!retained) return;

    this.rememberEntities(retained, event, state);
    this.promoteKnowledgeLineage(retained);
    this.maybeCreateEpisode(retained, event);
    this.updateEra(retained);
    this.maybeCreateCivilizationMemory(retained, event);
  }

  private shouldRetain(event: HistoricalEvent): boolean {
    return event.significance >= 0.42 || ALWAYS_RETAIN.has(event.type);
  }

  private reasonFor(event: HistoricalEvent): string {
    if (CIVILIZATION_SCALE_EVENTS.has(event.type)) return 'It changed the scale or long-term condition of civilization.';
    if (event.significance >= 0.75) return 'Its contemporary significance was unusually high.';
    if (TURNING_POINTS.has(event.type)) return 'It marked a reversal or turning point.';
    return `It belongs to the durable historical record of ${readable(event.type)}.`;
  }

  private rememberEvent(event: HistoricalEvent, state: SimulationState, whyRemembered: string): CompressedEventMemory {
    let memory = this.memory.events.find((item) => item.eventId === event.id);
    if (memory) return memory;
    const knowledgeId = typeof event.context.knowledge === 'string' ? event.context.knowledge : undefined;
    const attributedPersonId = typeof event.context.attributedPersonId === 'string' ? event.context.attributedPersonId : undefined;
    memory = {
      id: eventMemoryId(event.id), eventId: event.id, month: event.month, type: event.type,
      label: trimText(event.summary || `${readable(event.type)} at month ${event.month}`, 140),
      entityIds: unique([...(event.locationId ? [event.locationId] : []), ...event.actors, ...(attributedPersonId ? [attributedPersonId] : [])]).slice(0, DEEP_HISTORY_LIMITS.entityRefsPerRecord),
      ...(event.locationId ? { locationId: event.locationId } : {}),
      ...(event.location ? { location: structuredClone(event.location) } : {}),
      ...(knowledgeId ? { knowledgeId } : {}),
      ...(attributedPersonId ? { attributedPersonId } : {}),
      affectedPopulation: Math.max(0, event.affectedPopulation), magnitude: clamp(event.magnitude),
      contemporarySignificance: clamp(event.significance), retrospectiveSignificance: clamp(event.significance),
      retrospectiveReasons: [], whyRemembered,
      provenance: { class: 'recorded-fact', sourceEventIds: [event.id], sourceMemoryIds: [] },
    };
    this.memory.events.push(memory);
    return memory;
  }

  private rememberEntities(memory: CompressedEventMemory, event: HistoricalEvent, state: SimulationState): void {
    for (const entityId of memory.entityIds) {
      const kind = this.entityKind(entityId, state, memory);
      if (event.significance < 0.5 && kind !== 'person') continue;
      const label = this.entityLabel(entityId, state, event, memory);
      let entity = this.memory.entities.find((item) => item.entityId === entityId);
      if (!entity) {
        entity = {
          id: `deep:entity:${entityId}`, entityId, kind, label, firstMonth: event.month, lastMonth: event.month,
          contemporarySignificance: memory.contemporarySignificance, retrospectiveSignificance: memory.retrospectiveSignificance,
          reasons: [memory.whyRemembered], sourceMemoryIds: [memory.id],
        };
        this.memory.entities.push(entity);
      } else {
        entity.lastMonth = Math.max(entity.lastMonth, event.month);
        entity.contemporarySignificance = Math.max(entity.contemporarySignificance, memory.contemporarySignificance);
        entity.retrospectiveSignificance = Math.max(entity.retrospectiveSignificance, memory.retrospectiveSignificance);
        entity.reasons = unique([...entity.reasons, memory.whyRemembered]).slice(-DEEP_HISTORY_LIMITS.reasonsPerRecord);
        entity.sourceMemoryIds = unique([...entity.sourceMemoryIds, memory.id]).slice(-DEEP_HISTORY_LIMITS.memoryRefsPerRecord);
      }
    }
  }

  private entityKind(entityId: string, state: SimulationState, memory: CompressedEventMemory): DeepEntityMemory['kind'] {
    if (state.people.some((item) => item.id === entityId) || memory.attributedPersonId === entityId) return 'person';
    if (state.settlements.some((item) => item.id === entityId)) return 'settlement';
    if (state.institutions.some((item) => item.id === entityId)) return 'institution';
    if (state.polities.some((item) => item.id === entityId)) return 'polity';
    if (state.ideas?.some((item) => item.id === entityId)) return 'idea';
    return 'other';
  }

  private entityLabel(entityId: string, state: SimulationState, event: HistoricalEvent, memory: CompressedEventMemory): string {
    if (memory.attributedPersonId === entityId && typeof event.context.name === 'string') return event.context.name;
    return state.people.find((item) => item.id === entityId)?.name
      ?? state.settlements.find((item) => item.id === entityId)?.name
      ?? state.institutions.find((item) => item.id === entityId)?.name
      ?? state.polities.find((item) => item.id === entityId)?.name
      ?? state.ideas?.find((item) => item.id === entityId)?.name
      ?? entityId;
  }

  private addDirectCausalLink(fromEventId: string, toEventId: string): void {
    const id = `deep:cause:${fromEventId}->${toEventId}`;
    if (this.memory.causalLinks.some((item) => item.id === id)) return;
    this.memory.causalLinks.push({ id, fromEventId, toEventId, confidence: 'recorded-direct-cause', evidenceEventIds: [fromEventId, toEventId] });
  }

  private promoteCausalAncestors(targetEventId: string, targetSignificance: number): void {
    const visit = (currentTargetId: string, depth: number, seen: Set<string>): void => {
      if (depth > 3) return;
      for (const link of this.memory.causalLinks.filter((item) => item.toEventId === currentTargetId)) {
        if (seen.has(link.fromEventId)) continue;
        seen.add(link.fromEventId);
        const source = this.memory.events.find((item) => item.eventId === link.fromEventId);
        if (!source) continue;
        const promoted = clamp(targetSignificance * Math.max(0.38, 0.82 - depth * 0.16));
        if (promoted > source.retrospectiveSignificance) {
          source.retrospectiveSignificance = promoted;
          source.retrospectiveReasons = unique([...source.retrospectiveReasons, `Later recorded consequences made this earlier ${readable(source.type)} more important in retrospect.`]).slice(-DEEP_HISTORY_LIMITS.reasonsPerRecord);
          for (const entityId of source.entityIds) {
            const entity = this.memory.entities.find((item) => item.entityId === entityId);
            if (entity) entity.retrospectiveSignificance = Math.max(entity.retrospectiveSignificance, promoted);
          }
        }
        visit(link.fromEventId, depth + 1, seen);
      }
    };
    visit(targetEventId, 0, new Set<string>());
  }

  private promoteKnowledgeLineage(memory: CompressedEventMemory): void {
    if (!memory.knowledgeId || !['knowledge-adopted', 'technology-transformation', 'technology-widespread', 'knowledge-rediscovered'].includes(memory.type)) return;
    const earlier = this.memory.events
      .filter((item) => item.knowledgeId === memory.knowledgeId && item.month < memory.month)
      .sort((a, b) => a.month - b.month);
    const origin = earlier[0];
    if (!origin) return;
    const promoted = clamp(Math.max(origin.retrospectiveSignificance, memory.retrospectiveSignificance * 0.8));
    if (promoted <= origin.retrospectiveSignificance) return;
    origin.retrospectiveSignificance = promoted;
    origin.retrospectiveReasons = unique([...origin.retrospectiveReasons, `Later adoption of ${readable(memory.knowledgeId)} made this earlier contribution foundational in retrospect.`]).slice(-DEEP_HISTORY_LIMITS.reasonsPerRecord);
    if (origin.attributedPersonId) {
      const person = this.memory.entities.find((item) => item.entityId === origin.attributedPersonId);
      if (person) person.retrospectiveSignificance = Math.max(person.retrospectiveSignificance, promoted);
    }
  }

  private maybeCreateEpisode(memory: CompressedEventMemory, event: HistoricalEvent): void {
    if (memory.contemporarySignificance < 0.68 && !TURNING_POINTS.has(memory.type)) return;
    const causeIds = event.causes.filter((id) => this.memory.events.some((item) => item.eventId === id));
    const causeMonths = causeIds.map((id) => this.memory.events.find((item) => item.eventId === id)?.month).filter((month): month is number => month !== undefined);
    this.rememberEpisode({
      id: `event-${event.id}`,
      title: memory.label,
      startMonth: Math.min(memory.month, ...causeMonths), endMonth: memory.month,
      entityIds: memory.entityIds,
      keyEventIds: [...causeIds, event.id],
      turningPointEventIds: TURNING_POINTS.has(event.type) ? [event.id] : [],
      consequences: event.outcome ? [event.outcome] : [],
      significance: Math.max(memory.contemporarySignificance, memory.retrospectiveSignificance),
    });
  }

  private updateEra(memory: CompressedEventMemory): void {
    let current = this.memory.eras.find((item) => item.endMonth === undefined);
    if (!current) {
      current = this.newEra(memory.month, memory);
      this.memory.eras.push(current);
    }

    const signal = current.structuralSignals.find((item) => item.type === memory.type);
    if (signal) signal.count += 1;
    else current.structuralSignals.push({ type: memory.type, count: 1 });
    current.structuralSignals.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    current.structuralSignals = current.structuralSignals.slice(0, DEEP_HISTORY_LIMITS.structuralSignalsPerEra);
    current.keyMemoryIds = unique([...current.keyMemoryIds, memory.id]).slice(-DEEP_HISTORY_LIMITS.memoryRefsPerRecord);
    current.significance = Math.max(current.significance, memory.retrospectiveSignificance);
    current.provenance.sourceEventIds = unique([...current.provenance.sourceEventIds, memory.eventId]).slice(-DEEP_HISTORY_LIMITS.eventRefsPerRecord);
    current.provenance.sourceMemoryIds = unique([...current.provenance.sourceMemoryIds, memory.id]).slice(-DEEP_HISTORY_LIMITS.memoryRefsPerRecord);

    if (!ERA_BOUNDARIES.has(memory.type)) return;
    const minimumSpan = CIVILIZATION_SCALE_EVENTS.has(memory.type) ? 0 : 10 * 12;
    if (memory.month - current.startMonth < minimumSpan && current.boundaryEventId) return;
    if (current.startMonth < memory.month) current.endMonth = Math.max(current.startMonth, memory.month - 1);
    const next = this.newEra(memory.month, memory);
    next.boundaryEventId = memory.eventId;
    this.memory.eras.push(next);
  }

  private newEra(startMonth: number, memory: CompressedEventMemory): DeepEraMemory {
    return {
      id: `deep:era:${startMonth}:${memory.eventId}`,
      label: `A period shaped by ${readable(memory.type)}`,
      startMonth,
      structuralSignals: [{ type: memory.type, count: 1 }],
      keyMemoryIds: [memory.id],
      significance: memory.retrospectiveSignificance,
      provenance: { class: 'derived-statistic', sourceEventIds: [memory.eventId], sourceMemoryIds: [memory.id] },
    };
  }

  private maybeCreateCivilizationMemory(memory: CompressedEventMemory, event: HistoricalEvent): void {
    if (!CIVILIZATION_SCALE_EVENTS.has(event.type) && memory.retrospectiveSignificance < 0.86) return;
    const record: CivilizationMemory = {
      id: `deep:civilization:${event.id}`, month: event.month, title: trimText(memory.label, 120),
      summary: trimText(event.outcome || event.summary, 240), significance: Math.max(memory.contemporarySignificance, memory.retrospectiveSignificance),
      provenance: { class: 'recorded-fact', sourceEventIds: [event.id], sourceMemoryIds: [memory.id] },
    };
    if (!this.memory.civilization.some((item) => item.id === record.id)) this.memory.civilization.push(record);
  }

  private shortestCausalPath(sourceEventId: string, targetEventId: string, maxEdges: number): string[] | undefined {
    const queue: Array<{ id: string; path: string[] }> = [{ id: sourceEventId, path: [sourceEventId] }];
    const visited = new Set<string>([sourceEventId]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (current.path.length - 1 >= maxEdges) continue;
      for (const link of this.memory.causalLinks.filter((item) => item.fromEventId === current.id)) {
        if (visited.has(link.toEventId)) continue;
        const path = [...current.path, link.toEventId];
        if (link.toEventId === targetEventId) return path;
        visited.add(link.toEventId);
        queue.push({ id: link.toEventId, path });
      }
    }
    return undefined;
  }

  private compact(): void {
    this.memory.events.sort((a, b) => memoryPriority(b) - memoryPriority(a) || b.month - a.month || a.id.localeCompare(b.id));
    this.memory.events = this.memory.events.slice(0, DEEP_HISTORY_LIMITS.events);
    const eventIds = new Set(this.memory.events.map((item) => item.eventId));
    this.memory.causalLinks = this.memory.causalLinks
      .filter((item) => eventIds.has(item.fromEventId) && eventIds.has(item.toEventId))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(-DEEP_HISTORY_LIMITS.causalLinks);

    this.memory.episodes.sort((a, b) => b.significance - a.significance || b.endMonth - a.endMonth || a.id.localeCompare(b.id));
    this.memory.episodes = this.memory.episodes.slice(0, DEEP_HISTORY_LIMITS.episodes);
    this.memory.threads.sort((a, b) => b.significance - a.significance || b.lastMonth - a.lastMonth || a.id.localeCompare(b.id));
    this.memory.threads = this.memory.threads.slice(0, DEEP_HISTORY_LIMITS.threads);
    this.memory.eras.sort((a, b) => a.startMonth - b.startMonth || a.id.localeCompare(b.id));
    if (this.memory.eras.length > DEEP_HISTORY_LIMITS.eras) this.memory.eras = this.memory.eras.slice(-DEEP_HISTORY_LIMITS.eras);
    this.memory.entities.sort((a, b) => b.retrospectiveSignificance - a.retrospectiveSignificance || b.lastMonth - a.lastMonth || a.id.localeCompare(b.id));
    this.memory.entities = this.memory.entities.slice(0, DEEP_HISTORY_LIMITS.entities);
    this.memory.civilization.sort((a, b) => b.significance - a.significance || b.month - a.month || a.id.localeCompare(b.id));
    this.memory.civilization = this.memory.civilization.slice(0, DEEP_HISTORY_LIMITS.civilization);
    this.memory.processedEventIdsAtMonth = unique(this.memory.processedEventIdsAtMonth).slice(-DEEP_HISTORY_LIMITS.processedEventRefs);

    const validMemoryIds = this.allMemoryIds();
    const filterProvenance = (provenance: DeepProvenance): void => {
      provenance.sourceEventIds = unique(provenance.sourceEventIds).slice(-DEEP_HISTORY_LIMITS.eventRefsPerRecord);
      provenance.sourceMemoryIds = unique(provenance.sourceMemoryIds).filter((id) => validMemoryIds.has(id)).slice(-DEEP_HISTORY_LIMITS.memoryRefsPerRecord);
    };
    for (const item of this.memory.events) {
      item.entityIds = unique(item.entityIds).slice(0, DEEP_HISTORY_LIMITS.entityRefsPerRecord);
      item.retrospectiveReasons = unique(item.retrospectiveReasons).slice(-DEEP_HISTORY_LIMITS.reasonsPerRecord);
      filterProvenance(item.provenance);
    }
    for (const item of this.memory.episodes) filterProvenance(item.provenance);
    for (const item of this.memory.threads) filterProvenance(item.provenance);
    for (const item of this.memory.eras) filterProvenance(item.provenance);
    for (const item of this.memory.civilization) filterProvenance(item.provenance);
    for (const item of this.memory.entities) {
      item.reasons = unique(item.reasons).slice(-DEEP_HISTORY_LIMITS.reasonsPerRecord);
      item.sourceMemoryIds = unique(item.sourceMemoryIds).filter((id) => validMemoryIds.has(id)).slice(-DEEP_HISTORY_LIMITS.memoryRefsPerRecord);
    }
  }

  private allMemoryIds(): Set<string> {
    return new Set<string>([
      ...this.memory.events.map((item) => item.id),
      ...this.memory.episodes.map((item) => item.id),
      ...this.memory.threads.map((item) => item.id),
      ...this.memory.eras.map((item) => item.id),
      ...this.memory.entities.map((item) => item.id),
      ...this.memory.civilization.map((item) => item.id),
    ]);
  }

  private sanitize(snapshot: DeepHistoricalMemorySnapshot): DeepHistoricalMemorySnapshot {
    const source = structuredClone(snapshot);
    const memory: DeepHistoricalMemorySnapshot = {
      ...emptySnapshot(), ...source, version: 1,
      events: (source.events ?? []).slice(0, DEEP_HISTORY_LIMITS.events),
      episodes: (source.episodes ?? []).slice(0, DEEP_HISTORY_LIMITS.episodes),
      threads: (source.threads ?? []).slice(0, DEEP_HISTORY_LIMITS.threads),
      eras: (source.eras ?? []).slice(0, DEEP_HISTORY_LIMITS.eras),
      entities: (source.entities ?? []).slice(0, DEEP_HISTORY_LIMITS.entities),
      civilization: (source.civilization ?? []).slice(0, DEEP_HISTORY_LIMITS.civilization),
      causalLinks: (source.causalLinks ?? []).slice(0, DEEP_HISTORY_LIMITS.causalLinks),
      processedEventIdsAtMonth: unique(source.processedEventIdsAtMonth ?? []).slice(-DEEP_HISTORY_LIMITS.processedEventRefs),
    };
    this.memory = memory;
    this.compact();
    return this.memory;
  }
}

/**
 * The persistent Watcher snapshot already rides through RunArchive. Keeping deep history nested
 * there avoids a second persistence channel while remaining backwards compatible with v4 records.
 */
declare module './WatcherMind' {
  interface WatcherMemorySnapshot {
    deepHistory?: DeepHistoricalMemorySnapshot;
  }
}

export function deepHistoryFromWatcherSnapshot(snapshot?: { deepHistory?: DeepHistoricalMemorySnapshot }): DeepHistoricalMemory {
  return new DeepHistoricalMemory(snapshot?.deepHistory);
}

export function attachDeepHistory<T extends { deepHistory?: DeepHistoricalMemorySnapshot }>(snapshot: T, deepHistory: DeepHistoricalMemorySnapshot): T {
  snapshot.deepHistory = structuredClone(deepHistory);
  return snapshot;
}
