import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { diseaseEnvironment, diseaseState, planDisease, resolveDisease } from '../src/sim/pressures/Disease';
import { observeSocialPressures } from '../src/sim/pressures/SocialPressures';
import { survivalState } from '../src/sim/pressures/Survival';
import { beginLabourMonth, invalidateLabour, settlementLabour, workAvailability, workforceProfile } from '../src/sim/people/HumanCapital';
import { conceptionChance } from '../src/sim/people/Demography';
import { developmentContext, evaluatePressures } from '../src/sim/development/SettlementDevelopmentSystem';
import { AdvancedCivilizationSystem } from '../src/sim/advanced/AdvancedCivilizationSystem';
import { SeededRandom } from '../src/sim/prng';
import { createRunIdentity, RunRecordBuilder } from '../src/historian/RunArchive';
import type { Person, Settlement, SimulationState } from '../src/sim/types';

let base: Simulation;
beforeAll(() => { base = new Simulation({ seed: 'epidemiology', startingPopulation: 80, settlementCount: [2, 2], world: { size: 24 } }); });
function fixture(count = 160) {
  const state = structuredClone(base.state);
  state.month = 1; state.tradeRoutes = []; state.wars = [];
  const [a, b] = state.settlements as [Settlement, Settlement];
  const template = state.people[0]!;
  state.people = [a, b].flatMap(s => Array.from({ length: count }, (_, i): Person => ({ ...structuredClone(template),
    id: `${s.id}:patient:${i}`, homeId: s.id, ageMonths: 360, alive: true, health: 1,
    occupation: 'farmer', infection: undefined, immunity: undefined, activity: 'farm', partnerId: undefined })));
  for (const s of [a, b]) {
    s.buildings = 1; s.pollution = 0; s.conflictPressure = 0; s.foodSecurity = 1;
    s.resources.goods = 100; s.resources.food = 1000;
    survivalState(s).deprivation = 0; s.survival!.exposureDose = 0;
    s.survival!.disease = undefined;
    s.development!.water = { evaluatedMonth: 1, availability: 1, reliability: 1, quality: 1,
      sanitation: 1, irrigation: 0, droughtStress: 0, floodContamination: 0, surfaceAccess: 1, builtService: 1, droughtMonths: 0 };
    diseaseState(s);
  }
  return { state, a, b, people: state.people.filter(p => p.homeId === a.id) };
}
function infect(people: Person[], count: number, pathogen: 'respiratory' | 'enteric' | 'zoonotic' = 'respiratory', recoveryMonth = 5) {
  for (const p of people.slice(0, count)) p.infection = { pathogen, acquiredMonth: 0, infectiousMonth: 1, recoveryMonth, severity: 0.6 };
}
function labour(state: SimulationState) {
  invalidateLabour(state);
  const groups = new Map(state.settlements.map(s => [s.id, state.people.filter(p => p.alive && p.homeId === s.id)]));
  beginLabourMonth(state, groups);
}
function tick(state: SimulationState, response: 'wait' | 'care' | 'contain' = 'wait') {
  for (const s of state.settlements) diseaseState(s).response = response;
  labour(state); resolveDisease(state); state.month++;
}

describe('causal infectious disease', () => {
  it('requires infected contact for viral spread, including real delivered freight rather than nominal routes', () => {
    const isolated = fixture(), connected = fixture();
    for (const f of [isolated, connected]) infect(f.people, 70, 'respiratory', 20);
    for (const f of [isolated, connected]) f.state.tradeRoutes.push({ id: 'route', a: f.a.id, b: f.b.id, active: true,
      volume: 2, ageMonths: 1, caravanProgress: 0, caravanDirection: 1, mode: 'land', knowledgeFlow: 0, cumulativeKnowledge: 0,
      transport: { nextDispatchMonth: 0, projectIds: [] } });
    for (let month = 1; month <= 8; month++) {
      connected.state.tradeRoutes[0]!.transport!.lastDeliveryMonth = month;
      tick(isolated.state); tick(connected.state);
    }
    expect(diseaseState(isolated.b).cases).toBe(0);
    expect(diseaseState(connected.b).cases).toBeGreaterThan(10);
    const first = connected.state.history.find(e => e.locationId === connected.b.id && e.tags.includes('disease'))!;
    expect(first.context.importedContact).toBeGreaterThan(0);
    expect(first.causes).toContain(diseaseState(connected.a).episodeEventId);
  });

  it('derives emergence from contaminated water and crowding, and severity from missed nutrition and cold', () => {
    const dirty = fixture(), clean = fixture();
    dirty.a.development!.water!.quality = 0; dirty.a.development!.water!.sanitation = 0;
    dirty.a.development!.water!.floodContamination = 1;
    dirty.a.survival!.deprivation = 6; dirty.a.survival!.cold.exposure = 1;
    for (let i = 0; i < 18; i++) { tick(dirty.state); tick(clean.state); }
    expect(diseaseState(dirty.a).cases).toBeGreaterThan(20);
    expect(diseaseState(clean.a).cases).toBe(0);
    expect(diseaseEnvironment(dirty.state, dirty.a, 160).severity).toBeGreaterThan(diseaseEnvironment(clean.state, clean.a, 160).severity);
    const dense = diseaseEnvironment(dirty.state, dirty.a, 160);
    dirty.a.buildings = 100;
    expect(diseaseEnvironment(dirty.state, dirty.a, 160).reservoir.enteric).toBeLessThan(dense.reservoir.enteric);
    expect(diseaseEnvironment(dirty.state, dirty.a, 160).reservoir.zoonotic).toBe(0);
    expect(diseaseEnvironment(dirty.state, dirty.a, 160, 1).reservoir.zoonotic).toBeGreaterThan(0);
  });

  it('charges containment to the shared labour and goods budgets and reduces cumulative infections', () => {
    const ignored = fixture(300), contained = fixture(300);
    for (const f of [ignored, contained]) infect(f.people, 20, 'respiratory', 8);
    diseaseState(contained.a).practice = 0.8;
    diseaseState(contained.a).response = 'contain'; labour(contained.state);
    labour(ignored.state);
    expect(settlementLabour(contained.state, contained.a).economy.farmer).toBeLessThan(settlementLabour(ignored.state, ignored.a).economy.farmer!);
    expect(diseaseState(contained.a).labourSpent).toBeGreaterThan(0);
    for (let i = 0; i < 14; i++) { tick(ignored.state); tick(contained.state, 'contain'); }
    expect(diseaseState(contained.a).cases).toBeLessThan(diseaseState(ignored.a).cases * 0.6);
    expect(contained.a.resources.goods).toBeLessThan(ignored.a.resources.goods);
    expect(contained.a.resources.goods).toBeGreaterThanOrEqual(0);
    expect(ignored.state.history.some(e => e.type === 'response-resolved' && e.context.response === 'wait' && e.context.cases as number > 0)).toBe(true);
  });

  it('cannot obtain protection or consume treatment goods without actual workers', () => {
    const { state, a, people } = fixture(); infect(people, 20);
    for (const p of state.people) p.occupation = 'child';
    const before = a.resources.goods;
    tick(state, 'contain');
    expect(diseaseState(a).labourSpent).toBe(0);
    expect(diseaseState(a).protection).toBe(0);
    expect(a.resources.goods).toBe(before);
  });

  it('carries infection with migrants and preserves individual immunity through recovery', () => {
    const { state, a, b, people } = fixture(); infect(people, 25, 'respiratory', 3);
    for (const p of people.slice(0, 20)) { p.homeId = b.id; p.activity = 'migrate'; }
    tick(state);
    expect(diseaseState(b).cases).toBe(0);
    for (const p of people.slice(0, 20)) p.activity = 'farm';
    for (let i = 0; i < 3; i++) tick(state);
    expect(diseaseState(b).cases).toBeGreaterThan(0);
    const recovered = people.find(p => p.alive && p.immunity?.respiratory)!;
    expect(recovered).toBeDefined();
    expect(recovered.infection).toBeUndefined();
    recovered.homeId = a.id;
    infect(state.people.filter(p => p.alive && p !== recovered && p.homeId === a.id), 50, 'respiratory', 30);
    for (let i = 0; i < 6; i++) tick(state);
    expect(recovered.infection).toBeUndefined();
  });

  it('links deaths to outbreaks, reduces labour and conception, and conserves living people', () => {
    const { state, a, people } = fixture(300); infect(people, 250, 'zoonotic', 15);
    const healthy = structuredClone(people[0]!); healthy.infection = undefined;
    expect(workAvailability(people[0]!)).toBeLessThan(workAvailability(healthy));
    const woman = people[0]!, partner = people[1]!;
    woman.sex = 'female'; woman.partnerId = partner.id; partner.partnerId = woman.id;
    woman.pregnancy = undefined; woman.lastBirthMonth = -100; woman.reproductiveRecoveryUntilMonth = 0;
    const sickChance = conceptionChance(woman, partner, a, 1, 1, 1);
    expect(sickChance).toBeLessThan(conceptionChance({ ...woman, infection: undefined }, { ...partner, infection: undefined }, a, 1, 1, 1));
    const before = state.people.filter(p => p.alive).length, deaths = state.stats.deaths;
    for (let i = 0; i < 8; i++) tick(state);
    const lost = before - state.people.filter(p => p.alive).length;
    expect(lost).toBeGreaterThan(15);
    expect(state.stats.deaths - deaths).toBe(lost);
    const death = state.history.find(e => e.type === 'death' && e.causes.includes('infection'))!;
    expect(death.context.pathogen).toBe('zoonotic');
    expect(death.causes.some(id => state.history.some(e => e.id === id && e.type === 'pressure-detected'))).toBe(true);
  });

  it('retains paid medical experience and cultural memory that influence subsequent decisions and infrastructure', () => {
    const f = fixture(300); infect(f.people, 240, 'respiratory', 2);
    for (let episode = 0; episode < 12; episode++) {
      for (const p of f.people.filter(p => p.alive)) { p.immunity = undefined; p.infection = undefined; }
      infect(f.people.filter(p => p.alive), 180, 'respiratory', f.state.month + 1);
      tick(f.state, 'care'); tick(f.state, 'care');
    }
    const h = diseaseState(f.a);
    expect(h.practice).toBeGreaterThan(0.1);
    expect(h.adaptationEventId).toBeDefined();
    expect(f.state.cultures.some(c => c.memory.healthCrisis)).toBe(true);
    const c = developmentContext(f.state, f.a);
    const pressure = evaluatePressures(c).pressures.healthcare!;
    const memory = h.memory; h.memory = 0;
    expect(evaluatePressures(c).pressures.healthcare).toBeLessThan(pressure);
    h.memory = memory;
    const novice = structuredClone(f.state); diseaseState(novice.settlements[0]!).practice = 0;
    tick(f.state, 'care'); tick(novice, 'care');
    expect(h.protection).toBeGreaterThan(diseaseState(novice.settlements[0]!).protection);
  });

  it('resolves statistical populations independently of documentary samples and charges mortality exactly once', () => {
    const f = fixture();
    f.state.advanced.scale = 'modern-statistical'; f.state.advanced.representedPopulation = 100000;
    for (const city of f.state.advanced.cities) city.population = 50000;
    const h = diseaseState(f.a);
    h.compartments.zoonotic.infectious = 0.5; h.prevalence = 0.5;
    const sparse = structuredClone(f.state); sparse.people = sparse.people.slice(0, 1);
    const beforeDeaths = f.state.stats.deaths;
    resolveDisease(f.state); resolveDisease(sparse);
    expect(f.state.advanced.representedPopulation).toBe(sparse.advanced.representedPopulation);
    expect(f.state.advanced.representedPopulation).toBeLessThan(100000);
    expect(f.state.advanced.cities.reduce((n, c) => n + c.population, 0)).toBeCloseTo(f.state.advanced.representedPopulation);
    expect(f.state.stats.deaths - beforeDeaths).toBeCloseTo(100000 - f.state.advanced.representedPopulation);
    const resolved = structuredClone(f.state);
    resolveDisease(f.state);
    expect(f.state).toEqual(resolved);
    expect(h.compartments.zoonotic.infectious + h.compartments.zoonotic.immune + h.compartments.zoonotic.exposed).toBeLessThanOrEqual(1);
  });

  it('exposes linked scarcity, migration, unrest, and political evidence without scheduling disasters', () => {
    const { state, a } = fixture();
    observeSocialPressures(state);
    const prior = structuredClone(a.survival!.observations);
    a.survival!.deprivation = 9; a.survival!.exposureDose = 8; diseaseState(a).prevalence = 0.5;
    a.conflictPressure = 0.8;
    state.month++; observeSocialPressures(state);
    expect(a.survival!.observations.unrest!.perceived).toBeGreaterThan(prior.unrest!.perceived);
    expect(a.survival!.observations.migration!.perceived).toBeGreaterThan(prior.migration!.perceived);
    expect(a.survival!.observations.politics!.responses).toContain('secession');
    expect(a.survival!.observations.scarcity!.responses).toContain('trade');
    expect(a.survival!.observations.war!.responses).toContain('negotiation');
  });

  it('persists causal evidence in archives and reproduces a JSON-restored infection trajectory', () => {
    const f = fixture(); infect(f.people, 50);
    const archive = new RunRecordBuilder(createRunIdentity(base.config, f.state, 1, '2026-10-04T00:00:00Z'), base.config, f.state);
    tick(f.state, 'care');
    const restored = JSON.parse(JSON.stringify(f.state)) as SimulationState;
    for (let i = 0; i < 8; i++) { tick(f.state, 'care'); tick(restored, 'care'); }
    expect(JSON.parse(JSON.stringify(f.state))).toEqual(JSON.parse(JSON.stringify(restored)));
    const eventIds = f.state.history.filter(e => e.tags.includes('disease')).map(e => e.id);
    f.state.history = [];
    const record = archive.update(f.state, new Set(), [], []);
    expect(eventIds.every(id => record.events.some(e => e.id === id))).toBe(true);
    expect(record.majorEntities.settlements[0]!.survival!.disease).toEqual(diseaseState(f.a));
  });

  it('does not invent a second pandemic shock in the advanced risk system', () => {
    const { state } = fixture();
    state.advanced.scale = 'modern-statistical'; state.advanced.representedPopulation = 100000;
    state.advanced.sectors.biotechnology = 1; state.advanced.governance.fragmentation = 1;
    const system = new AdvancedCivilizationSystem(base.config, new SeededRandom('no-scripted-pandemic'));
    const before = state.stats.pandemics;
    for (let year = 0; year < 10; year++) { state.month += 12; system.advanceYear(state); }
    expect(state.stats.pandemics).toBe(before);
    expect(state.advanced.risks.pandemic.annualProbability).toBe(0);
  });

  it('makes response planning idempotent and grounded in observed illness', () => {
    const { state, a } = fixture(); diseaseState(a).prevalence = 0.6;
    planDisease(state, a, 160);
    const before = structuredClone(a);
    planDisease(state, a, 160);
    expect(a).toEqual(before);
    expect(a.survival!.observations.disease!.perceived).toBe(1);
  });

  it('preserves occupational capacity at scale transition without fossilizing temporary sickness', () => {
    const { people } = fixture();
    const healthy = workforceProfile(people, 1, 1);
    infect(people, 100);
    expect(workforceProfile(people, 1, 1)).toEqual(healthy);
  });

  it('captures surviving infections at the actual statistical transition after demographic changes', () => {
    const { state, a, people } = fixture();
    infect(people, 40);
    for (const p of people.slice(0, 10)) p.alive = false;
    a.industry.active = true;
    a.knowledge.records['modern-medicine'] = { id: 'modern-medicine', theory: 1, practice: 1,
      adoptedMonth: 0, discoveredMonth: 0, lastUsedMonth: 0, originSettlementId: a.id,
      lineageId: 'transition-medicine', parentLineages: [], source: 'inheritance', dormant: false };
    new AdvancedCivilizationSystem(base.config, new SeededRandom('infection-transition')).advanceMonth(state);
    expect(state.advanced.scale).toBe('modern-statistical');
    expect(diseaseState(a).compartments.respiratory.infectious).toBeCloseTo(30 / 150);
    expect(diseaseState(a).populationBasis).toBe(150);
  });

  it('makes retained care practice reduce the attack rate of a later outbreak under the same paid response', () => {
    const novice = fixture(400), experienced = fixture(400);
    infect(novice.people, 25, 'respiratory', 8); infect(experienced.people, 25, 'respiratory', 8);
    diseaseState(experienced.a).practice = 0.9;
    for (let i = 0; i < 12; i++) { tick(novice.state, 'care'); tick(experienced.state, 'care'); }
    expect(diseaseState(experienced.a).cases).toBeLessThan(diseaseState(novice.a).cases);
    expect(diseaseState(experienced.a).deaths).toBeLessThanOrEqual(diseaseState(novice.a).deaths);
  });

  it('does not propagate faster when settlement iteration order changes', () => {
    const f = fixture(); infect(f.people, 50, 'respiratory', 10);
    f.state.tradeRoutes.push({ id: 'arrival', a: f.a.id, b: f.b.id, active: true, volume: 1, ageMonths: 1,
      caravanProgress: 0, caravanDirection: 1, mode: 'land', knowledgeFlow: 0, cumulativeKnowledge: 0,
      transport: { lastDeliveryMonth: 1, nextDispatchMonth: 2, projectIds: [] } });
    const reversed = structuredClone(f.state); reversed.settlements.reverse();
    tick(f.state); tick(reversed);
    const statuses = (s: SimulationState) => s.people.map(p => ({ id: p.id, alive: p.alive,
      pathogen: p.infection?.pathogen, acquiredMonth: p.infection?.acquiredMonth, severity: p.infection?.severity }));
    expect(statuses(f.state)).toEqual(statuses(reversed));
  });

  it('propagates a severe outbreak through the integrated economy, demography and political state', () => {
    const config = { seed: 'integrated-epidemic', startingPopulation: 100, settlementCount: [2, 2] as const, world: { size: 24 } };
    const sick = new Simulation(config), healthy = new Simulation(config), replay = new Simulation(config);
    for (const sim of [sick, healthy, replay]) {
      for (const p of sim.state.people) { p.infection = undefined; p.health = 1; p.ageMonths = 360; p.occupation = 'farmer'; p.pregnancy = undefined; }
      for (const s of sim.state.settlements) s.resources.food = 1000;
    }
    infect(sick.state.people, 85, 'zoonotic', 14); infect(replay.state.people, 85, 'zoonotic', 14);
    let sickOutput = 0, healthyOutput = 0;
    for (let i = 0; i < 12; i++) {
      sick.step(); healthy.step(); replay.step();
      sickOutput += sick.state.settlements.reduce((n, s) => n + (s.survival?.food?.production ?? 0), 0);
      healthyOutput += healthy.state.settlements.reduce((n, s) => n + (s.survival?.food?.production ?? 0), 0);
    }
    expect(sickOutput).toBeLessThan(healthyOutput);
    expect(sick.state.stats.deaths).toBeGreaterThan(healthy.state.stats.deaths);
    expect(sick.state.settlements.some(s => (s.survival?.disease?.deaths ?? 0) > 0)).toBe(true);
    expect(sick.state.settlements.reduce((n, s) => n + s.conflictPressure, 0)).toBeGreaterThan(healthy.state.settlements.reduce((n, s) => n + s.conflictPressure, 0));
    expect(sick.state.cultures.some(c => c.memory.healthCrisis)).toBe(true);
    expect(sick.state.history).toEqual(replay.state.history);
    expect(sick.summary()).toEqual(replay.summary());
    expect(sick.state.history).not.toEqual(healthy.state.history);
  }, 30000);
});
