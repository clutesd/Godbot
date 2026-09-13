import type { HistoricalIdentity, NotableFigure, Person, SimulationState } from '../types';
import { advancePersonalMemory, memoriesFor, memoryInfluenceFor } from './PersonalMemorySystem';
import { advanceSocialDynamics, socialInfluenceFor } from './SocialDynamicsSystem';

/**
 * Deterministic historical importance.
 *
 * Nothing here invents celebrity: a person only rises above `ordinary` because the simulation
 * already gave them an office, a command, an attributed discovery, a founding role, repeated
 * mentions in the chronicle, a consequential social network, or durable memories of real events.
 * Scores are bounded and monotonic for a life, so the same seed always produces the same notable people.
 */

const NOTABLE_THRESHOLD = 0.42;
const HISTORICAL_THRESHOLD = 0.76;
/** Chronicle entries retained per person; documentary shots only ever cite a handful. */
const MAX_CITED_EVENTS = 6;
/** Deceased figures kept for the Historian. Bounded so a long run cannot grow without limit. */
const MAX_RETIRED_FIGURES = 256;

/** Events that make the people named in them candidates rather than bystanders. */
const CHRONICLE_WEIGHTS: Record<string, number> = {
  discovery: 0.5,
  'leadership-succession': 0.34,
  'institution-founded': 0.2,
  'polity-formed': 0.26,
  'polity-transition': 0.18,
  battle: 0.16,
  'war-declared': 0.14,
  'settlement-founded': 0.3,
  'knowledge-rediscovered': 0.22,
};

interface Chronicle {
  mentions: number;
  weight: number;
  peakSignificance: number;
  eventIds: string[];
  reasons: Set<string>;
}

export class HistoricalImportanceSystem {
  private readonly chronicles = new Map<string, Chronicle>();
  private readonly retired = new Map<string, NotableFigure>();
  private processedEvents = 0;

  reset(): void {
    this.chronicles.clear();
    this.retired.clear();
    this.processedEvents = 0;
  }

  /**
   * Fold newly recorded history into the per-person index. Memory runs before social pruning so a
   * death from the previous month can still reach surviving family/friends/mentors through the old
   * relationship edge; SocialDynamics can then safely remove the deceased endpoint.
   */
  ingest(state: SimulationState): void {
    advancePersonalMemory(state);
    advanceSocialDynamics(state);
    for (let index = this.processedEvents; index < state.history.length; index += 1) {
      const event = state.history[index];
      if (!event) continue;
      const weight = CHRONICLE_WEIGHTS[event.type];
      if (weight === undefined) continue;
      for (const actor of event.actors) {
        if (!actor.startsWith('person-')) continue;
        const chronicle = this.chronicleFor(actor);
        chronicle.mentions += 1;
        chronicle.weight = Math.min(1, chronicle.weight + weight * (0.45 + event.significance * 0.55));
        chronicle.peakSignificance = Math.max(chronicle.peakSignificance, event.significance);
        if (chronicle.eventIds.length < MAX_CITED_EVENTS) chronicle.eventIds.push(event.id);
        if (event.type === 'discovery') chronicle.reasons.add(event.significance >= 0.7 ? 'major-discovery' : 'discovery');
        else if (event.type === 'leadership-succession') chronicle.reasons.add('succession');
        else if (event.type === 'battle' || event.type === 'war-declared') chronicle.reasons.add('war-record');
        else chronicle.reasons.add('chronicled');
      }
    }
    this.processedEvents = state.history.length;
  }

  /** Records a contribution the chronicle cannot express through actor lists alone. */
  credit(personId: string, reason: string, weight: number, eventId?: string): void {
    const chronicle = this.chronicleFor(personId);
    chronicle.reasons.add(reason);
    chronicle.weight = Math.min(1, chronicle.weight + weight);
    chronicle.mentions += 1;
    if (eventId && chronicle.eventIds.length < MAX_CITED_EVENTS) chronicle.eventIds.push(eventId);
  }

  /**
   * Assigns `person.historical`. Status is monotonic: a life that reached `notable` stays at least
   * notable, so the camera never loses a subject mid-shot and the record stays stable.
   */
  evaluate(person: Person, state: SimulationState, month: number): HistoricalIdentity {
    const chronicle = this.chronicles.get(person.id);
    const reasons = new Set<string>(chronicle?.reasons ?? []);
    let score = 0;

    if (chronicle) {
      score += Math.min(0.46, chronicle.weight * 0.52);
      score += Math.min(0.16, chronicle.peakSignificance * 0.2);
      if (chronicle.mentions >= 3) score += 0.06;
    }

    const polity = state.polities.find((candidate) => candidate.leadingPersonId === person.id);
    if (polity) {
      reasons.add('polity-leader');
      const tenureYears = Math.max(0, month - polity.phaseSinceMonth) / 12;
      score += 0.46 + Math.min(0.16, tenureYears * 0.006) + polity.legitimacy * 0.08;
      if (polity.settlementIds.length > 1) score += 0.08;
    }

    const command = state.wars.find((war) => war.leaderAId === person.id || war.leaderBId === person.id);
    if (command) {
      reasons.add('war-leader');
      score += 0.4 + Math.min(0.14, command.campaign.battleCount * 0.05);
    }

    if (person.institutionId) {
      const institution = state.institutions.find((candidate) => candidate.id === person.institutionId);
      if (institution && institution.prestige > 0.55) {
        reasons.add('institution-figure');
        score += 0.14 + institution.prestige * 0.1;
      }
    }

    const standing = person.socialPosition;
    if (standing) {
      score += Math.max(0, standing.politicalInfluence - 0.55) * 0.3;
      score += standing.institutionalPosition > 0.7 ? 0.08 : 0;
    }

    const social = socialInfluenceFor(person.id, state.socialRelationships ?? []);
    if (social.positiveTies >= 4 && social.support > 0.38) {
      reasons.add('community-network');
      score += Math.min(0.06, 0.025 + social.support * 0.04 + social.centrality * 0.02);
    }
    if ((social.mentorTies > 0 || social.collaboratorTies > 0) && social.learning > 0.22) {
      reasons.add(social.mentorTies > 0 ? 'mentor-network' : 'intellectual-network');
      score += Math.min(0.045, social.learning * 0.055);
    }
    if (social.politicalTies > 0 && social.political > 0.2) {
      reasons.add('political-network');
      score += Math.min(0.065, social.political * 0.075);
    }
    if (social.rivalTies > 0 && social.tension > 0.16) reasons.add('contested-figure');

    const memory = memoryInfluenceFor(person, month);
    if (memory.count > 0) {
      if (memory.legacy > 0.2) reasons.add('legacy-bearer');
      if (memory.displacement > 0.26) reasons.add('migration-memory');
      if (memory.adversity > 0.32) reasons.add('survivor');
      if (memory.achievement > 0.3) reasons.add('remembered-achievement');
      if (memory.grief > 0.34) reasons.add('bereaved');
      // Memory can distinguish lives with genuine continuity, but never manufacture a notable life.
      score += Math.min(0.075, memory.legacy * 0.025 + memory.adversity * 0.018 + memory.achievement * 0.045 + memory.displacement * 0.012);
    }

    if (person.ageMonths > 88 * 12) {
      reasons.add('long-lived');
      score += 0.1;
    }

    score = Math.min(1, score);
    const earned: HistoricalIdentity['status'] = score >= HISTORICAL_THRESHOLD ? 'historical' : score >= NOTABLE_THRESHOLD ? 'notable' : 'ordinary';
    const previous = person.historical;
    const status = rankOf(earned) >= rankOf(previous?.status ?? 'ordinary') ? earned : previous!.status;
    const memoryEventIds = memoriesFor(person).flatMap((memoryItem) => memoryItem.eventId ? [memoryItem.eventId] : []);
    const eventIds = [...new Set([...(chronicle?.eventIds ?? previous?.eventIds ?? []), ...memoryEventIds])].slice(0, MAX_CITED_EVENTS);
    const identity: HistoricalIdentity = {
      status,
      score: Math.max(score, previous?.score ?? 0),
      reasons: [...reasons].sort(),
      eventIds,
      ...(status === 'ordinary' ? {} : { promotedMonth: previous?.promotedMonth ?? month }),
    };
    person.historical = identity;
    return identity;
  }

  /** Freezes a notable life into the roster so the Historian keeps it after the person is gone. */
  retire(person: Person, month: number): void {
    const identity = person.historical;
    if (!identity || identity.status === 'ordinary') {
      this.chronicles.delete(person.id);
      return;
    }
    const memory = memoryInfluenceFor(person, month);
    const legacyReasons = [
      ...(memory.legacy > 0.2 ? ['legacy-bearer'] : []),
      ...(memory.adversity > 0.32 ? ['survivor'] : []),
      ...(memory.displacement > 0.26 ? ['migration-memory'] : []),
    ];
    this.retired.set(person.id, {
      id: person.id,
      name: person.name,
      status: identity.status,
      score: identity.score,
      reasons: [...new Set([...identity.reasons, ...legacyReasons])],
      eventIds: identity.eventIds,
      bornMonth: person.bornMonth,
      diedMonth: month,
      homeId: person.homeId,
      cultureId: person.cultureId,
      ...(person.role ? { role: person.role } : {}),
    });
    this.chronicles.delete(person.id);
    if (this.retired.size > MAX_RETIRED_FIGURES) this.prune();
  }

  /** Living notable people plus the retained record of the dead, sorted by importance. */
  roster(living: readonly Person[]): NotableFigure[] {
    const figures: NotableFigure[] = [];
    for (const person of living) {
      const identity = person.historical;
      if (!identity || identity.status === 'ordinary' || !person.alive) continue;
      figures.push({
        id: person.id,
        name: person.name,
        status: identity.status,
        score: identity.score,
        reasons: identity.reasons,
        eventIds: identity.eventIds,
        bornMonth: person.bornMonth,
        homeId: person.homeId,
        cultureId: person.cultureId,
        ...(person.role ? { role: person.role } : {}),
      });
    }
    for (const figure of this.retired.values()) figures.push(figure);
    figures.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return figures;
  }

  private chronicleFor(personId: string): Chronicle {
    const existing = this.chronicles.get(personId);
    if (existing) return existing;
    const created: Chronicle = { mentions: 0, weight: 0, peakSignificance: 0, eventIds: [], reasons: new Set() };
    this.chronicles.set(personId, created);
    return created;
  }

  private prune(): void {
    const ordered = [...this.retired.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    this.retired.clear();
    for (const figure of ordered.slice(0, MAX_RETIRED_FIGURES)) this.retired.set(figure.id, figure);
  }
}

function rankOf(status: HistoricalIdentity['status']): number {
  return status === 'historical' ? 2 : status === 'notable' ? 1 : 0;
}
