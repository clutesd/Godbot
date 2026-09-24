import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { AdvancedCivilizationSystem } from '../src/sim/advanced/AdvancedCivilizationSystem';
import { SeededRandom } from '../src/sim/prng';
import { Historian } from '../src/historian/Historian';
import { createRunIdentity, RunRecordBuilder } from '../src/historian/RunArchive';
import { developmentContext, evaluatePressures } from '../src/sim/development/SettlementDevelopmentSystem';
import { explicitLabour, settlementLabour } from '../src/sim/people/HumanCapital';
import { addMaterial } from '../src/sim/resources/Inventory';
import { observePressure } from '../src/sim/pressures/Pressure';
import { adaptFoodCareer, adjustFoodProduction, allocateSurvivalLabour, applyCold, beginFoodMonth, chooseFoodResponse,
  foodNeed, foodResponseOptions, foodStorageCapacity, foundingFirstFirePlan, observeFood, resolveSurvival, survivalHealthChange, survivalMortality, survivalState } from '../src/sim/pressures/Survival';
import type { Settlement, SimulationState } from '../src/sim/types';

let base: Simulation;
beforeAll(() => { base = new Simulation({ seed: 'causal-food', startingPopulation: 80, settlementCount: [2, 2], world: { size: 24 } }); });
function fixture() {
  const state = structuredClone(base.state);
  const s = state.settlements[0]!;
  const residents = state.people.filter(p => p.alive && p.homeId === s.id);
  const culture = state.cultures.find(c => s.cultureShares[c.id])!;
  return { state, s, residents, culture, population: residents.length };
}
function learn(s: Settlement, id: string) {
  s.knowledge.records[id] = { id, theory: 1, practice: 1, adoptedMonth: 0, discoveredMonth: 0, lastUsedMonth: 0,
    originSettlementId: s.id, lineageId: `test:${id}`, parentLineages: [], source: 'inheritance', dormant: false };
}
function feed(state: SimulationState, s: Settlement, population: number, production: number) {
  state.month++;
  beginFoodMonth(s, population, production, state.month);
  resolveSurvival(state, s, population);
}

describe('survival pressure and physical consequences', () => {
  it('recognizes falling reserves, negative flow and rising urgency before starvation', () => {
    const { s, population } = fixture();
    s.resources.food = foodNeed(s, population) * 6; s.monthlyBalance.food = 1;
    const secure = observeFood(s, population, 1);
    s.resources.food = foodNeed(s, population) * 2; s.monthlyBalance.food = -3;
    const risk = observeFood(s, population, 2);
    s.resources.food = 0; s.monthlyBalance.food = -foodNeed(s, population);
    const severe = observeFood(s, population, 3);
    expect(secure.intensity).toBe(0);
    expect(risk.perceived).toBeGreaterThan(secure.perceived);
    expect(severe.intensity).toBeGreaterThan(risk.intensity);
    expect(severe.trend).toBeGreaterThan(0);
    expect(severe.evidence.reserves).toBe(0);
    expect(severe.causes).toContain('negative-food-balance');
  });

  it('preserves food mass and charges deprivation gradually, with delayed mortality and gradual recovery', () => {
    const { state, s, population } = fixture();
    s.resources.food = 0;
    feed(state, s, population, 0);
    expect(s.survival?.deprivation).toBe(1);
    expect(survivalMortality(s)).toBe(0);
    expect(survivalHealthChange(s)).toBeLessThan(0);
    for (let m = 0; m < 7; m++) feed(state, s, population, 0);
    expect(survivalMortality(s)).toBeGreaterThan(0.2);
    const high = s.survival!.observations.food!.intensity;
    const debt = s.survival!.deprivation;
    feed(state, s, population, foodNeed(s, population) * 8);
    expect(s.survival!.deprivation).toBeGreaterThan(0);
    expect(s.survival!.deprivation).toBeLessThan(debt);
    expect(s.survival!.observations.food!.intensity).toBeLessThan(high);
    for (let m = 0; m < 30; m++) feed(state, s, population, foodNeed(s, population) * 1.2);
    expect(s.survival!.deprivation).toBe(0);
    expect(survivalMortality(s)).toBe(0);
    const before = s.resources.food;
    beginFoodMonth(s, population, 5, ++state.month);
    const ledger = s.survival!.food!;
    expect(before + 5).toBeCloseTo(s.resources.food + ledger.consumed + ledger.spoiled, 9);
    resolveSurvival(state, s, population);
    const once = structuredClone(s.survival);
    resolveSurvival(state, s, population);
    expect(s.survival).toEqual(once);
  });

  it('accounts for drought at empty stores and feeds imports before assessing missed calories', () => {
    const { state, s, population } = fixture();
    state.month = 1; s.resources.food = 0;
    const need = foodNeed(s, population);
    beginFoodMonth(s, population, need, 1);
    adjustFoodProduction(s, -need * 0.5, 1);
    expect(s.survival!.food!.consumed).toBeCloseTo(need * 0.5);
    s.resources.food += need * 0.5; // actual import delivery uses the same stock
    resolveSurvival(state, s, population);
    expect(s.survival!.deprivation).toBe(0);
    expect(s.resources.food).toBeCloseTo(0);
  });

  it('revises the uncapped harvest before discarding overflow, without creating artificial starvation', () => {
    const { state, s, population } = fixture();
    state.month = 1; s.resources.food = 0;
    const capacity = foodStorageCapacity(s, population);
    beginFoodMonth(s, population, capacity * 5, state.month);
    expect(s.survival!.food!.overflow).toBeGreaterThan(0);
    adjustFoodProduction(s, -capacity * 3, state.month);
    resolveSurvival(state, s, population);
    const ledger = s.survival!.food!;
    expect(s.resources.food).toBe(capacity);
    expect(ledger.consumed).toBe(ledger.need);
    expect(s.survival!.deprivation).toBe(0);
    expect(ledger.production).toBeCloseTo(s.resources.food + ledger.consumed + ledger.overflow);
  });

  it('makes functional storage reduce spoilage and increase capacity', () => {
    const { s, population } = fixture();
    const store = structuredClone(s);
    const plot = store.structurePlots!.find(p => p.development)!;
    plot.development!.form = 'store'; plot.development!.services.food = 1;
    plot.development!.status = 'active'; plot.condition = 1; plot.accessRestricted = false;
    s.resources.food = store.resources.food = 100;
    beginFoodMonth(s, population, 0, 1); beginFoodMonth(store, population, 0, 1);
    expect(store.survival!.food!.spoiled).toBeLessThan(s.survival!.food!.spoiled);
    expect(foodStorageCapacity(store, population)).toBeGreaterThan(foodStorageCapacity(s, population));
    plot.accessRestricted = true;
    expect(foodStorageCapacity(store, population)).toBe(foodStorageCapacity(s, population));
  });

  it('requires fire knowledge and real fuel; shelter and fuel independently mitigate cold', () => {
    const { state, s, population } = fixture();
    state.weather.cells[s.cellIndex]!.temperature = 0;
    s.structurePlots = []; s.localMaterials = {}; s.materialEconomy = undefined;
    delete s.knowledge.records['fire-control'];
    addMaterial(s, 'timber', 10);
    state.month = 1; applyCold(state, s, population);
    const exposed = s.survival!.cold.exposure;
    expect(s.survival!.cold.fuelUsed).toBe(0);
    learn(s, 'fire-control');
    state.month++; applyCold(state, s, population);
    expect(s.survival!.cold.fuelUsed).toBeCloseTo(population * 0.006);
    expect(s.survival!.cold.exposure).toBeLessThan(exposed);
    const timber = s.localMaterials.timber;
    applyCold(state, s, population);
    expect(s.localMaterials.timber).toBe(timber);
    s.structurePlots = structuredClone(base.state.settlements[0]!.structurePlots);
    for (const plot of s.structurePlots ?? []) if (plot.development) { plot.development.services.housing = 100; plot.condition = 1; }
    state.month++; applyCold(state, s, population);
    expect(s.survival!.cold.exposure).toBeLessThan(exposed * 0.2);
  });

  it('records a founding camp first fire in warm weather and keeps routine hearth use resource-backed', () => {
    const { state, s, population } = fixture();
    s.foundingPodId = 'test-founding-pod';
    s.foundedMonth = 0;
    state.weather.cells[s.cellIndex]!.temperature = 0.8;
    s.structurePlots = []; s.localMaterials = {}; s.materialEconomy = undefined;
    addMaterial(s, 'timber', 10);
    learn(s, 'fire-control');

    const before = s.localMaterials.timber!;
    const plan = foundingFirstFirePlan(state, s, population)!;
    expect(plan.plannedMonth).toBeGreaterThan(0);

    // Landing/first monthly evaluation may reserve and plan the hearth, but warm camps do not
    // receive a finished fireplace for free.
    for (let month = 1; month < plan.plannedMonth; month++) {
      state.month = month;
      applyCold(state, s, population);
      expect(s.survival!.cold.fuelUsed).toBe(0);
      expect(s.survival!.hearth!.fuelUsed).toBe(0);
      expect(s.survival!.firstFire).toBeUndefined();
      expect(s.localMaterials.timber).toBe(before);
    }

    state.month = plan.plannedMonth; applyCold(state, s, population);
    expect(s.survival!.cold.fuelUsed).toBe(0);
    expect(s.survival!.hearth!.fuelUsed).toBeGreaterThan(0);
    expect(s.localMaterials.timber).toBeLessThan(before);
    const milestone = structuredClone(s.survival!.firstFire);
    expect(milestone).toMatchObject({ month: plan.plannedMonth, eventId: expect.any(String),
      plannedMonth: plan.plannedMonth, readiness: expect.any(Number) });
    const event = state.history.find(e => e.id === milestone!.eventId)!;
    expect(event.type).toBe('first-fire');
    expect(event.locationId).toBe(s.id);
    expect(event.context.foundingPodId).toBe('test-founding-pod');
    expect(event.context.purpose).toBe('founding-hearth');
    expect(event.context.plannedMonth).toBe(plan.plannedMonth);
    expect(event.context.ignitionReadiness).toBeGreaterThanOrEqual(0);
    expect(event.causes).toContain('site-readiness');

    const afterIgnition = s.localMaterials.timber!;
    state.month = plan.plannedMonth + 1; applyCold(state, s, population);
    expect(s.survival!.cold.fuelUsed).toBe(0);
    expect(s.survival!.hearth!.fuelUsed).toBeGreaterThan(0);
    expect(s.localMaterials.timber).toBeLessThan(afterIgnition);
    expect(s.survival!.firstFire).toEqual(milestone);
    expect(state.history.filter(e => e.type === 'first-fire' && e.locationId === s.id)).toHaveLength(1);
  });

  it('gives founding camps different ignition windows from local readiness instead of a shared timer', () => {
    const simulation = new Simulation({ seed: 'arrival-day-preview', startMode: 'arrival' });
    simulation.advanceArrival(80);
simulation.beginHistory();
    const founding = simulation.state.settlements.filter(settlement => settlement.foundingPodId);
    expect(founding).toHaveLength(5);

    const plans = founding.map(settlement => {
      const population = simulation.state.people.filter(person => person.alive && person.homeId === settlement.id).length;
      return foundingFirstFirePlan(simulation.state, settlement, population)!;
    });
    const plannedMonths = plans.map(plan => plan.plannedMonth);
    expect(new Set(plannedMonths).size).toBe(founding.length);
    expect(Math.min(...plannedMonths)).toBeGreaterThanOrEqual(1);
    const byRank = [...plans].sort((a, b) => a.rank - b.rank);
    for (let index = 1; index < byRank.length; index++) {
      expect(byRank[index]!.plannedMonth).toBeGreaterThan(byRank[index - 1]!.plannedMonth);
    }
    expect(byRank[0]!.rank).toBe(0);
    for (const plan of plans) {
      expect(plan.readiness).toBeGreaterThanOrEqual(0);
      expect(plan.readiness).toBeLessThanOrEqual(1);
      expect(plan.drivers.coldUrgency).toBeGreaterThanOrEqual(0);
      expect(plan.drivers.shelterNeed).toBeGreaterThanOrEqual(0);
      expect(plan.drivers.woodland).toBeGreaterThanOrEqual(0);
      expect(plan.drivers.fuelSecurity).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not create a first-fire milestone for non-founding settlements', () => {
    const { state, s, population } = fixture();
    delete s.foundingPodId;
    state.weather.cells[s.cellIndex]!.temperature = 0;
    s.structurePlots = []; s.localMaterials = {}; s.materialEconomy = undefined;
    addMaterial(s, 'timber', 10);
    learn(s, 'fire-control');

    state.month = 1; applyCold(state, s, population);
    expect(s.survival!.cold.fuelUsed).toBeGreaterThan(0);
    expect(s.survival!.firstFire).toBeUndefined();
    expect(s.survival!.hearth).toBeUndefined();
    expect(state.history.some(e => e.type === 'first-fire' && e.locationId === s.id)).toBe(false);
  });
});

describe('local choice, adaptation and causal evidence', () => {
  it('offers only feasible alternatives and permits divergence and delay under the same pressure', () => {
    const selected = new Set<string>();
    for (let seed = 0; seed < 160; seed++) {
      const { state, s, population, culture } = fixture();
      state.seed = `choice-${seed}`; state.month = 1;
      state.world.cells[s.cellIndex]!.fertility = 0.6;
      state.world.cells[s.cellIndex]!.water = false;
      s.resources.food = 2; s.monthlyBalance.food = -foodNeed(s, population);
      survivalState(s).food = { month: 0, population, need: foodNeed(s, population), target: 0, consumed: 0, production: 0, spoiled: 0, overflow: 0, extraProduction: 0 };
      learn(s, 'crop-selection');
      chooseFoodResponse(state, s, population, 10, culture);
      selected.add(s.survival!.response!.kind);
      const replay = structuredClone(s); replay.survival!.response = undefined; replay.survival!.nextDecisionMonth = 0;
      chooseFoodResponse(state, replay, population, 10, culture);
      expect(replay.survival!.response!.kind).toBe(s.survival!.response!.kind);
    }
    expect(selected).toEqual(new Set(['forage', 'cultivate', 'ration', 'wait']));
    const { s } = fixture();
    s.knowledge.records = {}; s.resources.food = 0;
    expect(foodResponseOptions(s, 0.6, true, 2).map(o => o.kind)).toEqual(['wait', 'forage']);
    expect(foodResponseOptions(s, 0.6, false, 2).map(o => o.kind)).toEqual(['wait']);
    expect(foodResponseOptions(s, 0.6, true, 0).map(o => o.kind)).toEqual(['wait']);
  });

  it('takes response labour from other uses, preserves reservations and does not grant knowledge', () => {
    const { s, residents } = fixture();
    learn(s, 'crop-selection');
    const survival = survivalState(s);
    survival.response = { kind: 'cultivate', startedMonth: 1, untilMonth: 3, eventId: 'attempt', pressureEventId: 'pressure', baselinePressure: 0.8, extraProduction: 0, foodSaved: 0, labourSpent: 0 };
    const summary = explicitLabour(residents, 1);
    const prior = structuredClone(summary), knowledge = structuredClone(s.knowledge);
    allocateSurvivalLabour(s, summary);
    const total = (a: typeof summary.economy) => Object.values(a).reduce((n, value) => n + value, 0);
    expect(summary.survivalReassigned).toBeGreaterThan(0);
    expect(total(summary.economy)).toBeLessThan(total(prior.economy));
    expect(summary.economy.farmer).toBeGreaterThan(prior.economy.farmer!);
    expect(summary.resources).toEqual(prior.resources);
    expect(summary.infrastructure).toBe(prior.infrastructure);
    expect(s.knowledge).toEqual(knowledge);
    expect(survival.reassignedLabour).toBe(0); // read-only labour queries cannot alter simulation telemetry
  });

  it('does not call an ineffective response successful and grounds each decision in archived evidence', () => {
    const { state, s, population, culture } = fixture();
    const identity = createRunIdentity(base.config, state, 1, '2026-09-16T00:00:00Z');
    const archive = new RunRecordBuilder(identity, base.config, state);
    s.resources.food = 0; s.monthlyBalance.food = -foodNeed(s, population); state.month = 1;
    chooseFoodResponse(state, s, population, 0, culture); // delay is the only feasible response
    const attempt = structuredClone(s.survival!.response!);
    for (; state.month <= attempt.untilMonth; state.month++) {
      beginFoodMonth(s, population, 0, state.month);
      resolveSurvival(state, s, population, culture);
    }
    const outcome = state.history.find(e => e.type === 'response-resolved')!;
    expect(outcome.context.succeeded).toBe(false);
    expect(outcome.context.extraProduction).toBe(0);
    expect(outcome.causes).toContain(attempt.eventId);
    expect(s.survival!.experience.wait!.preference).toBeLessThan(0);
    expect(culture.memory.foodScarcity?.eventId).toBeDefined();
    const c = developmentContext(state, s);
    const withMemory = evaluatePressures(c).pressures.food!;
    const memory = culture.memory.foodScarcity;
    culture.memory.foodScarcity = undefined;
    expect(withMemory).toBeGreaterThan(evaluatePressures(c).pressures.food!);
    culture.memory.foodScarcity = memory;
    const historian = new Historian(base.config);
    const scene = historian.chooseScene(state, outcome.id);
    expect(historian.validateStatement(scene.statement, state)).toBe(true);
    expect(scene.statement.sourceEventIds).toContain(outcome.id);
    state.history = []; // observer must have retained causal parents before hot-history eviction
    const record = archive.update(state, new Set(), [], []);
    for (const id of [attempt.pressureEventId, attempt.eventId, outcome.id, memory!.eventId]) expect(record.events.some(e => e.id === id)).toBe(true);
    expect(record.majorEntities.settlements.find(v => v.id === s.id)?.survival).toEqual(s.survival);
  });

  it('starts a fresh causal episode after recovery even when the decision cooldown delays recognition', () => {
    const { state, s, population } = fixture();
    state.month = 1; s.resources.food = 0; s.monthlyBalance.food = -foodNeed(s, population);
    chooseFoodResponse(state, s, population, 0);
    const previousRoot = s.survival!.response!.pressureEventId;
    s.survival!.response = undefined;
    s.resources.food = foodNeed(s, population) * 6; s.monthlyBalance.food = 1;
    observeFood(s, population, 2);
    expect(s.survival!.observations.food!.eventId).toBeUndefined();
    state.month = 3; s.resources.food = 0; s.monthlyBalance.food = -foodNeed(s, population);
    chooseFoodResponse(state, s, population, 0);
    expect(s.survival!.response).toBeUndefined();
    state.month = 7; chooseFoodResponse(state, s, population, 0);
    expect(s.survival!.response!.pressureEventId).not.toBe(previousRoot);
    expect(state.history.find(e => e.id === s.survival!.response!.pressureEventId)!.month).toBe(7);
  });

  it('learns from measured repeated relief and can recruit a specialist without granting expertise', () => {
    const { state, s, residents, population, culture } = fixture();
    learn(s, 'crop-selection');
    state.world.cells[s.cellIndex]!.fertility = 0.8;
    state.world.cells[s.cellIndex]!.water = false;
    // Select real attempts, then supply the measured food ledger through three response windows.
    for (let episode = 0; episode < 3; episode++) {
      state.month = 30 + episode * 30;
      s.resources.food = 0; s.monthlyBalance.food = -foodNeed(s, population);
      for (let seed = 0; seed < 100; seed++) {
        state.seed = `successful-cultivation-${seed}`;
        survivalState(s).response = undefined;
        s.survival!.nextDecisionMonth = 0;
        chooseFoodResponse(state, s, population, residents.length, culture);
        if (s.survival!.response?.kind === 'cultivate') break;
      }
      expect(s.survival!.response!.kind).toBe('cultivate');
      const end = s.survival!.response!.untilMonth;
      for (; state.month <= end; state.month++) {
        beginFoodMonth(s, population, foodNeed(s, population) * 4, state.month, 2);
        resolveSurvival(state, s, population, culture);
      }
    }
    expect(s.survival!.experience.cultivate!.successes).toBe(3);
    expect(s.survival!.experience.cultivate!.preference).toBeGreaterThan(0);
    s.resources.food = 0; s.monthlyBalance.food = -foodNeed(s, population);
    observeFood(s, population, state.month);
    residents[0]!.occupation = 'builder'; residents[0]!.ageMonths = 360; residents[0]!.health = 1; residents[0]!.career = undefined;
    let specialist;
    for (let m = 0; m < 60 && !specialist; m++) { state.month++; specialist = adaptFoodCareer(state, s, residents); }
    expect(specialist).toBeDefined();
    expect(specialist!.career!.reason).toBe('repeated-food-response');
    expect(state.history.some(e => e.type === 'adaptation-established' && e.causes.includes(s.survival!.experience.cultivate!.eventId!))).toBe(true);
  });

  it('bounds invalid/empty/extreme observations and does not accumulate state on repeated reads', () => {
    const { s } = fixture();
    for (const value of [0, -1, NaN, Infinity, 1e100]) {
      s.resources.food = value; s.monthlyBalance.food = -value;
      const observation = observeFood(s, value, 1);
      const numbers = [observation.intensity, observation.perceived, observation.duration, observation.urgency, observation.trend, ...Object.values(observation.evidence)];
      expect(numbers.every(Number.isFinite)).toBe(true);
    }
    const previous = observeFood(s, 20, 2);
    const next = observePressure(previous, previous);
    expect(next.duration).toBe(previous.duration);
    expect(JSON.parse(JSON.stringify(s.survival))).toEqual(s.survival);
  });

  it('runs local evaluations without global data searches and works with aggregate labour', () => {
    const { state, s, residents } = fixture();
    survivalState(s);
    const started = performance.now();
    for (let m = 1; m <= 10000; m++) observeFood(s, 1000000, m);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(Object.keys(s.survival!.observations)).toHaveLength(1);
    const normal = settlementLabour(state, s, residents);
    expect(normal.population).toBe(residents.length);
    expect(Object.values(normal.economy).every(Number.isFinite)).toBe(true);
  });

  it('charges aggregate starvation independently of documentary samples and carrying-capacity growth', () => {
    const { state } = fixture();
    state.advanced.scale = 'modern-statistical';
    state.advanced.representedPopulation = 10000000;
    for (const city of state.advanced.cities) city.population = state.advanced.representedPopulation / state.advanced.cities.length;
    for (const s of state.settlements) { s.foodSecurity = 0; survivalState(s).deprivation = 10; }
    const fed = structuredClone(state), sampled = structuredClone(state);
    sampled.people = sampled.people.slice(0, 2);
    for (const s of fed.settlements) s.survival!.deprivation = 0;
    for (const input of [state, sampled, fed]) new AdvancedCivilizationSystem(base.config, new SeededRandom('aggregate-pressure')).advanceMonth(input);
    expect(state.advanced.representedPopulation).toBeLessThan(fed.advanced.representedPopulation);
    expect(state.advanced.representedPopulation).toBeLessThan(10000000);
    expect(state.advanced.representedPopulation).toBe(sampled.advanced.representedPopulation);
    expect(state.advanced.cities[0]!.health).toBeLessThan(fed.advanced.cities[0]!.health);
    const s = state.settlements[0]!;
    const workerCount = settlementLabour(state, s).population;
    expect(workerCount).toBeGreaterThan(1000);
    expect(settlementLabour(sampled, sampled.settlements[0]!).population).toBe(workerCount);
  });

  it('replays the integrated world and produces valid pressure and intake state', () => {
    const config = { seed: 'pressure-integration', startingPopulation: 80, settlementCount: [2, 2] as const, world: { size: 24 } };
    const first = new Simulation(config), second = new Simulation(config);
    first.step(24); second.step(24);
    expect(first.state.settlements.map(s => s.survival)).toEqual(second.state.settlements.map(s => s.survival));
    expect(first.summary()).toEqual(second.summary());
    expect(first.state.history).toEqual(second.state.history);
    expect(first.state.settlements.every(s => s.survival?.food && s.survival.food.consumed <= s.survival.food.need)).toBe(true);
  }, 30000);

  it('makes ignored starvation reduce health and kill people in the integrated demographic loop', () => {
    const config = { seed: 'ignored-starvation', startingPopulation: 80, settlementCount: [2, 2] as const, world: { size: 24 } };
    const hungry = new Simulation(config), fed = new Simulation(config);
    for (const simulation of [hungry, fed]) {
      for (const p of simulation.state.people) { p.occupation = 'keeper'; p.ageMonths = 360; p.health = 0.9; p.partnerId = undefined; }
      for (const s of simulation.state.settlements) { s.resources.food = 0; survivalState(s).nextDecisionMonth = 1000; }
    }
    for (let m = 0; m < 18; m++) {
      for (const s of fed.state.settlements) s.resources.food = 1000;
      hungry.step(); fed.step();
    }
    expect(hungry.state.settlements.some(s => s.survival!.deprivation >= 8)).toBe(true);
    const health = (sim: Simulation) => sim.state.people.reduce((n, p) => n + p.health, 0) / sim.population;
    expect(health(hungry)).toBeLessThan(health(fed) - 0.25);
    expect(hungry.state.stats.deaths).toBeGreaterThan(fed.state.stats.deaths);
    expect(hungry.state.history.some(e => e.type === 'death' && e.causes.includes('scarcity'))).toBe(true);
  }, 30000);
});
