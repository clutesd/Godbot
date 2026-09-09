import { Simulation } from '../Simulation';
import { stableHash } from '../prng';
import type { Activity, Person, PersonNavigation, PersonRole, Relation, Settlement, SimulationState, TradeRoute, Vec2, War } from '../types';
import { WalkabilityLayer } from './WalkabilityLayer';

export type PersonMissionKind = 'trade-delegation' | 'diplomatic-envoy' | 'knowledge-exchange' | 'military-service';
export type PersonMissionStage = 'outbound' | 'visiting' | 'returning' | 'completed' | 'aborted';

export interface PersonMission {
  id: string;
  kind: PersonMissionKind;
  personId: string;
  originId: string;
  targetId: string;
  sponsorId?: string;
  relatedId?: string;
  startedMonth: number;
  stage: PersonMissionStage;
  purpose: string;
  stayUntilMonth?: number;
  completedMonth?: number;
  outcome?: string;
}

interface PersonPresentationSnapshot {
  position: Vec2;
  target: Vec2;
  activity: Activity;
  navigation?: PersonNavigation;
}

interface MissionJourney {
  stage: 'outbound' | 'returning';
  position: Vec2;
  waypoints: Vec2[];
  waypointIndex: number;
}

interface ActiveMission {
  person: Person;
  mission: PersonMission;
  baseline?: PersonPresentationSnapshot;
  journey?: MissionJourney;
  visitPosition?: Vec2;
}

const missionByPerson = new WeakMap<Person, PersonMission>();
const directors = new WeakMap<Simulation, PersonMissionDirector>();
let installed = false;

const terminal = (mission: PersonMission): boolean => mission.stage === 'completed' || mission.stage === 'aborted';
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
const cloneVec = (value: Vec2): Vec2 => ({ x: value.x, z: value.z });

function cloneNavigation(navigation?: PersonNavigation): PersonNavigation | undefined {
  return navigation ? { ...navigation, waypoints: navigation.waypoints.map(cloneVec) } : undefined;
}

function snapshot(person: Person): PersonPresentationSnapshot {
  return {
    position: cloneVec(person.position),
    target: cloneVec(person.target),
    activity: person.activity,
    navigation: cloneNavigation(person.navigation),
  };
}

function restore(person: Person, baseline: PersonPresentationSnapshot): void {
  person.position = cloneVec(baseline.position);
  person.target = cloneVec(baseline.target);
  person.activity = baseline.activity;
  person.navigation = cloneNavigation(baseline.navigation);
}

export function missionForPerson(person: Person): PersonMission | undefined {
  return missionByPerson.get(person);
}

export function describeMission(person: Person, state: SimulationState): string | undefined {
  const mission = missionForPerson(person);
  if (!mission) return undefined;
  const origin = state.settlements.find((settlement) => settlement.id === mission.originId)?.name ?? 'their home';
  const target = state.settlements.find((settlement) => settlement.id === mission.targetId)?.name ?? 'another settlement';
  if (mission.stage === 'returning') return `${person.name} is returning to ${origin} after ${mission.purpose}.`;
  if (mission.stage === 'visiting') return `${person.name} is in ${target}, ${mission.purpose}.`;
  if (mission.stage === 'completed') return `${person.name} recently returned to ${origin} after ${mission.purpose}.`;
  if (mission.stage === 'aborted') return `${person.name}'s journey toward ${target} ended before its purpose could be completed.`;
  return `${person.name} is traveling from ${origin} to ${target}, ${mission.purpose}.`;
}

/**
 * Selects a small number of representative people to embody movements the authoritative
 * settlement/polity simulation already understands. Mission movement is a presentation overlay:
 * before every simulation month, the person's ordinary position/activity/navigation are restored;
 * after the month resolves, the mission position is reapplied for the renderer and Historian.
 * This keeps aggregate history identical while making its meaning visible through people.
 */
export class PersonMissionDirector {
  private readonly active = new Map<string, ActiveMission>();
  private readonly walkability: WalkabilityLayer;
  private nextCivilEvaluationMonth = 0;

  constructor(private readonly stateIdentity: SimulationState) {
    this.walkability = new WalkabilityLayer(stateIdentity.world);
  }

  matches(state: SimulationState): boolean {
    return state === this.stateIdentity;
  }

  beforeMonth(state: SimulationState): void {
    this.restoreAuthoritativePresentation();
    this.prune(state);
    this.updateStages(state);

    const budget = this.missionBudget(state);
    if (this.active.size >= budget) return;
    this.assignMilitaryMissions(state, budget);
    if (state.month < this.nextCivilEvaluationMonth || this.active.size >= budget) return;
    this.nextCivilEvaluationMonth = state.month + 6;
    this.assignTradeMissions(state, budget);
    this.assignDiplomaticMissions(state, budget);
    this.assignKnowledgeMissions(state, budget);
  }

  afterMonth(state: SimulationState): void {
    for (const entry of this.active.values()) {
      const { person, mission } = entry;
      if (!person.alive || !state.people.includes(person)) continue;
      entry.baseline = snapshot(person);
      if (terminal(mission)) continue;
      this.advanceMission(entry, state);
      this.applyMissionOverlay(entry, state);
    }
  }

  private restoreAuthoritativePresentation(): void {
    for (const entry of this.active.values()) {
      if (!entry.baseline || !entry.person.alive) continue;
      restore(entry.person, entry.baseline);
      entry.baseline = undefined;
    }
  }

  private prune(state: SimulationState): void {
    for (const [id, entry] of this.active) {
      const { person, mission } = entry;
      if (!person.alive && !terminal(mission)) {
        mission.stage = 'aborted';
        mission.completedMonth = state.month;
        mission.outcome = 'the traveler died before returning';
      }
      if (terminal(mission) && state.month - (mission.completedMonth ?? mission.startedMonth) >= 3) {
        missionByPerson.delete(person);
        this.active.delete(id);
      }
    }
  }

  private updateStages(state: SimulationState): void {
    for (const entry of this.active.values()) {
      const { mission } = entry;
      if (terminal(mission)) continue;
      if (mission.kind === 'military-service') {
        const war = state.wars.find((candidate) => candidate.id === mission.relatedId);
        if (!war?.active && mission.stage !== 'returning') {
          mission.stage = 'returning';
          entry.journey = undefined;
        }
      }
      if (mission.stage === 'visiting' && state.month >= (mission.stayUntilMonth ?? state.month)) {
        mission.stage = 'returning';
        entry.journey = undefined;
      }
    }
  }

  private advanceMission(entry: ActiveMission, state: SimulationState): void {
    const { mission, person } = entry;
    if (mission.stage === 'visiting') return;
    if (mission.stage !== 'outbound' && mission.stage !== 'returning') return;

    const destinationId = mission.stage === 'returning' ? mission.originId : mission.targetId;
    const destination = this.settlement(state, destinationId);
    if (!destination) {
      mission.stage = 'aborted';
      mission.completedMonth = state.month;
      mission.outcome = 'destination no longer existed';
      entry.journey = undefined;
      return;
    }

    if (!entry.journey || entry.journey.stage !== mission.stage) {
      const start = mission.stage === 'returning'
        ? cloneVec(entry.visitPosition ?? this.settlement(state, mission.targetId)?.position ?? person.position)
        : cloneVec(person.position);
      const endpoint = this.walkability.nearestWalkable(destination.position, `${mission.id}:${destination.id}`);
      if (distance(start, endpoint) <= 0.05) {
        this.finishLeg(entry, state, endpoint);
        return;
      }
      const waypoints = this.walkability.route(start, endpoint, [], 'walk');
      if (!waypoints.length) {
        mission.stage = 'aborted';
        mission.completedMonth = state.month;
        mission.outcome = `no safe route to ${destination.name}`;
        return;
      }
      entry.journey = { stage: mission.stage, position: start, waypoints: waypoints.map(cloneVec), waypointIndex: 0 };
    }

    const journey = entry.journey;
    if (!journey) return;
    let remainingStep = 2 + person.traits.conscientiousness * 0.5;
    while (remainingStep > 0.001) {
      const waypoint = journey.waypoints[journey.waypointIndex];
      if (!waypoint) {
        this.finishLeg(entry, state, journey.position);
        return;
      }
      const remaining = distance(journey.position, waypoint);
      const multiplier = this.walkability.travelMultiplier(waypoint);
      const available = remainingStep / Math.max(0.5, multiplier);
      if (remaining <= available) {
        journey.position = cloneVec(waypoint);
        remainingStep -= remaining * Math.max(0.5, multiplier);
        journey.waypointIndex += 1;
        if (journey.waypointIndex >= journey.waypoints.length) {
          this.finishLeg(entry, state, journey.position);
          return;
        }
      } else {
        journey.position = {
          x: journey.position.x + (waypoint.x - journey.position.x) / remaining * available,
          z: journey.position.z + (waypoint.z - journey.position.z) / remaining * available,
        };
        remainingStep = 0;
      }
    }
  }

  private finishLeg(entry: ActiveMission, state: SimulationState, position: Vec2): void {
    const { mission } = entry;
    if (mission.stage === 'outbound') {
      mission.stage = 'visiting';
      mission.stayUntilMonth = state.month + this.visitDuration(mission);
      entry.visitPosition = cloneVec(position);
      entry.journey = undefined;
      return;
    }
    if (mission.stage === 'returning') {
      const origin = this.settlement(state, mission.originId);
      mission.stage = 'completed';
      mission.completedMonth = state.month;
      mission.outcome = origin ? `returned to ${origin.name}` : 'returned home';
      entry.journey = undefined;
      entry.visitPosition = undefined;
    }
  }

  private applyMissionOverlay(entry: ActiveMission, state: SimulationState): void {
    const { person, mission } = entry;
    if (terminal(mission)) return;

    if (mission.stage === 'visiting') {
      const position = cloneVec(entry.visitPosition ?? this.settlement(state, mission.targetId)?.position ?? person.position);
      person.position = position;
      person.target = cloneVec(position);
      person.activity = this.visitActivity(mission);
      person.navigation = {
        destinationKind: this.destinationKind(mission),
        destinationId: `${mission.id}:visit`,
        reason: `mission: ${mission.purpose}`,
        waypoints: [], waypointIndex: 0, schedulePhase: 'social', traveling: false, crossingMode: 'walk',
      };
      return;
    }

    const journey = entry.journey;
    if (!journey) return;
    const next = journey.waypoints[journey.waypointIndex] ?? journey.position;
    person.position = cloneVec(journey.position);
    person.target = cloneVec(next);
    person.activity = 'travel';
    person.navigation = {
      destinationKind: this.destinationKind(mission),
      destinationId: `${mission.id}:${mission.stage}`,
      reason: mission.stage === 'returning'
        ? `mission: returning home after ${mission.purpose}`
        : `mission: ${mission.purpose}`,
      waypoints: journey.waypoints.map(cloneVec),
      waypointIndex: journey.waypointIndex,
      schedulePhase: 'emergency',
      traveling: true,
      crossingMode: 'walk',
    };
  }

  private assignMilitaryMissions(state: SimulationState, budget: number): void {
    for (const war of state.wars.filter((candidate) => candidate.active)) {
      if (this.active.size >= budget) return;
      this.assignMilitarySide(state, war, war.attacker, war.defender, budget);
      if (this.active.size >= budget) return;
      this.assignMilitarySide(state, war, war.defender, war.attacker, budget);
    }
  }

  private assignMilitarySide(state: SimulationState, war: War, originId: string, targetId: string, budget: number): void {
    if (this.active.size >= budget || this.hasMission('military-service', war.id, originId)) return;
    const origin = this.settlement(state, originId);
    const target = this.settlement(state, targetId);
    if (!origin || !target) return;
    const person = this.pickPerson(state, origin.id, ['soldier', 'guard'], `${war.id}:${origin.id}:military`, (candidate) =>
      candidate.traits.courage * 0.34 + candidate.traits.aggression * 0.2 + candidate.traits.loyalty * 0.18 + candidate.prestige * 0.12);
    if (!person) return;
    this.startMission(state, person, {
      kind: 'military-service', originId: origin.id, targetId: target.id,
      sponsorId: origin.polityId, relatedId: war.id,
      purpose: `serving with ${origin.name}'s forces during the ${war.cause.replaceAll('-', ' ')}`,
    });
  }

  private assignTradeMissions(state: SimulationState, budget: number): void {
    const routes = state.tradeRoutes.filter((route) => route.active && route.mode === 'land')
      .sort((a, b) => b.volume - a.volume || a.id.localeCompare(b.id));
    for (const route of routes) {
      if (this.active.size >= budget) return;
      const direction = this.tradeDirection(route);
      const origin = this.settlement(state, direction.origin);
      const target = this.settlement(state, direction.target);
      if (!origin || !target || this.hasMission('trade-delegation', route.id, origin.id)) continue;
      const person = this.pickPerson(state, origin.id, ['merchant', 'trader', 'transporter', 'dock-worker'], `${route.id}:trade`, (candidate) =>
        candidate.traits.sociability * 0.25 + candidate.traits.cooperation * 0.2 + candidate.traits.riskTolerance * 0.16 + candidate.prestige * 0.12);
      if (!person) continue;
      this.startMission(state, person, {
        kind: 'trade-delegation', originId: origin.id, targetId: target.id,
        sponsorId: origin.polityId, relatedId: route.id,
        purpose: `carrying exchange and representing ${origin.name}'s traders in ${target.name}`,
      });
    }
  }

  private assignDiplomaticMissions(state: SimulationState, budget: number): void {
    const relations = [...state.relations]
      .filter((relation) => relation.contact && !state.wars.some((war) => war.active && this.warMatchesRelation(war, relation)))
      .sort((a, b) => (b.allied ? 1 : 0) - (a.allied ? 1 : 0) || b.trust - a.trust || a.id.localeCompare(b.id));
    for (const relation of relations) {
      if (this.active.size >= budget) return;
      const origin = this.settlement(state, relation.a);
      const target = this.settlement(state, relation.b);
      if (!origin || !target || this.hasMission('diplomatic-envoy', relation.id, origin.id)) continue;
      if (!relation.allied && relation.trust < 0.52 && relation.hostility > 0.38) continue;
      const person = this.pickPerson(state, origin.id, ['administrator', 'priest', 'merchant', 'ritual-specialist'], `${relation.id}:envoy`, (candidate) =>
        candidate.traits.sociability * 0.28 + candidate.traits.cooperation * 0.24 + candidate.traits.patience * 0.16 + candidate.prestige * 0.18);
      if (!person) continue;
      const purpose = relation.allied
        ? `carrying messages between allied communities and tending the relationship with ${target.name}`
        : `meeting leaders in ${target.name} to preserve a workable relationship`;
      this.startMission(state, person, {
        kind: 'diplomatic-envoy', originId: origin.id, targetId: target.id,
        sponsorId: origin.polityId, relatedId: relation.id, purpose,
      });
    }
  }

  private assignKnowledgeMissions(state: SimulationState, budget: number): void {
    for (const route of state.tradeRoutes.filter((candidate) => candidate.active && candidate.mode === 'land')) {
      if (this.active.size >= budget) return;
      const a = this.settlement(state, route.a);
      const b = this.settlement(state, route.b);
      if (!a || !b) continue;
      const knowledgeA = Object.keys(a.knowledge.records).length + a.knowledge.literacy * 8;
      const knowledgeB = Object.keys(b.knowledge.records).length + b.knowledge.literacy * 8;
      if (Math.abs(knowledgeA - knowledgeB) < 2) continue;
      const origin = knowledgeA > knowledgeB ? a : b;
      const target = knowledgeA > knowledgeB ? b : a;
      if (this.hasMission('knowledge-exchange', route.id, origin.id)) continue;
      const person = this.pickPerson(state, origin.id, ['scholar', 'researcher', 'scientist', 'administrator'], `${route.id}:knowledge`, (candidate) =>
        candidate.traits.curiosity * 0.34 + candidate.traits.cooperation * 0.2 + candidate.traits.conscientiousness * 0.15 + candidate.prestige * 0.12);
      if (!person) continue;
      this.startMission(state, person, {
        kind: 'knowledge-exchange', originId: origin.id, targetId: target.id,
        sponsorId: person.institutionId ?? origin.polityId, relatedId: route.id,
        purpose: `bringing knowledge from ${origin.name} to colleagues in ${target.name}`,
      });
    }
  }

  private pickPerson(
    state: SimulationState,
    homeId: string,
    preferredRoles: PersonRole[],
    seed: string,
    score: (person: Person) => number,
  ): Person | undefined {
    return state.people
      .filter((person) => person.alive && person.homeId === homeId && !missionByPerson.has(person)
        && person.ageMonths >= 18 * 12 && person.ageMonths <= 67 * 12 && person.health > 0.55 && person.energy > 0.3)
      .map((person) => ({
        person,
        score: score(person) + (preferredRoles.includes(person.role ?? 'gatherer') ? 0.55 : 0)
          + stableHash(`${state.seed}:${seed}:${person.id}`, state.month, 0) * 0.08,
      }))
      .sort((a, b) => b.score - a.score || a.person.id.localeCompare(b.person.id))[0]?.person;
  }

  private startMission(
    state: SimulationState,
    person: Person,
    input: Omit<PersonMission, 'id' | 'personId' | 'startedMonth' | 'stage'>,
  ): void {
    const mission: PersonMission = {
      ...input,
      id: `mission:${input.kind}:${input.relatedId ?? `${input.originId}:${input.targetId}`}:${person.id}:${state.month}`,
      personId: person.id,
      startedMonth: state.month,
      stage: 'outbound',
    };
    missionByPerson.set(person, mission);
    this.active.set(mission.id, { person, mission });
  }

  private hasMission(kind: PersonMissionKind, relatedId: string, originId: string): boolean {
    return [...this.active.values()].some(({ mission }) => !terminal(mission)
      && mission.kind === kind && mission.relatedId === relatedId && mission.originId === originId);
  }

  private missionBudget(state: SimulationState): number {
    const living = state.people.filter((person) => person.alive).length;
    return Math.max(3, Math.min(16, Math.round(living / 55)));
  }

  private tradeDirection(route: TradeRoute): { origin: string; target: string } {
    const trip = route.transport?.trip;
    if (trip?.status === 'moving') return { origin: trip.origin, target: trip.destination };
    return route.caravanDirection >= 0 ? { origin: route.a, target: route.b } : { origin: route.b, target: route.a };
  }

  private warMatchesRelation(war: War, relation: Relation): boolean {
    return (war.attacker === relation.a && war.defender === relation.b) || (war.attacker === relation.b && war.defender === relation.a);
  }

  private settlement(state: SimulationState, id: string): Settlement | undefined {
    return state.settlements.find((settlement) => settlement.id === id && settlement.alive);
  }

  private visitDuration(mission: PersonMission): number {
    if (mission.kind === 'military-service') return 8;
    if (mission.kind === 'knowledge-exchange') return 4;
    if (mission.kind === 'diplomatic-envoy') return 3;
    return 2;
  }

  private visitActivity(mission: PersonMission): Activity {
    if (mission.kind === 'trade-delegation') return 'trade';
    if (mission.kind === 'knowledge-exchange') return 'study';
    if (mission.kind === 'military-service') return 'patrol';
    return 'socialize';
  }

  private destinationKind(mission: PersonMission): 'market' | 'civic-building' | 'knowledge-institution' | 'patrol-route' {
    if (mission.kind === 'trade-delegation') return 'market';
    if (mission.kind === 'knowledge-exchange') return 'knowledge-institution';
    if (mission.kind === 'military-service') return 'patrol-route';
    return 'civic-building';
  }
}

/**
 * Installs the presentation-only agency layer. Simulation.step is still called once per month;
 * the director restores ordinary person presentation before every authoritative tick and reapplies
 * mission presentation afterward, so chunking and historical outcomes remain unchanged.
 */
export function installPersonMissions(): void {
  if (installed) return;
  installed = true;

  const originalStep = Simulation.prototype.step;
  Simulation.prototype.step = function missionAwareStep(months = 1): void {
    const count = Math.max(0, Math.floor(months));
    let director = directors.get(this);
    if (!director || !director.matches(this.state)) {
      director = new PersonMissionDirector(this.state);
      directors.set(this, director);
    }
    for (let index = 0; index < count; index += 1) {
      director.beforeMonth(this.state);
      originalStep.call(this, 1);
      if (!director.matches(this.state)) {
        director = new PersonMissionDirector(this.state);
        directors.set(this, director);
      }
      director.afterMonth(this.state);
    }
  };
}
