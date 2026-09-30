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
 * scene selection. This layer only deepens the chosen observation with a restrained cosmic
 * observer voice, historical callbacks, remembered subjects and calibrated surprise.
 */
export function installWatcherHistorian(): void {
  if (installed) return;
  installed = true;

  const acquireScene = Historian.prototype.acquireScene;
  Historian.prototype.acquireScene = function watcherAcquireScene(scene, state, narrationVisible): void {
    const memory = memoryFor(this);
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


    const originalText = scene.statement.text;
    const originalSources = [...scene.statement.sourceEventIds];
    deepenObservation(this, memory, scene, state);

    // The observer is never allowed to trade factual grounding for dramatic language.
    if (!this.validateStatement(scene.statement, state)) {
      scene.statement.text = originalText;
      scene.statement.sourceEventIds = originalSources;
    }
    return scene;
  };
}

function deepenObservation(historian: Historian, memory: ObserverMemory, scene: ObservationCandidate, state: SimulationState): void {
  if (scene.editorial?.narration === 'silent' || scene.id.startsWith('development:')) return;
  // Campaign scenes already have a concise, evidence-specific watcher voice.
  if (scene.statement.claims.warId || (scene.event && isWarEvent(scene.event))) return;
  const statement = scene.statement;
  const additions: string[] = [];

  if (scene.event) {
    additions.push(...eventPerspective(memory, scene.event, state, statement));
  }

  const attentionRemark = attentionPerspective(memory, scene, state.month);
  if (attentionRemark) additions.push(attentionRemark);

  const predictionRemark = resolvedPredictionPerspective(historian, memory, scene);
  if (predictionRemark) additions.push(predictionRemark);

  if (additions.length === 0) return;
  statement.text = `${additions.slice(0, 2).join(' ')} ${statement.text}`.trim();
}

function eventPerspective(memory: ObserverMemory, event: HistoricalEvent, state: SimulationState, statement: HistorianStatement): string[] {
  // Arrival Day already has an authored opening voice. Do not decorate it with generic
  // "first recorded event" language if it is explicitly revisited later.
  if (event.type === 'ARRIVAL_DAY') return [];
  const remarks: string[] = [];
  const priorOfType = state.history.filter((candidate) => candidate.type === event.type && (candidate.month < event.month || candidate.month === event.month && candidate.id < event.id));
  const firstOfKind = priorOfType.length === 0;
  const thresholdRemark = thresholdPerspective(memory, event, state);
  if (thresholdRemark) remarks.push(thresholdRemark);

  if (firstOfKind && event.significance >= 0.58) {
    remarks.push(`I have no earlier record of ${eventNoun(event.type, true)} in this world.`);
  } else if (priorOfType.length >= 4 && event.significance >= 0.68 && memory.observationSequence % 3 === 0) {
    remarks.push(`This is the ${ordinal(priorOfType.length + 1)} recorded ${eventNoun(event.type)}. Repetition does not make its consequences smaller.`);
  }

  const callback = relatedEarlierEvent(event, state);
  if (callback) {
    statement.sourceEventIds = unique([...statement.sourceEventIds, callback.id]);
    remarks.push(callbackText(event, callback));
  }
  return remarks;
}

function thresholdPerspective(memory: ObserverMemory, event: HistoricalEvent, state: SimulationState): string | undefined {
  switch (event.type) {
    case 'atomic-threshold':
      return 'For generations, power was limited by ordinary combustion. That boundary has now been crossed.';
    case 'first-orbit':
      return 'For the first time, this civilization has placed part of itself beyond the ground that made it.';
    case 'offworld-settlement':
      return 'The sky is no longer merely something these people look toward; it now contains a place they inhabit.';
    case 'interplanetary-transition':
      return 'What began as one inhabited world has become a civilization measured across worlds.';
    case 'machine-intelligence-transition':
      return 'A new kind of participant has entered history, and the consequences are not yet knowable.';
    case 'nuclear-weapons-developed':
      return 'Knowledge has become the ability to erase in moments what generations required to build.';
    case 'nuclear-use':
    case 'nuclear-exchange':
      return state.history.some((candidate) => candidate.type === 'war-declared' && candidate.month < event.month)
        ? 'I have recorded war before. The scale available here changes what war can mean.'
        : 'The destructive scale of this moment has no ordinary precedent in the record.';
    case 'civilization-collapse':
      return 'The record now marks a collapse of the systems this civilization built.';
    case 'civilization-recovery':
      return 'Collapse did not end this story. Something survived long enough to begin again.';
    case 'post-biological-transition':
      return 'The civilization remains continuous with its past, even as the beings carrying that continuity change.';
    case 'first-contact':
      return 'Two histories that had developed apart now become part of one another.';
    case 'settlement-founded':
      return memory.observationSequence % 3 === 0 ? 'Another name enters the map. I will remember whether it endures.' : undefined;
    case 'settlement-abandoned':
      return 'A place can remain on the land after it has disappeared from ordinary life.';
    case 'knowledge-rediscovered':
      return 'What was lost has returned. The second discovery carries the memory of the first absence.';
    case 'archive-destroyed':
      return 'A civilization can lose part of itself without losing a single living body: it can lose what it remembers.';
    case 'planetary-stability':
      return 'Survival has lasted long enough to become a pattern rather than a moment.';
    case 'observation-lost':
      return 'For once, even the record cannot tell me what followed.';
    default:
      return undefined;
  }
}

function relatedEarlierEvent(event: HistoricalEvent, state: SimulationState): HistoricalEvent | undefined {
  const candidates = state.history.filter((candidate) => {
    if (candidate.id === event.id || candidate.month > event.month) return false;
    if (event.causes.includes(candidate.id)) return true;
    if (candidate.month >= event.month - 36 || candidate.significance < 0.42) return false;
    const samePlace = Boolean(event.locationId && candidate.locationId === event.locationId);
    const sharedActors = event.actors.some((actor) => candidate.actors.includes(actor));
    const causal = event.causes.includes(candidate.id);
    return samePlace || sharedActors || causal;
  });
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => {
    const causalA = event.causes.includes(a.id) ? 1 : 0;
    const causalB = event.causes.includes(b.id) ? 1 : 0;
    if (causalA !== causalB) return causalB - causalA;
    const placeA = event.locationId && a.locationId === event.locationId ? 1 : 0;
    const placeB = event.locationId && b.locationId === event.locationId ? 1 : 0;
    if (placeA !== placeB) return placeB - placeA;
    return b.month - a.month;
  });
  return candidates[0];
}

function callbackText(event: HistoricalEvent, earlier: HistoricalEvent): string {
  const months = Math.max(0, event.month - earlier.month);
  const interval = months < 12 ? `${months} ${months === 1 ? 'month' : 'months'}`
    : `${Math.floor(months / 12).toLocaleString()} ${months < 24 ? 'year' : 'years'}`;
  if (event.causes.includes(earlier.id)) {
    return `The roots of this moment reach back ${interval}, to ${eventNoun(earlier.type, true)}.`;
  }
  if (event.locationId && earlier.locationId === event.locationId) {
    return `I remember this place ${interval} ago, when the record marked ${eventNoun(earlier.type, true)} here.`;
  }
  return `These lives or institutions touched the record together ${interval} ago, during ${eventNoun(earlier.type, true)}.`;
}

function rememberAttention(memory: ObserverMemory, subjectId: string, month: number): void {
  const existing = memory.attention.get(subjectId);
  if (!existing) {
    memory.attention.set(subjectId, { firstMonth: month, appearances: 1 });
    return;
  }
  existing.appearances += 1;
}

function attentionPerspective(memory: ObserverMemory, scene: ObservationCandidate, month: number): string | undefined {
  const attention = memory.attention.get(scene.subjectId);
  if (!attention || attention.appearances < 3 || memory.observationSequence % 5 !== 0) return undefined;
  const years = Math.floor((month - attention.firstMonth) / 12);
  if (years < 8) return undefined;
  return `I have returned to ${scene.title} across ${years.toLocaleString()} years. Some threads keep drawing the record back.`;
}

function resolvedPredictionPerspective(historian: Historian, memory: ObserverMemory, scene: ObservationCandidate): string | undefined {
  if (scene.kind !== 'historian-context' || memory.observationSequence % 4 !== 0) return undefined;
  const resolved = [...historian.predictions].reverse().find((prediction) => prediction.resolved && !memory.remarkedPredictionIds.has(prediction.id));
  if (!resolved) return undefined;
  memory.pendingPredictionRemarks.set(scene.statement.id, resolved.id);
  if (memory.pendingPredictionRemarks.size > 64) memory.pendingPredictionRemarks.delete(memory.pendingPredictionRemarks.keys().next().value!);
  const horizonYears = Math.max(1, Math.round((resolved.horizonMonth - resolved.madeMonth) / 12));
  return resolved.occurred
    ? `An earlier warning proved justified within its ${horizonYears}-year horizon. Prediction is not prophecy; this one happened to be right.`
    : `An earlier warning passed its ${horizonYears}-year horizon without the predicted war. The future resisted the pattern I thought I saw.`;
}

function eventNoun(type: HistoricalEventType, withArticle = false): string {
  const readable = type.replaceAll('-', ' ');
  if (!withArticle) return readable;
  return `${/^[aeiou]/i.test(readable) ? 'an' : 'a'} ${readable}`;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const suffix = value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
