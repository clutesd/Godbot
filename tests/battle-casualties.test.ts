import { describe, expect, it } from 'vitest';
import { warFixture } from './fixtures/war';
import { applyNuclearCasualties, applyStructureCasualties, combatLossFraction, nuclearExposure } from '../src/sim/war/BattleCasualties';
import { applyWarPreviewMethod, prepareStrategicWarPreview, prepareWarPreviewBattlefield, warPreviewMethod } from '../src/dev/warPreviewModel';
import { militaryProfileForWar } from '../src/sim/war/MilitaryCapability';
import { representedPopulation } from '../src/sim/Population';
import { WarRenderer } from '../src/render/war/WarRenderer';
import { eventSequence } from '../src/sim/History';
import { AdvancedCivilizationSystem } from '../src/sim/advanced/AdvancedCivilizationSystem';
import { SeededRandom } from '../src/sim/prng';
import type { BattleImpact, NuclearPosture, SimulationState } from '../src/sim/types';

describe('damage-scaled casualties', () => {
  it('kills everyone directly under a detonation without a representative survival cap, preserving people outside it', () => {
    const f = warFixture('nuclear-core-loss');
    f.state.people.forEach((p, i) => { p.position = { x: i < 120 ? 0 : 30, z: 0 }; });
    f.state.advanced.space.selfSustainingBodies = 2;
    const before = representedPopulation(f.state), deaths = f.state.stats.deaths;
    const result = applyNuclearCasualties(f.state, 'core', [{ x: 0, z: 0 }], false);
    expect(result.affectedPopulation).toBe(120);
    expect(f.state.people.slice(0, 120).every(p => !p.alive)).toBe(true);
    expect(f.state.people.slice(120).every(p => p.alive)).toBe(true);
    expect(representedPopulation(f.state)).toBe(before - 120);
    expect(f.state.stats.deaths - deaths).toBe(120);
    const saved = structuredClone(f.state), snapshot = JSON.stringify(saved);
    expect(applyNuclearCasualties(saved, 'core', [{ x: 0, z: 0 }], false)).toEqual(result);
    expect(JSON.stringify(saved)).toBe(snapshot);
  });

  it('reduces mortality with distance and increases exposure for hydrogen weapons and overlapping strikes', () => {
    const sites = [{ x: 0, z: 0 }];
    expect(nuclearExposure({ x: 0, z: 0 }, sites, false)).toBe(1);
    const inner = nuclearExposure({ x: 3.5, z: 0 }, sites, false);
    const outer = nuclearExposure({ x: 6, z: 0 }, sites, false);
    expect(inner).toBeGreaterThan(0.9); expect(outer).toBeLessThan(inner);
    expect(nuclearExposure({ x: 8, z: 0 }, sites, false)).toBe(0);
    expect(nuclearExposure({ x: 8, z: 0 }, sites, true)).toBeGreaterThan(0.5);
    expect(nuclearExposure({ x: 6, z: 0 }, [...sites, { x: 1, z: 0 }], false)).toBeGreaterThan(outer);
    expect(nuclearExposure({ x: 0, z: 0 }, [], true)).toBe(0);
  });

  it('charges statistical city deaths once, independently of the named documentary sample', () => {
    const f = warFixture('aggregate-blast');
    f.state.advanced.scale = 'modern-statistical';
    f.state.advanced.representedPopulation = 200_000;
    f.state.advanced.cities = [f.a, f.b].map(s => ({ settlementId: s.id, population: 100_000,
      health: 0.8, education: 0.8, productivity: 0.8, infrastructureReliability: 0.8, emissions: 0, resilience: 0.5 }));
    for (const s of [f.a, f.b]) {
      s.position = { x: s === f.a ? 0 : 30, z: 0 };
      for (const plot of s.structurePlots ?? []) { plot.worldX = s.position.x; plot.worldZ = 0; }
    }
    for (const p of f.state.people) p.position = { ...(p.homeId === f.a.id ? f.a : f.b).position };
    const documentary = f.state.people.filter(p => p.homeId === f.a.id).length;
    const deaths = f.state.stats.deaths;
    const result = applyNuclearCasualties(f.state, 'city', [{ x: 0, z: 0 }, { x: 0.2, z: 0 }], true);
    expect(result.affectedPopulation).toBe(100_000);
    expect(f.state.advanced.cities.map(c => c.population)).toEqual([0, 100_000]);
    expect(representedPopulation(f.state)).toBe(100_000);
    expect(f.state.stats.deaths - deaths).toBe(100_000);
    expect(f.state.stats.documentaryDeaths).toBe(documentary);
    expect(f.state.people.some(p => p.alive && p.homeId === f.a.id)).toBe(false);
  });

  it('escalates an exchange across both populations without counting overlapping damage twice', () => {
    const f = warFixture('escalation-loss');
    f.state.people.forEach((p, i) => { p.position = { x: i % 2 ? 30 : 0, z: 0 }; });
    const exchange = structuredClone(f.state);
    const limited = applyNuclearCasualties(f.state, 'limited', [{ x: 0, z: 0 }], false);
    const major = applyNuclearCasualties(exchange, 'exchange', [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 0.1, z: 0 }], true);
    expect(major.affectedPopulation).toBeGreaterThan(limited.affectedPopulation);
    expect(major.affectedPopulation).toBe(160);
    expect(representedPopulation(exchange)).toBe(0);
  });

  it('uses exposure in a live strategic event and updates army strength alongside population losses', () => {
    const f = warFixture('live-nuclear-casualties'), war = f.declare();
    for (const p of f.state.people) p.position = { ...f.state.settlements.find(s => s.id === p.homeId)!.position };
    const armed: NuclearPosture[] = [{ polityId: f.a.polityId, weaponClass: 'hydrogen', programLevel: 1,
      arsenalScale: 1, survivability: 0.5, warningReliability: 0.5, commandControlReliability: 0.8,
      riskTolerance: 0.5, doctrine: 'retaliatory' }];
    const targetPopulation = f.state.people.filter(p => p.homeId === f.b.id).length;
    const system = new AdvancedCivilizationSystem(f.sim.config, new SeededRandom('live-nuclear-casualties'));
    const trigger = system as unknown as { triggerNuclearUse(state: SimulationState, armed: NuclearPosture[]): { affectedPopulation?: number; blastSites?: { x: number; z: number }[] }[] };
    const event = trigger.triggerNuclearUse(f.state, armed)[0]!;
    expect(event.affectedPopulation).toBe(targetPopulation);
    expect(event.blastSites?.[0]).toEqual(f.b.position);
    expect(f.state.people.some(p => p.alive && p.homeId === f.b.id)).toBe(false);
    expect(war.attacker === f.b.id ? war.strengthA : war.strengthB).toBe(0);
    expect(war.attacker === f.a.id ? war.strengthA : war.strengthB).toBeGreaterThan(0);
    expect(war.attacker === f.b.id ? war.moraleA : war.moraleB).toBe(0);
    expect(war.casualtiesA + war.casualtiesB).toBe(event.affectedPopulation);
  });

  it('makes collapsed occupied buildings more lethal than superficial damage and leaves distant residents alive', () => {
    const f = warFixture('occupied-building');
    const plot = f.a.structurePlots![0]!;
    f.state.people.forEach((p, i) => { p.position = { x: plot.worldX + (i < 100 ? 0 : 30), z: plot.worldZ }; });
    const severe = structuredClone(f.state);
    const impact: BattleImpact = { targetId: plot.id, targetKind: 'structure', position: { x: plot.worldX, z: plot.worldZ },
      side: 1, weapon: 'missile', impactAt: 4, damage: 0.1, destroyed: false, vaporized: false };
    const minor = applyStructureCasualties(f.state, 'occupied', [impact]);
    const collapse = applyStructureCasualties(severe, 'occupied', [{ ...impact, damage: 1, destroyed: true }]);
    expect(collapse.affectedPopulation).toBeGreaterThan(90);
    expect(collapse.affectedPopulation).toBeGreaterThan(minor.affectedPopulation * 5);
    expect(severe.people.slice(100).every(p => p.alive)).toBe(true);
  });

  it('scales combat losses with delivered firepower and records real population losses in emission order', () => {
    const f = warFixture('firepower-loss'), war = f.declare();
    applyWarPreviewMethod(war, warPreviewMethod('club'));
    const primitive = structuredClone(militaryProfileForWar(war, 'attacker')!);
    applyWarPreviewMethod(war, warPreviewMethod('missile'));
    const modern = militaryProfileForWar(war, 'attacker')!;
    expect(combatLossFraction(modern, primitive, 1)).toBeGreaterThan(combatLossFraction(primitive, modern, 1) * 4);
    expect(combatLossFraction(modern, primitive, 0)).toBe(0);
    prepareWarPreviewBattlefield(f.state, war, warPreviewMethod('missile'), 'settlement');
    f.state.people.forEach(p => {
      const plot = f.state.settlements.find(s => s.id === p.homeId)!.structurePlots![0]!;
      p.position = { x: plot.worldX, z: plot.worldZ };
    });
    const before = representedPopulation(f.state), deaths = f.state.stats.deaths;
    for (let i = 0; i < 120 && !war.campaign.battleCount; i++) f.tick();
    const event = f.state.history.find(e => e.type === 'battle')!;
    expect(event.context.structuralCasualties).toBeGreaterThan(0);
    expect(event.affectedPopulation).toBe(before - representedPopulation(f.state));
    expect(f.state.stats.deaths - deaths).toBe(event.affectedPopulation);
    expect(event.impacts!.filter(hit => hit.targetKind === 'person').length).toBe(event.affectedPopulation);
    expect(f.state.history.every((event, i, history) => !i || eventSequence(event) > eventSequence(history[i - 1]!))).toBe(true);
  });

  it('removes the exposed documentary formations after the blast, including with reduced motion', () => {
    const f = warFixture('formation-nuclear'), war = f.declare(), kit = warPreviewMethod('hydrogen');
    applyWarPreviewMethod(war, kit); prepareWarPreviewBattlefield(f.state, war, kit, 'settlement');
    for (let i = 0; i < 120 && !war.campaign.battleCount; i++) f.tick();
    const event = prepareStrategicWarPreview(f.state, war, kit, 'exchange')!;
    expect(event.affectedPopulation).toBeGreaterThan(20);
    const before = JSON.stringify(f.state), renderer = new WarRenderer(f.state, () => 0);
    renderer.update(0, 10, war.id);
    const initial = renderer.report.figures;
    expect(initial).toBeGreaterThan(0);
    renderer.update(0.1, 15, war.id);
    expect(renderer.report.figures).toBeLessThan(initial * 0.1);
    expect(JSON.stringify(f.state)).toBe(before);
    renderer.dispose();
    const reduced = new WarRenderer(f.state, () => 0);
    reduced.update(0, 0, war.id, true);
    expect(reduced.report.figures).toBe(0);
    expect(JSON.stringify(f.state)).toBe(before);
    reduced.dispose();
  });
});
