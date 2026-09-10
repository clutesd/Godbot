import { describe, expect, it } from 'vitest';
import { warFixture } from './fixtures/war';
import { campaignFront, campaignPoint, createCampaign, TRUCE_MONTHS } from '../src/sim/war/Campaign';
import { WalkabilityLayer } from '../src/sim/people/WalkabilityLayer';
import { Historian } from '../src/historian/Historian';
import { warEventStory } from '../src/historian/WarStory';
import { WarRenderer } from '../src/render/war/WarRenderer';
import type * as THREE from 'three';

describe('Witnessed campaigns', () => {
  it('makes longer routes take longer and never interpolates across a route corner', () => {
    const { state, a, b } = warFixture();
    const walking = new WalkabilityLayer(state.world);
    const long = createCampaign(state.world, walking, a, b, 0, 10, 10);
    const near = createCampaign(state.world, walking, a, { ...b, position: { x: -5, z: 0 } }, 0, 10, 10);
    expect(long.marchMonths).toBeGreaterThan(near.marchMonths);
    expect(walking.routeIsValid(long.route)).toBe(true);
    expect(campaignPoint([{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 10, z: 10 }], 0.75, a.position)).toEqual({ x: 5, z: 10 });
  });

  it('records a full deterministic campaign, actual losses, co-located reports, and bounded dispatches', () => {
    const first = warFixture();
    const second = warFixture();
    const war = first.declare(); second.declare();
    const before = first.state.people.filter(p => p.alive).length;
    const phases = new Set([war.phase]);
    for (let month = 0; month < 80; month++) {
      first.tick(); second.tick(); phases.add(war.phase);
      const battle = [...first.state.history].reverse().find(e => e.type === 'battle' && e.month === first.state.month);
      if (battle) expect(battle.location).toEqual(campaignFront(war, first.b.position));
    }
    expect(phases.has('mobilizing') && phases.has('marching') && phases.has('battle')).toBe(true);
    expect(war.resolvedMonth).toBeDefined();
    expect(war.active).toBe(false);
    expect(war.casualtiesA + war.casualtiesB).toBe(before - first.state.people.filter(p => p.alive).length);
    expect(war.campaign.battleCount).toBeGreaterThan(0);
    expect(first.state.history.filter(e => e.type === 'war-ended')).toHaveLength(1);
    expect(new Set(war.campaign.dispatches).size).toBe(war.campaign.dispatches.length);
    expect(first.state.wars).toEqual(second.state.wars);
    expect(first.state.history).toEqual(second.state.history);
  });

  it('ends an impassable campaign without imaginary battles and enforces the truce', () => {
    const fixture = warFixture();
    const war = fixture.declare();
    // A world-changing flood closes the already surveyed route.
    fixture.state.world.terrain.waterLevel.fill(1);
    fixture.state.world.environmentRevision!++;
    fixture.tick(30);
    expect(war.resolutionReason).toBe('impassable');
    expect(war.campaign.battleCount).toBe(0);
    expect(war.casualtiesA + war.casualtiesB).toBe(0);
    expect(fixture.state.history.filter(e => e.type === 'war-campaign')).toHaveLength(1);
    fixture.declare();
    expect(fixture.state.wars).toHaveLength(1);
    fixture.tick(TRUCE_MONTHS);
    fixture.declare();
    expect(fixture.state.wars).toHaveLength(2);
  });

  it('closes a war when a settlement disappears and prevents a collapsed army receiving tribute', () => {
    const fixture = warFixture();
    const war = fixture.declare();
    fixture.a.alive = false;
    fixture.tick();
    expect(war.resolutionReason).toBe('settlement-lost');
    expect(fixture.state.history.some(e => e.type === 'war-ended')).toBe(true);
    const another = warFixture();
    const w = another.declare();
    w.progress = 1; w.moraleA = 0.05;
    const a = another.state.settlements.find(s => s.id === w.attacker)!;
    const b = another.state.settlements.find(s => s.id === w.defender)!;
    const wealth = a.resources.wealth;
    another.engine.endWar(w, a, b);
    expect(w.phase).toBe('negotiation');
    expect(a.resources.wealth).toBe(wealth);
  });

  it('grounds watcher chapters without future knowledge or duplicate casualty prose', () => {
    const fixture = warFixture();
    const war = fixture.declare();
    const declaration = fixture.state.history.find(e => e.type === 'war-declared')!;
    const text = warEventStory(fixture.state, declaration);
    fixture.tick(80);
    expect(warEventStory(fixture.state, declaration)).toBe(text);
    const historian = new Historian(fixture.sim.config);
    fixture.state.month = war.resolvedMonth!;
    const ending = fixture.state.history.find(e => e.type === 'war-ended')!;
    const scene = historian.chooseScene(fixture.state, ending.id);
    expect(scene.statement.text).toContain(`I watched this war for ${ending.context.months} months`);
    expect(scene.statement.claims.warId).toBe(war.id);
    expect(historian.validateStatement(scene.statement, fixture.state)).toBe(true);
    const ongoing = warFixture();
    const active = ongoing.declare(); ongoing.tick(4);
    const observer = new Historian(ongoing.sim.config);
    const candidates = observer.candidates(ongoing.state);
    expect(candidates.some(c => c.id.startsWith('campaign:') && c.statement.claims.warId === active.id && observer.validateStatement(c.statement, ongoing.state))).toBe(true);
  });

  it('removes modern casualties from represented cities without treating the documentary cast as extra people', () => {
    const fixture = warFixture();
    fixture.state.advanced.scale = 'modern-statistical';
    fixture.state.advanced.representedPopulation = 100_000;
    fixture.state.advanced.cities.forEach(city => { city.population = 50_000; });
    const war = fixture.declare();
    const cast = fixture.state.people.filter(p => p.alive).length;
    const deaths = fixture.state.stats.deaths;
    fixture.tick(80);
    const losses = war.casualtiesA + war.casualtiesB;
    expect(losses).toBeGreaterThan(0);
    expect(fixture.state.advanced.representedPopulation).toBe(100_000 - losses);
    expect(fixture.state.advanced.cities.reduce((n, c) => n + c.population, 0)).toBe(100_000 - losses);
    expect(fixture.state.stats.deaths - deaths).toBe(losses);
    expect(fixture.state.people.filter(p => p.alive)).toHaveLength(cast);
    expect(fixture.a.resources.food).toBeGreaterThan(0);
  });

  it('lets poor supply delay the march and cites earlier contact when the watcher remembers it', () => {
    const provisioned = warFixture();
    const hungry = warFixture();
    const a = provisioned.declare();
    const b = hungry.declare();
    hungry.state.settlements.forEach(s => { s.foodSecurity = 0.03; s.prosperity = 0; s.resources.food = 0; });
    provisioned.tick(6); hungry.tick(6);
    expect(a.marchProgress).toBeGreaterThan(b.marchProgress);
    expect(b.campaign.exhaustionA).toBeGreaterThan(a.campaign.exhaustionA);
    // A prior relation event must exist in the record before memory can mention it.
    const past = warFixture();
    const firstWar = past.declare(); past.tick(80);
    const peace = past.state.history.find(e => e.type === 'war-ended')!;
    past.state.month = firstWar.resolvedMonth! + TRUCE_MONTHS;
    past.declare();
    const declaration = [...past.state.history].reverse().find(e => e.type === 'war-declared')!;
    const historian = new Historian(past.sim.config);
    const scene = historian.chooseScene(past.state, declaration.id);
    expect(scene.statement.text).toContain('I last recorded peace between them');
    expect(scene.statement.sourceEventIds).toContain(peace.id);
    expect(historian.validateStatement(scene.statement, past.state)).toBe(true);
  });

  it('animates persistent figures without changing state, handles reduced motion, and releases expired campaigns', () => {
    const fixture = warFixture();
    const war = fixture.declare();
    fixture.tick(4);
    const renderer = new WarRenderer(fixture.state, () => 2);
    const before = JSON.stringify(fixture.state);
    renderer.update(0.1, 0, war.id);
    const company = renderer.group.children[0]!;
    const legs = company.children[2] as THREE.InstancedMesh;
    const initial = Array.from(legs.instanceMatrix.array);
    renderer.update(0.1, 0.2, war.id);
    expect(company).toBe(renderer.group.children[0]);
    expect(Array.from(legs.instanceMatrix.array)).not.toEqual(initial);
    expect(renderer.report.figures).toBeGreaterThan(0);
    expect(renderer.report.figures).toBeLessThanOrEqual(renderer.report.budget);
    renderer.update(0.1, 2, war.id, true);
    const still = Array.from(legs.instanceMatrix.array);
    renderer.update(0.1, 8, war.id, true);
    expect(Array.from(legs.instanceMatrix.array)).toEqual(still);
    expect(JSON.stringify(fixture.state)).toBe(before);
    fixture.tick(100);
    renderer.update(0.1, 9);
    expect(renderer.report.campaigns).toBe(0);
    renderer.dispose(); renderer.dispose();
    expect(renderer.group.children).toHaveLength(0);
  });
});
