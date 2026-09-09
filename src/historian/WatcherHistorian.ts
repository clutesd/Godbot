import type { GodboxConfig } from '../config';
import type { HistoricalEvent, HistoricalEventType, SimulationState } from '../sim/types';
import { Historian, type HistorianOptions } from './Historian';
import type { HistorianStatement, ObservationCandidate } from './types';

interface ObserverAttention {
  firstMonth: number;
  lastMonth: number;
  appearances: number;
}

/**
 * A narrative layer over the grounded Historian.
 *
 * The base Historian remains the authority for facts, provenance, scoring and scene selection.
 * WatcherHistorian only deepens the selected observation with memory, perspective and callbacks
 * that can be supported by history already present in SimulationState. This keeps the observer
 * evocative without allowing the voice to invent events merely because they would sound good.
 */
export class WatcherHistorian extends Historian {
  private observationSequence = 0;
  private readonly attention = new Map<string, ObserverAttention>();
  private readonly remarkedPredictionIds = new Set<string>();

  constructor(config: GodboxConfig, options: HistorianOptions = {}) {
    super(config, options);
  }

  override chooseScene(state: SimulationState, focusEventId?: string): ObservationCandidate {
    const scene = super.chooseScene(state, focusEventId);
    this.observationSequence += 1;
    this.rememberAttention(scene.subjectId, state.month);
    this.deepen(scene, state);
    return scene;
  }

  private deepen(scene: ObservationCandidate, state: SimulationState): void {
    const statement = scene.statement;
    const additions: string[] = [];

    if (scene.event) {
      additions.push(...this.eventPerspective(scene.event, state, statement));
    } else if (statement.sourceArchiveIds.length > 0) {
      additions.push('I remember other worlds as well. Patterns repeat, but never perfectly.');
    } else if (statement.epistemicStatus === 'probabilistic-inference') {
      additions.push('I have watched certainty fail too often to call this destiny.');
    } else if (scene.kind === 'historian-context' && this.observationSequence % 2 === 0) {
      additions.push('Time makes patterns visible that a single lifetime cannot see.');
    } else if (this.observationSequence % 7 === 0) {
      additions.push('For now, history is quiet. Quiet years still become part of the age.');
    }

    const attentionRemark = this.attentionPerspective(scene, state.month);
    if (attentionRemark) additions.push(attentionRemark);

    const predictionRemark = this.resolvedPredictionPerspective(scene, state);
    if (predictionRemark) additions.push(predictionRemark);

    if (additions.length === 0) return;

    // Keep the factual statement intact. The observer voice frames it rather than replacing it.
    statement.text = `${additions.slice(0, 2).join(' ')} ${statement.text}`.trim();
  }

  private eventPerspective(event: HistoricalEvent, state: SimulationState, statement: HistorianStatement): string[] {
    const remarks: string[] = [];
    const priorOfType = state.history.filter((candidate) => candidate.type === event.type && candidate.month < event.month);
    const firstOfKind = priorOfType.length === 0;

    const thresholdRemark = this.thresholdPerspective(event, state);
    if (thresholdRemark) remarks.push(thresholdRemark);

    if (firstOfKind && event.significance >= 0.58) {
      remarks.push(`I have no earlier record of ${this.eventNoun(event.type)} in this world.`);
    } else if (priorOfType.length >= 4 && event.significance >= 0.68 && this.observationSequence % 3 === 0) {
      remarks.push(`This is the ${this.ordinal(priorOfType.length + 1)} recorded ${this.eventNoun(event.type)}. Repetition does not make its consequences smaller.`);
    }

    const callback = this.relatedEarlierEvent(event, state);
    if (callback) {
      statement.sourceEventIds = this.unique([...statement.sourceEventIds, callback.id]);
      remarks.push(this.callbackText(event, callback));
    }

    return remarks;
  }

  private thresholdPerspective(event: HistoricalEvent, state: SimulationState): string | undefined {
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
        return 'I watched generations build the systems now coming apart.';
      case 'civilization-recovery':
        return 'Collapse did not end this story. Something survived long enough to begin again.';
      case 'post-biological-transition':
        return 'The civilization remains continuous with its past, even as the beings carrying that continuity change.';
      case 'first-contact':
        return 'Two histories that had developed apart now become part of one another.';
      case 'settlement-founded':
        return this.observationSequence % 3 === 0 ? 'Another name enters the map. I will remember whether it endures.' : undefined;
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

  private relatedEarlierEvent(event: HistoricalEvent, state: SimulationState): HistoricalEvent | undefined {
    // Callbacks should feel earned. Require temporal distance and meaningful connection.
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

  private callbackText(event: HistoricalEvent, earlier: HistoricalEvent): string {
    const years = Math.max(1, Math.floor((event.month - earlier.month) / 12));
    if (event.causes.includes(earlier.id)) {
      return `The roots of this moment reach back ${years.toLocaleString()} years, to a recorded ${this.eventNoun(earlier.type)}.`;
    }
    if (event.locationId && earlier.locationId === event.locationId) {
      return `I remember this place ${years.toLocaleString()} years ago, when the record marked ${this.eventNoun(earlier.type)} here.`;
    }
    return `These lives or institutions touched the record together ${years.toLocaleString()} years ago, during ${this.eventNoun(earlier.type)}.`;
  }

  private rememberAttention(subjectId: string, month: number): void {
    const existing = this.attention.get(subjectId);
    if (!existing) {
      this.attention.set(subjectId, { firstMonth: month, lastMonth: month, appearances: 1 });
      return;
    }
    existing.lastMonth = month;
    existing.appearances += 1;
  }

  private attentionPerspective(scene: ObservationCandidate, month: number): string | undefined {
    const memory = this.attention.get(scene.subjectId);
    if (!memory || memory.appearances < 3 || this.observationSequence % 5 !== 0) return undefined;
    const years = Math.floor((month - memory.firstMonth) / 12);
    if (years < 8) return undefined;
    return `I have returned to ${scene.title} across ${years.toLocaleString()} years. Some threads keep drawing the record back.`;
  }

  private resolvedPredictionPerspective(scene: ObservationCandidate, state: SimulationState): string | undefined {
    if (scene.kind !== 'historian-context' || this.observationSequence % 4 !== 0) return undefined;
    const resolved = [...this.predictions].reverse().find((prediction) => prediction.resolved && !this.remarkedPredictionIds.has(prediction.id));
    if (!resolved) return undefined;
    this.remarkedPredictionIds.add(resolved.id);
    const horizonYears = Math.max(1, Math.round((resolved.horizonMonth - resolved.madeMonth) / 12));
    return resolved.occurred
      ? `An earlier warning proved justified within its ${horizonYears}-year horizon. Prediction is not prophecy; this one happened to be right.`
      : `An earlier warning passed its ${horizonYears}-year horizon without the predicted war. The future resisted the pattern I thought I saw.`;
  }

  private eventNoun(type: HistoricalEventType): string {
    const readable = type.replaceAll('-', ' ');
    const startsWithVowel = /^[aeiou]/i.test(readable);
    return `${startsWithVowel ? 'an' : 'a'} ${readable}`;
  }

  private ordinal(value: number): string {
    const mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
    const suffix = value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
    return `${value}${suffix}`;
  }

  private unique(values: readonly string[]): string[] {
    return [...new Set(values)];
  }
}
