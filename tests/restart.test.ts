import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { ARRIVAL_END_SECONDS, assertPristine, podPosition, podTouchdown, validLandingSite } from '../src/sim/founding/FoundingArrival';
import { RunRecordBuilder, createRunIdentity, migrateArchiveRecord } from '../src/historian/RunArchive';
import { WalkabilityLayer } from '../src/sim/people/WalkabilityLayer';
import { createSettlementLayoutPlan } from '../src/shared/SettlementLayoutPlan';

const CONFIG = { seed: 'arrival-day-preview', startMode: 'arrival' as const };
const complete = (s: Simulation) => {
  s.advanceArrival(ARRIVAL_END_SECONDS);
  if (!s.beginHistory()) throw new Error('Expected completed Arrival orientation boundary');
};

describe('Arrival Day / authoritative restart', () => {
  it('erases a developed civilization and regenerates natural resources', () => {
    const s = new Simulation({ ...CONFIG, startMode: 'established', startingPopulation: 100 });
    s.step(120);
    const old = s.state;
    old.world.cells.find(c => !c.water)!.modifications = { road: { intensity: 1, firstMonth: 0, lastMonth: 120 } };
    old.world.resourceDeposits[0]!.extracted = 99;
    s.restart();
    expect(s.year).toBe(0);
    expect(s.state.month).toBe(0);
    expect(s.state).not.toBe(old);
    expect(() => assertPristine(s.state)).not.toThrow();
    expect(s.state).toEqual(new Simulation(CONFIG).state);
    expect(s.state.arrival?.phase).toBe('PRISTINE_WORLD');
    expect(s.state.arrival?.pods).toHaveLength(5);
    expect(s.state.people).toHaveLength(0);
    expect(s.state.settlements).toHaveLength(0);
    expect(s.state.history).toHaveLength(0);
    expect(s.state.transportation.segments).toEqual({});
    expect(s.state.world.resourceDeposits.some(d => (d.extracted ?? 0) > 0)).toBe(false);
  }, 20000);
  it('holds time and civilization through twelve seconds of pristine world', () => {
    const s = new Simulation(CONFIG);
    const weather = structuredClone(s.state.weather);
    s.step(120); s.advanceArrival(11.99); s.step(120);
    expect(s.state.arrival!.phase).toBe('PRISTINE_WORLD');
    expect(s.state.weather).toEqual(weather);
    expect(() => assertPristine(s.state)).not.toThrow();
  });
  it.each(['arrival-day-preview', 'witness-the-saffron-river', 'restart-audit', 'another-world', 'clean-world'])(
    'selects five deterministic safe, separated sites for %s', seed => {
      const s = new Simulation({ ...CONFIG, seed });
      const a = s.state.arrival!;
      expect(a.pods).toHaveLength(5);
      for (const key of ['id', 'color', 'groupId'] as const) expect(new Set(a.pods.map(p => p[key])).size).toBe(5);
      const walk = new WalkabilityLayer(s.state.world);
      for (const p of a.pods) {
        expect(validLandingSite(s.state.world, p.position, walk)).toBe(true);
        expect(podPosition(p, podTouchdown(p))).toEqual({ ...p.position, y: p.groundY + 1.1 });
        for (const q of a.pods.filter(q => q.id !== p.id)) expect(Math.hypot(p.position.x - q.position.x, p.position.z - q.position.z)).toBeGreaterThanOrEqual(a.minimumSeparation);
      }
      expect(new Simulation({ ...CONFIG, seed }).state.arrival).toEqual(a);
    }, 15000);
  it('lands separately and opens a bare camp before the first person emerges', () => {
    const s = new Simulation(CONFIG); s.advanceArrival(25);
    expect(s.state.arrival!.pods.filter(p => p.landed)).toHaveLength(1);
    expect(s.state.settlements).toHaveLength(1);
    expect(s.population).toBe(0);
    expect(s.state.settlements[0]!.buildings).toBe(0);
    s.advanceArrival(2);
    expect(s.population).toBe(2);
    s.step(99);
    expect(s.state.month).toBe(0);
    expect(s.state.history).toHaveLength(0);
  });
  it('creates real founders at recorded origins with distinct knowledge and zero infrastructure', () => {
    const s = new Simulation(CONFIG); complete(s);
    expect(s.state.arrival!.phase).toBe('HISTORY_RUNNING');
    expect(s.population).toBe(110);
    expect(s.state.settlements).toHaveLength(5);
    expect(s.state.cultures).toHaveLength(5);
    expect(s.state.institutions).toHaveLength(0);
    for (const pod of s.state.arrival!.pods) {
      const camp = s.state.settlements.find(c => c.id === pod.settlementId)!;
      const people = s.state.people.filter(p => pod.personIds.includes(p.id));
      expect(people).toHaveLength(pod.population);
      expect(camp.position).toEqual(pod.position);
      expect(camp.buildings).toBe(0);
      expect(camp.structurePlots ?? []).toHaveLength(0);
      expect(Object.values(camp.infrastructure).every(n => n === 0)).toBe(true);
      expect(camp.resources.food).toBe(pod.supplies.food);
      expect(camp.industry.active).toBe(false);
      expect(createSettlementLayoutPlan({ settlement: camp, settlements: s.state.settlements, routes: [], eraRank: 1, seed: s.state.seed }).streets).toHaveLength(0);
      for (const id of pod.knowledge) {
        expect(camp.knowledge.records[id]!.theory).toBeGreaterThan(0.5);
        expect(camp.knowledge.records[id]!.practice).toBeLessThan(0.05);
        expect(camp.knowledge.records[id]!.adoptedMonth).toBeUndefined();
      }
      for (const person of people) {
        expect(person.alive).toBe(true);
        expect(person.foundingOrigin!.position).toEqual(pod.position);
        expect(person.foundingOrigin!.groupId).toBe(pod.groupId);
        expect(person.homeId).toBe(camp.id);
        expect(person.expertise!.map(e => e.domain)).toEqual(pod.domains);
        expect(Math.hypot(person.position.x - pod.position.x, person.position.z - pod.position.z)).toBeLessThan(3.3);
      }
    }
  });
  it('archives Arrival Day once, survives retention, and resumes normal simulation', () => {
    const s = new Simulation({ ...CONFIG, simulation: { historyLimit: 8 } });
    const builder = new RunRecordBuilder(createRunIdentity(s.config, s.state, 1), s.config, s.state);
    const pending = builder.update(s.state);
    expect(pending.status).toBe('ongoing');
    expect(pending.outcome.classification).not.toBe('EXTINCT');
    expect(pending.demographicMilestones.some(m => m.kind === 'extinction')).toBe(false);
    complete(s); complete(s);
    const event = s.state.history.find(e => e.type === 'ARRIVAL_DAY')!;
    expect(event.month).toBe(0);
    expect(JSON.parse(String(event.context.manifest))).toHaveLength(5);
    s.step(120);
    expect(s.state.history.filter(e => e.type === 'ARRIVAL_DAY')).toHaveLength(1);
    const record = builder.update(s.state);
    expect(record.events.filter(e => e.type === 'ARRIVAL_DAY')).toHaveLength(1);
    expect(record.foundingArrival!.pods).toHaveLength(5);
    expect(migrateArchiveRecord(record).foundingArrival).toEqual(record.foundingArrival);
    expect(s.state.month).toBe(120);
    expect(s.state.stats.births).toBeGreaterThan(0);
  }, 15000);
  it('replays independently of animation frame cadence', () => {
    const a = new Simulation(CONFIG), b = new Simulation(CONFIG); complete(a);
    for (let i = 0; i < ARRIVAL_END_SECONDS * 10; i++) b.advanceArrival(0.1);
    b.advanceArrival(0.01);
    expect(b.state.arrival?.phase).toBe('FOUNDING_ORIENTATION');
    expect(b.beginHistory()).toBe(true);
    expect(a.state).toEqual(b.state);
    a.step(12); b.step(12);
    expect(a.state).toEqual(b.state);
  }, 15000);
  it('restarts twice including mid-descent without duplication, retaining the current seed', () => {
    const s = new Simulation(CONFIG); s.advanceArrival(28); s.restart('another-world');
    expect(() => assertPristine(s.state)).not.toThrow();
    complete(s); s.step(12); s.restart();
    expect(s.config.seed).toBe('another-world');
    expect(() => assertPristine(s.state)).not.toThrow();
    complete(s);
    const fresh = new Simulation({ ...CONFIG, seed: 'another-world' }); complete(fresh);
    expect(s.state).toEqual(fresh.state);
    expect(s.state.history).toHaveLength(1);
    expect(s.population).toBe(110);
  }, 15000);
  it('rejects invalid animation deltas', () => {
    const s = new Simulation(CONFIG);
    s.advanceArrival(NaN); s.advanceArrival(Infinity); s.advanceArrival(-1);
    expect(s.state.arrival!.elapsedSeconds).toBe(0);
    expect(() => assertPristine(s.state)).not.toThrow();
  });
});
