import type { GodboxConfig } from '../config';
import { SeededRandom } from '../sim/prng';
import { representedPopulation, settlementRepresentedPopulation } from '../sim/advanced/AdvancedCivilizationSystem';
import type { HistoricalEvent, LandmarkKind, Person, Relation, SimulationState, Vec2, WorldCell } from '../sim/types';
import type { AudioCategory, CandidateScoreBreakdown, CrossRunContext, HistorianPrediction, HistorianStatement, ObservationCandidate, ObservationKind } from './types';
import { campaignMemory, isWarEvent, liveWarStory, WAR_CHAPTERS, warEventStory, warForEvent } from './WarStory';
import { campaignFocus } from '../sim/war/Campaign';

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

const SIGNIFICANT_EVENT_TYPES = new Set<HistoricalEvent['type']>([
  'discovery', 'knowledge-lost', 'knowledge-rediscovered', 'knowledge-adopted', 'technology-transformation', 'technology-widespread', 'industrialization-stage', 'industrialization', 'infrastructure-built', 'archive-destroyed',
  'institution-formed', 'alliance-formed', 'alliance-ended', 'political-transition', 'leadership-succession', 'war-declared', 'war-campaign', 'battle', 'war-ended',
  'settlement-founded', 'settlement-abandoned', 'major-migration', 'first-contact', 'harvest-crisis', 'recovery', 'cultural-shift',
  'statistical-transition', 'atomic-threshold', 'nuclear-energy', 'nuclear-medicine', 'nuclear-weapons-developed', 'nuclear-restraint',
  'nuclear-disarmament', 'nuclear-crisis', 'nuclear-use', 'nuclear-exchange', 'pandemic', 'ecological-crisis', 'climate-crisis',
  'resource-crisis', 'autonomous-weapons-crisis', 'machine-intelligence-transition', 'first-orbit', 'offworld-settlement',
  'interplanetary-transition', 'fermi-question', 'natural-catastrophe', 'civilization-collapse', 'civilization-recovery',
  'planetary-stability', 'post-biological-transition', 'observation-lost', 'outcome-classified',
]);

const POLITICAL_EVENTS = new Set<HistoricalEvent['type']>(['institution-formed', 'alliance-formed', 'alliance-ended', 'political-transition', 'leadership-succession', 'war-declared', 'war-ended', 'nuclear-restraint', 'nuclear-disarmament', 'nuclear-crisis', 'civilization-collapse', 'planetary-stability']);
const TECHNICAL_EVENTS = new Set<HistoricalEvent['type']>(['discovery', 'knowledge-lost', 'knowledge-rediscovered', 'knowledge-adopted', 'technology-transformation', 'technology-widespread', 'industrialization-stage', 'industrialization', 'infrastructure-built', 'archive-destroyed', 'atomic-threshold', 'nuclear-energy', 'nuclear-medicine', 'nuclear-weapons-developed', 'machine-intelligence-transition', 'first-orbit', 'offworld-settlement', 'interplanetary-transition', 'post-biological-transition']);
const CULTURAL_EVENTS = new Set<HistoricalEvent['type']>(['cultural-shift', 'first-contact', 'major-migration', 'institution-formed']);

const LANDMARK_TITLES: Record<LandmarkKind, string> = {
  'great-peak': 'The great peak',
  'mountain-pass': 'The pass',
  waterfall: 'The falls',
  'sacred-lake': 'The still water',
  'deep-canyon': 'The cut',
  'cliff-cape': 'The cape',
  'river-mouth': 'The river mouth',
};

const LANDMARK_DESCRIPTIONS: Record<LandmarkKind, string> = {
  'great-peak': 'The highest ground in this world stands above everything settled.',
  'mountain-pass': 'A low saddle through the mountains; whatever crosses this range crosses here.',
  waterfall: 'A river falls from high ground and throws mist across the rock.',
  'sacred-lake': 'Still water held in a basin the rivers drain into.',
  'deep-canyon': 'A channel cut deep enough that the land above it is a different country.',
  'cliff-cape': 'A headland of rock standing out into the sea.',
  'river-mouth': 'The river reaches the sea and spreads across its own silt.',
};

export interface HistorianOptions {
  observationNumber?: number;
  crossRunContext?: CrossRunContext;
}

export class Historian {
  readonly statements: HistorianStatement[] = [];
  readonly predictions: HistorianPrediction[] = [];
  readonly representativePersonIds = new Set<string>();
  private readonly random: SeededRandom;
  private readonly shownSubjects = new Map<string, number>();
  private readonly shownEventTypes = new Map<HistoricalEvent['type'], number>();
  private readonly shownCenturies = new Set<number>();
  private statementSequence = 1;
  private predictionSequence = 1;
  private sceneSequence = 0;
  private lastRepresentativeRefreshMonth = -Infinity;
  private lastSubjectId = '';
  private crossRunContext?: CrossRunContext;
  private knownIdsMonth = -1;
  private knownIds = new Set<string>();

  constructor(private readonly config: GodboxConfig, options: HistorianOptions = {}) {
    this.random = new SeededRandom(`${config.seed}:historian:observation-${options.observationNumber ?? 1}`);
    this.crossRunContext = options.crossRunContext;
  }

  setCrossRunContext(context: CrossRunContext): void {
    this.crossRunContext = context;
  }

  chooseScene(state: SimulationState, focusEventId?: string): ObservationCandidate {
    this.refreshRepresentatives(state);
    this.resolvePredictions(state);
    const candidates = this.candidates(state);
    const pattern = ['ordinary', 'city', 'significant', 'ordinary', 'context', 'travel', 'city', 'ordinary', 'significant', 'context'] as const;
    const beat = pattern[this.sceneSequence % pattern.length] ?? 'ordinary';
    this.sceneSequence += 1;
    const preferred = candidates.filter((candidate) => {
      if (beat === 'ordinary') return ['worker-follow', 'street-observation', 'settlement-approach', 'landscape-pause', 'night-transition'].includes(candidate.kind);
      if (beat === 'city') return ['settlement-approach', 'street-observation', 'institution-exterior', 'city-growth-timelapse', 'infrastructure-scene'].includes(candidate.kind);
      if (beat === 'significant') return candidate.interest >= 0.62;
      if (beat === 'context') return candidate.kind === 'historian-context' || candidate.kind === 'world-establishing' || candidate.kind === 'city-growth-timelapse';
      return candidate.kind === 'traveler-follow' || candidate.kind === 'regional-travel' || candidate.kind === 'landscape-pause';
    });
    const focusEvent = focusEventId ? state.history.find(event => event.id === focusEventId && event.month <= state.month) : undefined;
    const focusCandidate = focusEvent ? this.eventCandidate(state, focusEvent) : undefined;
    const focused = focusCandidate && this.validateStatement(focusCandidate.statement, state) ? focusCandidate : undefined;
    const pool = preferred.length > 0 ? preferred : candidates;
    pool.sort((a, b) => b.score - a.score);
    const shortlist = pool.slice(0, Math.min(6, pool.length));
    const choice = focused ?? shortlist[this.random.weightedIndex(shortlist.map((candidate, index) => Math.max(0.04, candidate.score * (1 - index * 0.1))))] ?? pool[0] ?? this.fallback(state);
    this.shownSubjects.set(choice.subjectId, (this.shownSubjects.get(choice.subjectId) ?? 0) + 1);
    if (choice.event) this.shownEventTypes.set(choice.event.type, (this.shownEventTypes.get(choice.event.type) ?? 0) + 1);
    if (choice.id.startsWith('century:')) this.shownCenturies.add(Number(choice.id.replace('century:', '')));
    this.lastSubjectId = choice.subjectId;
    if (this.validateStatement(choice.statement, state)) {
      this.statements.push(choice.statement);
      if (this.statements.length > 1200) this.statements.splice(0, this.statements.length - 1200);
    }
    return choice;
  }

  candidates(state: SimulationState): ObservationCandidate[] {
    const candidates: ObservationCandidate[] = [];
    const recentEvents = state.history.filter((event) => SIGNIFICANT_EVENT_TYPES.has(event.type) && event.month <= state.month && state.month - event.month <= 24);
    const latestCampaignEvents = new Map<string, HistoricalEvent>();
    for (const event of recentEvents) {
      const war = warForEvent(state, event);
      if (war) latestCampaignEvents.set(war.id, event);
      else candidates.push(this.eventCandidate(state, event));
    }
    for (const event of latestCampaignEvents.values()) candidates.push(this.eventCandidate(state, event));
    candidates.push(...this.campaignCandidates(state));
    candidates.push(...this.settlementCandidates(state));
    candidates.push(...this.personCandidates(state));
    candidates.push(...this.routeCandidates(state));
    candidates.push(...this.polityCandidates(state));
    const retrospective = this.retrospectiveCandidate(state);
    if (retrospective) candidates.push(retrospective);
    const prediction = this.inferenceCandidate(state);
    if (prediction) candidates.push(prediction);
    const comparison = this.crossRunCandidate(state);
    if (comparison) candidates.push(comparison);
    const landscape = this.landscapeCandidate(state);
    if (landscape) candidates.push(landscape);
    return candidates.filter((candidate) => this.validateStatement(candidate.statement, state));
  }

  validateStatement(statement: HistorianStatement, state: SimulationState): boolean {
    if (statement.month > state.month || statement.month < 0 || statement.text.trim().length === 0) return false;
    const events = statement.sourceEventIds.map((id) => state.history.find((event) => event.id === id));
    if (events.some((event) => !event || event.month > statement.month)) return false;
    if (statement.epistemicStatus === 'recorded-fact' && statement.sourceEventIds.length === 0 && statement.sourceEntityIds.length === 0) return false;
    const knownEntityIds = this.knownEntityIds(state, statement.month);
    if (statement.sourceEntityIds.some((id) => !knownEntityIds.has(id))) return false;
    if (statement.claims.entityIds?.some((id) => !knownEntityIds.has(id))) return false;
    if (statement.sourceArchiveIds.some((id) => !this.crossRunContext?.archiveIds.includes(id))) return false;
    if (statement.claims.population) {
      const claim = statement.claims.population;
      if (claim.month !== state.month) return false;
      const actual = claim.scopeEntityId
        ? settlementRepresentedPopulation(state, claim.scopeEntityId)
        : representedPopulation(state);
      if (claim.scopeEntityId && !state.settlements.some((settlement) => settlement.id === claim.scopeEntityId)) return false;
      if (claim.value !== actual) return false;
    }
    if (statement.claims.warId && !state.wars.some((war) => war.id === statement.claims.warId && war.startMonth <= statement.month)) return false;
    if (statement.claims.knowledgeId) {
      const knownAtTime = state.history.some((event) => event.month <= statement.month && typeof event.context.knowledge === 'string' && event.context.knowledge === statement.claims.knowledgeId)
        || state.settlements.some((settlement) => (settlement.knowledge.records[statement.claims.knowledgeId ?? '']?.discoveredMonth ?? Number.POSITIVE_INFINITY) <= statement.month);
      if (!knownAtTime) return false;
    }
    if (statement.claims.eventType && !events.some((event) => event?.type === statement.claims.eventType)) return false;
    if (statement.epistemicStatus === 'probabilistic-inference' && statement.sourceEntityIds.length === 0) return false;
    if (statement.epistemicStatus === 'derived-statistic' && statement.sourceEventIds.length === 0 && statement.sourceEntityIds.length === 0 && statement.sourceArchiveIds.length === 0) return false;
    return true;
  }

  private eventCandidate(state: SimulationState, event: HistoricalEvent): ObservationCandidate {
    const war = warForEvent(state, event);
    const memory = campaignMemory(state, event);
    const breakdown = this.scoreEvent(state, event);
    const score = this.totalScore(breakdown);
    const kind = this.kindForEvent(event);
    const attributedPersonId = typeof event.context.attributedPersonId === 'string' ? event.context.attributedPersonId : undefined;
    const attributedPerson = attributedPersonId ? state.people.find((person) => person.id === attributedPersonId) : undefined;
    const atomicComparison = event.type === 'atomic-threshold' && (this.crossRunContext?.completedRuns ?? 0) >= 3
      ? ` ${this.crossRunContext?.atomicThresholdRuns ?? 0} previous completed civilizations reached this threshold; ${this.crossRunContext?.survivedThreeCenturiesAfterAtomic ?? 0} remained technologically intact for at least 300 years afterward.`
      : '';
    const statement = this.statement({
      month: state.month,
      text: `${memory ? `${memory.text} ` : ''}${warEventStory(state, event) ?? this.eventText(event)}${atomicComparison}`,
      epistemicStatus: 'recorded-fact',
      sourceEventIds: [event.id, ...(memory ? [memory.event.id] : [])],
      sourceEntityIds: event.actors.filter((id) => this.knownEntityIds(state, state.month).has(id)),
      sourceArchiveIds: atomicComparison ? this.crossRunContext?.archiveIds ?? [] : [],
      claims: {
        ...(isWarEvent(event) ? { warId: event.actors.find((id) => id.startsWith('war-')) } : {}),
        ...(typeof event.context.knowledge === 'string' ? { knowledgeId: event.context.knowledge } : {}),
        eventType: event.type,
      },
    });
    return {
      id: `event:${event.id}`,
      subjectId: attributedPerson?.id ?? event.locationId ?? event.actors[0] ?? event.id,
      kind,
      position: attributedPerson?.position ?? event.location ?? this.positionForActors(state, event.actors),
      title: war ? `The ${state.settlements.find(s => s.id === war.defender)?.name ?? 'frontier'} campaign` : this.titleForEvent(state, event),
      statement,
      score,
      interest: clamp(0.4 + event.significance * 0.45 + (event.month === state.month ? 0.1 : 0)),
      audioCategory: this.audioForEvent(event),
      breakdown,
      event,
    };
  }

  private campaignCandidates(state: SimulationState): ObservationCandidate[] {
    return state.wars.filter(war => war.active && war.resolvedMonth === undefined).flatMap(war => {
      const a = state.settlements.find(s => s.id === war.attacker);
      const b = state.settlements.find(s => s.id === war.defender);
      if (!a || !b) return [];
      const statement = this.statement({ month: state.month, text: liveWarStory(state, war), epistemicStatus: 'derived-statistic', sourceEntityIds: [war.id, a.id, b.id], claims: { warId: war.id } });
      const breakdown = { novelty: 0.6, magnitude: 0.65, populationAffected: 0.5, rarity: 0.5, technological: 0, political: 0.65, cultural: 0.2, consequence: 0.7, continuity: this.lastSubjectId === war.id ? 0.65 : 0.2, repetitionPenalty: Math.min(0.7, (this.shownSubjects.get(war.id) ?? 0) * 0.06) };
      return [{ id: `campaign:${war.id}:${war.phase}`, subjectId: war.id, kind: 'battle-overview' as const,
        position: campaignFocus(war, a.position, b.position), title: `${b.name} · ${WAR_CHAPTERS[war.phase].title}`, statement,
        score: this.totalScore(breakdown), interest: 0.76, audioCategory: 'conflict' as const, breakdown }];
    });
  }

  private settlementCandidates(state: SimulationState): ObservationCandidate[] {
    const result: ObservationCandidate[] = [];
    for (const settlement of state.settlements.filter((candidate) => candidate.alive)) {
      const people = state.people.filter((person) => person.alive && person.homeId === settlement.id);
      const localPopulation = settlementRepresentedPopulation(state, settlement.id);
      const shown = this.shownSubjects.get(settlement.id) ?? 0;
      const base = 0.43 + Math.min(0.2, people.length / 600) + settlement.prosperity * 0.12 - shown * 0.045;
      const kind: ObservationKind = settlement.industry.active ? 'city-growth-timelapse' : settlement.urbanization > 0.35 ? 'street-observation' : 'settlement-approach';
      const statement = this.statement({
        month: state.month,
        text: state.month - settlement.foundedMonth >= this.config.historicalPace.generationYears * 24
          ? `${settlement.name} has endured for ${this.durationPhrase(state.month - settlement.foundedMonth)} and currently represents ${localPopulation.toLocaleString()} people; its strongest production is ${settlement.specialization}.`
          : `${settlement.name} currently represents ${localPopulation.toLocaleString()} people; its strongest production is ${settlement.specialization}.`,
        epistemicStatus: 'derived-statistic',
        sourceEntityIds: [settlement.id],
        claims: { population: { month: state.month, value: localPopulation, scopeEntityId: settlement.id }, entityIds: [settlement.id] },
      });
      result.push(this.candidate(`settlement:${settlement.id}`, settlement.id, kind, settlement.position, settlement.name, statement, base, settlement.industry.active ? 0.7 : 0.35, settlement.industry.active ? 'industry' : 'settlement'));
      for (const institution of state.institutions.filter((candidate) => candidate.settlementId === settlement.id).sort((a, b) => b.prestige - a.prestige).slice(0, 1)) {
        const institutionStatement = this.statement({ month: state.month, text: `${institution.name} has ${institution.members} members and has endured for ${this.durationPhrase(state.month - institution.foundedMonth)}.`, epistemicStatus: 'derived-statistic', sourceEntityIds: [institution.id, settlement.id], claims: { entityIds: [institution.id, settlement.id] } });
        result.push(this.candidate(`institution:${institution.id}`, institution.id, 'institution-exterior', settlement.position, institution.name, institutionStatement, 0.42 + institution.prestige * 0.22 - (this.shownSubjects.get(institution.id) ?? 0) * 0.05, 0.48, institution.kind === 'temple' ? 'ritual-culture' : 'settlement'));
      }
    }
    return result;
  }

  private personCandidates(state: SimulationState): ObservationCandidate[] {
    const result: ObservationCandidate[] = [];
    for (const id of this.representativePersonIds) {
      const person = state.people.find((candidate) => candidate.alive && candidate.id === id);
      if (!person) continue;
      const home = state.settlements.find((settlement) => settlement.id === person.homeId);
      const age = Math.floor(person.ageMonths / 12);
      const isTraveler = person.activity === 'migrate' || person.activity === 'travel' || person.activity === 'transport';
      const kind: ObservationKind = isTraveler ? 'traveler-follow' : 'worker-follow';
      const work = person.activity === 'socialize' ? 'spending time with others' : person.activity === 'rest' ? 'resting' : person.activity;
      const statement = this.statement({ month: state.month, text: `${person.name}, age ${age}, is ${work}${home ? ` near ${home.name}` : ''}.`, epistemicStatus: 'recorded-fact', sourceEntityIds: [person.id, ...(home ? [home.id] : [])], claims: { entityIds: [person.id, ...(home ? [home.id] : [])] } });
      const unusual = person.occupation === 'keeper' || person.occupation === 'carrier' ? 0.08 : 0;
      const ordinary = person.prestige < 0.42 ? 0.07 : 0;
      result.push(this.candidate(`person:${person.id}`, person.id, kind, person.position, person.name, statement, 0.44 + unusual + ordinary + person.prestige * 0.08 - (this.shownSubjects.get(person.id) ?? 0) * 0.065, 0.3, isTraveler ? 'ambient-wilderness' : 'settlement'));
    }
    return result;
  }

  private routeCandidates(state: SimulationState): ObservationCandidate[] {
    return state.tradeRoutes.filter((route) => route.active).map((route) => {
      const a = state.settlements.find((settlement) => settlement.id === route.a);
      const b = state.settlements.find((settlement) => settlement.id === route.b);
      const position = a && b ? { x: (a.position.x + b.position.x) / 2, z: (a.position.z + b.position.z) / 2 } : { x: 0, z: 0 };
      const years = Math.floor(route.ageMonths / 12);
      const statement = this.statement({ month: state.month, text: `Trade between ${a?.name ?? route.a} and ${b?.name ?? route.b} has continued for ${years} years${years >= this.config.historicalPace.generationYears * 2 ? `—${Math.max(1, Math.floor(years / this.config.historicalPace.generationYears))} generations` : ''}.`, epistemicStatus: 'derived-statistic', sourceEntityIds: [route.id, route.a, route.b], claims: { entityIds: [route.id, route.a, route.b] } });
      return this.candidate(`route:${route.id}`, route.id, 'regional-travel', position, `${route.mode === 'water' ? 'Water passage' : 'Trade road'} between ${a?.name ?? 'one settlement'} and ${b?.name ?? 'another'}`, statement, 0.43 + Math.min(0.18, route.ageMonths / 2400) + Math.min(0.12, route.knowledgeFlow * 12) - (this.shownSubjects.get(route.id) ?? 0) * 0.055, 0.38, 'ambient-wilderness');
    });
  }

  private polityCandidates(state: SimulationState): ObservationCandidate[] {
    return state.polities.map((polity) => {
      const capital = state.settlements.find((settlement) => settlement.id === polity.capitalId && settlement.alive);
      if (!capital) return undefined;
      const activeWar = state.wars.some((war) => war.active && polity.settlementIds.some((id) => war.attacker === id || war.defender === id));
      const latestWar = [...state.wars].filter((war) => polity.settlementIds.some((id) => war.attacker === id || war.defender === id) && war.resolvedMonth !== undefined).sort((a, b) => (b.resolvedMonth ?? 0) - (a.resolvedMonth ?? 0))[0];
      const peaceMonths = activeWar ? 0 : state.month - (latestWar?.resolvedMonth ?? polity.formedMonth);
      const dynastyMonths = polity.dynastyStartedMonth === undefined ? 0 : state.month - polity.dynastyStartedMonth;
      const persistence = peaceMonths >= 50 * 12
        ? `${polity.name} has known peace for ${this.durationPhrase(peaceMonths)}.`
        : dynastyMonths >= this.config.historicalPace.generationYears * 24 && polity.dynastyName
          ? `${polity.dynastyName} has led ${polity.name} for ${this.durationPhrase(dynastyMonths)} through ${polity.successionCount} recorded successions.`
          : `${polity.name} has persisted for ${this.durationPhrase(state.month - polity.formedMonth)} and is in a ${polity.phase} phase.`;
      const statement = this.statement({ month: state.month, text: persistence, epistemicStatus: 'derived-statistic', sourceEntityIds: [polity.id, capital.id], claims: { entityIds: [polity.id, capital.id] } });
      const score = 0.42 + Math.min(0.2, (state.month - polity.formedMonth) / 6000) + Math.min(0.12, peaceMonths / 3600) - (this.shownSubjects.get(polity.id) ?? 0) * 0.05;
      return this.candidate(`polity:${polity.id}`, polity.id, 'historian-context', capital.position, polity.name, statement, score, activeWar ? 0.62 : 0.3, 'historian');
    }).filter((candidate): candidate is ObservationCandidate => Boolean(candidate));
  }

  private retrospectiveCandidate(state: SimulationState): ObservationCandidate | undefined {
    const century = Math.floor(state.month / 1200);
    if (century < 1 || this.shownCenturies.has(century) || state.month % 1200 > 36) return undefined;
    const start = century * 1200 - 1200;
    const events = state.history.filter((event) => event.month >= start && event.month <= state.month && event.significance >= 0.5);
    if (events.length === 0) return undefined;
    const discoveries = events.filter((event) => event.type === 'discovery').length;
    const wars = events.filter((event) => event.type === 'war-declared').length;
    const migrations = events.filter((event) => event.type === 'major-migration').length;
    const sourceEvents = events
      .filter((event) => event.type === 'discovery' || event.type === 'war-declared' || event.type === 'major-migration')
      .map((event) => event.id);
    const statement = this.statement({ month: state.month, text: `In the previous century, the record contains ${discoveries} discoveries, ${wars} wars, and ${migrations} major migrations.`, epistemicStatus: 'derived-statistic', sourceEventIds: sourceEvents, sourceEntityIds: ['world'] });
    return this.candidate(`century:${century}`, `century:${century}`, 'historian-context', this.populationCenter(state), `The ${century}${this.ordinalSuffix(century)} century`, statement, 0.68, 0.58, 'historian');
  }

  private inferenceCandidate(state: SimulationState): ObservationCandidate | undefined {
    const livingSettlementIds = new Set(state.settlements.filter((settlement) => settlement.alive).map((settlement) => settlement.id));
    const relation = state.relations.filter((candidate) => candidate.contact
      && livingSettlementIds.has(candidate.a)
      && livingSettlementIds.has(candidate.b)
      && !state.wars.some((war) => war.active && this.matchesRelation(war.attacker, war.defender, candidate)))
      .sort((a, b) => this.relationRisk(b) - this.relationRisk(a))[0];
    if (!relation || this.relationRisk(relation) < 0.67 || this.predictions.some((prediction) => !prediction.resolved && prediction.subjectIds.includes(relation.id))) return undefined;
    const a = state.settlements.find((settlement) => settlement.id === relation.a);
    const b = state.settlements.find((settlement) => settlement.id === relation.b);
    if (!a || !b) return undefined;
    const prediction: HistorianPrediction = { id: `prediction-${this.predictionSequence++}`, madeMonth: state.month, horizonMonth: state.month + 120, subjectIds: [relation.id, a.id, b.id], predictedEventType: 'war-declared', sourceEntityIds: [relation.id, a.id, b.id], resolved: false };
    this.predictions.push(prediction);
    if (this.predictions.length > 1200) {
      const removable = this.predictions.findIndex((candidate) => candidate.resolved);
      if (removable >= 0) this.predictions.splice(removable, 1);
    }
    const statement = this.statement({ month: state.month, text: `Relations between ${a.name} and ${b.name} are strained; conflict within the next decade is possible, not certain.`, epistemicStatus: 'probabilistic-inference', sourceEntityIds: prediction.sourceEntityIds, claims: { entityIds: prediction.sourceEntityIds } });
    return this.candidate(`inference:${prediction.id}`, relation.id, 'historian-context', { x: (a.position.x + b.position.x) / 2, z: (a.position.z + b.position.z) / 2 }, 'The Historian notes uncertainty', statement, 0.57, 0.5, 'historian');
  }

  private crossRunCandidate(state: SimulationState): ObservationCandidate | undefined {
    const context = this.crossRunContext;
    if (!context || context.completedRuns < 3 || this.sceneSequence % 23 !== 0) return undefined;
    const smallSample = context.completedRuns < 12 ? ' This remains a small sample.' : '';
    const metric = Math.floor(this.sceneSequence / 23) % 4;
    const text = metric === 0
      ? `Across ${context.completedRuns} completed observations, ${context.industrializedFraction === null ? 'industrialization frequency is not yet measurable' : `${Math.round(context.industrializedFraction * 100)}% industrialized`}.${smallSample}`
      : metric === 1
        ? `${context.atomicThresholdRuns} of ${context.completedRuns} completed civilizations reached the atomic threshold; the median time was ${context.medianAtomicThresholdYear === null ? 'not yet measurable' : `${Math.round(context.medianAtomicThresholdYear).toLocaleString()} years`}.${smallSample}`
        : metric === 2
          ? `${context.nuclearWarRuns} of ${context.completedRuns} completed observations recorded nuclear war. This is an association count, not a causal finding.${smallSample}`
          : `${context.interplanetaryRuns} of ${context.completedRuns} completed observations became interplanetary; ${context.extinctionOrCollapseRuns} ended extinct or collapsed.${smallSample}`;
    const statement = this.statement({ month: state.month, text, epistemicStatus: 'derived-statistic', sourceArchiveIds: context.archiveIds });
    return this.candidate(`cross-run:${state.month}`, 'historian:cross-run', 'historian-context', this.populationCenter(state), 'Across remembered worlds', statement, 0.5, 0.42, 'historian');
  }

  /**
   * Scenic framing. Named natural landmarks are preferred over anonymous terrain, so the wide
   * shots land on the great peak, the falls and the sacred lake instead of a random hillside.
   */
  private landscapeCandidate(state: SimulationState): ObservationCandidate | undefined {
    const landmarks = state.world.landmarks;
    if (landmarks.length > 0 && this.sceneSequence % 3 !== 2) {
      const landmark = landmarks[this.random.weightedIndex(landmarks.map((candidate) => 0.25 + candidate.prominence))];
      if (landmark) {
        const title = LANDMARK_TITLES[landmark.kind];
        const statement = this.statement({
          month: state.month,
          text: LANDMARK_DESCRIPTIONS[landmark.kind],
          epistemicStatus: 'recorded-fact',
          sourceEntityIds: [landmark.id],
          claims: { entityIds: [landmark.id] },
        });
        const kind = landmark.kind === 'great-peak' || landmark.kind === 'deep-canyon' ? 'world-establishing' : 'landscape-pause';
        return this.candidate(`landmark:${landmark.id}:${this.sceneSequence}`, landmark.id, kind, { x: landmark.worldX, z: landmark.worldZ }, title, statement, 0.46 + landmark.prominence * 0.2, 0.24, 'ambient-wilderness');
      }
    }
    const cells = state.world.cells.filter((cell) => !cell.water && (cell.coast || cell.elevation > 0.73));
    const cell = cells[this.random.int(0, cells.length)];
    if (!cell) return undefined;
    const title = cell.coast ? 'The inhabited coast' : 'The high country';
    const statement = this.statement({ month: state.month, text: cell.coast ? 'A coastal landscape beyond the settlements.' : 'High ground beyond the settled valleys.', epistemicStatus: 'recorded-fact', sourceEntityIds: [this.cellId(cell)], claims: { entityIds: [this.cellId(cell)] } });
    return this.candidate(`landscape:${cell.x}:${cell.z}:${this.sceneSequence}`, this.cellId(cell), this.sceneSequence % 9 === 0 ? 'night-transition' : 'landscape-pause', { x: cell.worldX, z: cell.worldZ }, title, statement, 0.42, 0.18, 'ambient-wilderness');
  }

  private scoreEvent(state: SimulationState, event: HistoricalEvent): CandidateScoreBreakdown {
    const sameType = state.history.filter((candidate) => candidate.type === event.type && candidate.month <= state.month).length;
    const shownSubject = this.shownSubjects.get(event.locationId ?? event.actors[0] ?? event.id) ?? 0;
    return {
      novelty: 1 / (1 + (this.shownEventTypes.get(event.type) ?? 0) * 0.7),
      magnitude: event.magnitude,
      populationAffected: clamp(event.affectedPopulation / Math.max(12, representedPopulation(state) * 0.45)),
      rarity: clamp(1 - Math.log2(1 + sameType) / 8),
      technological: TECHNICAL_EVENTS.has(event.type) ? event.significance : 0,
      political: POLITICAL_EVENTS.has(event.type) ? event.significance : 0,
      cultural: CULTURAL_EVENTS.has(event.type) ? event.significance : 0,
      consequence: clamp(event.causes.length * 0.12 + event.tags.length * 0.05 + event.significance * 0.42),
      continuity: event.locationId === this.lastSubjectId || event.actors.includes(this.lastSubjectId) ? 0.34 : 0.08,
      repetitionPenalty: clamp(shownSubject * 0.14),
    };
  }

  private totalScore(score: CandidateScoreBreakdown): number {
    return clamp(score.novelty * 0.15 + score.magnitude * 0.14 + score.populationAffected * 0.09 + score.rarity * 0.12 + score.technological * 0.15 + score.political * 0.09 + score.cultural * 0.07 + score.consequence * 0.12 + score.continuity * 0.07 - score.repetitionPenalty, 0.03, 1.2);
  }

  private kindForEvent(event: HistoricalEvent): ObservationKind {
    if (event.type === 'atomic-threshold') return 'atomic-threshold';
    if (event.type === 'first-orbit' || event.type === 'offworld-settlement' || event.type === 'interplanetary-transition') return 'orbital-establishing';
    if (event.type === 'civilization-collapse' || event.type === 'outcome-classified' || event.type === 'observation-lost' || event.type === 'post-biological-transition' || event.type === 'planetary-stability') return 'civilization-ending';
    if (event.type === 'discovery' || event.type === 'knowledge-rediscovered' || event.type === 'knowledge-adopted' || event.type === 'technology-transformation') return 'discovery-scene';
    if (event.type === 'industrialization' || event.type === 'industrialization-stage') return 'city-growth-timelapse';
    if (event.type === 'infrastructure-built' || event.type === 'archive-destroyed') return 'infrastructure-scene';
    if (event.type === 'institution-formed' || event.type === 'leadership-succession') return 'institution-exterior';
    if (event.type === 'war-declared' || event.type === 'war-campaign' || event.type === 'battle' || event.type === 'nuclear-crisis' || event.type === 'nuclear-use') return 'battle-overview';
    if (event.type === 'war-ended' || event.type === 'settlement-abandoned' || event.type === 'knowledge-lost' || event.type === 'nuclear-exchange' || event.type === 'pandemic' || event.type === 'natural-catastrophe' || event.type === 'ecological-crisis' || event.type === 'climate-crisis') return 'aftermath-pullback';
    if (event.type === 'major-migration') return 'regional-travel';
    return 'historian-context';
  }

  private audioForEvent(event: HistoricalEvent): AudioCategory {
    if (event.type === 'atomic-threshold' || event.type === 'first-orbit' || event.type === 'interplanetary-transition' || event.type === 'post-biological-transition') return 'major-threshold';
    if (event.type === 'outcome-classified' || event.type === 'observation-lost' || event.type === 'civilization-collapse') return 'ending';
    if (event.type === 'discovery' || event.type === 'knowledge-rediscovered' || event.type === 'knowledge-adopted' || event.type === 'technology-transformation') return 'discovery';
    if (event.type === 'industrialization') return 'major-threshold';
    if (event.type === 'industrialization-stage') return 'industry';
    if (event.type === 'war-declared' || event.type === 'war-campaign' || event.type === 'battle' || event.type === 'nuclear-crisis' || event.type === 'nuclear-use') return 'conflict';
    if (event.type === 'war-ended' || event.type === 'settlement-abandoned' || event.type === 'archive-destroyed' || event.type === 'knowledge-lost' || event.type === 'nuclear-exchange' || event.type === 'pandemic' || event.type === 'natural-catastrophe') return 'tragedy';
    if (event.type === 'nuclear-energy' || event.type === 'machine-intelligence-transition') return 'industry';
    if (event.type === 'cultural-shift' || event.type === 'institution-formed') return 'ritual-culture';
    return 'settlement';
  }

  private eventText(event: HistoricalEvent): string {
    if (event.type === 'atomic-threshold') return 'This civilization has discovered an energy source vastly beyond chemical combustion.';
    if (event.type === 'nuclear-weapons-developed') return `${event.summary} Its doctrine is recorded as ${String(event.context.doctrine ?? 'undetermined').replaceAll('-', ' ')}.`;
    if (event.type === 'nuclear-use' || event.type === 'nuclear-exchange') return `${event.summary} The demographic loss is recorded as ${Math.round(Number(event.context.populationLossFraction ?? 0) * 100)}%.`;
    if (event.type === 'first-orbit' || event.type === 'offworld-settlement' || event.type === 'interplanetary-transition') return event.summary;
    if (event.type === 'observation-lost') return `${event.summary} Classification: UNKNOWN.`;
    if (event.type === 'trade-route-established') return `${event.summary} This is recorded in year ${Math.floor(event.month / 12)}.`;
    if (event.type === 'discovery' && typeof event.context.name === 'string') return `${event.context.name} is first recorded here in year ${Math.floor(event.month / 12)}.`;
    if (event.type === 'knowledge-adopted' || event.type === 'technology-transformation' || event.type === 'industrialization-stage') return `${event.summary} ${event.outcome}`;
    if (event.type === 'battle') return `${event.summary} The record attributes ${event.affectedPopulation} deaths to this clash.`;
    if (event.type === 'major-migration') return `${event.affectedPopulation} people moved: ${event.outcome}`;
    if (event.type === 'industrialization') return `${event.summary} ${event.outcome}`;
    return event.summary;
  }

  private titleForEvent(state: SimulationState, event: HistoricalEvent): string {
    if (event.type === 'atomic-threshold') return 'ATOMIC THRESHOLD';
    if (event.type === 'first-orbit') return 'FIRST ORBIT';
    if (event.type === 'offworld-settlement') return 'FIRST OFF-WORLD SETTLEMENT';
    if (event.type === 'interplanetary-transition') return 'INTERPLANETARY';
    if (event.type === 'observation-lost') return 'OBSERVATION LOST';
    if (event.type === 'nuclear-exchange') return 'AFTER THE EXCHANGE';
    if (event.type === 'discovery') return typeof event.context.name === 'string' ? event.context.name : 'A new practical understanding';
    const settlement = event.locationId ? state.settlements.find((candidate) => candidate.id === event.locationId) : undefined;
    return settlement?.name ?? event.type.replaceAll('-', ' ');
  }

  private refreshRepresentatives(state: SimulationState): void {
    if (state.month - this.lastRepresentativeRefreshMonth < 120 && this.representativePersonIds.size > 0) return;
    this.lastRepresentativeRefreshMonth = state.month;
    const living = state.people.filter((person) => person.alive);
    const selected: Person[] = [];
    const add = (person?: Person): void => { if (person && !selected.some((candidate) => candidate.id === person.id) && selected.length < 36) selected.push(person); };
    for (const polity of state.polities) add(living.find((person) => person.id === polity.leadingPersonId));
    for (const event of state.history.filter((candidate) => candidate.type === 'discovery').slice(-18)) add(event.actors.map((id) => living.find((person) => person.id === id)).find(Boolean));
    for (const settlement of state.settlements.filter((candidate) => candidate.alive)) {
      const local = living.filter((person) => person.homeId === settlement.id);
      add(local.find((person) => person.activity === 'migrate'));
      add([...local].sort((a, b) => b.ageMonths - a.ageMonths)[0]);
      add(local.find((person) => person.occupation === 'keeper'));
      add(local.find((person) => person.occupation === 'carrier'));
      add([...local].sort((a, b) => Math.abs(a.prestige - 0.3) - Math.abs(b.prestige - 0.3))[0]);
    }
    for (const occupation of ['farmer', 'forager', 'builder', 'artisan', 'carrier', 'keeper'] as const) add(living.find((person) => person.occupation === occupation));
    this.representativePersonIds.clear();
    for (const person of selected) this.representativePersonIds.add(person.id);
  }

  private resolvePredictions(state: SimulationState): void {
    for (const prediction of this.predictions.filter((candidate) => !candidate.resolved)) {
      const [relationId] = prediction.subjectIds;
      const relation = state.relations.find((candidate) => candidate.id === relationId);
      const occurred = relation ? state.wars.some((war) => war.startMonth >= prediction.madeMonth && war.startMonth <= Math.min(state.month, prediction.horizonMonth) && this.matchesRelation(war.attacker, war.defender, relation)) : false;
      if (occurred || state.month >= prediction.horizonMonth) {
        prediction.resolved = true;
        prediction.occurred = occurred;
      }
    }
  }

  private statement(input: Omit<HistorianStatement, 'id' | 'sourceEventIds' | 'sourceEntityIds' | 'sourceArchiveIds' | 'claims'> & Partial<Pick<HistorianStatement, 'sourceEventIds' | 'sourceEntityIds' | 'sourceArchiveIds' | 'claims'>>): HistorianStatement {
    return { id: `historian-${this.statementSequence++}`, sourceEventIds: [], sourceEntityIds: [], sourceArchiveIds: [], claims: {}, ...input };
  }

  private candidate(id: string, subjectId: string, kind: ObservationKind, position: Vec2, title: string, statement: HistorianStatement, score: number, interest: number, audioCategory: AudioCategory): ObservationCandidate {
    const repetitionPenalty = clamp((this.shownSubjects.get(subjectId) ?? 0) * 0.08);
    return { id, subjectId, kind, position, title, statement, score: clamp(score - repetitionPenalty, 0.03, 1), interest, audioCategory, breakdown: { novelty: 0.5, magnitude: interest, populationAffected: 0, rarity: 0.5, technological: 0, political: 0, cultural: 0, consequence: 0, continuity: subjectId === this.lastSubjectId ? 0.3 : 0, repetitionPenalty } };
  }

  private fallback(state: SimulationState): ObservationCandidate {
    const population = representedPopulation(state);
    const statement = this.statement({ month: state.month, text: `The recorded population is ${population.toLocaleString()}.`, epistemicStatus: 'derived-statistic', sourceEntityIds: ['world', ...state.settlements.filter((settlement) => settlement.alive).map((settlement) => settlement.id)], claims: { population: { month: state.month, value: population } } });
    return this.candidate('world', 'world', 'world-establishing', this.populationCenter(state), 'The known world', statement, 0.5, 0.15, 'ambient-wilderness');
  }

  private knownEntityIds(state: SimulationState, month: number): Set<string> {
    if (month === this.knownIdsMonth) return this.knownIds;
    const ids = new Set<string>(['world']);
    for (const collection of [state.people, state.settlements, state.cultures, state.institutions, state.relations, state.tradeRoutes, state.wars, state.polities, state.advanced.institutions]) for (const entity of collection) ids.add(entity.id);
    for (const event of state.history) if (event.month <= month) for (const id of event.actors) ids.add(id);
    for (const cell of state.world.cells) ids.add(this.cellId(cell));
    for (const landmark of state.world.landmarks) ids.add(landmark.id);
    for (const settlement of state.settlements) for (const plot of settlement.structurePlots ?? []) if (plot.foundedMonth <= month && plot.development) ids.add(plot.id);
    this.knownIdsMonth = month;
    this.knownIds = ids;
    return ids;
  }

  private positionForActors(state: SimulationState, actors: readonly string[]): Vec2 {
    for (const id of actors) {
      const person = state.people.find((candidate) => candidate.id === id);
      if (person) return person.position;
      const settlement = state.settlements.find((candidate) => candidate.id === id);
      if (settlement) return settlement.position;
      const plot = state.settlements.flatMap(s => s.structurePlots ?? []).find(p => p.id === id);
      if (plot) return { x: plot.worldX, z: plot.worldZ };
      const institution = state.institutions.find((candidate) => candidate.id === id);
      const home = institution ? state.settlements.find((candidate) => candidate.id === institution.settlementId) : undefined;
      if (home) return home.position;
    }
    return this.populationCenter(state);
  }

  private populationCenter(state: SimulationState): Vec2 {
    const settlements = state.settlements.filter((settlement) => settlement.alive);
    if (settlements.length === 0) return { x: 0, z: 0 };
    const weights = settlements.map((settlement) => Math.max(1, settlementRepresentedPopulation(state, settlement.id)));
    const total = weights.reduce((sum, value) => sum + value, 0);
    return { x: settlements.reduce((sum, settlement, index) => sum + settlement.position.x * (weights[index] ?? 1), 0) / total, z: settlements.reduce((sum, settlement, index) => sum + settlement.position.z * (weights[index] ?? 1), 0) / total };
  }

  private cellId(cell: WorldCell): string { return `cell-${cell.x}-${cell.z}`; }
  private durationPhrase(months: number): string {
    const years = Math.max(0, Math.floor(months / 12));
    const generations = Math.floor(years / this.config.historicalPace.generationYears);
    if (years >= 100 && years % 100 <= 8) return `nearly ${Math.max(1, Math.round(years / 100))} ${Math.round(years / 100) === 1 ? 'century' : 'centuries'} (${years} years)`;
    if (generations >= 2) return `${years} years—about ${generations} generations`;
    if (generations === 1) return `${years} years—within one long generation`;
    return `${years} years`;
  }
  private relationRisk(relation: Relation): number { return clamp(relation.hostility * 0.46 + relation.grievances * 0.28 + relation.territorialTension * 0.26); }
  private matchesRelation(a: string, b: string, relation: Relation): boolean { return (a === relation.a && b === relation.b) || (a === relation.b && b === relation.a); }
  private ordinalSuffix(value: number): string { const mod100 = value % 100; if (mod100 >= 11 && mod100 <= 13) return 'th'; return value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th'; }
}
