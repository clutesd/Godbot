import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { warFixture } from './fixtures/war';
import { applyWarPreviewMethod, prepareWarPreviewBattlefield, prepareStrategicWarPreview, warPreviewMethod } from '../src/dev/warPreviewModel';
import { resolveBattleDestruction, resolveNuclearDestruction } from '../src/sim/war/BattleDestruction';
import { killPeople } from '../src/sim/people/PersonLifecycle';
import { createStructureRuin, StructureDestruction } from '../src/render/war/StructureDestruction';
import { casualtyLifecycle } from '../src/render/war/BattleAftermath';
import { observeHistory } from '../src/sim/History';
import type { HistoricalEvent } from '../src/sim/types';

function battle(method = 'missile') {
  const f = warFixture('resolved-destruction');
  const war = f.declare(), kit = warPreviewMethod(method);
  applyWarPreviewMethod(war, kit);
  prepareWarPreviewBattlefield(f.state, war, kit, 'settlement');
  for (let i = 0; i < 120 && war.campaign.battleCount === 0; i++) f.tick();
  const event = f.state.history.find(e => e.type === 'battle' && e.actors.includes(war.id))!;
  return { ...f, war, kit, event };
}

describe('recorded battle destruction', () => {
  it('targets nearby buildings, attributes real deaths, and resolves each battle once', () => {
    const f = battle();
    const hits = f.event.impacts!;
    const buildings = hits.filter(hit => hit.targetKind === 'structure');
    expect(buildings.length).toBeGreaterThan(0);
    expect(buildings.some(hit => hit.destroyed)).toBe(true);
    for (const hit of buildings) {
      const plot = f.state.settlements.flatMap(s => s.structurePlots ?? []).find(p => p.id === hit.targetId)!;
      expect(hit.position).toEqual({ x: plot.worldX, z: plot.worldZ });
      expect(plot.condition).toBeLessThan(1);
      expect(plot.destruction?.eventId).toBe(f.event.id);
      expect(plot.accessRestricted).toBe(true);
      expect(plot.fire?.cause).toBe('attack');
    }
    const people = hits.filter(hit => hit.targetKind === 'person');
    expect(people.length).toBe(f.event.affectedPopulation);
    for (const hit of people) expect(f.state.bodies?.find(b => b.id === hit.targetId)?.combatImpact?.eventId).toBe(f.event.id);
    const before = JSON.stringify(f.state);
    resolveBattleDestruction(f.state, f.war, f.event);
    expect(JSON.stringify(f.state)).toBe(before);
    expect(f.state.aftermathEvents?.find(e => e.id === f.event.id)?.impacts).toEqual(hits);
  });

  it('leaves distant structures and structures beyond primitive reach untouched', () => {
    const f = battle('club');
    expect(f.event.impacts!.filter(hit => hit.targetKind === 'structure')).toEqual([]);
    expect(f.b.structurePlots!.every(p => p.condition === 1)).toBe(true);
  });

  it('publishes identified destruction before archive observers receive the battle', () => {
    const f = warFixture('archive-destruction'), war = f.declare(), kit = warPreviewMethod('missile');
    applyWarPreviewMethod(war, kit); prepareWarPreviewBattlefield(f.state, war, kit, 'settlement');
    let archived: HistoricalEvent | undefined;
    const stop = observeHistory(f.state, event => { if (event.type === 'battle') archived = structuredClone(event); });
    for (let i = 0; i < 120 && war.campaign.battleCount === 0; i++) f.tick();
    stop();
    expect(archived?.impacts?.some(hit => hit.targetKind === 'structure')).toBe(true);
    expect(archived?.context.destroyedStructures).toBeGreaterThan(0);
  });

  it('records vaporization without charging the strategic resolver for the same deaths again', () => {
    const f = battle('atomic');
    const site = { x: f.b.structurePlots![0]!.worldX, z: f.b.structurePlots![0]!.worldZ };
    const victim = f.state.people.find(p => p.alive)!;
    victim.position = { ...site };
    killPeople(f.state, [victim], 'civilization-shock');
    const deaths = f.state.stats.deaths;
    const hits = resolveNuclearDestruction(f.state, 'test-nuclear', [site], false);
    expect(f.state.stats.deaths).toBe(deaths);
    expect(hits.find(hit => hit.targetId === victim.id)?.vaporized).toBe(true);
    expect(f.state.bodies?.find(b => b.id === victim.id)?.removed?.reason).toBe('destruction');
    const plot = f.b.structurePlots![0]!;
    expect(plot.condition).toBe(0); expect(plot.fire).toBeUndefined();
    expect(plot.development?.status).toBe('ruin');
    const ruins = createStructureRuin(plot, 0);
    expect(ruins.children).toHaveLength(1); // Scorched footprint; no intact walls/rubble in the core.
  });

  it('settles the original shell at the recorded hit, preserves rubble, and never mutates a plot', () => {
    const f = battle();
    const plot = f.state.settlements.flatMap(s => s.structurePlots ?? []).find(p => p.condition === 0)!;
    const before = JSON.stringify(plot), scene = new THREE.Scene(), parent = new THREE.Group(), shell = new THREE.Group();
    const ruins = createStructureRuin(plot, 0); parent.add(shell, ruins); scene.add(parent);
    const destruction = new StructureDestruction(); destruction.bind(plot, shell, ruins);
    destruction.update(8, f.state.month, false);
    expect(shell.visible).toBe(true); expect(ruins.visible).toBe(false);
    destruction.update(8 + plot.destruction!.impactAt + 2, f.state.month, false);
    expect(shell.visible).toBe(false); expect(ruins.visible).toBe(true);
    destruction.update(60, f.state.month, false); expect(shell.visible).toBe(false);
    expect(JSON.stringify(plot)).toBe(before);
    expect(casualtyLifecycle(0.4, false, true).lift).toBeGreaterThan(0);
    expect(casualtyLifecycle(5, false, true).lift).toBe(0);
    expect(casualtyLifecycle(0.4, true, true).lift).toBe(0);
  });

  it('keeps deterrence inert and restricts preview destruction to its isolated state', () => {
    const f = battle('mad'), before = JSON.stringify(f.state);
    prepareStrategicWarPreview(f.state, f.war, f.kit, 'deterrence');
    expect(f.state.people.filter(p => p.alive).length).toBe(JSON.parse(before).people.filter((p: { alive: boolean }) => p.alive).length);
    const event = prepareStrategicWarPreview(f.state, f.war, f.kit, 'exchange')!;
    expect(event.impacts!.some(hit => hit.vaporized && hit.targetKind === 'structure')).toBe(true);
    expect(event.impacts!.some(hit => hit.vaporized && hit.targetKind === 'person')).toBe(true);
    expect(event.blastSites).toHaveLength(2);
    expect(event.affectedPopulation).toBeGreaterThan(8);
    expect(f.state.bodies?.filter(b => b.combatImpact?.eventId === event.id).length).toBe(event.affectedPopulation);
  });

  it('preserves strategic impact records through Simulation event publication', () => {
    const f = battle('atomic');
    const site = { x: f.b.structurePlots![0]!.worldX, z: f.b.structurePlots![0]!.worldZ };
    const impacts = resolveNuclearDestruction(f.state, 'draft-key', [site], false);
    const publisher = f.sim as unknown as { addEvent(draft: Omit<HistoricalEvent, 'id' | 'month'>): void };
    publisher.addEvent({ type: 'nuclear-use', location: site, blastSites: [site], impacts,
      actors: [f.war.id], causes: ['strategic-crisis'], context: { nuclearWeapon: 'atomic' },
      outcome: 'Recorded nuclear destruction.', summary: 'Recorded nuclear destruction.', affectedPopulation: 0,
      magnitude: 0.8, significance: 1, tags: ['war'] });
    const published = f.state.history.at(-1)!;
    expect(published.impacts).toEqual(impacts); expect(published.blastSites).toEqual([site]);
    expect(f.b.structurePlots![0]!.destruction?.eventId).toBe(published.id);
  });
});
