import { afterEach, describe, expect, it } from 'vitest';
import { warFixture } from './fixtures/war';
import { armsDemand, armsReadiness, loseCombatArms, observeArmsDemand, type ArmsDiagnostic } from '../src/sim/resources/ArmsDemand';
import { consumeMaterials } from '../src/sim/resources/Consumption';
import { materialEconomy, publishBulkStocks } from '../src/sim/resources/Inventory';
import { deriveMilitaryProfile } from '../src/sim/war/MilitaryCapability';

function fixture() {
  const f = warFixture('arms-demand');
  f.state.relations.forEach(r => { r.hostility = 0; });
  const s = f.a;
  const people = f.state.people.filter(p => p.alive && p.homeId === s.id);
  const e = materialEconomy(s);
  s.localMaterials.timber = 100; publishBulkStocks(s);
  const record = s.knowledge.records['stone-composites'];
  if (!record) throw new Error('fixture requires stone-composites');
  record.practice = 0.8;
  let last: ArmsDiagnostic;
  observeArmsDemand(r => { last = r; });
  const tick = (artisan = 10) => { consumeMaterials(f.state, s, people, { artisan }, []); return last!; };
  return { ...f, s, people, e, tick, demand: () => armsDemand(f.state, s, people, people.length) };
}
afterEach(() => observeArmsDemand(undefined));

describe('causal wooden equipment demand', () => {
  it('idles with a sufficient reserve and charges wear only to issued equipment', () => {
    const f = fixture(); const d = f.demand();
    f.e.timberArms = d.desired;
    const r = f.tick();
    expect(r.timber).toBe(0); expect(r.labour).toBe(0);
    expect(r.wear).toBeCloseTo(d.active * 0.01);
    expect(r.stockAfter).toBeCloseTo(d.desired - r.wear);
  });
  it('reorders after ordinary use and stops at the desired reserve without overshoot', () => {
    const f = fixture(); f.e.timberArms = f.demand().desired;
    let produced = 0;
    for (let i = 0; i < 160; i++) {
      const r = f.tick(); produced += r.achieved;
      expect(r.stockAfter).toBeLessThanOrEqual(r.desired + 1e-9);
      expect(r.achieved).toBeCloseTo(r.timber * 0.5);
      expect(r.labour).toBeCloseTo(r.timber / 0.3);
    }
    expect(produced).toBeGreaterThan(0);
  });
  it('uses military organization, eligible adults, threat and war rather than total population', () => {
    const f = fixture(); const peace = f.demand();
    f.s.politicalPower.military = 1;
    expect(f.demand().desired).toBeGreaterThan(peace.desired);
    f.state.relations[0]!.contact = true; f.state.relations[0]!.hostility = 0.9;
    expect(f.demand().desired).toBeGreaterThan(peace.desired * 2);
    f.declare(); expect(f.demand().active).toBeCloseTo(f.demand().muster);
    f.people.forEach(p => { p.ageMonths = 8 * 12; });
    expect(f.demand().desired).toBe(0);
  });
  it('metal equipment substitutes for wooden equipment', () => {
    const f = fixture(); f.e.arms = f.demand().desired * 2;
    f.e.timberArms = 3;
    const r = f.tick(); expect(r.wear).toBe(0); expect(r.timber).toBe(0);
  });
  it('retains scarcity, artisan limits and quality-weighted output', () => {
    const f = fixture(); expect(f.tick(0).achieved).toBe(0);
    f.e.quality.timber = 0.25;
    const r = f.tick(0.1);
    expect(r.timber).toBeCloseTo(0.03); expect(r.achieved).toBeCloseTo(0.0075);
    f.s.localMaterials.timber = 0; publishBulkStocks(f.s);
    expect(f.tick().achieved).toBe(0);
  });
  it('defers peace production below critical needs, but allows wartime scarcity', () => {
    const f = fixture(); f.s.localMaterials.timber = 1; publishBulkStocks(f.s);
    expect(f.tick().timber).toBe(0);
    f.declare(); const r = f.tick();
    expect(r.criticalTimber).toBe(true); expect(r.timber).toBeGreaterThan(0);
  });
  it('ties losses to actual casualties, caps them at issued stock, and records them once', () => {
    const f = fixture(); f.declare(); f.e.timberArms = f.demand().desired; f.tick();
    const before = f.e.timberArms;
    const loss = loseCombatArms(f.s, 2);
    expect(loss).toBeGreaterThan(0); expect(f.e.timberArms).toBeCloseTo(before - loss);
    const r = f.tick(); expect(r.combatLoss).toBeCloseTo(loss);
    expect(r.replacementDemand).toBeGreaterThan(0); expect(f.tick().combatLoss).toBe(0);
    expect(loseCombatArms(f.s, 1e6)).toBeLessThanOrEqual(f.demand().active);
    expect(f.e.timberArms).toBeGreaterThanOrEqual(0);
  });
  it('makes finished stock affect military readiness without granting old saves equipment', () => {
    const f = fixture(); f.tick(0); expect(armsReadiness(f.s)).toBe(0);
    const unarmed = deriveMilitaryProfile(f.s).melee;
    f.e.timberArms = f.demand().active; expect(armsReadiness(f.s)).toBe(1);
    expect(deriveMilitaryProfile(f.s).melee).toBeGreaterThan(unarmed);
    const loaded = JSON.parse(JSON.stringify(f.s)) as typeof f.s;
    expect(armsReadiness(loaded)).toBe(1);
    expect(materialEconomy(loaded).woodenArmsService).toEqual(f.e.woodenArmsService);
  });
  it('removes equipment in the real casualty resolver, including the last battle of a war', () => {
    const f = fixture(); const war = f.declare();
    f.e.timberArms = f.demand().desired; f.tick(0);
    const before = f.e.timberArms;
    for (let i = 0; i < 80; i++) { f.state.month++; f.engine.runWars(); }
    const casualties = war.attacker === f.s.id ? war.casualtiesA : war.casualtiesB;
    expect(casualties).toBeGreaterThan(0);
    expect(f.e.timberArms).toBeLessThan(before);
    expect(f.e.woodenArmsService!.combatLoss).toBeCloseTo(before - f.e.timberArms);
  });
  it('uses represented working-age cohorts at statistical scale', () => {
    const f = fixture(); f.state.advanced.scale = 'modern-statistical';
    const d = armsDemand(f.state, f.s, f.people, 10000);
    expect(d.eligible).toBeCloseTo(10000 * f.state.advanced.cohorts.workingAge);
    expect(d.desired).toBeGreaterThan(100);
    expect(f.e.timberArms).toBe(0);
  });
});
