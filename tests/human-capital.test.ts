import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { AdvancedCivilizationSystem } from '../src/sim/advanced/AdvancedCivilizationSystem';
import { SeededRandom } from '../src/sim/prng';
import { beginLabourMonth, competence, explicitLabour, invalidateLabour, expertiseEntry, practise, reconsiderCareer, resourceLabourBudget, settlementLabour, teach, workforceProfile } from '../src/sim/people/HumanCapital';
import { killPeople } from '../src/sim/people/PersonLifecycle';
import { emitEvent } from '../src/sim/History';
import { HistoricalImportanceSystem } from '../src/sim/people/HistoricalImportance';
import { advancePersonalMemory, memoriesFor } from '../src/sim/people/PersonalMemorySystem';
import { representedPopulation, settlementRepresentedPopulation } from '../src/sim/Population';
import { RunRecordBuilder, createRunIdentity } from '../src/historian/RunArchive';
import type { Person, SimulationState, SocialRelationship } from '../src/sim/types';

let base: Simulation;
beforeAll(() => { base = new Simulation({ seed: 'human-capital-authority', startingPopulation: 80, settlementCount: [2, 2], world: { size: 24 } }); });
function world(): SimulationState { return structuredClone(base.state); }
function worker(state: SimulationState, id: string, skill = 0, occupation: Person['occupation'] = 'artisan'): Person {
  const p = structuredClone(state.people[0]!);
  Object.assign(p, { id, name: id, alive: true, occupation, role: undefined, ageMonths: 360, activity: 'craft', health: 1,
    partnerId: undefined, parents: [], children: [], navigation: undefined, expertise: [], displacedSinceMonth: undefined });
  p.expertise = [{ domain: occupation === 'farmer' ? 'agriculture' : occupation === 'builder' ? 'mechanics' : 'materials', competence: skill, lastPractisedMonth: 0 }];
  return p;
}
function pair(state: SimulationState): { mentor: Person; learner: Person; relation: SocialRelationship } {
  const mentor = worker(state, 'person-master', 0.9), learner = worker(state, 'person-student', 0.1);
  const relation: SocialRelationship = { id: 'teaching', a: mentor.id, b: learner.id, kind: 'mentor', trust: 0.9, strength: 0.9, formedMonth: 0, lastContactMonth: 12 };
  state.people = [mentor, learner]; state.socialRelationships = [relation]; state.month = 12;
  state.settlements[0]!.foodSecurity = 1; state.settlements[0]!.conflictPressure = 0;
  return { mentor, learner, relation };
}
function headline(state: SimulationState, actor: string, type: 'discovery' | 'battle' = 'discovery') {
  return emitEvent(state, { type, actors: [actor], causes: [], context: {}, outcome: 'recorded', affectedPopulation: 1,
    magnitude: 0.7, significance: 0.8, tags: [], summary: 'A consequential event.', locationId: state.settlements[0]!.id });
}

describe('acquired human capability', () => {
  it('retains occupation and tenure across ordinary birthdays; adulthood is a real transition', () => {
    const s = world(), p = worker(s, 'person-worker');
    const original = p.occupation;
    for (let year = 1; year <= 20; year++) { p.ageMonths += 12; expect(reconsiderCareer(p, s.settlements[0]!, year * 12, () => 'farmer')).toBe(false); }
    expect(p.occupation).toBe(original);
    p.occupation = 'child'; p.ageMonths = 180;
    expect(reconsiderCareer(p, s.settlements[0]!, 252, () => 'builder')).toBe(true);
    expect(p.career?.reason).toBe('adulthood');
    expect(competence(p, 'mechanics')).toBe(0);
  });
  it('accumulates bounded expertise through years of practice, not occupation assignment', () => {
    const s = world(), master = worker(s, 'person-practised'), novice = worker(s, 'person-novice');
    for (let month = 3; month <= 240; month += 3) practise(master, 'materials', month);
    expect(competence(master, 'materials')).toBeGreaterThan(0.8);
    expect(competence(novice, 'materials')).toBe(0);
    expect(competence(master, 'materials')).toBeLessThan(1);
    for (const d of ['agriculture', 'records', 'medicine', 'transport'] as const) expertiseEntry(master, d, 250);
    expect(master.expertise).toHaveLength(3);
  });
  it('gives identical worker counts different agricultural and construction capacity', () => {
    const s = world();
    for (const occupation of ['farmer', 'builder', 'artisan'] as const) {
      const novice = worker(s, 'person-novice', 0, occupation), expert = worker(s, 'person-expert', 0.9, occupation);
      expect(explicitLabour([expert], 1).effective[occupation]).toBeGreaterThan(explicitLabour([novice], 1).effective[occupation]! * 1.4);
      expert.health = 0.2;
      expect(explicitLabour([expert], 1).effective[occupation]).toBeLessThan(explicitLabour([novice], 1).effective[occupation]!);
      expect(expert.expertise![0]!.competence).toBe(0.9);
    }
  });
  it('teaches the correct domain without awarding the teacher learning', () => {
    const s = world(), { mentor, learner, relation } = pair(s);
    teach(s);
    expect(competence(learner, 'materials')).toBeGreaterThan(0.1);
    expect(competence(mentor, 'materials')).toBe(0.9);
    expect(competence(learner, 'agriculture')).toBe(0);
    expect(relation.teaching).toMatchObject({ mentorId: mentor.id, learnerId: learner.id, domain: 'materials' });
    const after = competence(learner, 'materials'); teach(s); expect(competence(learner, 'materials')).toBe(after);
  });
  it('cannot teach agriculture from metallurgy and cannot teach without contact or conditions', () => {
    const s = world(), { mentor, learner, relation } = pair(s);
    learner.occupation = 'farmer'; teach(s); expect(competence(learner, 'agriculture')).toBe(0);
    learner.occupation = 'artisan'; relation.lastContactMonth = -24; teach(s); expect(competence(learner, 'materials')).toBe(0.1);
    relation.lastContactMonth = 12; s.settlements[0]!.foodSecurity = 0; teach(s); expect(competence(learner, 'materials')).toBe(0.1);
    expect(competence(mentor, 'materials')).toBe(0.9);
  });
  it('bounds teacher capacity and records lineage only after consequential progress', () => {
    const s = world(), { mentor, learner, relation } = pair(s);
    for (let i = 0; i < 4; i++) {
      const p = worker(s, `person-extra-${i}`, 0.1); s.people.push(p);
      s.socialRelationships!.push({ ...relation, id: `r${i}`, b: p.id });
    }
    teach(s); expect(s.socialRelationships!.filter(r => r.teaching)).toHaveLength(2);
    expect(learner.expertise![0]!.teacherId).toBeUndefined();
    for (let month = 15; month <= 120; month += 3) { s.month = month; for (const r of s.socialRelationships!) r.lastContactMonth = month; teach(s); }
    expect(learner.expertise![0]!.teacherId).toBe(mentor.id);
    advancePersonalMemory(s); expect(memoriesFor(learner).some(m => m.kind === 'mentorship')).toBe(true);
  });
  it('loses rare expertise on death and a trained successor reduces proportional loss', () => {
    const loss = (train: boolean) => {
      const s = world(), { mentor, learner, relation } = pair(s);
      if (train) for (let month = 12; month <= 360; month += 3) { s.month = month; relation.lastContactMonth = month; teach(s); }
      const before = explicitLabour(s.people, s.month).experts.materials!;
      killPeople(s, [mentor], 'age');
      const after = explicitLabour(s.people, s.month).experts.materials!;
      expect(after).toBeCloseTo(competence(learner, 'materials'));
      return (before - after) / before;
    };
    expect(loss(true)).toBeLessThan(loss(false) * 0.8);
  });
  it('transfers personal expertise by migration without cloning it', () => {
    const s = world(), p = worker(s, 'person-migrant', 0.9); s.people = [p];
    const a = s.settlements[0]!, b = s.settlements[1]!;
    expect(settlementLabour(s, a).experts.materials).toBeCloseTo(0.9);
    p.homeId = b.id;
    expect(settlementLabour(s, a).experts.materials ?? 0).toBe(0);
    expect(settlementLabour(s, b).experts.materials).toBeCloseTo(0.9);
    expect(s.people).toHaveLength(1);
  });
  it('feeds acquired agriculture directly into economy output with equal populations and inputs', () => {
    const run = (skill: number) => {
      const sim = new Simulation({ seed: 'matched-production', startingPopulation: 80, settlementCount: [2, 2], world: { size: 24 } });
      for (const p of sim.state.people) { p.occupation = 'farmer'; p.health = 1; p.expertise = [{ domain: 'agriculture', competence: skill, lastPractisedMonth: 0 }]; }
      (sim as unknown as { runEconomy(): void }).runEconomy();
      return sim.state.settlements.reduce((n, settlement) => n + settlement.monthlyBalance.food, 0);
    };
    expect(run(0.9)).toBeGreaterThan(run(0) + 10);
  });
  it('reserves mobilized workers and shares industrial labour with ordinary production', () => {
    const s = world(), p = worker(s, 'person-worker', 0.9); s.people = [p];
    const home = s.settlements[0]!; home.industry.active = true;
    const peace = settlementLabour(s, home);
    s.wars = [{ active: true, attacker: home.id, defender: s.settlements[1]!.id }] as SimulationState['wars'];
    const war = settlementLabour(s, home);
    expect(war.effective.artisan).toBeLessThan(peace.effective.artisan!);
    expect(war.militaryReserved).toBeGreaterThan(0);
    expect(war.resources.artisan! + war.economy.artisan! + war.industry).toBeCloseTo(war.effective.artisan! * 0.98);
  });
  it('uses one allocation snapshot during work and invalidates it on death', () => {
    const s = world(), p = worker(s, 'person-worker', 0.9); s.people = [p];
    const home = s.settlements[0]!;
    beginLabourMonth(s, new Map([[home.id, [p]]]));
    const allocated = settlementLabour(s, home);
    p.health = 0.2;
    expect(settlementLabour(s, home)).toBe(allocated);
    invalidateLabour(s);
    expect(settlementLabour(s, home).effective.artisan).toBeLessThan(allocated.effective.artisan!);
    beginLabourMonth(s, new Map([[home.id, [p]]])); killPeople(s, [p], 'age');
    expect(settlementLabour(s, home).effective.artisan ?? 0).toBe(0);
  });
  it('retires a notable once and removes simulation indexes for catastrophe death', () => {
    const sim = new Simulation({ seed: 'notable-retirement', startingPopulation: 30, settlementCount: [2, 2], world: { size: 24 } });
    const p = sim.state.people[0]!;
    p.historical = { status: 'notable', score: 0.6, reasons: ['practical-expert'], eventIds: [], promotedMonth: 0 };
    killPeople(sim.state, [p, p], 'civilization-shock');
    const figure = sim.state.notableFigures!.find(f => f.id === p.id);
    expect(figure?.diedMonth).toBe(0);
    expect(sim.state.notableFigures!.filter(f => f.id === p.id)).toHaveLength(1);
    const internals = sim as unknown as { person(id: string): Person | undefined; peopleAt(id: string): Person[] };
    expect(internals.person(p.id)).toBeUndefined(); expect(internals.peopleAt(p.homeId)).not.toContain(p);
  });
  it('partitions labour and shares the material budget rather than allocating it again', () => {
    const s = world(), p = worker(s, 'person-builder', 0.9, 'builder'); s.people = [p];
    const summary = settlementLabour(s, s.settlements[0]!);
    expect(summary.resources.builder! + summary.economy.builder! + summary.infrastructure).toBeCloseTo(summary.effective.builder! * 0.98);
    const first = resourceLabourBudget(s, s.settlements[0]!); first.builder = 0;
    expect(resourceLabourBudget(s, s.settlements[0]!).builder).toBe(0);
  });
});

describe('population, lifecycle and history authority', () => {
  it('reconciles explicit, urban-industrial and city counts before abstraction', () => {
    const s = world(); s.advanced.scale = 'urban-industrial'; s.advanced.representedPopulation = 99999;
    const system = new AdvancedCivilizationSystem(base.config, new SeededRandom('city-contract'));
    system.advanceMonth(s);
    expect(representedPopulation(s)).toBe(s.people.length);
    for (const city of s.advanced.cities) expect(city.population).toBe(s.people.filter(p => p.homeId === city.settlementId).length);
  });
  it('keeps city population, growth, workforce and capacity independent of modern sample size and identity', () => {
    const a = world(); a.advanced.scale = 'modern-statistical'; a.advanced.representedPopulation = 100000;
    for (const city of a.advanced.cities) { city.population = 50000; city.workforce = workforceProfile(a.people.filter(p => p.homeId === city.settlementId), 0); }
    const b = structuredClone(a); b.people = b.people.slice(0, 2); for (const p of b.people) { p.homeId = b.settlements[1]!.id; p.occupation = 'keeper'; p.expertise = []; }
    const sa = new AdvancedCivilizationSystem(base.config, new SeededRandom('invariance')), sb = new AdvancedCivilizationSystem(base.config, new SeededRandom('invariance'));
    for (let m = 1; m <= 12; m++) { a.month = m; b.month = m; sa.advanceMonth(a); sb.advanceMonth(b); }
    expect(a.advanced.representedPopulation).toBe(b.advanced.representedPopulation);
    expect(a.advanced.cities).toEqual(b.advanced.cities);
    for (const settlement of a.settlements) expect(settlementLabour(a, settlement)).toEqual(settlementLabour(b, b.settlements.find(s => s.id === settlement.id)!));
    expect(settlementRepresentedPopulation(a, a.settlements[0]!.id)).toBeGreaterThan(49000);
  });
  it.each(['age', 'civilization-shock', 'war', 'scarcity'])('applies identical idempotent death cleanup for %s', cause => {
    const s = world(), { mentor, learner } = pair(s); mentor.partnerId = learner.id; learner.partnerId = mentor.id;
    mentor.children = [learner.id]; learner.parents = [mentor.id];
    const before = s.stats.deaths;
    expect(killPeople(s, [mentor], cause)).toBe(1); expect(killPeople(s, [mentor], cause)).toBe(0);
    expect(mentor.alive).toBe(false); expect(mentor.diedMonth).toBe(s.month);
    expect(learner.partnerId).toBeUndefined(); expect(mentor.partnerId).toBeUndefined();
    expect(s.socialRelationships).toHaveLength(0); expect(learner.parents).toContain(mentor.id);
    expect(memoriesFor(learner).some(m => m.kind === 'loss' && m.subjectId === mentor.id)).toBe(true);
    expect(s.stats.deaths).toBe(before + 1); expect(s.history.filter(e => e.type === 'death')).toHaveLength(1);
  });
  it('advanced shocks use the same lifecycle even when the system runs standalone', () => {
    const s = world(), { mentor, learner } = pair(s); mentor.partnerId = learner.id; learner.partnerId = mentor.id;
    const system = new AdvancedCivilizationSystem(base.config, new SeededRandom('shock'));
    (system as unknown as { applyShock(s: SimulationState, loss: number, damage: number): number }).applyShock(s, 0.96, 0.3);
    expect(s.people.filter(p => !p.alive)).toHaveLength(1);
    expect(s.history.filter(e => e.type === 'death')).toHaveLength(1);
    expect(s.people.find(p => p.alive)!.partnerId).toBeUndefined();
  });
  it('keeps survivors ageing in inactive settlements and permits mortality', () => {
    const sim = new Simulation({ seed: 'stranded-lifecycle', startingPopulation: 20, settlementCount: [2, 2], world: { size: 24 } });
    for (const settlement of sim.state.settlements) settlement.alive = false;
    const p = sim.state.people[0]!; p.health = 1; const age = p.ageMonths;
    sim.step(1); expect(p.ageMonths).toBe(age + 1); expect(p.alive).toBe(true); expect(p.displacedSinceMonth).toBe(1);
    p.health = 0; sim.step(1); expect(p.alive).toBe(false);
    expect(sim.state.history.some(e => e.type === 'death' && e.actors.includes(p.id))).toBe(true);
  });
  it('retries failed evacuation and transfers a surviving expert when refuge becomes reachable', () => {
    const sim = new Simulation({ seed: 'refuge-retry', startingPopulation: 40, settlementCount: [2, 2], world: { size: 24 } });
    const home = sim.state.settlements[0]!, target = sim.state.settlements[1]!;
    const p = sim.state.people.find(p => p.homeId === home.id)!; p.health = 1;
    p.expertise = [{ domain: 'materials', competence: 0.8, lastPractisedMonth: 0 }]; home.alive = false;
    const internals = sim as unknown as { peopleSystem: { beginMigration(): boolean }; seekRefuge(p: Person): void };
    const route = vi.spyOn(internals.peopleSystem, 'beginMigration').mockReturnValue(false);
    sim.step(3); expect(p.alive).toBe(true); expect(p.homeId).toBe(home.id);
    route.mockReturnValue(true); internals.seekRefuge(p);
    expect(p.homeId).toBe(target.id); expect(p.displacedSinceMonth).toBeUndefined();
    expect(competence(p, 'materials')).toBe(0.8); route.mockRestore();
  });
  it('ingests new events after arbitrary significance trimming without re-ingesting retained history', () => {
    const s = world(), p = worker(s, 'person-historic'); s.people = [p]; s.history = [];
    const importance = new HistoricalImportanceSystem();
    headline(s, p.id); importance.ingest(s);
    const old = headline(s, p.id); importance.ingest(s);
    s.history = [old]; const next = headline(s, p.id); importance.ingest(s);
    const identity = importance.evaluate(p, s, s.month);
    expect(identity.eventIds).toContain(next.id);
    const score = identity.score; importance.ingest(s); expect(importance.evaluate(p, s, s.month).score).toBe(score);
    expect(memoriesFor(p).some(m => m.eventId === next.id)).toBe(true);
  });
  it('archives emitted death before retention can erase it', () => {
    const s = world(), p = worker(s, 'person-archived', 0.9); s.people = [p];
    const archive = new RunRecordBuilder(createRunIdentity(base.config, s, 1, '2026-09-13'), base.config, s);
    archive.update(s, new Set([p.id])); killPeople(s, [p], 'age'); s.history = []; s.people = [];
    const record = archive.update(s);
    expect(record.significantPeople.find(person => person.id === p.id)?.aliveAtLastRecord).toBe(false);
  });
  it('gives legitimate local battle witnesses memories but excludes remote people', () => {
    const s = world(), local = worker(s, 'person-local'), remote = worker(s, 'person-remote'); remote.homeId = s.settlements[1]!.id;
    s.people = [local, remote]; headline(s, 'war-1', 'battle'); advancePersonalMemory(s);
    expect(memoriesFor(local).some(m => m.kind === 'war')).toBe(true); expect(memoriesFor(remote)).toHaveLength(0);
  });
  it('replays practice and directed teaching deterministically', () => {
    const a = world(); pair(a); const b = structuredClone(a);
    for (const s of [a, b]) for (let m = 12; m <= 240; m += 3) { s.month = m; s.socialRelationships![0]!.lastContactMonth = m; practise(s.people[0]!, 'materials', m); teach(s); }
    expect(a.people).toEqual(b.people); expect(a.socialRelationships).toEqual(b.socialRelationships);
  });
});
