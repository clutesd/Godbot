import type { HistoricalEvent, HistoricalEventType, SimulationState } from '../sim/types';
import { describeMission, missionForPerson } from '../sim/people/PersonMissionSystem';
import { DeepHistoricalMemory, attachDeepHistory, deepHistoryFromWatcherSnapshot } from './DeepHistoricalMemory';
import { Historian } from './Historian';
import { NarrativeThreadEngine } from './NarrativeThreadEngine';
import { WatcherMind, type WatcherMemorySnapshot } from './WatcherMind';
import { registerWatcherMemory, watcherMemoryForState } from './WatcherMemoryRegistry';
import type { HistorianStatement, ObservationCandidate } from './types';

interface WatcherRuntime {
  mind: WatcherMind;
  threads: NarrativeThreadEngine;
  deepHistory: DeepHistoricalMemory;
  hydratedState?: SimulationState;
}

const runtimes = new WeakMap<Historian, WatcherRuntime>();
let installed = false;

function runtimeFor(historian: Historian): WatcherRuntime {
  let runtime = runtimes.get(historian);
  if (!runtime) {
    runtime = { mind: new WatcherMind(), threads: new NarrativeThreadEngine(), deepHistory: new DeepHistoricalMemory() };
    runtimes.set(historian, runtime);
  }
  return runtime;
}

function runtimeSnapshot(runtime: WatcherRuntime): WatcherMemorySnapshot {
  return attachDeepHistory(runtime.mind.snapshot(), runtime.deepHistory.snapshot());
}

export function restoreWatcherMemory(historian: Historian, snapshot?: WatcherMemorySnapshot): void {
  const runtime = runtimeFor(historian);
  runtime.mind.restore(snapshot);
  runtime.deepHistory = deepHistoryFromWatcherSnapshot(snapshot);
}

export function snapshotWatcherMemory(historian: Historian): WatcherMemorySnapshot {
  return runtimeSnapshot(runtimeFor(historian));
}

export function installWatcherHistorian(): void {
  if (installed) return;
  installed = true;

  const chooseScene = Historian.prototype.chooseScene;
  Historian.prototype.chooseScene = function watcherChooseScene(state: SimulationState, focusEventId?: string): ObservationCandidate {
    const scene = chooseScene.call(this, state, focusEventId);
    const runtime = runtimeFor(this);
    if (runtime.hydratedState !== state) {
      const persisted = watcherMemoryForState(state);
      if (persisted) {
        runtime.mind.restore(persisted);
        runtime.deepHistory = deepHistoryFromWatcherSnapshot(persisted);
      } else {
        runtime.deepHistory = new DeepHistoricalMemory();
      }
      runtime.hydratedState = state;
    }

    runtime.deepHistory.observe(state);
    runtime.mind.observe(scene, state, this.predictions);
    registerWatcherMemory(state, runtimeSnapshot(runtime));

    const originalText = scene.statement.text;
    const originalSources = [...scene.statement.sourceEventIds];
    const originalEntities = [...scene.statement.sourceEntityIds];
    const originalMemorySources = [...(scene.statement.sourceMemoryIds ?? [])];
    const originalEpistemicStatus = scene.statement.epistemicStatus;
    const originalInterest = scene.interest;
    deepenObservation(runtime, scene, state);

    if (!this.validateStatement(scene.statement, state)) {
      scene.statement.text = originalText;
      scene.statement.sourceEventIds = originalSources;
      scene.statement.sourceEntityIds = originalEntities;
      scene.statement.sourceMemoryIds = originalMemorySources;
      scene.statement.epistemicStatus = originalEpistemicStatus;
      scene.interest = originalInterest;
    }
    registerWatcherMemory(state, runtimeSnapshot(runtime));
    return scene;
  };
}

function deepenObservation(runtime: WatcherRuntime, scene: ObservationCandidate, state: SimulationState): void {
  const statement = scene.statement;
  const additions: string[] = [];

  const person = state.people.find((candidate) => candidate.alive && candidate.id === scene.subjectId);
  const mission = person ? missionForPerson(person) : undefined;
  if (person && mission && !['completed', 'aborted'].includes(mission.stage)) {
    const missionText = describeMission(person, state);
    if (missionText) {
      additions.push(missionText);
      statement.sourceEntityIds = unique([...statement.sourceEntityIds, person.id, mission.originId, mission.targetId]);
      const missionInterest = mission.kind === 'military-service' ? 0.84
        : mission.kind === 'diplomatic-envoy' ? 0.76
          : mission.kind === 'knowledge-exchange' ? 0.72 : 0.68;
      scene.interest = Math.min(1, Math.max(scene.interest, missionInterest));
    }
  }

  const threadContext = runtime.threads.contextFor(scene, state);
  if (threadContext) {
    statement.sourceEventIds = unique([...statement.sourceEventIds, ...threadContext.sourceEventIds]);
    additions.push(threadContext.text);
    scene.interest = Math.min(1, Math.max(scene.interest, 0.34 + threadContext.thread.interestingness * 0.52));
    runtime.mind.observeThread(
      threadContext.thread.id,
      threadContext.thread.title,
      threadContext.thread.interestingness,
      threadContext.sourceEventIds,
      threadContext.thread.entityIds,
      state.month,
    );
    runtime.deepHistory.rememberThread(threadContext.thread);
  }

  if (scene.event) {
    additions.push(...eventPerspective(runtime.mind.sequence, scene.event, state, statement));
  } else if (statement.sourceArchiveIds.length > 0) {
    additions.push('I remember other worlds as well. Patterns repeat, but never perfectly.');
  } else if (statement.epistemicStatus === 'probabilistic-inference') {
    additions.push('I have watched certainty fail too often to call this destiny.');
  }

  if (scene.event && runtime.mind.sequence % 13 === 0 && additions.length < 2) {
    const causal = causalPerspective(runtime.deepHistory, scene.event);
    if (causal) {
      statement.sourceMemoryIds = unique([...(statement.sourceMemoryIds ?? []), ...causal.sourceMemoryIds]);
      additions.push(causal.text);
    }
  }

  const memoryRemark = runtime.mind.remark(scene, state);
  if (memoryRemark) {
    statement.sourceEventIds = unique([...statement.sourceEventIds, ...memoryRemark.sourceEventIds]);
    statement.sourceEntityIds = unique([...statement.sourceEntityIds, ...memoryRemark.sourceEntityIds]);
    additions.push(memoryRemark.text);
  }

  if (runtime.mind.sequence % 11 === 0 && additions.length < 2) {
    const deepRemark = runtime.deepHistory.callbackFor(scene, state);
    if (deepRemark && deepRemark.sourceMemoryIds.every((id) => runtime.deepHistory.hasMemoryId(id))) {
      statement.sourceMemoryIds = unique([...(statement.sourceMemoryIds ?? []), ...deepRemark.sourceMemoryIds]);
      if (deepRemark.provenance === 'historical-interpretation' && statement.sourceEntityIds.length > 0) {
        statement.epistemicStatus = 'probabilistic-inference';
      }
      if (deepRemark.provenance !== 'historical-interpretation' || statement.epistemicStatus === 'probabilistic-inference') {
        additions.push(deepRemark.text);
      }
    }
  }

  if (additions.length === 0) return;
  statement.text = `${additions.slice(0, 2).join(' ')} ${statement.text}`.trim();
}

function causalPerspective(deepHistory: DeepHistoricalMemory, event: HistoricalEvent): { text: string; sourceMemoryIds: string[] } | undefined {
  const targetMemory = deepHistory.eventMemory(event.id);
  if (!targetMemory) return undefined;
  const directSources = event.causes
    .map((causeId) => ({ assessment: deepHistory.causalAssessment(causeId, event.id), memory: deepHistory.eventMemory(causeId) }))
    .filter((item) => item.assessment.confidence === 'recorded-direct-cause' && item.memory !== undefined);
  if (directSources.length === 0) return undefined;

  const sourceMemories = directSources.map((item) => item.memory!).filter((memory, index, all) => all.findIndex((candidate) => candidate.eventId === memory.eventId) === index);
  const types = unique(sourceMemories.map((memory) => memory.type)).slice(0, 3);
  const target = eventNoun(event.type);
  const text = types.length === 1
    ? `The record directly links an earlier ${eventNoun(types[0]!)} to this ${target}.`
    : `The record directly links ${joinReadable(types.map((type) => eventNoun(type)))} as causes of this ${target}.`;
  return {
    text,
    sourceMemoryIds: unique([...sourceMemories.map((memory) => memory.id), targetMemory.id]),
  };
}

function joinReadable(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function eventPerspective(sequence: number, event: HistoricalEvent, state: SimulationState, statement: HistorianStatement): string[] {
  const remarks: string[] = [];
  const priorOfType = state.history.filter((candidate) => candidate.type === event.type && candidate.month < event.month);
  const firstOfKind = priorOfType.length === 0;
  const thresholdRemark = thresholdPerspective(sequence, event, state);
  if (thresholdRemark) remarks.push(thresholdRemark);

  if (firstOfKind && event.significance >= 0.58) {
    remarks.push(`I have no earlier record of ${eventNoun(event.type, true)} in this world.`);
  } else if (priorOfType.length >= 4 && event.significance >= 0.68 && sequence % 3 === 0) {
    remarks.push(`This is the ${ordinal(priorOfType.length + 1)} recorded ${eventNoun(event.type)}. Repetition does not make its consequences smaller.`);
  }

  const callback = relatedEarlierEvent(event, state);
  if (callback) {
    statement.sourceEventIds = unique([...statement.sourceEventIds, callback.id]);
    remarks.push(callbackText(event, callback));
  }
  return remarks;
}

function thresholdPerspective(sequence: number, event: HistoricalEvent, state: SimulationState): string | undefined {
  switch (event.type) {
    case 'atomic-threshold': return 'For generations, power was limited by ordinary combustion. That boundary has now been crossed.';
    case 'first-orbit': return 'For the first time, this civilization has placed part of itself beyond the ground that made it.';
    case 'offworld-settlement': return 'The sky is no longer merely something these people look toward; it now contains a place they inhabit.';
    case 'interplanetary-transition': return 'What began as one inhabited world has become a civilization measured across worlds.';
    case 'machine-intelligence-transition': return 'A new kind of participant has entered history, and the consequences are not yet knowable.';
    case 'nuclear-weapons-developed': return 'Knowledge has become the ability to erase in moments what generations required to build.';
    case 'nuclear-use':
    case 'nuclear-exchange':
      return state.history.some((candidate) => candidate.type === 'war-declared' && candidate.month < event.month)
        ? 'I have recorded war before. The scale available here changes what war can mean.'
        : 'The destructive scale of this moment has no ordinary precedent in the record.';
    case 'civilization-collapse': return 'I watched generations build the systems now coming apart.';
    case 'civilization-recovery': return 'Collapse did not end this story. Something survived long enough to begin again.';
    case 'post-biological-transition': return 'The civilization remains continuous with its past, even as the beings carrying that continuity change.';
    case 'first-contact': return 'Two histories that had developed apart now become part of one another.';
    case 'settlement-founded': return sequence % 3 === 0 ? 'Another name enters the map. I will remember whether it endures.' : undefined;
    case 'settlement-abandoned': return 'A place can remain on the land after it has disappeared from ordinary life.';
    case 'knowledge-rediscovered': return 'What was lost has returned. The second discovery carries the memory of the first absence.';
    case 'archive-destroyed': return 'A civilization can lose part of itself without losing a single living body: it can lose what it remembers.';
    case 'planetary-stability': return 'Survival has lasted long enough to become a pattern rather than a moment.';
    case 'observation-lost': return 'For once, even the record cannot tell me what followed.';
    default: return undefined;
  }
}

function relatedEarlierEvent(event: HistoricalEvent, state: SimulationState): HistoricalEvent | undefined {
  const candidates = state.history.filter((candidate) => {
    if (candidate.id === event.id || candidate.month >= event.month - 36 || candidate.significance < 0.42) return false;
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
  const years = Math.max(1, Math.floor((event.month - earlier.month) / 12));
  if (event.causes.includes(earlier.id)) return `The roots of this moment reach back ${years.toLocaleString()} years, to ${eventNoun(earlier.type, true)}.`;
  if (event.locationId && earlier.locationId === event.locationId) return `I remember this place ${years.toLocaleString()} years ago, when the record marked ${eventNoun(earlier.type, true)} here.`;
  return `These lives or institutions touched the record together ${years.toLocaleString()} years ago, during ${eventNoun(earlier.type, true)}.`;
}

function eventNoun(type: string, withArticle = false): string {
  const readableType = type.replaceAll('-', ' ');
  if (!withArticle) return readableType;
  return `${/^[aeiou]/i.test(readableType) ? 'an' : 'a'} ${readableType}`;
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