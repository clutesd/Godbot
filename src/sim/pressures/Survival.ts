import { emitEvent } from '../History';
import { shelterCapacity } from '../development/Shelter';
import { capabilityPractice } from '../knowledge/CapabilityContract';
import { SeededRandom } from '../prng';
import { takeMaterial } from '../resources/Inventory';
import type { LabourSummary } from '../people/HumanCapital';
import type { Culture, HistoricalEvent, Person, Settlement, SimulationState } from '../types';
import { finite, observePressure, positive, unit } from './Pressure';
import type { FoodResponse, PressureObservation, SurvivalState } from './types';

export function survivalState(s: Settlement): SurvivalState {
  return s.survival ??= { observations: {}, deprivation: 0, exposureDose: 0,
    cold: { severity: 0, shelterCoverage: 1, fuelNeed: 0, fuelUsed: 0, exposure: 0 },
    experience: {}, nextDecisionMonth: 0, lastConsequenceMonth: -120, lastSpecializationMonth: -120,
    reassignedLabour: 0, lastResolvedMonth: -1 };
}

/** Only functioning food stores protect food; arbitrary buildings still provide baseline household space. */
function foodStores(s: Settlement): number {
  return (s.structurePlots ?? []).reduce((n, p) => n + (p.development?.status === 'active'
    && p.development.form === 'store' && !p.accessRestricted ? positive(p.development.services.food ?? 0) * unit(p.condition) : 0), 0);
}
export function foodStorageCapacity(s: Settlement, population: number): number {
  return Math.max(180, positive(population) * 6 + positive(s.buildings) * 24) + foodStores(s) * 90;
}
export function foodNeed(s: Settlement, population: number): number {
  return positive(population) * (0.31 + unit(s.urbanization) * 0.018);
}
export function updateFoodSecurity(s: Settlement, population: number): void {
  s.foodSecurity = unit(positive(s.resources.food) / Math.max(1, foodNeed(s, population)) / 5 * 0.7
    + (s.monthlyBalance.food >= 0 ? 0.3 : 0));
}

/** Separate production, full nutritional need and actual intake before any stock is clamped. */
export function beginFoodMonth(s: Settlement, population: number, production: number, month: number, extraProduction = 0): void {
  const survival = survivalState(s);
  const need = foodNeed(s, population);
  const rationing = survival.response?.kind === 'ration' && month <= survival.response.untilMonth;
  const target = need * (rationing ? 0.88 : 1);
  const stored = positive(s.resources.food);
  const spoiled = stored * (0.018 / (1 + foodStores(s) * 0.7));
  const available = stored - spoiled + positive(production);
  const consumed = Math.min(target, available);
  const overflow = Math.max(0, available - consumed - foodStorageCapacity(s, population));
  survival.food = { month, population: positive(population), need, target, production: positive(production), consumed, spoiled, overflow, extraProduction: positive(extraProduction) };
  s.resources.food = Math.min(foodStorageCapacity(s, population), Math.max(0, available - consumed));
  s.monthlyBalance.food = positive(production) - target - spoiled;
  updateFoodSecurity(s, population);
}

/** Water can revise this month's yield without losing unmet consumption at the zero-stock boundary. */
export function adjustFoodProduction(s: Settlement, delta: number, month: number): boolean {
  const ledger = s.survival?.food;
  if (!ledger || ledger.month !== month) return false;
  const change = Math.max(-ledger.production, finite(delta));
  ledger.production += change;
  // Capacity cannot discard part of an estimated harvest before that harvest has been revised.
  const available = Math.max(0, s.resources.food + ledger.consumed + (ledger.overflow ?? 0) + change);
  ledger.consumed = Math.min(ledger.target, available);
  ledger.overflow = Math.max(0, available - ledger.consumed - foodStorageCapacity(s, ledger.population));
  s.resources.food = Math.min(foodStorageCapacity(s, ledger.population), Math.max(0, available - ledger.consumed));
  s.monthlyBalance.food += change;
  updateFoodSecurity(s, ledger.population);
  return true;
}

export function observeFood(s: Settlement, population: number, month: number): PressureObservation {
  const survival = survivalState(s);
  const need = foodNeed(s, population);
  const reserves = positive(s.resources.food) / Math.max(0.1, need);
  const flow = finite(s.monthlyBalance.food) / Math.max(0.1, need);
  const shortage = unit(1 - reserves / 4);
  const deficit = unit(-flow);
  const intensity = population > 0 ? unit(shortage * 0.68 + deficit * 0.25 + unit(survival.deprivation / 4) * 0.35) : 0;
  const observation = observePressure(survival.observations.food, { kind: 'food', intensity,
    confidence: 0.65 + unit(s.knowledge.literacy) * 0.3, affectedPopulation: population, location: s.position, observedMonth: month,
    expectedSeverity: unit(intensity + deficit * 0.15),
    causes: [...(reserves < 4 ? ['low-food-reserves'] : []), ...(flow < 0 ? ['negative-food-balance'] : []),
      ...(survival.deprivation > 0.3 ? ['missed-nutrition'] : [])],
    consequences: ['weakness', 'reduced-fertility', 'migration-pressure', 'malnutrition-mortality'],
    responses: ['forage', 'cultivate', 'ration', 'wait'], evidence: { reserves, balance: finite(s.monthlyBalance.food), need, deprivation: survival.deprivation } });
  survival.observations.food = observation;
  return observation;
}

function record(state: SimulationState, s: Settlement, type: HistoricalEvent['type'], summary: string,
  context: HistoricalEvent['context'], causes: string[], population: number, significance = 0.52, actors = [s.id]): HistoricalEvent {
  return emitEvent(state, { type, location: { ...s.position }, locationId: s.id, actors, causes, context,
    summary, outcome: summary, affectedPopulation: positive(population), magnitude: unit(typeof context.intensity === 'number' ? context.intensity : s.survival?.observations.food?.intensity ?? 0),
    significance, tags: ['survival', 'causal', type] });
}

export interface FoodOption { kind: FoodResponse; weight: number }
/** Feasibility uses local evidence. No neighbour scan, hidden stocks, or technology grants. */
export function foodResponseOptions(s: Settlement, fertility: number, land: boolean, workers: number, culture?: Culture): FoodOption[] {
  const survival = survivalState(s);
  const urgency = survival.observations.food?.urgency ?? 0;
  const d = culture?.dimensions;
  const intensity = survival.observations.food?.perceived ?? 0;
  const options: FoodOption[] = [{ kind: 'wait', weight: 0.25 + (1 - urgency) * 0.7 }];
  if (land && fertility > 0.08 && workers > 0) {
    options.push({ kind: 'forage', weight: 0.4 + unit(fertility) * 0.7 + (1 - (d?.longTermOrientation ?? 0.5)) * 0.5 + intensity * 0.6 });
    if (capabilityPractice(s, 'crop-selection', 'adopted') >= 0.15) options.push({ kind: 'cultivate', weight: 0.3 + unit(fertility) + (d?.longTermOrientation ?? 0.5) + intensity * 0.4 });
  }
  if (s.resources.food > 0) options.push({ kind: 'ration', weight: 0.25 + urgency * 0.7 + (d?.cooperation ?? 0.5) * 0.4 });
  return options.map(option => ({ ...option, weight: option.weight * Math.exp(Math.max(-1, Math.min(1,
    finite(survival.experience[option.kind]?.preference ?? 0)))) }));
}

/** At most one local decision per quarter. The isolated stream cannot perturb unrelated world draws. */
export function chooseFoodResponse(state: SimulationState, s: Settlement, population: number, workers: number, culture?: Culture): void {
  const survival = survivalState(s);
  const pressure = observeFood(s, population, state.month);
  if (survival.response || state.month < survival.nextDecisionMonth || pressure.perceived < 0.35) return;
  if (!pressure.eventId || pressure.duration === 1) {
    const event = record(state, s, 'pressure-detected', `${s.name} observes food risk with ${pressure.evidence.reserves!.toFixed(1)} months of food in reserve.`,
      { ...pressure.evidence, intensity: pressure.intensity, perceived: pressure.perceived, duration: pressure.duration }, pressure.causes, population);
    pressure.eventId = event.id;
  }
  const cell = state.world.cells[s.cellIndex];
  const options = foodResponseOptions(s, cell?.fertility ?? 0, !!cell && !cell.water, workers, culture);
  pressure.responses = options.map(option => option.kind);
  const random = new SeededRandom(`${state.seed}:survival:${s.id}:${state.month}`);
  const kind = options[random.weightedIndex(options.map(o => o.weight))]!.kind;
  const memory = survival.experience[kind];
  const event = record(state, s, 'response-attempted', `${s.name} ${kind === 'wait' ? 'delays changing its food strategy' : kind === 'ration' ? 'limits household rations to stretch its stores' : `redirects available work to ${kind === 'forage' ? 'foraging' : 'cultivation'}`} after observing food risk.`,
    { response: kind, pressureEventId: pressure.eventId, baselinePressure: pressure.intensity,
      alternatives: options.map(o => o.kind).join(','), ...(memory?.eventId ? { memoryEventId: memory.eventId, learnedPreference: memory.preference } : {}) },
    [pressure.eventId, ...pressure.causes, ...(memory?.eventId ? [memory.eventId] : [])], population);
  survival.response = { kind, startedMonth: state.month, untilMonth: state.month + 2, pressureEventId: pressure.eventId,
    eventId: event.id, baselinePressure: pressure.intensity, extraProduction: 0, foodSaved: 0, labourSpent: 0 };
  survival.nextDecisionMonth = state.month + 6;
}

/** Reallocate ONLY unreserved economy time. Resources, soldiers, industry and infrastructure keep their budgets. */
export function allocateSurvivalLabour(s: Settlement, summary: LabourSummary): LabourSummary {
  const survival = s.survival;
  if (!survival) return summary;
  summary.survivalReassigned = 0;
  const response = survival.response;
  if (!response || summary.month > response.untilMonth || !['forage', 'cultivate'].includes(response.kind)) return allocateEstablishmentLabour(s, summary);
  if (response.kind === 'cultivate' && capabilityPractice(s, 'crop-selection', 'adopted') < 0.15) return allocateEstablishmentLabour(s, summary);
  const destination = response.kind === 'forage' ? 'forager' : 'farmer';
  const share = (0.15 + (survival.observations.food?.urgency ?? 0) * 0.25)
    / (1 + (survival.establishment?.shelterUrgency ?? 0) * 0.5);
  for (const source of ['builder', 'artisan', 'carrier', 'keeper'] as const) {
    const spend = positive(summary.economy[source] ?? 0) * share;
    summary.economy[source] = positive(summary.economy[source] ?? 0) - spend;
    // Unfamiliar work is less effective, never a free efficiency multiplier.
    summary.economy[destination] = (summary.economy[destination] ?? 0) + spend * 0.7;
    summary.survivalReassigned += spend;
  }
  return allocateEstablishmentLabour(s, summary);
}

/** Monthly, local, and based on observed climate/season rather than future weather draws. */
export function observeEstablishment(state: SimulationState, s: Settlement, population: number, workers: number): void {
  const survival = survivalState(s), prior = survival.establishment;
  const shelter = shelterCapacity(s, state, population);
  const coverage = population > 0 ? unit(shelter.capacity / population) : 1;
  const permanentCoverage = population > 0 ? unit(shelter.permanent / population) : 1;
  const cell = state.world.cells[s.cellIndex]!;
  const weather = state.weather.cells[s.cellIndex];
  const season = state.month % 12;
  const approach = [1, 0.8, 0.4, 0.1, 0, 0, 0.1, 0.25, 0.55, 0.85, 1, 1][season]!;
  const coldRisk = unit((0.55 - cell.temperature) / 0.45);
  const winterMemory = Math.max((prior?.winterMemory ?? 0) * 0.998, unit(survival.exposureDose / 4));
  const preparedness = unit(approach * coldRisk + winterMemory * 0.25);
  const reserves = s.resources.food / Math.max(1, foodNeed(s, population));
  const foodUrgency = unit(Math.max(survival.observations.food?.intensity ?? 0, 1 - reserves / (3 + preparedness * 2)));
  const shelterUrgency = unit((1 - coverage) * (0.65 + preparedness * 0.55)
    + (1 - permanentCoverage) * 0.22 + survival.cold.exposure * 0.4 + winterMemory * 0.15);
  const fuelTarget = population * (0.012 + preparedness * 0.05);
  const feasibility = unit((cell.wood * 0.6 + cell.minerals * 0.25 + Math.min(1, (s.localMaterials.timber ?? 0) / 3) * 0.4)
    * (1 - (weather?.snowpack ?? 0) * 0.5) / Math.max(1, cell.movementCost * 0.3));
  // Age moderates effort; it never switches survival response off. Secure infrastructure ends establishment.
  const age = Math.max(0, state.month - s.foundedMonth);
  const strength = unit(Math.max(1 - coverage, (1 - permanentCoverage) * 0.65, foodUrgency * 0.4)
    * (0.75 + 0.25 / (1 + age / 60)));
  const project = s.development?.project;
  const stalled = project ? unit((state.month - (project.lastWorkMonth ?? project.startedMonth) - 3) / 24) : 0;
  const migration = unit((1 - feasibility) * (shelterUrgency + foodUrgency) * 0.5 + survival.exposureDose / 12 + stalled * shelterUrgency);
  const choice = workers < 0.2 || feasibility < 0.06 ? migration > 0.45 ? 'migrate' : 'tolerate'
    : foodUrgency > shelterUrgency + 0.2 ? 'food'
      : s.development?.project ? 'finish' : shelterUrgency > 0.2 ? 'shelter'
        : (s.localMaterials.timber ?? 0) < fuelTarget ? 'fuel' : 'tolerate';
  survival.establishment = { month: state.month, strength, preparedness, coldRisk, coverage, permanentCoverage,
    foodUrgency, shelterUrgency, fuelTarget, feasibility, migration, choice, materialDemand: {},
    constructionLabour: 0, gatheringLabour: 0, heatingLabour: 0, constructionByOccupation: {}, heatingByOccupation: {}, winterMemory,
    lastWinterEvent: prior?.lastWinterEvent, deficitEvent: prior?.deficitEvent };
  const e = survival.establishment;
  if (coverage < 0.8 && !e.deficitEvent) e.deficitEvent = record(state, s, 'pressure-detected',
    `${s.name} has physical protection for ${shelter.capacity.toFixed(1)} of ${population} people.`,
    { pressure: 'shelter', capacity: shelter.capacity, population, coverage, preparedness }, ['physical-shelter-deficit'], population).id;
  if (preparedness >= 0.4 && (prior?.preparedness ?? 0) < 0.4 && coverage < 1) record(state, s, 'response-attempted',
    `${s.name} begins seasonal preparation with ${(coverage * 100).toFixed(0)}% shelter coverage.`,
    { preparedness, coverage, foodReserves: reserves, fuel: s.localMaterials.timber ?? 0, winterMemory },
    ['seasonal-cold-risk', ...(e.deficitEvent ? [e.deficitEvent] : [])], population);
  if (season === 10 && e.lastWinterEvent !== state.month) {
    e.lastWinterEvent = state.month;
    record(state, s, 'pressure-detected', `${s.name} enters the cold season with ${(coverage * 100).toFixed(0)}% shelter coverage.`,
      { pressure: 'winter-preparation', coverage, capacity: shelter.capacity, population, foodReserves: reserves,
        fuel: s.localMaterials.timber ?? 0, choice, winterMemory }, ['seasonal-observation'], population);
  }
}

/** HumanCapital calls this once before freezing the common budget. No emergency workers are created. */
function allocateEstablishmentLabour(s: Settlement, summary: LabourSummary): LabourSummary {
  const e = s.survival?.establishment;
  if (!e || e.month !== summary.month) return summary;
  const project = s.development?.project;
  const active = Boolean(project?.response.adaptation);
  const missing = Object.entries(e.materialDemand).reduce((n, [id, amount]) => n + Math.max(0, amount - (s.localMaterials[id] ?? 0)), 0);
  const gatheringShare = missing > 0.05 ? 0.55 : 0.15;
  const urgency = Math.max(active ? e.shelterUrgency : 0, missing > 0 ? e.preparedness * 0.5 : 0);
  const share = unit(urgency * 0.75 / (1 + e.foodUrgency * 1.5));
  e.constructionLabour = 0; e.gatheringLabour = 0; e.heatingLabour = 0; e.constructionByOccupation = {}; e.heatingByOccupation = {};
  for (const source of ['farmer', 'forager', 'builder', 'artisan', 'carrier', 'keeper'] as const) {
    const available = positive(summary.economy[source] ?? 0);
    // Food specialists retain more time when reserves are short. Occupations never change here.
    const foodWorker = source === 'farmer' || source === 'forager';
    const spend = available * (active && source === 'builder' ? 1 : share * (foodWorker ? 1 - e.foodUrgency * 0.8 : 1));
    summary.economy[source] = available - spend;
    const gather = spend * (active ? gatheringShare : 1);
    summary.resources[source] = (summary.resources[source] ?? 0) + gather;
    e.gatheringLabour += gather;
    const build = spend - gather;
    e.constructionLabour += build * (source === 'builder' ? 1 : 0.7);
    e.constructionByOccupation[source] = build;
    summary.establishmentReserved = (summary.establishmentReserved ?? 0) + build;
  }
  // Fire tending spends a small share of the same civilian time; fuel alone is not free heating labour.
  if (capabilityPractice(s, 'fire-control', 'adopted') >= 0.15) {
    let remaining = summary.population * e.coldRisk * 0.004;
    for (const source of ['keeper', 'carrier', 'forager', 'farmer'] as const) {
      const spend = Math.min(remaining, summary.economy[source] ?? 0);
      summary.economy[source] = (summary.economy[source] ?? 0) - spend;
      e.heatingLabour += spend; remaining -= spend;
      e.heatingByOccupation[source] = spend;
      summary.establishmentReserved = (summary.establishmentReserved ?? 0) + spend;
    }
  }
  return summary;
}

const FOUNDING_HEARTH_IGNITION_FUEL = 0.03;
const FOUNDING_HEARTH_FUEL_PER_PERSON = 0.001;

export interface FoundingFirstFirePlan {
  plannedMonth: number;
  readiness: number;
  rank: number;
  drivers: {
    coldUrgency: number;
    shelterNeed: number;
    woodland: number;
    fuelSecurity: number;
  };
}

function firstFireReadiness(state: SimulationState, s: Settlement, population: number): Omit<FoundingFirstFirePlan, 'plannedMonth' | 'rank'> {
  const cell = state.world.cells[s.cellIndex];
  const pod = state.arrival?.pods.find(candidate => candidate.id === s.foundingPodId);
  const temperature = state.weather.cells[s.cellIndex]?.temperature ?? cell?.temperature ?? 0.5;
  const coldUrgency = unit((0.62 - temperature) / 0.5);
  const shelter = shelterCapacity(s, state, population);
  const shelterNeed = population > 0 ? unit(1 - shelter.capacity / population) : 0;
  const woodland = unit(pod?.site?.woodland ?? cell?.wood ?? 0);
  const fuelSecurity = unit(positive(s.localMaterials.timber ?? 0)
    / Math.max(FOUNDING_HEARTH_IGNITION_FUEL, positive(population) * 0.04));
  return {
    readiness: unit(coldUrgency * 0.42 + shelterNeed * 0.28 + woodland * 0.16 + fuelSecurity * 0.14),
    drivers: { coldUrgency, shelterNeed, woodland, fuelSecurity },
  };
}

/**
 * First fire is an earned settlement milestone, not a synchronized timer.
 * Need/readiness sets the order; touchdown time breaks close calls; hash is only the final tie-break.
 */
export function foundingFirstFirePlan(state: SimulationState, s: Settlement, population: number): FoundingFirstFirePlan | undefined {
  if (!s.foundingPodId) return;
  const founding = state.settlements.filter(candidate => candidate.foundingPodId && candidate.alive);
  const ranked = founding.map(candidate => {
    const candidatePopulation = candidate.id === s.id
      ? population
      : state.people.reduce((count, person) => count + Number(person.alive && person.homeId === candidate.id), 0);
    const score = firstFireReadiness(state, candidate, candidatePopulation);
    const pod = state.arrival?.pods.find(item => item.id === candidate.foundingPodId);
    return {
      settlement: candidate,
      ...score,
      touchdown: pod ? pod.entrySeconds + pod.descentSeconds : Number.POSITIVE_INFINITY,
      tie: stableFirstFireUnit(`${state.seed}:first-fire:${candidate.id}`),
    };
  }).sort((a, b) => b.readiness - a.readiness || a.touchdown - b.touchdown || b.tie - a.tie);

  const rank = Math.max(0, ranked.findIndex(candidate => candidate.settlement.id === s.id));
  const own = ranked[rank] ?? { ...firstFireReadiness(state, s, population), settlement: s, touchdown: 0, tie: 0 };
  // One clearly leads; the middle pair follow; the final pair need more camp preparation.
  // Severe cold overrides ceremony pacing because survival need is authoritative.
  const delay = own.drivers.coldUrgency >= 0.75 ? 1 : 1 + Math.min(2, Math.ceil(rank / 2));
  return {
    plannedMonth: s.foundedMonth + delay,
    readiness: own.readiness,
    rank,
    drivers: own.drivers,
  };
}

/**
 * A founding camp uses fire for ordinary cooking/light before cold weather makes it life-critical.
 * Both ignition and routine use consume authoritative timber; presentation only observes this ledger.
 */
function maintainFoundingHearth(state: SimulationState, s: Settlement, population: number): void {
  const survival = survivalState(s);
  if (!s.foundingPodId || capabilityPractice(s, 'fire-control', 'adopted') < 0.15 || population <= 0) {
    if (s.foundingPodId) survival.hearth = { ...survival.hearth, fuelNeed: 0, fuelUsed: 0 };
    return;
  }

  if (!survival.firstFire) {
    const plan = survival.hearth?.plannedIgnitionMonth === undefined
      ? foundingFirstFirePlan(state, s, population)
      : {
        plannedMonth: survival.hearth.plannedIgnitionMonth,
        readiness: survival.hearth.ignitionReadiness ?? 0,
        rank: survival.hearth.ignitionRank ?? 0,
      };
    if (!plan) return;
    const ignitionNeed = Math.min(FOUNDING_HEARTH_IGNITION_FUEL, positive(population) * 0.0015);
    survival.hearth = {
      ...survival.hearth,
      fuelNeed: ignitionNeed,
      fuelUsed: 0,
      plannedIgnitionMonth: plan.plannedMonth,
      ignitionReadiness: plan.readiness,
      ignitionRank: plan.rank,
    };
    if (state.month < plan.plannedMonth || (s.localMaterials.timber ?? 0) < ignitionNeed) return;

    const ignitionFuel = takeMaterial(s, 'timber', ignitionNeed);
    survival.hearth.fuelUsed = ignitionFuel;
    const fullPlan = foundingFirstFirePlan(state, s, population);
    const drivers = fullPlan?.drivers;
    const event = record(state, s, 'first-fire', `${s.name} lights its first recorded survival hearth.`,
      { foundingPodId: s.foundingPodId, fuelUsed: ignitionFuel, fuelNeed: ignitionNeed, purpose: 'founding-hearth',
        plannedMonth: plan.plannedMonth, ignitionReadiness: plan.readiness, ignitionRank: plan.rank,
        ...(drivers ? { coldUrgency: drivers.coldUrgency, shelterNeed: drivers.shelterNeed,
          woodland: drivers.woodland, fuelSecurity: drivers.fuelSecurity } : {}), intensity: 1 },
      ['founding-survival', 'fire-control', 'real-fuel-consumed', 'site-readiness'], population, 0.68);
    survival.firstFire = { month: state.month, eventId: event.id, plannedMonth: plan.plannedMonth, readiness: plan.readiness };
    return;
  }

  const fuelNeed = positive(population) * FOUNDING_HEARTH_FUEL_PER_PERSON;
  const fuelUsed = takeMaterial(s, 'timber', fuelNeed);
  survival.hearth = { ...survival.hearth, fuelNeed, fuelUsed };
}

/** Cold severity uses the weather model's normalized temperature, not degrees Celsius. */
export function applyCold(state: SimulationState, s: Settlement, population: number): void {
  const survival = survivalState(s);
  if (survival.observations.cold?.observedMonth === state.month) return;
  maintainFoundingHearth(state, s, population);
  const temperature = state.weather.cells[s.cellIndex]?.temperature ?? 0.5;
  const severity = unit((0.3 - temperature) / 0.3);
  const shelter = shelterCapacity(s, state, population);
  const shelterCoverage = population > 0 ? unit(shelter.capacity / population) : 1;
  const fuelNeed = severity * positive(population) * 0.006;
  const tending = survival.establishment ? unit(survival.establishment.heatingLabour / Math.max(0.001, population * severity * 0.004)) : 1;
  const fireEstablished = !s.foundingPodId || Boolean(survival.firstFire);
  const fuelUsed = fuelNeed > 0 && fireEstablished && capabilityPractice(s, 'fire-control', 'adopted') >= 0.15
    ? takeMaterial(s, 'timber', fuelNeed * tending) : 0;
  const warmth = fuelNeed > 0 ? unit(fuelUsed / fuelNeed) : 1;
  const insulation = population > 0 ? unit(shelter.protection / population) : 1;
  const exposure = severity * (1 - insulation) * (1 - warmth * 0.65);
  survival.cold = { severity, shelterCoverage, fuelNeed, fuelUsed, exposure };
  survival.observations.cold = observePressure(survival.observations.cold, { kind: 'cold', intensity: exposure,
    confidence: 0.95, affectedPopulation: population, location: s.position, observedMonth: state.month,
    causes: [...(severity > 0 ? ['cold-weather'] : []), ...(shelterCoverage < 1 ? ['shelter-shortage'] : []), ...(warmth < 1 ? ['fuel-shortage'] : [])],
    consequences: ['lost-work', 'exposure-illness'], responses: ['shelter', 'fuel', 'migration'],
    evidence: { temperature, shelterCoverage, capacity: shelter.capacity, exposed: Math.max(0, population - shelter.capacity),
      fuelNeed, fuelUsed, constructionLabour: survival.establishment?.constructionLabour ?? 0,
      gatheringLabour: survival.establishment?.gatheringLabour ?? 0 } });
  const cold = survival.observations.cold;
  if (cold.intensity >= 0.35 && (!cold.eventId || cold.duration === 1)) {
    cold.eventId = record(state, s, 'pressure-detected', `${s.name} faces cold exposure with insufficient shelter or heating.`,
      { pressure: 'cold', ...cold.evidence, intensity: cold.intensity }, cold.causes, population).id;
  }
}

/** Resolve after water and trade. Imports can feed households this month before deprivation is charged. */
export function resolveSurvival(state: SimulationState, s: Settlement, population: number, culture?: Culture): void {
  const survival = survivalState(s);
  const ledger = survival.food;
  if (!ledger || ledger.month !== state.month || survival.lastResolvedMonth === state.month) return;
  survival.lastResolvedMonth = state.month;
  const catchup = Math.min(positive(s.resources.food), Math.max(0, ledger.target - ledger.consumed));
  s.resources.food -= catchup; ledger.consumed += catchup;
  const deficit = ledger.need > 0 ? unit(1 - ledger.consumed / ledger.need) : 0;
  survival.deprivation = Math.max(0, Math.min(12, finite(survival.deprivation) + deficit - (deficit < 0.02 ? 0.35 : 0)));
  survival.exposureDose = Math.max(0, Math.min(12, finite(survival.exposureDose) + survival.cold.exposure - 0.18));
  updateFoodSecurity(s, population);
  const pressure = observeFood(s, population, state.month);
  if (survival.deprivation >= 2 && state.month - survival.lastConsequenceMonth >= 24) {
    survival.lastConsequenceMonth = state.month;
    const event = record(state, s, 'harvest-crisis', `${s.name} suffers sustained undernutrition after households repeatedly receive less food than they need.`,
      { need: ledger.need, consumed: ledger.consumed, deprivation: survival.deprivation, pressure: pressure.intensity },
      ['missed-nutrition', ...(pressure.eventId ? [pressure.eventId] : [])], population, 0.67);
    pressure.eventId ??= event.id;
    if (culture) culture.memory.foodScarcity = { strength: unit((culture.memory.foodScarcity?.strength ?? 0) + 0.2), eventId: event.id };
  }
  const response = survival.response;
  if (!response) return;
  response.extraProduction += ledger.extraProduction;
  response.foodSaved += response.kind === 'ration' ? Math.min(ledger.need - ledger.target, positive(s.resources.food)) : 0;
  response.labourSpent += survival.reassignedLabour;
  if (state.month < response.untilMonth) return;
  const benefit = response.extraProduction + response.foodSaved;
  const improved = pressure.intensity < response.baselinePressure - 0.04;
  const succeeded = benefit > 0.01 && improved;
  const experience = survival.experience[response.kind] ??= { attempts: 0, successes: 0, preference: 0 };
  experience.attempts = Math.min(10000, experience.attempts + 1);
  experience.successes = Math.min(10000, experience.successes + (succeeded ? 1 : 0));
  experience.preference = Math.max(-1, Math.min(1, experience.preference * 0.96 + (succeeded ? 0.16 : -0.06)));
  const event = record(state, s, 'response-resolved', `${s.name}'s ${response.kind} response ${succeeded ? 'contributes food while observed food risk falls' : 'ends without demonstrated relief from food risk'}.`,
    { response: response.kind, attemptEventId: response.eventId, pressureEventId: response.pressureEventId,
      beforePressure: response.baselinePressure, afterPressure: pressure.intensity, extraProduction: response.extraProduction,
      foodSaved: response.foodSaved, labourSpent: response.labourSpent, succeeded,
      attribution: 'Direct food contribution measured; overall pressure change also includes weather, trade and population.' },
    [response.eventId, response.pressureEventId], population);
  experience.eventId = event.id;
  survival.response = undefined;
}

export function survivalHealthChange(s: Settlement): number {
  const survival = s.survival;
  if (!survival) return 0;
  return -unit(survival.deprivation / 4) * 0.035 - survival.cold.exposure * 0.008 - unit(survival.exposureDose / 6) * 0.009;
}
export function survivalMortality(s: Settlement, cause?: 'food' | 'cold'): number {
  // Annual hazard, charged monthly by existing demographic authority. One missed meal is not lethal.
  return (cause === 'cold' ? 0 : unit(((s.survival?.deprivation ?? 0) - 2) / 6) * 0.32)
    + (cause === 'food' ? 0 : unit(((s.survival?.exposureDose ?? 0) - 3) / 6) * 0.08);
}

/** A successful repeated collective response can recruit a specialist; no expertise is granted. */
export function adaptFoodCareer(state: SimulationState, s: Settlement, residents: readonly Person[]): Person | undefined {
  const survival = s.survival;
  if (!survival || state.advanced.scale === 'modern-statistical' || state.month - survival.lastSpecializationMonth < 24) return;
  const kind = (['cultivate', 'forage'] as const).find(k => (survival.experience[k]?.successes ?? 0) >= 3);
  if (!kind || (survival.observations.food?.perceived ?? 0) < 0.3) return;
  const random = new SeededRandom(`${state.seed}:food-career:${s.id}:${state.month}`);
  if (!random.chance(0.12)) return;
  const candidates = residents.filter(p => p.alive && p.ageMonths >= 180 && p.ageMonths < 816 && p.health > 0.4
    && ['builder', 'artisan', 'carrier', 'keeper'].includes(p.occupation) && state.month - (p.career?.startedMonth ?? 0) >= 24);
  if (!candidates.length) return;
  const person = random.pick(candidates);
  const previous = person.occupation;
  person.occupation = kind === 'cultivate' ? 'farmer' : 'forager';
  person.career = { startedMonth: state.month, lastReconsideredMonth: state.month, reason: 'repeated-food-response', inactiveMonths: 0 };
  survival.lastSpecializationMonth = state.month;
  record(state, s, 'adaptation-established', `${person.name} takes up ${person.occupation === 'farmer' ? 'farming' : 'foraging'} after repeated food responses showed relief.`,
    { personId: person.id, previousOccupation: previous, occupation: person.occupation, response: kind, successes: survival.experience[kind]!.successes },
    [survival.experience[kind]!.eventId!], residents.length, 0.6, [s.id, person.id]);
  return person;
}


function stableFirstFireUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
