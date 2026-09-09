import { Simulation } from '../Simulation';
import { stableHash } from '../prng';
import type { HistoricalEvent, Person, PersonRole, Settlement, SimulationState } from '../types';

export type LifeProjectKind =
  | 'secure-food-supply'
  | 'expand-trade'
  | 'preserve-knowledge'
  | 'systematic-inquiry'
  | 'medical-inquiry'
  | 'religious-reform'
  | 'found-institution'
  | 'political-reform'
  | 'engineering-improvement'
  | 'exploration'
  | 'industrial-invention'
  | 'scientific-research'
  | 'public-health'
  | 'electrical-systems'
  | 'computation'
  | 'spaceflight'
  | 'machine-intelligence';

export type LifeProjectStatus = 'active' | 'stalled' | 'completed' | 'abandoned';
export type LifeProjectEra = 'settlement' | 'recorded' | 'scholarly' | 'commercial' | 'industrial' | 'modern' | 'atomic' | 'information' | 'space';

export interface LifeProject {
  id: string;
  personId: string;
  kind: LifeProjectKind;
  title: string;
  purpose: string;
  settlementId: string;
  startedMonth: number;
  lastAdvancedMonth: number;
  status: LifeProjectStatus;
  eraAtStart: LifeProjectEra;
  conceptualDistance: number;
  effort: number;
  support: number;
  resistance: number;
  institutionId?: string;
  relatedEventIds: string[];
  completedMonth?: number;
  outcome?: string;
}

interface Candidate {
  kind: LifeProjectKind;
  title: string;
  purpose: string;
  score: number;
  conceptualDistance: number;
}

const projectByPerson = new WeakMap<Person, LifeProject>();
const directors = new WeakMap<Simulation, LifeProjectDirector>();
let installed = false;

export function lifeProjectForPerson(person: Person): LifeProject | undefined {
  return projectByPerson.get(person);
}

export function describeLifeProject(person: Person, state: SimulationState): string | undefined {
  const project = lifeProjectForPerson(person);
  if (!project) return undefined;
  const place = state.settlements.find((settlement) => settlement.id === project.settlementId)?.name ?? 'their community';
  if (project.status === 'completed') return `${person.name} is remembered for ${project.purpose}.`;
  if (project.status === 'abandoned') return `${person.name} once pursued ${project.purpose}, but the work did not endure.`;
  if (project.status === 'stalled') return `${person.name} has spent years pursuing ${project.purpose}, but the work has stalled in ${place}.`;
  return `${person.name} is pursuing a long-term project: ${project.purpose}.`;
}

export function eraForState(state: SimulationState, settlement?: Settlement): LifeProjectEra {
  const local = settlement ?? state.settlements.find((candidate) => candidate.alive);
  const advanced = state.advanced;
  if (advanced?.space?.selfSustainingBodies >= 1 || advanced?.space?.orbitalCapability >= 0.55) return 'space';
  if (advanced?.machine?.capability >= 0.35 || (local?.knowledge.records['computation']?.practice ?? 0) >= 0.42) return 'information';
  if (advanced?.atomic?.thresholdMonth !== undefined) return 'atomic';
  if ((local?.knowledge.records['electrical-generation']?.practice ?? 0) >= 0.35 || (local?.industry.intensity ?? 0) >= 0.62) return 'modern';
  if (local?.industry.active) return 'industrial';
  if ((local?.knowledge.records['printing']?.practice ?? 0) >= 0.28 || (local?.infrastructure.ports ?? 0) >= 0.3 || (local?.infrastructure.roads ?? 0) >= 0.4) return 'commercial';
  if ((local?.knowledge.literacy ?? 0) >= 0.28 && local?.institutionIds.length) return 'scholarly';
  if (local?.knowledge.records['durable-records']) return 'recorded';
  return 'settlement';
}

/**
 * Presentation/history interpretation layer for persistent human ambitions.
 *
 * Projects do not directly award discoveries, create institutions, change resources or alter
 * simulation probabilities. They interpret conditions a person could plausibly notice in their
 * era, accumulate an effort record, and only claim success when authoritative history supplies
 * evidence attributable to that person. This lets people have biographies without creating a
 * second simulation hidden inside the presentation layer.
 */
export class LifeProjectDirector {
  private readonly known = new Map<string, LifeProject>();
  private nextEvaluationMonth = 0;
  private lastHistoryLength = 0;

  constructor(private readonly stateIdentity: SimulationState) {
    this.lastHistoryLength = stateIdentity.history.length;
  }

  matches(state: SimulationState): boolean {
    return state === this.stateIdentity;
  }

  advance(state: SimulationState): void {
    this.resolveEvidence(state);
    this.prune(state);
    this.advanceExisting(state);
    if (state.month < this.nextEvaluationMonth) return;
    this.nextEvaluationMonth = state.month + 12;
    this.assignProjects(state);
  }

  private assignProjects(state: SimulationState): void {
    const living = state.people.filter((person) => person.alive && person.ageMonths >= 18 * 12 && person.ageMonths <= 72 * 12);
    const budget = Math.max(3, Math.min(24, Math.round(living.length / 42)));
    const activeCount = [...this.known.values()].filter((project) => project.status === 'active' || project.status === 'stalled').length;
    if (activeCount >= budget) return;

    const unassigned = living
      .filter((person) => !projectByPerson.has(person))
      .map((person) => ({ person, candidate: this.bestCandidate(person, state) }))
      .filter((entry): entry is { person: Person; candidate: Candidate } => Boolean(entry.candidate))
      .sort((a, b) => b.candidate.score - a.candidate.score || a.person.id.localeCompare(b.person.id));

    let remaining = budget - activeCount;
    for (const { person, candidate } of unassigned) {
      if (remaining <= 0 || candidate.score < 0.67) break;
      const project: LifeProject = {
        id: `life-project:${candidate.kind}:${person.id}:${state.month}`,
        personId: person.id,
        kind: candidate.kind,
        title: candidate.title,
        purpose: candidate.purpose,
        settlementId: person.homeId,
        startedMonth: state.month,
        lastAdvancedMonth: state.month,
        status: 'active',
        eraAtStart: eraForState(state, this.settlement(state, person.homeId)),
        conceptualDistance: candidate.conceptualDistance,
        effort: 0,
        support: this.support(person, state),
        resistance: this.resistance(person, state, candidate),
        ...(person.institutionId ? { institutionId: person.institutionId } : {}),
        relatedEventIds: [],
      };
      projectByPerson.set(person, project);
      this.known.set(project.id, project);
      remaining -= 1;
    }
  }

  private advanceExisting(state: SimulationState): void {
    for (const project of this.known.values()) {
      if (project.status !== 'active' && project.status !== 'stalled') continue;
      const person = state.people.find((candidate) => candidate.id === project.personId);
      if (!person?.alive) {
        project.status = 'abandoned';
        project.outcome = 'the project ended with the death of its originator';
        continue;
      }
      const elapsed = Math.max(0, state.month - project.lastAdvancedMonth);
      if (elapsed <= 0) continue;
      const support = this.support(person, state);
      const resistance = this.resistance(person, state, {
        kind: project.kind, title: project.title, purpose: project.purpose, score: 0, conceptualDistance: project.conceptualDistance,
      });
      project.support = support;
      project.resistance = resistance;
      const aptitude = this.aptitude(person, project.kind);
      const gainPerYear = Math.max(0.005, aptitude * 0.11 + support * 0.08 - resistance * 0.07 - project.conceptualDistance * 0.035);
      project.effort = Math.min(1, project.effort + gainPerYear * elapsed / 12);
      project.lastAdvancedMonth = state.month;
      project.status = resistance > support + 0.38 && project.effort > 0.18 ? 'stalled' : 'active';
      if (project.status === 'stalled' && support > resistance - 0.08) project.status = 'active';
    }
  }

  private resolveEvidence(state: SimulationState): void {
    const newEvents = state.history.slice(this.lastHistoryLength);
    this.lastHistoryLength = state.history.length;
    if (!newEvents.length) return;

    for (const event of newEvents) {
      const attributedPersonId = typeof event.context?.attributedPersonId === 'string' ? event.context.attributedPersonId : undefined;
      const personIds = new Set([...(event.actors ?? []), ...(attributedPersonId ? [attributedPersonId] : [])]);
      for (const personId of personIds) {
        const person = state.people.find((candidate) => candidate.id === personId);
        const project = person ? projectByPerson.get(person) : undefined;
        if (!project || (project.status !== 'active' && project.status !== 'stalled')) continue;
        if (!this.eventSupportsProject(event, project)) continue;
        project.relatedEventIds = [...new Set([...project.relatedEventIds, event.id])];
        project.effort = Math.min(1, project.effort + 0.22 + event.significance * 0.18);
        if (this.isCompletionEvent(event, project)) {
          project.status = 'completed';
          project.completedMonth = state.month;
          project.outcome = event.summary;
        }
      }
    }
  }

  private eventSupportsProject(event: HistoricalEvent, project: LifeProject): boolean {
    const types = new Set(event.types ?? [event.type]);
    switch (project.kind) {
      case 'systematic-inquiry':
      case 'scientific-research':
      case 'medical-inquiry':
      case 'industrial-invention':
      case 'electrical-systems':
      case 'computation':
      case 'spaceflight':
      case 'machine-intelligence':
        return [...types].some((type) => ['discovery', 'knowledge-adopted', 'technology-transformation', 'industrialization', 'atomic-threshold', 'first-orbit', 'machine-intelligence-transition', 'interplanetary-transition'].includes(type));
      case 'preserve-knowledge': return [...types].some((type) => ['knowledge-rediscovered', 'knowledge-adopted', 'infrastructure-built'].includes(type));
      case 'found-institution':
      case 'religious-reform':
      case 'political-reform': return [...types].some((type) => ['institution-formed', 'political-transition', 'cultural-shift', 'alliance-formed'].includes(type));
      case 'expand-trade': return [...types].some((type) => ['infrastructure-built', 'knowledge-exchange', 'first-contact'].includes(type));
      case 'engineering-improvement': return [...types].some((type) => ['infrastructure-built', 'technology-transformation', 'industrialization-stage'].includes(type));
      case 'public-health': return [...types].some((type) => ['discovery', 'knowledge-adopted', 'nuclear-medicine'].includes(type));
      case 'exploration': return [...types].some((type) => ['first-contact', 'major-migration', 'first-orbit', 'offworld-settlement'].includes(type));
      case 'secure-food-supply': return [...types].some((type) => ['recovery', 'discovery', 'knowledge-adopted', 'infrastructure-built'].includes(type));
    }
  }

  private isCompletionEvent(event: HistoricalEvent, project: LifeProject): boolean {
    if (event.significance < 0.58) return false;
    if (['discovery', 'technology-transformation', 'institution-formed', 'political-transition', 'industrialization', 'atomic-threshold', 'first-orbit', 'offworld-settlement', 'machine-intelligence-transition'].includes(event.type)) return true;
    return project.effort >= 0.76 && event.significance >= 0.68;
  }

  private prune(state: SimulationState): void {
    for (const [id, project] of this.known) {
      const person = state.people.find((candidate) => candidate.id === project.personId);
      if (person?.alive) continue;
      if (project.status === 'active' || project.status === 'stalled') {
        project.status = 'abandoned';
        project.outcome = 'the originator died before the project produced a recorded result';
      }
      if (state.month - (project.completedMonth ?? project.lastAdvancedMonth) > 1200) this.known.delete(id);
    }
  }

  private bestCandidate(person: Person, state: SimulationState): Candidate | undefined {
    const settlement = this.settlement(state, person.homeId);
    if (!settlement) return undefined;
    const era = eraForState(state, settlement);
    const role = person.role ?? this.roleFromOccupation(person);
    const options: Candidate[] = [];
    const add = (kind: LifeProjectKind, title: string, purpose: string, base: number, distance = 0.1): void => {
      const score = base + this.aptitude(person, kind) * 0.32 + this.support(person, state) * 0.12
        - this.resistance(person, state, { kind, title, purpose, score: 0, conceptualDistance: distance }) * 0.08
        + stableHash(`${state.seed}:life-project:${kind}:${person.id}`, state.month, 0) * 0.045;
      options.push({ kind, title, purpose, score, conceptualDistance: distance });
    };

    if (settlement.foodSecurity < 0.58 && ['farmer', 'gatherer', 'hunter', 'healer', 'administrator'].includes(role))
      add('secure-food-supply', 'Secure the food supply', `finding a more reliable way for ${settlement.name} to survive poor harvests`, 0.48, 0.05);
    if (state.tradeRoutes.some((route) => route.active && (route.a === settlement.id || route.b === settlement.id)) && ['merchant', 'trader', 'transporter', 'administrator'].includes(role))
      add('expand-trade', 'Expand exchange', `building stronger and more dependable exchange beyond ${settlement.name}`, 0.47, 0.05);
    if (settlement.knowledge.records['durable-records'] && ['scholar', 'priest', 'administrator', 'researcher'].includes(role))
      add('preserve-knowledge', 'Preserve the record', `preserving knowledge so it can outlive the people who currently hold it`, 0.5, 0.08);
    if (['recorded', 'scholarly', 'commercial', 'industrial', 'modern', 'atomic', 'information', 'space'].includes(era) && ['scholar', 'priest', 'healer', 'researcher', 'scientist'].includes(role))
      add('systematic-inquiry', 'Investigate a persistent question', `using repeated observation to understand a problem their society does not yet fully explain`, 0.49, era === 'recorded' ? 0.24 : 0.12);
    if (['healer', 'medical-worker', 'researcher', 'scientist'].includes(role) && era !== 'settlement')
      add('medical-inquiry', 'Understand illness', `comparing illness and treatment outcomes to find patterns that can improve survival`, 0.5, era === 'recorded' ? 0.22 : 0.1);
    if (['priest', 'ritual-specialist'].includes(role) && settlement.institutionIds.length > 0)
      add('religious-reform', 'Reform religious practice', `arguing that inherited religious practice should change in response to conditions in ${settlement.name}`, 0.45 + settlement.climateStress * 0.12 + settlement.conflictPressure * 0.1, 0.18);
    if (['administrator', 'priest', 'merchant', 'scholar'].includes(role) && settlement.institutionIds.length > 0)
      add('found-institution', 'Build a durable institution', `organizing people around a durable institution that can survive its founders`, 0.43 + person.traits.cooperation * 0.08, 0.14);
    if (['administrator', 'manager', 'priest', 'scholar'].includes(role) && ['scholarly', 'commercial', 'industrial', 'modern', 'atomic', 'information', 'space'].includes(era))
      add('political-reform', 'Reform political organization', `changing how authority and obligations are organized in ${settlement.name}`, 0.42 + settlement.conflictPressure * 0.12, 0.2);
    if (['builder', 'craft-worker', 'engineer', 'machinist', 'researcher'].includes(role))
      add('engineering-improvement', 'Improve a practical system', `developing a more reliable tool, structure, or transport method from techniques already available`, 0.47, 0.1);
    if (state.settlements.length > 1 && ['merchant', 'trader', 'sailor', 'scholar', 'administrator'].includes(role))
      add('exploration', 'Explore beyond familiar routes', `learning what lies beyond the routes and settlements already familiar to their community`, 0.4 + person.traits.riskTolerance * 0.09, 0.12);
    if (['industrial', 'modern', 'atomic', 'information', 'space'].includes(era) && ['engineer', 'machinist', 'scientist', 'researcher'].includes(role))
      add('industrial-invention', 'Develop a new machine or process', `turning accumulated practical knowledge into a more capable machine or production process`, 0.5, 0.12);
    if (['modern', 'atomic', 'information', 'space'].includes(era) && ['scientist', 'researcher', 'engineer'].includes(role))
      add('scientific-research', 'Pursue formal research', `testing a difficult question at the edge of their society's established knowledge`, 0.53, 0.17);
    if (['modern', 'atomic', 'information', 'space'].includes(era) && ['medical-worker', 'healer', 'administrator', 'researcher'].includes(role))
      add('public-health', 'Improve public health', `organizing knowledge and institutions to prevent illness across whole communities`, 0.49, 0.13);
    if (['modern', 'atomic', 'information', 'space'].includes(era) && ['engineer', 'energy-technician', 'scientist', 'researcher'].includes(role))
      add('electrical-systems', 'Extend electrical systems', `making electrical generation and distribution more useful and dependable`, 0.48, 0.11);
    if (['information', 'space'].includes(era) && ['scientist', 'researcher', 'machine-systems-specialist', 'engineer'].includes(role))
      add('computation', 'Advance computation', `using machines to represent, calculate, and reason about information at greater scale`, 0.54, 0.14);
    if (era === 'space' && ['space-worker', 'scientist', 'engineer', 'researcher'].includes(role))
      add('spaceflight', 'Extend civilization beyond the ground', `making sustained activity beyond the home world more practical`, 0.55, 0.16);
    if (['information', 'space'].includes(era) && ['machine-systems-specialist', 'scientist', 'researcher'].includes(role))
      add('machine-intelligence', 'Study machine intelligence', `testing whether increasingly capable machines can perform reasoning once limited to people`, 0.53, 0.2);

    return options.sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind))[0];
  }

  private aptitude(person: Person, kind: LifeProjectKind): number {
    const t = person.traits;
    switch (kind) {
      case 'scientific-research':
      case 'systematic-inquiry':
      case 'medical-inquiry':
      case 'computation':
      case 'machine-intelligence': return t.curiosity * 0.42 + t.conscientiousness * 0.26 + t.patience * 0.18 + t.riskTolerance * 0.08;
      case 'religious-reform': return t.sociability * 0.24 + t.empathy * 0.2 + (1 - t.conformity) * 0.28 + t.courage * 0.16;
      case 'found-institution': return t.cooperation * 0.28 + t.sociability * 0.22 + t.ambition * 0.2 + t.conscientiousness * 0.18;
      case 'political-reform': return t.ambition * 0.24 + t.sociability * 0.22 + t.courage * 0.18 + (1 - t.conformity) * 0.2;
      case 'expand-trade': return t.sociability * 0.28 + t.riskTolerance * 0.22 + t.cooperation * 0.22 + t.ambition * 0.14;
      case 'exploration': return t.curiosity * 0.32 + t.riskTolerance * 0.3 + t.courage * 0.2;
      case 'engineering-improvement':
      case 'industrial-invention':
      case 'electrical-systems':
      case 'spaceflight': return t.curiosity * 0.27 + t.conscientiousness * 0.28 + t.patience * 0.18 + t.riskTolerance * 0.13;
      case 'public-health': return t.empathy * 0.26 + t.cooperation * 0.22 + t.conscientiousness * 0.22 + t.curiosity * 0.16;
      case 'preserve-knowledge': return t.conscientiousness * 0.3 + t.patience * 0.22 + t.cooperation * 0.18 + t.curiosity * 0.14;
      case 'secure-food-supply': return t.conscientiousness * 0.26 + t.patience * 0.22 + t.cooperation * 0.18 + t.curiosity * 0.14;
    }
  }

  private support(person: Person, state: SimulationState): number {
    const settlement = this.settlement(state, person.homeId);
    if (!settlement) return 0;
    const institution = person.institutionId ? state.institutions.find((candidate) => candidate.id === person.institutionId) : undefined;
    return Math.min(1,
      (person.socialPosition?.educationAccess ?? 0.2) * 0.18
      + (person.socialPosition?.resourceAccess ?? 0.2) * 0.12
      + (person.influence?.network ?? 0.2) * 0.12
      + person.prestige * 0.12
      + settlement.prosperity * 0.14
      + settlement.knowledge.literacy * 0.14
      + (institution?.support ?? 0) * 0.1
      + (institution?.prestige ?? 0) * 0.08);
  }

  private resistance(person: Person, state: SimulationState, candidate: Candidate): number {
    const settlement = this.settlement(state, person.homeId);
    if (!settlement) return 1;
    const social = person.socialPosition;
    const scarcity = (1 - settlement.foodSecurity) * 0.28 + Math.max(0, 0.45 - settlement.prosperity) * 0.22;
    const danger = settlement.conflictPressure * 0.2 + settlement.climateStress * 0.12;
    const access = (1 - (social?.educationAccess ?? 0.2)) * 0.08 + (1 - (social?.resourceAccess ?? 0.2)) * 0.06;
    return Math.min(1, scarcity + danger + access + candidate.conceptualDistance * 0.2);
  }

  private roleFromOccupation(person: Person): PersonRole {
    if (person.occupation === 'farmer') return 'farmer';
    if (person.occupation === 'forager') return 'gatherer';
    if (person.occupation === 'builder') return 'builder';
    if (person.occupation === 'artisan') return 'craft-worker';
    if (person.occupation === 'carrier') return 'transporter';
    if (person.occupation === 'elder') return 'elder';
    if (person.occupation === 'child') return 'child';
    return 'administrator';
  }

  private settlement(state: SimulationState, id: string): Settlement | undefined {
    return state.settlements.find((candidate) => candidate.id === id && candidate.alive);
  }
}

export function installLifeProjects(): void {
  if (installed) return;
  installed = true;

  const originalStep = Simulation.prototype.step;
  Simulation.prototype.step = function lifeProjectAwareStep(months = 1): void {
    const count = Math.max(0, Math.floor(months));
    let director = directors.get(this);
    if (!director || !director.matches(this.state)) {
      director = new LifeProjectDirector(this.state);
      directors.set(this, director);
    }
    for (let index = 0; index < count; index += 1) {
      originalStep.call(this, 1);
      if (!director.matches(this.state)) {
        director = new LifeProjectDirector(this.state);
        directors.set(this, director);
      }
      director.advance(this.state);
    }
  };
}
