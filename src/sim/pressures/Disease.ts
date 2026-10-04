import { emitEvent } from '../History';
import { isStatistical } from '../Population';
import { rememberMortality } from '../development/Remembrance';
import { capabilityPractice } from '../knowledge/CapabilityContract';
import { killPeople } from '../people/PersonLifecycle';
import { SeededRandom } from '../prng';
import type { Person, Settlement, SimulationState } from '../types';
import { observePressure, positive, unit } from './Pressure';
import { survivalState } from './Survival';
import type { DiseaseState, Pathogen } from './types';

/** Epidemiological archetypes, not scripted historical disasters or clinical forecasts. */
export const PATHOGENS: readonly Pathogen[] = ['enteric', 'respiratory', 'zoonotic'];
const PARAMETERS = {
  enteric: { transmission: 0.75, fatality: 0.018, duration: 2, immunity: 18 },
  respiratory: { transmission: 1.15, fatality: 0.009, duration: 3, immunity: 36 },
  zoonotic: { transmission: 0.55, fatality: 0.055, duration: 3, immunity: 60 },
};
export function diseaseState(s: Settlement): DiseaseState {
  return survivalState(s).disease ??= { plannedMonth: -1, resolvedMonth: -1,
    compartments: { enteric: { exposed: 0, infectious: 0, immune: 0 }, respiratory: { exposed: 0, infectious: 0, immune: 0 }, zoonotic: { exposed: 0, infectious: 0, immune: 0 } },
    prevalence: 0, severity: 0, response: 'wait', labourSpent: 0, goodsSpent: 0, protection: 0,
    practice: 0, memory: 0, cases: 0, deaths: 0, lastEventMonth: -120 };
}

/** Imported carriage belongs to the initial population, never to a future era or newborn. */
export function seedInitialInfection(state: SimulationState, person: Person): void {
  if (state.month !== 0 || person.ageMonths <= 0) return;
  const random = new SeededRandom(`${state.seed}:founding-infection:${person.id}`);
  if (random.chance(0.012)) person.infection = { pathogen: 'respiratory', acquiredMonth: -1,
    infectiousMonth: 1, recoveryMonth: 4, severity: 0.25 };
}

/** Uses existing water, buildings and freight authority. No invented livestock population. */
export function diseaseEnvironment(state: SimulationState, s: Settlement, population: number, animals = 0) {
  const water = s.development?.water;
  const weather = state.weather.cells[s.cellIndex];
  const density = unit(population / Math.max(40, s.buildings * 18));
  const sanitation = unit(water?.sanitation ?? 0);
  const quality = unit(water?.quality ?? (0.86 - s.pollution * 0.48));
  const cold = unit((0.5 - (weather?.temperature ?? state.world.cells[s.cellIndex]?.temperature ?? 0.5)) * 2);
  const contamination = unit((1 - quality) * (1 - sanitation) + (water?.floodContamination ?? 0) * 0.4);
  const nutrition = unit((s.survival?.deprivation ?? 0) / 6);
  const exposure = unit(s.survival?.cold.exposure ?? 0);
  return { density, sanitation, quality, cold, contamination, nutrition, exposure, animals: unit(animals),
    severity: unit(0.2 + nutrition * 0.45 + exposure * 0.15 + s.conflictPressure * 0.2),
    // Background reservoirs only where local conditions can sustain them; respiratory needs contact.
    reservoir: { enteric: Math.max(0, contamination - 0.24) * density * 0.045,
      respiratory: 0, zoonotic: unit(animals) * density * (1 - sanitation) * 0.006 } };
}

function event(state: SimulationState, s: Settlement, type: 'pressure-detected' | 'response-attempted' | 'response-resolved' | 'adaptation-established' | 'pandemic',
  summary: string, causes: string[], context: Record<string, number | string | boolean>, population: number): string {
  return emitEvent(state, { type, summary, outcome: summary, location: { ...s.position }, locationId: s.id,
    actors: [s.id], causes, context, affectedPopulation: population, magnitude: unit(s.survival?.disease?.prevalence ?? 0),
    significance: type === 'pandemic' ? 0.78 : 0.5, tags: ['disease', 'causal', type] }).id;
}

/** Before the common labour budget. Beliefs use last month's cases, not future infections. */
export function planDisease(state: SimulationState, s: Settlement, population: number): void {
  const h = diseaseState(s);
  if (h.plannedMonth === state.month) return;
  h.plannedMonth = state.month;
  const env = diseaseEnvironment(state, s, population);
  const observation = observePressure(s.survival!.observations.disease, { kind: 'disease',
    intensity: unit(h.prevalence * 4), confidence: 0.45 + s.knowledge.literacy * 0.3 + h.practice * 0.25,
    location: s.position, affectedPopulation: population * h.prevalence, observedMonth: state.month,
    causes: ['infectious-contact', ...(env.contamination > 0.24 ? ['contaminated-water'] : []),
      ...(env.nutrition > 0.2 ? ['malnutrition'] : []), ...(s.conflictPressure > 0.4 ? ['conflict-disruption'] : [])],
    consequences: ['labour-loss', 'mortality', 'reduced-fertility', 'migration', 'institutional-strain'],
    responses: ['wait', 'care', 'contain'], evidence: { ...env, reservoir: 0, prevalence: h.prevalence, practice: h.practice } });
  s.survival!.observations.disease = observation;
  observation.eventId = h.episodeEventId;
  const prior = h.response;
  const culture = state.cultures.find(c => s.cultureShares[c.id]);
  const trust = culture?.dimensions.institutionalTrust ?? 0.5;
  const cooperation = culture?.dimensions.cooperation ?? 0.5;
  const understanding = capabilityPractice(s, 'contagion-patterns', 'adopted');
  // Decisions persist for a quarter, except that recovered communities release emergency work.
  if (h.prevalence < 0.01) h.response = 'wait';
  else if (state.month % 3 === 1 || !h.responseEventId) {
    const random = new SeededRandom(`${state.seed}:disease-response:${s.id}:${state.month}`);
    const weights = [0.2 + (1 - trust) * 0.8, 0.3 + cooperation + h.memory + (culture?.memory.healthCrisis?.strength ?? 0),
      (0.15 + understanding + h.practice) * trust * (0.4 + s.foodSecurity)];
    h.response = (['wait', 'care', 'contain'] as const)[random.weightedIndex(weights)]!;
  }
  h.labourSpent = 0; h.goodsSpent = 0; h.protection = 0;
  if (h.episodeEventId && (h.response !== prior || !h.responseEventId)) {
    h.responseEventId = event(state, s, 'response-attempted', `${s.name} chooses ${h.response} in response to infectious illness.`,
      [h.episodeEventId, ...(h.adaptationEventId ? [h.adaptationEventId] : [])],
      { response: h.response, perceived: observation.perceived, foodSecurity: s.foodSecurity, trust }, population);
  }
}

/** Reduces labour at its source, including resource, military and specialist work. */
export function illnessAvailability(p: Person): number { return p.infection ? 1 - p.infection.severity * 0.65 : 1; }
export function containment(s: Settlement): boolean {
  const h = s.survival?.disease;
  return h?.response === 'contain' && h.labourSpent > 0;
}

export function captureDiseasePopulation(s: Settlement, people: readonly Person[], month: number): void {
  const h = diseaseState(s), n = people.length;
  h.populationBasis = n;
  for (const id of PATHOGENS) {
    let exposed = 0, infectious = 0, immune = 0;
    for (const p of people) {
      if (p.infection?.pathogen === id) { if (p.infection.infectiousMonth <= month) infectious++; else exposed++; }
      else if ((p.immunity?.[id] ?? -1) > month) immune++;
    }
    h.compartments[id] = { exposed: n ? exposed / n : 0, infectious: n ? infectious / n : 0, immune: n ? immune / n : 0 };
  }
  const infected = people.filter(p => p.infection);
  h.prevalence = n ? infected.length / n : 0;
  h.severity = infected.length ? infected.reduce((sum, p) => sum + p.infection!.severity, 0) / infected.length : 0;
}

/** One snapshot prevents settlement iteration order and newly infected people from creating cascades.
 * O(people + settlements + routes + wars), fixed three pathogen slots, no all-pairs contact scan. */
export function resolveDisease(state: SimulationState): void {
  const statistical = isStatistical(state);
  const residents = new Map<string, Person[]>();
  for (const p of state.people) if (p.alive) { const group = residents.get(p.homeId) ?? []; group.push(p); residents.set(p.homeId, group); }
  const cities = new Map(state.advanced.cities.map(c => [c.settlementId, c]));
  const homes = new Map(state.settlements.filter(s => s.alive).map(s => [s.id, s]));
  const cultures = new Map(state.cultures.map(c => [c.id, c]));
  const snapshots = new Map<string, DiseaseState['compartments']>();
  const imported = new Map<string, Record<Pathogen, number>>();
  const origins = new Map<string, Set<string>>();
  const animals = new Map<string, number>();
  for (const s of homes.values()) {
    if (diseaseState(s).resolvedMonth === state.month) continue;
    if (!statistical) captureDiseasePopulation(s, residents.get(s.id) ?? [], state.month);
    const h = diseaseState(s);
    if (statistical) {
      const population = cities.get(s.id)?.population ?? 0;
      const dilution = population > 0 ? Math.min(1, (h.populationBasis ?? population) / population) : 0;
      for (const c of Object.values(h.compartments)) { c.exposed *= dilution; c.infectious *= dilution; c.immune *= dilution; }
      h.populationBasis = population;
      h.prevalence = unit(Object.values(h.compartments).reduce((sum, c) => sum + c.exposed + c.infectious, 0));
    }
    // Imported/initial carriers need a causal root before they can infect another settlement.
    if (h.prevalence > 0 && !h.episodeEventId) {
      h.episodeEventId = event(state, s, 'pressure-detected', `${s.name} observes infectious carriers among its residents.`,
        ['infectious-carriage', ...(residents.get(s.id) ?? []).flatMap(p => p.infection?.sourceEventId ? [p.infection.sourceEventId] : []).slice(0, 8)],
        { prevalence: h.prevalence }, statistical ? cities.get(s.id)?.population ?? 0 : (residents.get(s.id)?.length ?? 0));
    }
    const snapshot = structuredClone(h.compartments);
    if (!statistical) {
      const people = residents.get(s.id) ?? [];
      // homeId changes at departure; travellers cannot expose destination residents before arrival.
      for (const id of PATHOGENS) snapshot[id].infectious = people.length ? people.filter(p => p.activity !== 'migrate'
        && p.infection?.pathogen === id && p.infection.infectiousMonth <= state.month).length / people.length : 0;
    }
    snapshots.set(s.id, snapshot);
    imported.set(s.id, { enteric: 0, respiratory: 0, zoonotic: 0 });
  }
  const contact = (a: string, b: string, amount: number) => {
    const source = homes.get(a), target = homes.get(b);
    if (!source || !target || !snapshots.has(a) || !snapshots.has(b)) return;
    const reduction = (containment(source) ? 0.3 : 1) * (containment(target) ? 0.3 : 1);
    let transferred = 0;
    for (const id of PATHOGENS) {
      const exposure = snapshots.get(a)![id].infectious * amount * reduction;
      imported.get(b)![id] += exposure; transferred += exposure;
    }
    if (source.survival?.disease?.episodeEventId && transferred > 0) {
      const ids = origins.get(b) ?? new Set<string>();
      if (ids.size < 8) ids.add(source.survival.disease.episodeEventId);
      origins.set(b, ids);
    }
  };
  for (const route of state.tradeRoutes) {
    const trip = route.transport?.trip;
    const delivered = route.transport?.lastDeliveryMonth === state.month;
    if (!route.active || route.weatherBlocked || (!delivered && trip?.status !== 'moving')) continue;
    contact(route.a, route.b, 0.18); contact(route.b, route.a, 0.18);
    if (trip && ['pack-animal', 'cart', 'caravan'].includes(trip.vehicle ?? '')) {
      animals.set(route.a, 1); animals.set(route.b, 1);
    }
  }
  for (const war of state.wars) if (war.active && ['battle', 'occupation'].includes(war.phase)) {
    contact(war.attacker, war.defender, 0.25); contact(war.defender, war.attacker, 0.25);
  }
  const victims: Person[] = [];
  for (const s of homes.values()) {
    const h = diseaseState(s);
    if (h.resolvedMonth === state.month) continue;
    h.resolvedMonth = state.month;
    const people = residents.get(s.id) ?? [];
    const population = statistical ? cities.get(s.id)?.population ?? 0 : people.length;
    if (population <= 0) {
      h.prevalence = 0; h.populationBasis = 0;
      for (const id of PATHOGENS) h.compartments[id] = { exposed: 0, infectious: 0, immune: 0 };
      continue;
    }
    const env = diseaseEnvironment(state, s, population, animals.get(s.id));
    const medicine = capabilityPractice(s, 'modern-medicine', 'adopted');
    const vaccination = capabilityPractice(s, 'vaccination', 'adopted');
    const facilities = unit((s.structurePlots ?? []).reduce((sum, plot) => sum
      + (plot.development?.status === 'active' && !plot.accessRestricted
        ? positive(plot.development.services.healthcare ?? 0) * unit(plot.condition) : 0), 0) / Math.max(1, population / 25));
    const effort = unit(h.labourSpent / Math.max(0.1, population * 0.025));
    const need = population * 0.006 * effort;
    h.goodsSpent = h.response === 'wait' ? 0 : Math.min(positive(s.resources.goods), need);
    s.resources.goods -= h.goodsSpent;
    h.totalLabour = (h.totalLabour ?? 0) + h.labourSpent;
    h.totalGoods = (h.totalGoods ?? 0) + h.goodsSpent;
    h.protection = effort * unit(0.2 + h.practice * 0.25 + medicine * 0.35 + (need > 0 ? h.goodsSpent / need : 0) * 0.2 + facilities * 0.15);
    h.severity = env.severity;
    const risks = {} as Record<Pathogen, number>;
    for (const id of PATHOGENS) {
      const source = snapshots.get(s.id)![id];
      const season = id === 'respiratory' ? 0.6 + env.cold * 0.8 : 1;
      const hygiene = id === 'enteric' ? 1 - env.sanitation * 0.75 : 1;
      const force = PARAMETERS[id].transmission * (0.25 + env.density * 0.75) * season * hygiene
        * (source.infectious + Math.min(0.5, imported.get(s.id)![id]));
      risks[id] = unit(1 - Math.exp(-(force + env.reservoir[id]) * (1 - h.protection * 0.55)
        * (h.response === 'contain' ? 1 - effort * 0.65 : 1) * (1 - vaccination * h.protection * 0.6)));
    }
    const before = h.prevalence;
    let cases = 0, deaths = 0, recoveries = 0;
    if (!statistical) {
      const localDeaths = new Set<Person>();
      for (const p of people) {
        const random = new SeededRandom(`${state.seed}:infection:${state.month}:${p.id}`);
        if (p.infection) {
          const infection = p.infection;
          if (state.month < infection.infectiousMonth) continue;
          const protection = p.activity === 'migrate' ? 0 : h.protection;
          infection.severity = unit(Math.max(infection.severity, env.severity) * (1 - protection * 0.1));
          const frailty = p.ageMonths < 60 || p.ageMonths > 780 ? 1.8 : 1;
          const hazard = PARAMETERS[infection.pathogen].fatality * (0.35 + infection.severity * 2) * frailty * (1 - protection * 0.8);
          if (random.chance(hazard)) { victims.push(p); localDeaths.add(p); deaths++; continue; }
          if (state.month >= infection.recoveryMonth) {
            (p.immunity ??= {})[infection.pathogen] = state.month + PARAMETERS[infection.pathogen].immunity;
            p.infection = undefined; recoveries++;
          }
        } else {
          if (p.activity === 'migrate') continue;
          for (const id of PATHOGENS) {
            if ((p.immunity?.[id] ?? -1) > state.month || !random.chance(risks[id])) continue;
            p.infection = { pathogen: id, acquiredMonth: state.month, infectiousMonth: state.month + 1,
              recoveryMonth: state.month + 1 + PARAMETERS[id].duration, severity: env.severity,
              sourceEventId: h.episodeEventId ?? [...(origins.get(s.id) ?? [])][0] };
            cases++; break;
          }
        }
      }
      captureDiseasePopulation(s, people.filter(p => !localDeaths.has(p)), state.month);
    } else {
      // Compartment flows are bounded by their source; growth dilution precedes the snapshot.
      let remaining = population;
      for (const id of PATHOGENS) {
        const c = h.compartments[id], param = PARAMETERS[id];
        const susceptible = Math.max(0, 1 - c.exposed - c.infectious - c.immune);
        const acquired = susceptible * risks[id];
        const mortality = Math.min(c.infectious, c.infectious * param.fatality * (0.35 + env.severity * 2) * (1 - h.protection * 0.8));
        const recovered = (c.infectious - mortality) / param.duration;
        const waned = c.immune / param.immunity;
        const lost = Math.min(remaining, mortality * population);
        remaining -= lost; deaths += lost; cases += acquired * population; recoveries += recovered * population;
        const survival = Math.max(0.000001, 1 - mortality);
        c.infectious = Math.max(0, c.infectious + c.exposed - mortality - recovered) / survival;
        c.exposed = acquired / survival; c.immune = Math.max(0, c.immune + recovered - waned) / survival;
      }
      const city = cities.get(s.id);
      if (city) city.population = remaining;
      h.populationBasis = remaining;
      state.advanced.representedPopulation = Math.max(0, state.advanced.representedPopulation - deaths);
      state.stats.deaths += deaths;
      rememberMortality(state, s, deaths);
      for (const c of Object.values(h.compartments)) {
        const total = c.exposed + c.infectious + c.immune;
        if (total > 1) { c.exposed /= total; c.infectious /= total; c.immune /= total; }
        if ((c.exposed + c.infectious) * remaining < 0.25) { c.exposed = 0; c.infectious = 0; }
      }
      h.prevalence = unit(Object.values(h.compartments).reduce((sum, c) => sum + c.exposed + c.infectious, 0));
    }
    h.cases += cases; h.deaths += deaths;
    if ((cases > 0 || h.prevalence > 0) && !h.episodeEventId) {
      h.episodeEventId = event(state, s, 'pressure-detected', `${s.name} records infectious illness.`,
        ['infectious-contact', ...people.flatMap(p => p.infection?.sourceEventId ? [p.infection.sourceEventId] : []).slice(0, 8), ...(env.reservoir.enteric > 0 ? ['contaminated-water'] : []),
          ...(env.animals > 0 ? ['animal-freight-contact'] : []), ...origins.get(s.id) ?? []],
        { cases, density: env.density, sanitation: env.sanitation, waterQuality: env.quality, nutrition: env.nutrition,
          animalContact: env.animals, importedContact: Object.values(imported.get(s.id)!).reduce((a, b) => a + b, 0) }, population);
    }
    for (const p of people) if (p.infection && !p.infection.sourceEventId) p.infection.sourceEventId = h.episodeEventId;
    if (h.prevalence >= 0.1 && population * h.prevalence >= 3 && !h.epidemicEventId) {
      state.stats.pandemics++;
      h.epidemicEventId = event(state, s, 'pandemic', `${s.name} faces an epidemic of infectious illness.`, [h.episodeEventId!],
        { prevalence: h.prevalence, cases, deaths, response: h.response }, population * h.prevalence);
    }
    h.memory = Math.max(h.memory * 0.999, h.prevalence);
    if (h.episodeEventId && h.prevalence >= 0.1) {
      for (const id of Object.keys(s.cultureShares)) {
        const culture = cultures.get(id);
        if (culture && s.cultureShares[id]) culture.memory.healthCrisis = { strength: Math.max(culture.memory.healthCrisis?.strength ?? 0, h.memory), eventId: h.episodeEventId };
      }
    }
    const previousPractice = h.practice;
    // Experience requires actual work and surviving patients. No knowledge capability is granted.
    h.practice = unit(h.practice + effort * Math.min(0.015, recoveries / population * 0.08));
    if (Math.floor(h.practice * 10) > Math.floor(previousPractice * 10)) {
      h.adaptationEventId = event(state, s, 'adaptation-established', `${s.name} retains practical experience caring for infectious illness.`,
        [h.responseEventId ?? h.episodeEventId!], { practice: h.practice, labourSpent: h.labourSpent, recoveries }, population);
    }
    if (h.episodeEventId && (state.month - h.lastEventMonth >= 6 || (before > 0 && h.prevalence === 0))) {
      event(state, s, 'response-resolved', `${s.name} records the costs and course of infectious illness.`,
        [h.episodeEventId, ...(h.responseEventId ? [h.responseEventId] : [])],
        { response: h.response, labourSpent: h.labourSpent, goodsSpent: h.goodsSpent, protection: h.protection,
          cumulativeCases: h.cases, cumulativeDeaths: h.deaths, cumulativeLabour: h.totalLabour ?? 0, cumulativeGoods: h.totalGoods ?? 0,
          prevalence: h.prevalence, cases, deaths, recoveries, practice: h.practice, improving: h.prevalence < before }, population);
      h.lastEventMonth = state.month;
    }
    s.conflictPressure = unit(s.conflictPressure + h.prevalence * (0.018 + env.nutrition * 0.025) * (1 - h.protection));
    if (h.prevalence === 0) { h.episodeEventId = undefined; h.responseEventId = undefined; h.epidemicEventId = undefined; }
  }
  killPeople(state, victims, 'infection');
}
