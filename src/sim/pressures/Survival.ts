import { emitEvent } from '../History';
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
  if (!response || summary.month > response.untilMonth || !['forage', 'cultivate'].includes(response.kind)) return summary;
  if (response.kind === 'cultivate' && capabilityPractice(s, 'crop-selection', 'adopted') < 0.15) return summary;
  const destination = response.kind === 'forage' ? 'forager' : 'farmer';
  const share = 0.15 + (survival.observations.food?.urgency ?? 0) * 0.25;
  for (const source of ['builder', 'artisan', 'carrier', 'keeper'] as const) {
    const spend = positive(summary.economy[source] ?? 0) * share;
    summary.economy[source] = positive(summary.economy[source] ?? 0) - spend;
    // Unfamiliar work is less effective, never a free efficiency multiplier.
    summary.economy[destination] = (summary.economy[destination] ?? 0) + spend * 0.7;
    summary.survivalReassigned += spend;
  }
  return summary;
}

/** Cold severity uses the weather model's normalized temperature, not degrees Celsius. */
export function applyCold(state: SimulationState, s: Settlement, population: number): void {
  const survival = survivalState(s);
  if (survival.observations.cold?.observedMonth === state.month) return;
  const temperature = state.weather.cells[s.cellIndex]?.temperature ?? 0.5;
  const severity = unit((0.3 - temperature) / 0.3);
  const housing = (s.structurePlots ?? []).reduce((n, p) => n + (p.development?.status === 'active' && !p.accessRestricted
    ? positive(p.development.services.housing ?? 0) * unit(p.condition) * 17 : 0), 0);
  const shelterCoverage = population > 0 ? unit(housing / population) : 1;
  const fuelNeed = severity * positive(population) * 0.006;
  const fuelUsed = fuelNeed > 0 && capabilityPractice(s, 'fire-control', 'adopted') >= 0.15 ? takeMaterial(s, 'timber', fuelNeed) : 0;
  const warmth = fuelNeed > 0 ? unit(fuelUsed / fuelNeed) : 1;
  const exposure = severity * (1 - shelterCoverage * 0.75) * (1 - warmth * 0.65);
  survival.cold = { severity, shelterCoverage, fuelNeed, fuelUsed, exposure };
  survival.observations.cold = observePressure(survival.observations.cold, { kind: 'cold', intensity: exposure,
    confidence: 0.95, affectedPopulation: population, location: s.position, observedMonth: state.month,
    causes: [...(severity > 0 ? ['cold-weather'] : []), ...(shelterCoverage < 1 ? ['shelter-shortage'] : []), ...(warmth < 1 ? ['fuel-shortage'] : [])],
    consequences: ['lost-work', 'exposure-illness'], responses: ['shelter', 'fuel', 'migration'],
    evidence: { temperature, shelterCoverage, fuelNeed, fuelUsed } });
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
