import type { HistoricalEvent, HistoricalEventType, SimulationState } from '../sim/types';
import { Historian } from './Historian';
import type { HistorianStatement, ObservationCandidate } from './types';
import { isWarEvent } from './WarStory';

interface ObserverAttention {
  firstMonth: number;
  appearances: number;
}

interface ObserverMemory {
  observationSequence: number;
  attention: Map<string, ObserverAttention>;
  remarkedPredictionIds: Set<string>;
  pendingPredictionRemarks: Map<string, string>;
}

const bases = new WeakMap<HistorianStatement, { text: string; sources: string[] }>();
const memories = new WeakMap<Historian, ObserverMemory>();
let installed = false;

function memoryFor(historian: Historian): ObserverMemory {
  let memory = memories.get(historian);
  if (!memory) {
    memory = { observationSequence: 0, attention: new Map(), remarkedPredictionIds: new Set(), pendingPredictionRemarks: new Map() };
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
    // Refreshing a queued scene replaces its statement. Compose from those current facts
    // at physical arrival, including scenes selected directly by the sequence planner.
    if (narrationVisible ?? (scene.editorial?.narration !== 'silent')) prepareObservation(this, memory, scene, state);
    const predictionId = memory.pendingPredictionRemarks.get(scene.statement.id);
    if (predictionId && (narrationVisible ?? (scene.editorial?.narration !== 'silent'))) memory.remarkedPredictionIds.add(predictionId);
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
  memory.pendingPredictionRemarks.delete(statement.id);
  deepenObservation(historian, memory, scene, state);
  if (!historian.validateStatement(statement, state)) {
    statement.text = base.text;
    statement.sourceEventIds = [...base.sources];
    memory.pendingPredictionRemarks.delete(statement.id);
  }
}

function deepenObservation(historian: Historian, memory: ObserverMemory, scene: ObservationCandidate, state: SimulationState): void {
  if (scene.editorial?.narration === 'silent' || scene.id.startsWith('development:')) return;
  // Campaign scenes already have a concise, evidence-specific watcher voice.
  if (scene.statement.claims.warId || (scene.event && isWarEvent(scene.event))) return;
  const statement = scene.statement;
  const additions: string[] = [];

  const predictionRemark = scene.event ? undefined : resolvedPredictionPerspective(historian, memory, scene);
  if (predictionRemark) additions.push(predictionRemark);
  else if (scene.event) additions.push(...eventPerspective(scene.event, state, statement));

  const attentionRemark = attentionPerspective(memory, scene, state.month);
  if (attentionRemark) additions.push(attentionRemark);

  if (additions.length === 0) return;
  const availableWords = Math.max(0, 78 - statement.text.trim().split(/\s+/).length);
  if (availableWords < 12) { memory.pendingPredictionRemarks.delete(statement.id); return; }
  statement.text = `${statement.text} ${recordExcerpt(additions[0]!, availableWords)}`.trim();
}

function eventPerspective(event: HistoricalEvent, state: SimulationState, statement: HistorianStatement): string[] {
  // Arrival Day already has an authored opening voice. Do not decorate it with generic
  // "first recorded event" language if it is explicitly revisited later.
  if (event.type === 'ARRIVAL_DAY' || event.type === 'first-fire') return [];
  const remarks: string[] = [];
  // Interpretation uses authored outcomes and explicit historical links, not a presumed
  // consequence of the category. This runs at selection/acquisition, never per frame.
  const callback = relatedEarlierEvent(event, state);
  if (callback) {
    statement.sourceEventIds = unique([...statement.sourceEventIds, callback.id]);
    const outcome = event.outcome.trim();
    const result = outcome && !statement.text.includes(outcome) ? `The recorded outcome: ${recordExcerpt(outcome, 24)} ` : '';
    remarks.push(`${result}${callbackText(event, callback)}`);
  } else if (event.significance >= 0.58) {
    const outcome = event.outcome.trim();
    if (outcome && !statement.text.includes(outcome)) {
      remarks.push(`The recorded outcome: ${recordExcerpt(outcome, 24)}`);
    } else {
      const earlier = state.history.filter(candidate => candidate.type === event.type
        && candidate.month < event.month && candidate.month <= statement.month)
        .sort((a, b) => b.month - a.month || a.id.localeCompare(b.id))[0];
      if (earlier) {
        statement.sourceEventIds = unique([...statement.sourceEventIds, earlier.id]);
        remarks.push(`The previous ${eventNoun(event.type)} was recorded in month ${earlier.month}: ${recordExcerpt(earlier.summary, 24)}`);
      }
    }
  }
  return remarks;
}

function relatedEarlierEvent(event: HistoricalEvent, state: SimulationState): HistoricalEvent | undefined {
  const eventIndex = state.history.findIndex(candidate => candidate.id === event.id);
  const candidates = state.history.filter((candidate, index) => {
    if (candidate.id === event.id || candidate.month > event.month
      || candidate.month === event.month && (eventIndex < 0 || index >= eventIndex)) return false;
    if (event.causes.includes(candidate.id)) return true;
    if (candidate.significance < 0.42 || candidate.type === 'world-awakening' || candidate.type === 'ARRIVAL_DAY') return false;
    const samePlace = Boolean(event.locationId && candidate.locationId === event.locationId);
    const sharedActors = event.actors.some((actor) => actor !== 'world' && candidate.actors.includes(actor));
    const causal = event.causes.includes(candidate.id);
    const sameKnowledge = typeof event.context.knowledge === 'string'
      && event.context.knowledge === candidate.context.knowledge;
    return samePlace || sharedActors || causal || sameKnowledge;
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
  const interval = months < 12 ? `${months} ${months === 1 ? 'month' : 'months'}`
    : `${Math.floor(months / 12).toLocaleString()} ${months < 24 ? 'year' : 'years'}`;
  if (event.causes.includes(earlier.id)) {
    return months === 0 ? `The record identifies this predecessor: ${recordExcerpt(earlier.summary, 24)}`
      : `The roots of this moment reach back ${interval}, to this recorded ${eventNoun(earlier.type)}: ${recordExcerpt(earlier.summary, 24)}`;
  }
  if (typeof event.context.knowledge === 'string' && earlier.context.knowledge === event.context.knowledge) {
    return `The same knowledge appears ${interval} earlier in the record: ${recordExcerpt(earlier.summary, 24)}`;
  }
  if (event.locationId && earlier.locationId === event.locationId) {
    return `The earlier record at this place, ${interval} ago, reads: ${recordExcerpt(earlier.summary, 24)}`;
  }
  return `A shared participant appears in the record ${interval} earlier: ${recordExcerpt(earlier.summary, 24)}`;
}

function rememberAttention(memory: ObserverMemory, subjectId: string, month: number): void {
  const existing = memory.attention.get(subjectId);
  if (!existing) {
    memory.attention.set(subjectId, { firstMonth: month, appearances: 1 });
    if (memory.attention.size > 2048) memory.attention.delete(memory.attention.keys().next().value!);
    return;
  }
  existing.appearances += 1;
}

function attentionPerspective(memory: ObserverMemory, scene: ObservationCandidate, month: number): string | undefined {
  const attention = memory.attention.get(scene.subjectId);
  if (!attention || attention.appearances < 3 || memory.observationSequence % 5 !== 0) return undefined;
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

function eventNoun(type: HistoricalEventType, withArticle = false): string {
  const readable = type.replaceAll('-', ' ');
  if (!withArticle) return readable;
  return `${/^[aeiou]/i.test(readable) ? 'an' : 'a'} ${readable}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
