import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { combinedSurvivalHazard, conceptionChance, founderLife, migrationHouseholds } from '../src/sim/people/Demography';
import { beginFoodMonth, foodNeed, resolveSurvival, survivalHealthChange, survivalMortality, survivalState } from '../src/sim/pressures/Survival';
import { demographicSeed, DEMOGRAPHIC_SEEDS } from '../scripts/demographic-seeds';
import { takeMaterial } from '../src/sim/resources/Inventory';
import { killPeople } from '../src/sim/people/PersonLifecycle';

function arrival(seed = 'demography-families') {
  const sim = new Simulation({ seed, startMode: 'arrival', world: { size: 64 } });
  sim.advanceArrival(80); sim.beginHistory(); return sim;
}

describe('demographic foundation', () => {
  it('has bounded diverse ages and both reproductive cohorts over 100 manifests', () => {
    const ages = new Set<number>();
    for (let seed = 0; seed < 100; seed++) {
      const cohort = Array.from({ length: 22 }, (_, i) => founderLife(`pod-${seed}`, i));
      expect(cohort.filter(p => p.ageMonths < 18 * 12)).toHaveLength(6);
      expect(cohort.filter(p => p.ageMonths >= 60 * 12)).toHaveLength(2);
      for (const sex of ['female', 'male']) expect(cohort.filter(p => p.sex === sex && p.ageMonths >= 18 * 12 && p.ageMonths < 43 * 12).length).toBeGreaterThanOrEqual(7);
      cohort.forEach(p => ages.add(p.ageMonths));
    }
    expect(ages.size).toBeGreaterThan(150);
  });

  it('links founders, partners, parents and household registry before Month 1; keeps inherited practical knowledge', () => {
    const sim = arrival();
    expect(sim.state.month).toBe(0);
    for (const pod of sim.state.arrival!.pods) {
      const people = sim.state.people.filter(p => pod.personIds.includes(p.id));
      expect(people.filter(p => p.partnerId)).toHaveLength(10);
      for (const p of people) {
        expect(sim.state.households!.some(h => h.id === p.householdId && h.memberIds.includes(p.id))).toBe(true);
        if (p.partnerId) {
          const partner = people.find(q => q.id === p.partnerId)!;
          expect(partner.partnerId).toBe(p.id); expect(partner.householdId).toBe(p.householdId);
        }
        if (p.ageMonths < 18 * 12) {
          expect(p.parents).toHaveLength(2);
          for (const id of p.parents) {
            const parent = people.find(q => q.id === id)!;
            expect(parent.children).toContain(p.id); expect(parent.householdId).toBe(p.householdId);
            expect(parent.ageMonths - p.ageMonths).toBeGreaterThanOrEqual(18 * 12);
          }
        }
      }
      const s = sim.state.settlements.find(s => s.id === pod.settlementId)!;
      for (const occupation of ['farmer', 'forager', 'builder']) expect(people.some(p => p.occupation === occupation)).toBe(true);
      expect(s.knowledge.records['fire-control']!.practice).toBeGreaterThanOrEqual(0.34);
      expect(s.knowledge.records['stone-composites']!.practice).toBeGreaterThanOrEqual(0.3);
      if (pod.name === 'Seed') expect(s.knowledge.records['seasonal-observation']!.practice).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('responds to age, partners, health, deprivation, security, density and postpartum recovery', () => {
    const sim = arrival(), p = sim.state.people.find(p => p.sex === 'female' && p.partnerId)!;
    const partner = sim.state.people.find(q => q.id === p.partnerId)!, s = sim.state.settlements.find(s => s.id === p.homeId)!;
    p.pregnancy = undefined; p.health = partner.health = 1; p.ageMonths = 25 * 12; p.lastBirthMonth = -100;
    const chance = () => conceptionChance(p, partner, s, 0, 1, 1);
    const healthy = chance(); expect(healthy).toBeGreaterThan(0);
    p.ageMonths = 40 * 12; expect(chance()).toBeLessThan(healthy); p.ageMonths = 25 * 12;
    p.health = 0.3; expect(chance()).toBe(0); p.health = 1;
    survivalState(s).deprivation = 3; expect(chance()).toBe(0); s.survival!.deprivation = 0;
    s.conflictPressure = 1; expect(chance()).toBe(0); s.conflictPressure = 0;
    expect(conceptionChance(p, partner, s, 0, 0.1, 1)).toBeLessThan(healthy);
    partner.alive = false; expect(chance()).toBe(0); partner.alive = true;
    p.lastBirthMonth = -17; expect(chance()).toBe(0);
  });

  it('keeps pregnancies authoritative, prevents repeated births and replays Arrival chunking', () => {
    const sim = arrival('demography-gestation'), replay = new Simulation({ seed: 'demography-gestation', startMode: 'arrival', world: { size: 64 } });
    for (let i = 0; i < 80; i++) replay.advanceArrival(1);
    replay.beginHistory(); expect(replay.state.people).toEqual(sim.state.people);
    const births = new Map<string, number>();
    for (let m = 1; m <= 60; m++) {
      sim.step(); replay.step();
      for (const e of sim.state.history.filter(e => e.type === 'birth' && e.month === m)) {
        const mother = e.actors[1]!;
        if (births.has(mother)) expect(m - births.get(mother)!).toBeGreaterThanOrEqual(27);
        births.set(mother, m);
      }
      expect(sim.population).toBe(110 + sim.state.stats.births - sim.state.stats.deaths);
    }
    expect(births.size).toBeGreaterThan(0); expect(replay.summary()).toEqual(sim.summary());
    expect(replay.state.people).toEqual(sim.state.people); expect(replay.state.history).toEqual(sim.state.history);
  }, 30000);

  it('moves households within a workforce budget and permits larger catastrophe departures', () => {
    const sim = arrival(), people = sim.state.people.filter(p => p.homeId === sim.state.settlements[0]!.id);
    const movers = migrationHouseholds(people, 1, false);
    expect(movers.length).toBeLessThanOrEqual(Math.floor(people.length * 0.2));
    for (const p of movers) expect(movers.filter(q => q.householdId === p.householdId)).toEqual(people.filter(q => q.householdId === p.householdId));
    const remaining = people.filter(p => !movers.includes(p));
    expect(remaining.filter(p => p.ageMonths >= 18 * 12 && p.ageMonths < 60 * 12).length).toBeGreaterThanOrEqual(8);
    expect(migrationHouseholds(people.slice(0, 8), 1, false)).toHaveLength(0);
    expect(migrationHouseholds(people, 1, true).length).toBeGreaterThan(movers.length);
  });

  it('preserves an unborn child’s parentage after the father dies', () => {
    const sim = arrival(), mother = sim.state.people.find(p => p.sex === 'female' && p.partnerId)!;
    const father = sim.state.people.find(p => p.id === mother.partnerId)!;
    mother.pregnancy = { dueMonth: 1, fatherId: father.id };
    killPeople(sim.state, [father], 'illness'); sim.step();
    expect(sim.state.people.some(p => p.bornMonth === 1 && p.parents.includes(mother.id) && p.parents.includes(father.id))).toBe(true);
  });
});

describe('survival injury and recovery', () => {
  it('recovers productive health after a moderate interruption without replenishing resources', () => {
    const sim = arrival('founding-loop-audit'); sim.step(12);
    const s = sim.state.settlements[0]!;
    const residents = () => sim.state.people.filter(p => p.alive && p.homeId === s.id);
    const careers = new Map(residents().map(p => [p.id, p.occupation]));
    s.resources.food = 0;
    for (const p of residents()) if (p.occupation === 'farmer') p.occupation = 'keeper';
    sim.step(3);
    const debt = s.survival!.deprivation;
    expect(debt).toBeGreaterThan(0);
    for (const p of residents()) if (careers.has(p.id)) p.occupation = careers.get(p.id)!;
    sim.step(24);
    expect(s.survival!.deprivation).toBeLessThan(debt);
    expect(residents().reduce((n, p) => n + p.health, 0) / residents().length).toBeGreaterThan(0.7);
    expect(s.survival!.food!.production).toBeGreaterThan(0);
    expect(sim.population).toBe(110 + sim.state.stats.births - sim.state.stats.deaths);
  }, 15000);

  it('does not charge reserves as nutrition or duplicate health and starvation hazards', () => {
    const sim = arrival(), s = sim.state.settlements[0]!;
    s.resources.food = 0; s.foodSecurity = 0;
    beginFoodMonth(s, 22, foodNeed(s, 22), ++sim.state.month); resolveSurvival(sim.state, s, 22);
    expect(s.survival!.deprivation).toBe(0); expect(survivalHealthChange(s)).toBeCloseTo(0);
    expect(combinedSurvivalHazard(0.1, 0.32, 0)).toBe(0.32);
    expect(combinedSurvivalHazard(0.1, 0, 0.08)).toBe(0.1);
    expect(combinedSurvivalHazard(0.1, 0.32, 0.08)).toBe(0.4);
  });

  it('bounds mild rationing, recovers from a short shortage, but preserves catastrophic injury', () => {
    const sim = arrival(), s = sim.state.settlements[0]!;
    const feed = (fraction: number) => {
      s.resources.food = 0;
      beginFoodMonth(s, 22, foodNeed(s, 22) * fraction, ++sim.state.month);
      resolveSurvival(sim.state, s, 22);
    };
    for (let m = 0; m < 120; m++) feed(0.88);
    expect(s.survival!.deprivation).toBeLessThan(2); expect(survivalMortality(s, 'food')).toBe(0);
    for (let m = 0; m < 12; m++) feed(1);
    expect(s.survival!.deprivation).toBe(0);
    for (let m = 0; m < 3; m++) feed(0.5);
    const injury = s.survival!.deprivation; expect(injury).toBeGreaterThan(0);
    for (let m = 0; m < 12; m++) feed(1);
    expect(s.survival!.deprivation).toBe(0);
    for (let m = 0; m < 24; m++) feed(0);
    expect(survivalMortality(s, 'food')).toBe(0.32); expect(survivalHealthChange(s)).toBeLessThan(-0.04);
    s.survival!.exposureDose = 10;
    expect(survivalMortality(s, 'cold')).toBe(0.08);
  });
});

describe('multi-generation distribution (full deterministic simulation)', () => {
  it('tracks 5/10/20/30/40-year replacement, mortality, founder retention and population accounting', () => {
    const reports = DEMOGRAPHIC_SEEDS.map(seed => demographicSeed(seed));
    for (const r of reports) {
      expect(r.checkpoints.map(c => c.year)).toEqual([5, 10, 20, 30, 40]);
      for (const c of r.checkpoints) {
        expect(c.population).toBe(r.initial + c.births - c.deaths);
        expect(Object.values(c.causes).reduce((a, b) => a + b, 0)).toBe(c.deaths);
        expect(c.childDeaths).toBeLessThanOrEqual(c.deaths);
      }
      expect(r.founding.reduce((n, f) => n + f.foundersYear1, 0)).toBeGreaterThanOrEqual(95);
    }
    expect(reports.filter(r => r.firstBirth !== null && r.firstBirth < 12).length).toBeGreaterThanOrEqual(5);
    expect(reports.filter(r => r.checkpoints.at(-1)!.population >= 50 && r.descendantsReachingAdulthood >= 15).length).toBeGreaterThanOrEqual(4);
    expect(reports.filter(r => r.checkpoints.at(-1)!.population > r.initial).length).toBeGreaterThanOrEqual(2);
    expect(reports.flatMap(r => r.founding).filter(f => f.foundersYear5 >= 16 && f.residentsYear5 >= 14).length).toBeGreaterThanOrEqual(20);
    expect(new Set(reports.map(r => r.checkpoints.at(-1)!.population)).size).toBeGreaterThan(3);
  }, 300000);

  it.each(['demography-barren-a', 'demography-barren-b'])('permits genuine extinction without food, fuel or shelter: %s', seed => {
    const report = demographicSeed(seed, 40, sim => {
      for (const c of sim.state.world.cells) { c.fertility = 0; c.wood = 0; c.temperature = -0.5; c.minerals = 0; }
      for (const d of sim.state.world.resourceDeposits) { d.capacity = 0; d.abundance = 0; d.depleted = true; }
      for (const pod of sim.state.arrival!.pods) pod.condition = 0;
      for (const s of sim.state.settlements) {
        s.resources.food = 0; s.knowledge.records = {};
        for (const id of Object.keys(s.localMaterials)) takeMaterial(s, id, Infinity);
      }
      for (const p of sim.state.people) p.occupation = p.ageMonths < 15 * 12 ? 'child' : 'keeper';
    });
    const end = report.checkpoints.at(-1)!;
    expect(end.population).toBe(0); expect((end.causes.scarcity ?? 0) + (end.causes.exposure ?? 0)).toBeGreaterThan(70);
  }, 90000);
});
