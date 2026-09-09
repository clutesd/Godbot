import type { HistoricalEvent, HistorianPrediction, ObservationCandidate } from './types';
import type { SimulationState } from '../sim/types';

export type WatcherSubjectKind = 'person' | 'settlement' | 'institution' | 'polity' | 'knowledge' | 'thread' | 'other';
export type WatcherQuestionKind = 'settlement-recovery' | 'institution-survival' | 'knowledge-diffusion';
export type WatcherQuestionStatus = 'open' | 'resolved' | 'contradicted' | 'irrelevant';
export type WatcherBeliefKind = 'trade-cohesion' | 'settlement-resilience';
export type WatcherBeliefStatus = 'tentative' | 'strengthened' | 'weakened' | 'contradicted' | 'revised' | 'resolved';

export interface WatcherSubjectMemory {
  id: string;
  kind: WatcherSubjectKind;
  label: string;
  firstObservedMonth: number;
  lastObservedMonth: number;
  meaningfulObservations: number;
  attachment: number;
  interestReasons: string[];
  sourceEventIds: string[];
}

export interface WatcherQuestion {
  id: string;
  kind: WatcherQuestionKind;
  text: string;
  openedMonth: number;
  lastEvaluatedMonth: number;
  status: WatcherQuestionStatus;
  entityIds: string[];
  evidenceEventIds: string[];
  resolutionMonth?: number;
  resolutionText?: string;
  narrated?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

export interface WatcherBelief {
  id: string;
  kind: WatcherBeliefKind;
  thesis: string;
  formedMonth: number;
  lastEvaluatedMonth: number;
  confidence: number;
  status: WatcherBeliefStatus;
  entityIds: string[];
  supportingEventIds: string[];
  contradictingEventIds: string[];
  revisionText?: string;
  narratedRevision?: boolean;
}

export interface WatcherPredictionMemory {
  predictionId: string;
  madeMonth: number;
  horizonMonth: number;
  subjectIds: string[];
  resolved: boolean;
  occurred?: boolean;
  narratedResolution?: boolean;
}

export interface WatcherMemorySnapshot {
  version: 1;
  observationSequence: number;
  lastProcessedMonth: number;
  processedEventIdsAtMonth: string[];
  subjects: WatcherSubjectMemory[];
  questions: WatcherQuestion[];
  beliefs: WatcherBelief[];
  predictions: WatcherPredictionMemory[];
}

export interface WatcherRemark {
  text: string;
  sourceEventIds: string[];
  sourceEntityIds: string[];
}

export const WATCHER_MEMORY_LIMITS = {
  subjects: 160,
  questions: 80,
  beliefs: 80,
  predictions: 120,
  eventRefsPerSubject: 12,
  reasonsPerSubject: 8,
} as const;

export function emptyWatcherMemorySnapshot(): WatcherMemorySnapshot {
  return {
    version: 1,
    observationSequence: 0,
    lastProcessedMonth: -1,
    processedEventIdsAtMonth: [],
    subjects: [],
    questions: [],
    beliefs: [],
    predictions: [],
  };
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function pairKey(a: string, b: string): string {
  return [a, b].sort((first, second) => first.localeCompare(second)).join(':');
}

export class WatcherMind {
  private memory: WatcherMemorySnapshot;

  constructor(snapshot?: WatcherMemorySnapshot) {
    this.memory = this.sanitize(snapshot ?? emptyWatcherMemorySnapshot());
  }

  get sequence(): number {
    return this.memory.observationSequence;
  }

  snapshot(): WatcherMemorySnapshot {
    return structuredClone(this.memory);
  }

  restore(snapshot?: WatcherMemorySnapshot): void {
    this.memory = this.sanitize(snapshot ?? emptyWatcherMemorySnapshot());
  }

  observe(scene: ObservationCandidate, state: SimulationState, predictions: readonly HistorianPrediction[]): void {
    this.memory.observationSequence += 1;
    this.observeSubject(scene, state);
    this.processNewEvents(state);
    this.evaluateQuestions(state);
    this.evaluateBeliefs(state);
    this.syncPredictions(predictions);
    this.compact();
  }

  observeThread(id: string, title: string, interestingness: number, eventIds: readonly string[], entityIds: readonly string[], month: number): void {
    if (interestingness < 0.5) return;
    this.rememberSubject({
      id: `thread:${id}`,
      kind: 'thread',
      label: title,
      month,
      reason: 'recurring historical thread',
      eventIds,
      attachmentGain: interestingness * 0.08,
      meaningful: true,
    });
    const subject = this.memory.subjects.find((item) => item.id === `thread:${id}`);
    if (subject) subject.interestReasons = unique([...subject.interestReasons, ...entityIds.slice(0, 3).map((entityId) => `connected to ${entityId}`)]).slice(-WATCHER_MEMORY_LIMITS.reasonsPerSubject);
  }

  remark(scene: ObservationCandidate, state: SimulationState): WatcherRemark | undefined {
    const availableEvents = new Set(state.history.map((event) => event.id));
    const knownEntities = this.currentEntityIds(state);

    const question = [...this.memory.questions].reverse().find((item) => item.status !== 'open' && !item.narrated
      && (item.entityIds.includes(scene.subjectId) || this.memory.observationSequence % 8 === 0));
    if (question?.resolutionText) {
      question.narrated = true;
      const years = Math.max(1, Math.floor(((question.resolutionMonth ?? state.month) - question.openedMonth) / 12));
      return {
        text: `${years.toLocaleString()} years ago I wondered: ${question.text} ${question.resolutionText}`,
        sourceEventIds: question.evidenceEventIds.filter((id) => availableEvents.has(id)),
        sourceEntityIds: question.entityIds.filter((id) => knownEntities.has(id)),
      };
    }

    const revised = [...this.memory.beliefs].reverse().find((belief) => ['contradicted', 'revised'].includes(belief.status)
      && !belief.narratedRevision && (belief.entityIds.includes(scene.subjectId) || this.memory.observationSequence % 9 === 0));
    if (revised?.revisionText) {
      revised.narratedRevision = true;
      return {
        text: `I once suspected ${revised.thesis.charAt(0).toLowerCase()}${revised.thesis.slice(1)} ${revised.revisionText}`,
        sourceEventIds: unique([...revised.supportingEventIds, ...revised.contradictingEventIds]).filter((id) => availableEvents.has(id)),
        sourceEntityIds: revised.entityIds.filter((id) => knownEntities.has(id)),
      };
    }

    const subject = this.memory.subjects.find((item) => item.id === scene.subjectId);
    if (!subject || subject.meaningfulObservations < 4 || this.memory.observationSequence % 7 !== 0) return undefined;
    const years = Math.floor((state.month - subject.firstObservedMonth) / 12);
    if (years < 12) return undefined;
    return {
      text: `I have returned to ${subject.label} across ${years.toLocaleString()} years. ${subject.interestReasons[0] ? `I first kept watching because of ${subject.interestReasons[0]}.` : ''}`.trim(),
      sourceEventIds: subject.sourceEventIds.filter((id) => availableEvents.has(id)),
      sourceEntityIds: knownEntities.has(scene.subjectId) ? [scene.subjectId] : [],
    };
  }

  private observeSubject(scene: ObservationCandidate, state: SimulationState): void {
    const meaningful = scene.interest >= 0.55 || Boolean(scene.event && scene.event.significance >= 0.58);
    const reason = scene.event ? `${scene.event.type.replaceAll('-', ' ')} drew attention`
      : scene.kind === 'traveler-follow' ? 'purposeful movement'
        : scene.kind === 'historian-context' ? 'long historical context'
          : 'repeated observation';
    this.rememberSubject({
      id: scene.subjectId,
      kind: this.subjectKind(scene.subjectId, state),
      label: scene.title,
      month: state.month,
      reason,
      eventIds: scene.statement.sourceEventIds,
      attachmentGain: meaningful ? 0.045 + scene.interest * 0.035 : 0.008,
      meaningful,
    });
  }

  private rememberSubject(input: { id: string; kind: WatcherSubjectKind; label: string; month: number; reason: string; eventIds: readonly string[]; attachmentGain: number; meaningful: boolean }): void {
    if (!input.id) return;
    const existing = this.memory.subjects.find((item) => item.id === input.id);
    if (existing) {
      existing.lastObservedMonth = Math.max(existing.lastObservedMonth, input.month);
      if (input.meaningful) existing.meaningfulObservations += 1;
      existing.attachment = clamp(existing.attachment + input.attachmentGain);
      existing.label = input.label || existing.label;
      existing.interestReasons = unique([...existing.interestReasons, input.reason]).slice(-WATCHER_MEMORY_LIMITS.reasonsPerSubject);
      existing.sourceEventIds = unique([...existing.sourceEventIds, ...input.eventIds]).slice(-WATCHER_MEMORY_LIMITS.eventRefsPerSubject);
      return;
    }
    this.memory.subjects.push({
      id: input.id,
      kind: input.kind,
      label: input.label || input.id,
      firstObservedMonth: input.month,
      lastObservedMonth: input.month,
      meaningfulObservations: input.meaningful ? 1 : 0,
      attachment: clamp(input.attachmentGain),
      interestReasons: [input.reason],
      sourceEventIds: unique(input.eventIds).slice(-WATCHER_MEMORY_LIMITS.eventRefsPerSubject),
    });
  }

  private processNewEvents(state: SimulationState): void {
    const seenAtMonth = new Set(this.memory.processedEventIdsAtMonth);
    const events = state.history.filter((event) => event.month > this.memory.lastProcessedMonth
      || (event.month === this.memory.lastProcessedMonth && !seenAtMonth.has(event.id)));
    if (events.length === 0) return;
    events.sort((a, b) => a.month - b.month || a.id.localeCompare(b.id));
    for (const event of events) this.processEvent(event, state);
    const latestMonth = events[events.length - 1]?.month ?? this.memory.lastProcessedMonth;
    this.memory.lastProcessedMonth = latestMonth;
    this.memory.processedEventIdsAtMonth = state.history.filter((event) => event.month === latestMonth).map((event) => event.id).slice(-64);
  }

  private processEvent(event: HistoricalEvent, state: SimulationState): void {
    if (event.significance >= 0.55) {
      const ids = unique([...(event.locationId ? [event.locationId] : []), ...event.actors]);
      for (const id of ids.slice(0, 5)) this.rememberSubject({
        id,
        kind: this.subjectKind(id, state),
        label: this.entityLabel(id, state),
        month: event.month,
        reason: `connected to ${event.type.replaceAll('-', ' ')}`,
        eventIds: [event.id],
        attachmentGain: event.significance * 0.045,
        meaningful: true,
      });
    }

    if (['harvest-crisis', 'pandemic', 'ecological-crisis', 'climate-crisis', 'resource-crisis', 'natural-catastrophe'].includes(event.type) && event.locationId) {
      const settlement = state.settlements.find((item) => item.id === event.locationId);
      if (settlement) this.openQuestion({
        id: `question:recovery:${settlement.id}:${event.id}`,
        kind: 'settlement-recovery',
        text: `Can ${settlement.name} recover from this crisis?`,
        month: event.month,
        entityIds: [settlement.id],
        eventIds: [event.id],
      });
    }

    if (event.type === 'institution-formed') {
      const institution = state.institutions.find((item) => event.actors.includes(item.id));
      if (institution) this.openQuestion({
        id: `question:institution:${institution.id}:${event.id}`,
        kind: 'institution-survival',
        text: `Will ${institution.name} survive its founding generation?`,
        month: event.month,
        entityIds: [institution.id, institution.settlementId],
        eventIds: [event.id],
        metadata: { institutionId: institution.id },
      });
    }

    if (event.type === 'discovery' && typeof event.context.knowledge === 'string' && event.significance >= 0.55) {
      const knowledge = event.context.knowledge;
      const origin = event.locationId ? state.settlements.find((item) => item.id === event.locationId) : undefined;
      this.openQuestion({
        id: `question:knowledge:${knowledge}:${event.id}`,
        kind: 'knowledge-diffusion',
        text: `Will ${knowledge.replaceAll('-', ' ')} spread beyond ${origin?.name ?? 'its place of origin'}?`,
        month: event.month,
        entityIds: origin ? [origin.id] : [],
        eventIds: [event.id],
        metadata: { knowledge, originId: origin?.id ?? '' },
      });
      this.rememberSubject({ id: `knowledge:${knowledge}`, kind: 'knowledge', label: knowledge.replaceAll('-', ' '), month: event.month, reason: 'new knowledge entered the record', eventIds: [event.id], attachmentGain: event.significance * 0.06, meaningful: true });
    }

    if (event.type === 'recovery' && event.locationId) this.resolveRecovery(event, state, false);
    if (event.type === 'settlement-abandoned' && event.locationId) this.resolveRecovery(event, state, true);
    if (event.type === 'technology-widespread' && typeof event.context.knowledge === 'string') this.resolveKnowledge(event, event.context.knowledge);

    this.updateTradeBeliefsFromEvent(event, state);
    this.updateResilienceBeliefs(event, state);
  }

  private openQuestion(input: { id: string; kind: WatcherQuestionKind; text: string; month: number; entityIds: string[]; eventIds: string[]; metadata?: Record<string, string | number | boolean> }): void {
    if (this.memory.questions.some((question) => question.id === input.id)) return;
    this.memory.questions.push({
      id: input.id,
      kind: input.kind,
      text: input.text,
      openedMonth: input.month,
      lastEvaluatedMonth: input.month,
      status: 'open',
      entityIds: unique(input.entityIds),
      evidenceEventIds: unique(input.eventIds),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  }

  private resolveRecovery(event: HistoricalEvent, state: SimulationState, failed: boolean): void {
    const settlement = state.settlements.find((item) => item.id === event.locationId);
    for (const question of this.memory.questions.filter((item) => item.status === 'open' && item.kind === 'settlement-recovery' && item.entityIds.includes(event.locationId ?? ''))) {
      question.status = failed ? 'contradicted' : 'resolved';
      question.resolutionMonth = event.month;
      question.lastEvaluatedMonth = event.month;
      question.evidenceEventIds = unique([...question.evidenceEventIds, event.id]);
      question.resolutionText = failed
        ? `${settlement?.name ?? 'The settlement'} did not recover; it was abandoned.`
        : `${settlement?.name ?? 'The settlement'} recovered strongly enough for the record to mark a recovery.`;
    }
  }

  private resolveKnowledge(event: HistoricalEvent, knowledge: string): void {
    for (const question of this.memory.questions.filter((item) => item.status === 'open' && item.kind === 'knowledge-diffusion' && item.metadata?.knowledge === knowledge)) {
      question.status = 'resolved';
      question.resolutionMonth = event.month;
      question.lastEvaluatedMonth = event.month;
      question.evidenceEventIds = unique([...question.evidenceEventIds, event.id]);
      question.resolutionText = `${knowledge.replaceAll('-', ' ')} spread widely enough to become part of the broader historical record.`;
    }
  }

  private evaluateQuestions(state: SimulationState): void {
    for (const question of this.memory.questions.filter((item) => item.status === 'open')) {
      question.lastEvaluatedMonth = state.month;
      if (question.kind === 'institution-survival') {
        const institutionId = String(question.metadata?.institutionId ?? '');
        const exists = state.institutions.some((item) => item.id === institutionId);
        if (!exists) {
          question.status = 'contradicted';
          question.resolutionMonth = state.month;
          question.resolutionText = 'The institution disappeared before a full founding generation passed.';
        } else if (state.month - question.openedMonth >= 30 * 12) {
          const institution = state.institutions.find((item) => item.id === institutionId);
          question.status = 'resolved';
          question.resolutionMonth = state.month;
          question.resolutionText = `${institution?.name ?? 'The institution'} endured beyond its founding generation.`;
        }
      }
      if (question.kind === 'knowledge-diffusion') {
        const knowledge = String(question.metadata?.knowledge ?? '');
        const originId = String(question.metadata?.originId ?? '');
        const holders = state.settlements.filter((settlement) => Boolean(settlement.knowledge.records[knowledge]));
        if (holders.some((settlement) => settlement.id !== originId)) {
          question.status = 'resolved';
          question.resolutionMonth = state.month;
          question.resolutionText = `${knowledge.replaceAll('-', ' ')} reached communities beyond its place of origin.`;
        } else if (state.month - question.openedMonth >= 180 * 12 && holders.length === 0) {
          question.status = 'contradicted';
          question.resolutionMonth = state.month;
          question.resolutionText = `${knowledge.replaceAll('-', ' ')} disappeared from living practice before it spread.`;
        }
      }
    }
  }

  private evaluateBeliefs(state: SimulationState): void {
    for (const relation of state.relations.filter((item) => item.allied)) {
      const route = state.tradeRoutes.find((item) => item.active && ((item.a === relation.a && item.b === relation.b) || (item.a === relation.b && item.b === relation.a)));
      if (!route || Math.max(relation.tradeDependency, route.volume / 25) < 0.18) continue;
      const id = `belief:trade-cohesion:${pairKey(relation.a, relation.b)}`;
      const a = state.settlements.find((item) => item.id === relation.a)?.name ?? relation.a;
      const b = state.settlements.find((item) => item.id === relation.b)?.name ?? relation.b;
      let belief = this.memory.beliefs.find((item) => item.id === id);
      if (!belief) {
        const supportEvents = state.history.filter((event) => ['alliance-formed', 'trade-route-established'].includes(event.type)
          && (event.actors.includes(relation.id) || event.actors.includes(relation.a) || event.actors.includes(relation.b))).map((event) => event.id).slice(-8);
        belief = {
          id,
          kind: 'trade-cohesion',
          thesis: `trade may be helping hold ${a} and ${b} together.`,
          formedMonth: state.month,
          lastEvaluatedMonth: state.month,
          confidence: 0.42,
          status: 'tentative',
          entityIds: [relation.a, relation.b],
          supportingEventIds: supportEvents,
          contradictingEventIds: [],
        };
        this.memory.beliefs.push(belief);
      } else if (['tentative', 'strengthened', 'weakened'].includes(belief.status) && state.month - belief.lastEvaluatedMonth >= 20 * 12) {
        belief.lastEvaluatedMonth = state.month;
        belief.confidence = clamp(belief.confidence + 0.1, 0, 0.82);
        belief.status = belief.confidence >= 0.62 ? 'strengthened' : 'tentative';
      }
    }
  }

  private updateTradeBeliefsFromEvent(event: HistoricalEvent, state: SimulationState): void {
    if (!['war-declared', 'alliance-ended'].includes(event.type)) return;
    let a = '';
    let b = '';
    if (event.type === 'war-declared') {
      const war = state.wars.find((item) => event.actors.includes(item.id) || item.startMonth === event.month);
      if (war) { a = war.attacker; b = war.defender; }
    } else {
      const relation = state.relations.find((item) => event.actors.includes(item.id));
      if (relation) { a = relation.a; b = relation.b; }
    }
    if (!a || !b) return;
    const belief = this.memory.beliefs.find((item) => item.id === `belief:trade-cohesion:${pairKey(a, b)}`);
    if (!belief || ['contradicted', 'revised', 'resolved'].includes(belief.status)) return;
    const tradeStillExists = state.tradeRoutes.some((route) => route.active && ((route.a === a && route.b === b) || (route.a === b && route.b === a)));
    belief.contradictingEventIds = unique([...belief.contradictingEventIds, event.id]);
    belief.confidence = clamp(belief.confidence - 0.32);
    belief.status = tradeStillExists ? 'revised' : 'contradicted';
    belief.revisionText = tradeStillExists
      ? 'I was wrong. Trade survived their political relationship rather than preserving it.'
      : 'Later conflict weakened that interpretation; commerce was not enough to preserve the relationship.';
    belief.lastEvaluatedMonth = event.month;
  }

  private updateResilienceBeliefs(event: HistoricalEvent, state: SimulationState): void {
    if (!event.locationId || !['recovery', 'settlement-abandoned'].includes(event.type)) return;
    const settlement = state.settlements.find((item) => item.id === event.locationId);
    const id = `belief:settlement-resilience:${event.locationId}`;
    let belief = this.memory.beliefs.find((item) => item.id === id);
    if (event.type === 'recovery') {
      if (!belief) {
        belief = { id, kind: 'settlement-resilience', thesis: `${settlement?.name ?? 'this settlement'} appears able to recover from severe pressure.`, formedMonth: event.month, lastEvaluatedMonth: event.month, confidence: 0.45, status: 'tentative', entityIds: [event.locationId], supportingEventIds: [event.id], contradictingEventIds: [] };
        this.memory.beliefs.push(belief);
      } else {
        belief.supportingEventIds = unique([...belief.supportingEventIds, event.id]);
        belief.confidence = clamp(belief.confidence + 0.16, 0, 0.9);
        belief.status = belief.confidence >= 0.62 ? 'strengthened' : 'tentative';
        belief.lastEvaluatedMonth = event.month;
      }
    } else if (belief && !['contradicted', 'revised'].includes(belief.status)) {
      belief.contradictingEventIds = unique([...belief.contradictingEventIds, event.id]);
      belief.confidence = clamp(belief.confidence - 0.4);
      belief.status = 'revised';
      belief.revisionText = 'I mistook previous recoveries for lasting resilience. This settlement was ultimately abandoned.';
      belief.lastEvaluatedMonth = event.month;
    }
  }

  private syncPredictions(predictions: readonly HistorianPrediction[]): void {
    for (const prediction of predictions) {
      let memory = this.memory.predictions.find((item) => item.predictionId === prediction.id);
      if (!memory) {
        memory = { predictionId: prediction.id, madeMonth: prediction.madeMonth, horizonMonth: prediction.horizonMonth, subjectIds: [...prediction.subjectIds], resolved: prediction.resolved, ...(prediction.occurred === undefined ? {} : { occurred: prediction.occurred }) };
        this.memory.predictions.push(memory);
      } else {
        memory.resolved = prediction.resolved;
        if (prediction.occurred !== undefined) memory.occurred = prediction.occurred;
      }
    }
  }

  private compact(): void {
    this.memory.subjects.sort((a, b) => (b.attachment + b.meaningfulObservations * 0.04) - (a.attachment + a.meaningfulObservations * 0.04) || b.lastObservedMonth - a.lastObservedMonth);
    this.memory.subjects = this.memory.subjects.slice(0, WATCHER_MEMORY_LIMITS.subjects);
    this.memory.questions.sort((a, b) => (a.status === 'open' ? -1 : 1) - (b.status === 'open' ? -1 : 1) || b.lastEvaluatedMonth - a.lastEvaluatedMonth);
    this.memory.questions = this.memory.questions.slice(0, WATCHER_MEMORY_LIMITS.questions);
    this.memory.beliefs.sort((a, b) => b.lastEvaluatedMonth - a.lastEvaluatedMonth || b.confidence - a.confidence);
    this.memory.beliefs = this.memory.beliefs.slice(0, WATCHER_MEMORY_LIMITS.beliefs);
    this.memory.predictions.sort((a, b) => (a.resolved ? 1 : -1) - (b.resolved ? 1 : -1) || b.madeMonth - a.madeMonth);
    this.memory.predictions = this.memory.predictions.slice(0, WATCHER_MEMORY_LIMITS.predictions);
  }

  private sanitize(snapshot: WatcherMemorySnapshot): WatcherMemorySnapshot {
    const base = emptyWatcherMemorySnapshot();
    return {
      ...base,
      ...structuredClone(snapshot),
      version: 1,
      subjects: structuredClone(snapshot.subjects ?? []).slice(0, WATCHER_MEMORY_LIMITS.subjects),
      questions: structuredClone(snapshot.questions ?? []).slice(0, WATCHER_MEMORY_LIMITS.questions),
      beliefs: structuredClone(snapshot.beliefs ?? []).slice(0, WATCHER_MEMORY_LIMITS.beliefs),
      predictions: structuredClone(snapshot.predictions ?? []).slice(0, WATCHER_MEMORY_LIMITS.predictions),
      processedEventIdsAtMonth: structuredClone(snapshot.processedEventIdsAtMonth ?? []).slice(-64),
    };
  }

  private subjectKind(id: string, state: SimulationState): WatcherSubjectKind {
    if (state.people.some((item) => item.id === id)) return 'person';
    if (state.settlements.some((item) => item.id === id)) return 'settlement';
    if (state.institutions.some((item) => item.id === id)) return 'institution';
    if (state.polities.some((item) => item.id === id)) return 'polity';
    return 'other';
  }

  private entityLabel(id: string, state: SimulationState): string {
    return state.people.find((item) => item.id === id)?.name
      ?? state.settlements.find((item) => item.id === id)?.name
      ?? state.institutions.find((item) => item.id === id)?.name
      ?? state.polities.find((item) => item.id === id)?.name
      ?? id;
  }

  private currentEntityIds(state: SimulationState): Set<string> {
    return new Set<string>([
      ...state.people.map((item) => item.id),
      ...state.settlements.map((item) => item.id),
      ...state.institutions.map((item) => item.id),
      ...state.polities.map((item) => item.id),
      ...state.relations.map((item) => item.id),
      ...state.tradeRoutes.map((item) => item.id),
      ...state.wars.map((item) => item.id),
    ]);
  }
}