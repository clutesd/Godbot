import type { HistoricalEvent, SimulationState } from '../sim/types';
import { Historian } from './Historian';
import type { HistorianStatement, ObservationCandidate } from './types';
import { isWarEvent } from './WarStory';
import { elapsedTime, historicalDate, sentence } from './Narrative';
import { isChronicleEvent } from './EventCoverage';

interface ObserverAttention {
  firstMonth: number;
  appearances: number;
  remarked: boolean;
}

interface ObserverMemory {
  observationSequence: number;
  attention: Map<string, ObserverAttention>;
  remarkedPredictionIds: Set<string>;
  pendingPredictionRemarks: Map<string, string>;
  remarkedEventIds: Set<string>;
}

const bases = new WeakMap<HistorianStatement, { text: string; sources: string[] }>();
const pendingEvents = new WeakMap<HistorianStatement, string[]>();
const pendingAttention = new WeakMap<HistorianStatement, string>();
const memories = new WeakMap<Historian, ObserverMemory>();
let installed = false;

function memoryFor(historian: Historian): ObserverMemory {
  let memory = memories.get(historian);
  if (!memory) {
    memory = { observationSequence: 0, attention: new Map(), remarkedPredictionIds: new Set(), pendingPredictionRemarks: new Map(), remarkedEventIds: new Set() };
    memories.set(historian, memory);
  }
  return memory;
}

/**
 * Installs a narrative layer over the grounded Historian.
 *
 * The base Historian remains authoritative for facts, provenance, scoring, uncertainty and
 * scene selection. This layer adds one grounded historical connection after the current
 * facts, then recomposes that connection from fresh evidence at physical camera arrival.
 */
export function installWatcherHistorian(): void {
  if (installed) return;
  installed = true;

  const acquireScene = Historian.prototype.acquireScene;
  Historian.prototype.acquireScene = function watcherAcquireScene(scene, state, narrationVisible): void {
    const memory = memoryFor(this);
    const narrated = narrationVisible ?? (scene.editorial?.narration === 'required'
      || scene.editorial?.narration === 'selective' && (Boolean(scene.event) || scene.interest >= 0.66));
    // Refreshing a queued scene replaces its statement. Compose from those current facts
    // at physical arrival, including scenes selected directly by the sequence planner.
    if (narrated) prepareObservation(this, memory, scene, state);
    const predictionId = memory.pendingPredictionRemarks.get(scene.statement.id);
    if (predictionId && narrated) memory.remarkedPredictionIds.add(predictionId);
    if (narrated) {
      for (const id of pendingEvents.get(scene.statement) ?? []) memory.remarkedEventIds.add(id);
      if (memory.remarkedEventIds.size > 2048) memory.remarkedEventIds.delete(memory.remarkedEventIds.values().next().value!);
      const subject = pendingAttention.get(scene.statement);
      const attention = subject ? memory.attention.get(subject) : undefined;
      if (attention) attention.remarked = true;
    }
    memory.pendingPredictionRemarks.delete(scene.statement.id);
    memory.observationSequence += 1;
    rememberAttention(memory, scene.subjectId, state.month);
    acquireScene.call(this, scene, state, narrationVisible);
  };

  const chooseScene = Historian.prototype.chooseScene;
  Historian.prototype.chooseScene = function watcherChooseScene(state: SimulationState, focusEventId?: string): ObservationCandidate {
    const scene = chooseScene.call(this, state, focusEventId);
    const memory = memoryFor(this);
    prepareObservation(this, memory, scene, state);
    return scene;
  };
}

function prepareObservation(historian: Historian, memory: ObserverMemory, scene: ObservationCandidate, state: SimulationState): void {
  const statement = scene.statement;
  let base = bases.get(statement);
  if (!base) {
    base = { text: statement.text, sources: [...statement.sourceEventIds] };
    bases.set(statement, base);
  }
  statement.text = base.text;
  statement.sourceEventIds = [...base.sources];
  pendingEvents.delete(statement);
  pendingAttention.delete(statement);
  memory.pendingPredictionRemarks.delete(statement.id);
  deepenObservation(historian, memory, scene, state);
  if (statement.text === base.text) statement.sourceEventIds = [...base.sources];
  if (!historian.validateStatement(statement, state)) {
    statement.text = base.text;
    statement.sourceEventIds = [...base.sources];
    memory.pendingPredictionRemarks.delete(statement.id);
    pendingEvents.delete(statement);
    pendingAttention.delete(statement);
  }
}

function deepenObservation(historian: Historian, memory: ObserverMemory, scene: ObservationCandidate, state: SimulationState): void {
  if (scene.editorial?.narration === 'silent' || /^(development|chapter|century|founding):/.test(scene.id)) return;
  // Campaign scenes already have a concise, evidence-specific watcher voice.
  if (scene.statement.claims.warId || (scene.event && isWarEvent(scene.event))) return;
  const statement = scene.statement;
  const additions: string[] = [];

  const predictionRemark = scene.event ? undefined : resolvedPredictionPerspective(historian, memory, scene);
  if (predictionRemark) additions.push(predictionRemark);
  else if (scene.event) additions.push(...eventPerspective(scene.event, state, statement, memory));
  else {
    const local = localPerspective(memory, scene, state);
    if (local) additions.push(local);
  }

  const attentionRemark = attentionPerspective(memory, scene, state.month);
  if (attentionRemark && additions.length === 0) {
    additions.push(attentionRemark);
    pendingAttention.set(statement, scene.subjectId);
  }

  if (additions.length === 0) return;
  const availableWords = Math.max(0, 78 - statement.text.trim().split(/\s+/).length);
  if (availableWords < 12 || additions[0]!.split(/\s+/).length > availableWords) {
    memory.pendingPredictionRemarks.delete(statement.id); pendingEvents.delete(statement); pendingAttention.delete(statement); return;
  }
  statement.text = `${statement.text} ${additions[0]!}`.trim();
}

function eventPerspective(event: HistoricalEvent, state: SimulationState, statement: HistorianStatement, memory: ObserverMemory): string[] {
  // Arrival Day already has an authored opening voice. Do not decorate it with generic
  // "first recorded event" language if it is explicitly revisited later.
  if (event.type === 'ARRIVAL_DAY' || event.type === 'first-fire') return [];
  const remarks: string[] = [];
  // Interpretation uses authored outcomes and explicit historical links, not a presumed
  // consequence of the category. This runs at selection/acquisition, never per frame.
  const callback = relatedEarlierEvent(event, state, memory);
  if (callback) {
    statement.sourceEventIds = unique([...statement.sourceEventIds, callback.id]);
    pendingEvents.set(statement, [callback.id]);
    remarks.push(callbackText(event, callback));
  }
  return remarks;
}

function relatedEarlierEvent(event: HistoricalEvent, state: SimulationState, memory: ObserverMemory): HistoricalEvent | undefined {
  const eventIndex = state.history.findIndex(candidate => candidate.id === event.id);
  const candidates = state.history.filter((candidate, index) => {
    if (candidate.id === event.id || candidate.month > event.month
      || candidate.month === event.month && (eventIndex < 0 || index >= eventIndex)) return false;
    if (event.causes.includes(candidate.id)) return true;
    if (memory.remarkedEventIds.has(candidate.id) || event.month - candidate.month > 120
      || candidate.significance < 0.42 || candidate.type === 'world-awakening' || candidate.type === 'ARRIVAL_DAY') return false;
    const samePlace = Boolean(event.locationId && candidate.locationId === event.locationId);
    const sameKnowledge = typeof event.context.knowledge === 'string'
      && event.context.knowledge === candidate.context.knowledge;
    // Sharing a location or actor is not a story connection. Match a specific knowledge chain
    // or a recent chapter of the same subject, and never claim it caused the new event.
    const family = narrativeFamily(event);
    return sameKnowledge || family !== 'knowledge' && samePlace && family === narrativeFamily(candidate);
  });
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => {
    const causalA = event.causes.includes(a.id) ? 1 : 0;
    const causalB = event.causes.includes(b.id) ? 1 : 0;
    if (causalA !== causalB) return causalB - causalA;
    const knowledgeA = typeof event.context.knowledge === 'string' && a.context.knowledge === event.context.knowledge ? 1 : 0;
    const knowledgeB = typeof event.context.knowledge === 'string' && b.context.knowledge === event.context.knowledge ? 1 : 0;
    if (knowledgeA !== knowledgeB) return knowledgeB - knowledgeA;
    const placeA = event.locationId && a.locationId === event.locationId ? 1 : 0;
    const placeB = event.locationId && b.locationId === event.locationId ? 1 : 0;
    if (placeA !== placeB) return placeB - placeA;
    return b.month - a.month || a.id.localeCompare(b.id);
  });
  return candidates[0];
}

function callbackText(event: HistoricalEvent, earlier: HistoricalEvent): string {
  const months = Math.max(0, event.month - earlier.month);
  const interval = elapsedTime(months);
  if (event.causes.includes(earlier.id)) {
    return months === 0 ? `Its recorded beginning: ${recordExcerpt(earlier.summary, 24)}`
      : `The roots of this moment reach back ${interval}: ${recordExcerpt(earlier.summary, 24)}`;
  }
  if (typeof event.context.knowledge === 'string' && earlier.context.knowledge === event.context.knowledge) {
    return months === 0 ? `Another part of the same breakthrough: ${recordExcerpt(earlier.summary, 24)}`
      : `An earlier chapter of this knowledge, ${interval} ago: ${recordExcerpt(earlier.summary, 24)}`;
  }
  if (event.locationId && earlier.locationId === event.locationId) {
    return `Here, ${interval} earlier: ${recordExcerpt(earlier.summary, 24)}`;
  }
  return `A shared participant appears in the record ${interval} earlier: ${recordExcerpt(earlier.summary, 24)}`;
}

function narrativeFamily(event: HistoricalEvent): string {
  if (/^(knowledge|technology)-/.test(event.type) || event.type === 'discovery') return 'knowledge';
  if (/^(war|battle|alliance|political|leadership)/.test(event.type)) return 'politics';
  if (event.type === 'harvest-crisis' || event.type === 'recovery') return 'food';
  // Construction of different kinds and discoveries of different materials have separate arcs.
  return `${event.type}:${event.context.need ?? event.context.resource ?? event.context.recipe ?? ''}`;
}

function localPerspective(memory: ObserverMemory, scene: ObservationCandidate, state: SimulationState): string | undefined {
  const person = state.people.find(p => p.id === scene.subjectId);
  const institution = state.institutions.find(i => i.id === scene.subjectId);
  const placeId = person?.homeId ?? institution?.settlementId ?? scene.subjectId;
  const recent = state.history.filter(event => event.locationId === placeId && event.month <= state.month
    && state.month - event.month <= 120 && event.significance >= 0.5 && isChronicleEvent(event)
    && event.type !== 'ARRIVAL_DAY' && event.type !== 'first-fire' && !isWarEvent(event)
    && !memory.remarkedEventIds.has(event.id)).sort((a, b) => b.month - a.month || b.significance - a.significance)[0];
  if (!recent) return undefined;
  scene.statement.sourceEventIds = unique([...scene.statement.sourceEventIds, recent.id]);
  pendingEvents.set(scene.statement, [recent.id]);
  return `${historicalDate(recent.month)} brought a new chapter here: ${sentence(recordExcerpt(recent.summary, 26))}`;
}

function rememberAttention(memory: ObserverMemory, subjectId: string, month: number): void {
  const existing = memory.attention.get(subjectId);
  if (!existing) {
    memory.attention.set(subjectId, { firstMonth: month, appearances: 1, remarked: false });
    if (memory.attention.size > 2048) memory.attention.delete(memory.attention.keys().next().value!);
    return;
  }
  existing.appearances += 1;
}

function attentionPerspective(memory: ObserverMemory, scene: ObservationCandidate, month: number): string | undefined {
  const attention = memory.attention.get(scene.subjectId);
  if (!attention || attention.remarked || attention.appearances < 3 || memory.observationSequence % 5 !== 0) return undefined;
  const years = Math.floor((month - attention.firstMonth) / 12);
  if (years < 8) return undefined;
  return `I first observed ${scene.title} ${years.toLocaleString()} years ago.`;
}

function resolvedPredictionPerspective(historian: Historian, memory: ObserverMemory, scene: ObservationCandidate): string | undefined {
  if (scene.kind !== 'historian-context' || memory.observationSequence % 4 !== 0) return undefined;
  const resolved = [...historian.predictions].reverse().find((prediction) => prediction.resolved && !memory.remarkedPredictionIds.has(prediction.id));
  if (!resolved) return undefined;
  memory.pendingPredictionRemarks.set(scene.statement.id, resolved.id);
  if (memory.pendingPredictionRemarks.size > 64) memory.pendingPredictionRemarks.delete(memory.pendingPredictionRemarks.keys().next().value!);
  const horizonYears = Math.max(1, Math.round((resolved.horizonMonth - resolved.madeMonth) / 12));
  return resolved.occurred
    ? `An earlier warning proved justified within its ${horizonYears}-year horizon. The recorded outcome supports that warning.`
    : `An earlier warning passed its ${horizonYears}-year horizon without the predicted war. That warning did not establish what would happen.`;
}

/** Keep evidence readable without turning a clipped record into a new factual claim. */
function recordExcerpt(text: string, maximumWords: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maximumWords ? text : `${words.slice(0, maximumWords).join(' ')}…`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
