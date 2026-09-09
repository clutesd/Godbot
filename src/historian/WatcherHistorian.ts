import type { HistoricalEvent, SimulationState } from '../sim/types';
import { describeLifeProject, lifeProjectForPerson } from '../sim/people/LifeProjectSystem';
import { describeMission, missionForPerson } from '../sim/people/PersonMissionSystem';
import { DeepHistoricalMemory, attachDeepHistory, deepHistoryFromWatcherSnapshot } from './DeepHistoricalMemory';
import { HumanHistoryMemory, attachHumanHistory, humanHistoryFromWatcherSnapshot } from './HumanHistoryMemory';
import { Historian } from './Historian';
import { NarrativeEpisodeDirector, type NarrativeBeat } from './NarrativeEpisodeDirector';
import { NarrativeThreadEngine } from './NarrativeThreadEngine';
import { WatcherMind, type WatcherMemorySnapshot } from './WatcherMind';
import { registerWatcherMemory, watcherMemoryForState } from './WatcherMemoryRegistry';
import type { HistorianStatement, ObservationCandidate } from './types';

interface WatcherRuntime {
  mind: WatcherMind;
  threads: NarrativeThreadEngine;
  deepHistory: DeepHistoricalMemory;
  humanHistory: HumanHistoryMemory;
  episodes: NarrativeEpisodeDirector;
  hydratedState?: SimulationState;
}

const runtimes = new WeakMap<Historian, WatcherRuntime>();
let installed = false;

function runtimeFor(historian: Historian): WatcherRuntime {
  let runtime = runtimes.get(historian);
  if (!runtime) {
    runtime = {
      mind: new WatcherMind(),
      threads: new NarrativeThreadEngine(),
      deepHistory: new DeepHistoricalMemory(),
      humanHistory: new HumanHistoryMemory(),
      episodes: new NarrativeEpisodeDirector(),
    };
    runtimes.set(historian, runtime);
  }
  return runtime;
}

function runtimeSnapshot(runtime: WatcherRuntime): WatcherMemorySnapshot {
  const snapshot = runtime.mind.snapshot();
  attachDeepHistory(snapshot, runtime.deepHistory.snapshot());
  attachHumanHistory(snapshot, runtime.humanHistory.snapshot());
  return snapshot;
}

export function restoreWatcherMemory(historian: Historian, snapshot?: WatcherMemorySnapshot): void {
  const runtime = runtimeFor(historian);
  runtime.mind.restore(snapshot);
  runtime.deepHistory = deepHistoryFromWatcherSnapshot(snapshot);
  runtime.humanHistory = humanHistoryFromWatcherSnapshot(snapshot);
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
        runtime.humanHistory = humanHistoryFromWatcherSnapshot(persisted);
      } else {
        runtime.deepHistory = new DeepHistoricalMemory();
        runtime.humanHistory = new HumanHistoryMemory();
      }
      runtime.episodes = new NarrativeEpisodeDirector();
      runtime.hydratedState = state;
    }

    runtime.deepHistory.observe(state);
    runtime.humanHistory.observe(state, runtime.deepHistory);
    runtime.mind.observe(scene, state, this.predictions);
    runtime.mind.restore(runtime.humanHistory.resolveWatcherQuestions(runtime.mind.snapshot(), state, runtime.deepHistory));
    registerWatcherMemory(state, runtimeSnapshot(runtime));

    const originalText = scene.statement.text;
    const originalSources = [...scene.statement.sourceEventIds];
    const originalEntities = [...scene.statement.sourceEntityIds];
    const originalMemorySources = [...(scene.statement.sourceMemoryIds ?? [])];
    const originalEpistemicStatus = scene.statement.epistemicStatus;
    const originalInterest = scene.interest;
    deepenObservation(runtime, scene, state);

    const memorySourcesValid = (scene.statement.sourceMemoryIds ?? []).every((id) =>
      runtime.deepHistory.hasMemoryId(id) || runtime.humanHistory.hasMemoryId(id));
    if (!memorySourcesValid || !this.validateStatement(scene.statement, state)) {
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
  const beats: NarrativeBeat[] = [];
  const activeEventIds = new Set(state.history.map((event) => event.id));
  const knownEntityIds = currentEntityIds(state);
  const person = state.people.find((candidate) => candidate.alive && candidate.id === scene.subjectId);

  const mission = person ? missionForPerson(person) : undefined;
  if (person && mission && !['completed', 'aborted'].includes(mission.stage)) {
    const missionText = describeMission(person, state);
    if (missionText) {
      beats.push({
        key: `mission:${mission.id}:${mission.stage}`,
        category: 'mission',
        text: missionText,
        priority: mission.kind === 'military-service' ? 0.84 : mission.kind === 'diplomatic-envoy' ? 0.79 : 0.74,
        sourceEntityIds: [person.id, mission.originId, mission.targetId],
      });
      const missionInterest = mission.kind === 'military-service' ? 0.84
        : mission.kind === 'diplomatic-envoy' ? 0.76
          : mission.kind === 'knowledge-exchange' ? 0.72 : 0.68;
      scene.interest = Math.min(1, Math.max(scene.interest, missionInterest));
    }
  }

  if (person) {
    const project = lifeProjectForPerson(person);
    const projectText = project ? describeLifeProject(person, state) : undefined;
    if (project && projectText) {
      const longevity = Math.min(0.1, Math.max(0, state.month - project.startedMonth) / (40 * 12) * 0.1);
      const projectInterest = project.status === 'completed' ? 0.88
        : project.status === 'stalled' ? 0.7
          : 0.6 + project.effort * 0.16 + longevity;
      scene.interest = Math.max(scene.interest, projectInterest);
      if (project.status !== 'active' || project.effort >= 0.42 || runtime.mind.sequence % 17 === 0) {
        beats.push({
          key: `life-project:${project.id}:${project.status}`,
          category: 'life-project',
          text: projectText,
          priority: project.status === 'completed' ? 0.86 : project.status === 'stalled' ? 0.72 : 0.64,
          sourceEventIds: project.relatedEventIds,
          sourceEntityIds: [person.id, project.settlementId, ...(project.institutionId ? [project.institutionId] : [])],
          generic: project.status === 'active',
        });
      }
    }
  }

  const threadContext = runtime.threads.contextFor(scene, state);
  if (threadContext) {
    runtime.mind.observeThread(
      threadContext.thread.id,
      threadContext.thread.title,
      threadContext.thread.interestingness,
      threadContext.sourceEventIds,
      threadContext.thread.entityIds,
      state.month,
    );
    runtime.deepHistory.rememberThread(threadContext.thread);
    beats.push({
      key: `thread:${threadContext.thread.id}:${threadContext.thread.lastMonth}`,
      category: 'thread',
      text: threadContext.text,
      priority: 0.68 + threadContext.thread.interestingness * 0.16,
      sourceEventIds: threadContext.sourceEventIds,
      sourceEntityIds: threadContext.thread.entityIds,
    });
    scene.interest = Math.min(1, Math.max(scene.interest, 0.34 + threadContext.thread.interestingness * 0.52));
  }

  if (scene.event) {
    beats.push(...eventBeats(runtime, scene.event, state, statement));
    if (runtime.mind.sequence % 13 === 0) {
      const causal = causalPerspective(runtime.deepHistory, scene.event);
      if (causal) beats.push({
        key: `causal:${scene.event.id}`,
        category: 'causal',
        text: causal.text,
        priority: 0.87,
        sourceMemoryIds: causal.sourceMemoryIds,
        epistemicStatus: 'recorded-fact',
      });
    }
  } else if (statement.sourceArchiveIds.length > 0 && runtime.mind.sequence % 29 === 0) {
    beats.push({
      key: `archive-context:${statement.sourceArchiveIds.join(':')}`,
      category: 'archive-context',
      text: 'I have seen related outcomes in other observed worlds; this one still has to make its own history.',
      priority: 0.55,
      generic: true,
    });
  }

  const memoryRemark = runtime.mind.remark(scene, state);
  if (memoryRemark) beats.push({
    key: `watcher-memory:${stableTextKey(memoryRemark.text)}`,
    category: 'watcher-memory',
    text: memoryRemark.text,
    priority: /wondered:|I once suspected/i.test(memoryRemark.text) ? 0.94 : 0.76,
    sourceEventIds: memoryRemark.sourceEventIds,
    sourceEntityIds: memoryRemark.sourceEntityIds,
    epistemicStatus: /I once suspected/i.test(memoryRemark.text) ? 'probabilistic-inference' : undefined,
  });

  if ((scene.interest >= 0.62 && runtime.mind.sequence % 11 === 0) || (scene.event?.significance ?? 0) >= 0.9) {
    const humanRemark = runtime.humanHistory.remarkFor(scene, state, runtime.mind.sequence);
    if (humanRemark) beats.push({
      key: humanRemark.key,
      category: humanRemark.category,
      text: humanRemark.text,
      priority: humanRemark.priority,
      sourceEventIds: humanRemark.sourceEventIds,
      sourceEntityIds: humanRemark.sourceEntityIds,
      sourceMemoryIds: humanRemark.sourceMemoryIds,
      epistemicStatus: humanRemark.provenance === 'historical-interpretation' ? 'probabilistic-inference'
        : humanRemark.provenance === 'derived-statistic' ? 'derived-statistic' : undefined,
    });
  }

  if (runtime.mind.sequence % 17 === 0) {
    const deepRemark = runtime.deepHistory.callbackFor(scene, state);
    if (deepRemark && deepRemark.sourceMemoryIds.every((id) => runtime.deepHistory.hasMemoryId(id))) beats.push({
      key: `deep:${deepRemark.sourceMemoryIds.join(':')}`,
      category: 'deep-memory',
      text: deepRemark.text,
      priority: deepRemark.provenance === 'historical-interpretation' ? 0.84 : 0.78,
      sourceMemoryIds: deepRemark.sourceMemoryIds,
      epistemicStatus: deepRemark.provenance === 'historical-interpretation' ? 'probabilistic-inference' : undefined,
    });
  }

  const selected = runtime.episodes.select(beats, runtime.mind.sequence, statement.text);
  statement.text = selected.text;
  for (const beat of selected.beats) {
    statement.sourceEventIds = unique([...statement.sourceEventIds, ...(beat.sourceEventIds ?? []).filter((id) => activeEventIds.has(id))]);
    statement.sourceEntityIds = unique([...statement.sourceEntityIds, ...(beat.sourceEntityIds ?? []).filter((id) => knownEntityIds.has(id))]);
    statement.sourceMemoryIds = unique([...(statement.sourceMemoryIds ?? []), ...(beat.sourceMemoryIds ?? []).filter((id) => runtime.deepHistory.hasMemoryId(id) || runtime.humanHistory.hasMemoryId(id))]);
    if (beat.epistemicStatus === 'probabilistic-inference' && statement.sourceEntityIds.length > 0) statement.epistemicStatus = 'probabilistic-inference';
    else if (beat.epistemicStatus === 'derived-statistic' && statement.epistemicStatus === 'recorded-fact') statement.epistemicStatus = 'derived-statistic';
    if (['legacy', 'genealogy', 'institution', 'movement', 'theme', 'question-resolution'].includes(beat.category)) runtime.humanHistory.markNarrated(beat.key, state.month);
  }
}

function eventBeats(runtime: WatcherRuntime, event: HistoricalEvent, state: SimulationState, statement: HistorianStatement): NarrativeBeat[] {
  const beats: NarrativeBeat[] = [];
  const threshold = thresholdPerspective(event, state);
  if (threshold) beats.push({
    key: `threshold:${event.type}`,
    category: 'threshold',
    text: threshold,
    priority: event.significance >= 0.9 ? 0.93 : 0.82,
    sourceEventIds: [event.id],
    generic: false,
  });

  const priorOfType = state.history.filter((candidate) => candidate.type === event.type && candidate.month < event.month);
  if (priorOfType.length === 0 && event.significance >= 0.68 && !threshold) beats.push({
    key: `first:${event.type}`,
    category: 'threshold',
    text: `I have no earlier record of ${eventNoun(event.type, true)} in this world.`,
    priority: 0.75,
    sourceEventIds: [event.id],
  });

  if (priorOfType.length >= 4 && event.significance >= 0.72 && runtime.mind.sequence % 9 === 0) beats.push({
    key: `repeat:${event.type}:${Math.floor(priorOfType.length / 4)}`,
    category: 'threshold',
    text: `This is the ${ordinal(priorOfType.length + 1)} recorded ${eventNoun(event.type)}. The repetition is itself part of the history.`,
    priority: 0.62,
    sourceEventIds: [event.id],
    generic: true,
  });

  const callback = relatedEarlierEvent(event, state);
  if (callback && runtime.mind.sequence % 5 === 0) {
    statement.sourceEventIds = unique([...statement.sourceEventIds, callback.id]);
    beats.push({
      key: `callback:${callback.id}->${event.id}`,
      category: 'deep-memory',
      text: callbackText(event, callback),
      priority: event.causes.includes(callback.id) ? 0.86 : 0.7,
      sourceEventIds: [callback.id, event.id],
    });
  }
  return beats;
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
  return { text, sourceMemoryIds: unique([...sourceMemories.map((memory) => memory.id), targetMemory.id]) };
}

function thresholdPerspective(event: HistoricalEvent, state: SimulationState): string | undefined {
  switch (event.type) {
    case 'atomic-threshold': return 'For generations, ordinary combustion set the practical ceiling on power. That ceiling has changed.';
    case 'first-orbit': return 'This is the first recorded moment when part of this civilization remains beyond the ground that made it.';
    case 'offworld-settlement': return 'The sky now contains a place these people inhabit, not only a place they observe.';
    case 'interplanetary-transition': return 'A history that began on one world is now being carried between worlds.';
    case 'machine-intelligence-transition': return 'A new kind of participant has entered the record. I do not yet know what that will mean.';
    case 'nuclear-weapons-developed': return 'The record now includes the capacity to destroy in moments what generations built.';
    case 'nuclear-use':
    case 'nuclear-exchange':
      return state.history.some((candidate) => candidate.type === 'war-declared' && candidate.month < event.month)
        ? 'War is not new here. This destructive scale is.'
        : 'The destructive scale of this event has no ordinary precedent in the record.';
    case 'civilization-collapse': return 'Systems I watched accumulate across generations are now failing together.';
    case 'civilization-recovery': return 'The collapse did not end the record. Enough continuity survived to rebuild.';
    case 'post-biological-transition': return 'The civilization remains continuous with its earlier record even as its carriers change.';
    case 'first-contact': return 'Two histories that developed apart now have consequences for one another.';
    case 'knowledge-rediscovered': return 'This knowledge has entered the record before. Its absence is now part of its history too.';
    case 'archive-destroyed': return 'The loss here is not only material; part of the civilization’s stored memory has disappeared.';
    case 'planetary-stability': return 'Stability has persisted long enough to be evidence, not merely a quiet interval.';
    case 'observation-lost': return 'The record itself fails here. I cannot claim to know what followed.';
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
  if (event.causes.includes(earlier.id)) return `The record connects this directly to ${eventNoun(earlier.type, true)} ${years.toLocaleString()} years earlier.`;
  if (event.locationId && earlier.locationId === event.locationId) return `I remember this place ${years.toLocaleString()} years earlier, when ${eventNoun(earlier.type, true)} was recorded here.`;
  return `These people or institutions touched the same record ${years.toLocaleString()} years earlier, during ${eventNoun(earlier.type, true)}.`;
}

function eventNoun(type: string, withArticle = false): string {
  const readableType = type.replaceAll('-', ' ');
  if (!withArticle) return readableType;
  return `${/^[aeiou]/i.test(readableType) ? 'an' : 'a'} ${readableType}`;
}

function joinReadable(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const suffix = value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

function stableTextKey(text: string): string {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash.toString(16);
}

function currentEntityIds(state: SimulationState): Set<string> {
  return new Set<string>([
    ...state.people.map((item) => item.id),
    ...state.settlements.map((item) => item.id),
    ...state.institutions.map((item) => item.id),
    ...state.polities.map((item) => item.id),
    ...(state.ideas?.map((item) => item.id) ?? []),
    ...state.relations.map((item) => item.id),
    ...state.tradeRoutes.map((item) => item.id),
    ...state.wars.map((item) => item.id),
  ]);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
