import { describe, expect, it } from 'vitest';
import type { Settlement } from '../src/sim/types';
import { deriveMilitaryProfile } from '../src/sim/war/MilitaryCapability';
import { militaryVisualStyle } from '../src/render/war/MilitaryVisualLanguage';
import { WarRenderer } from '../src/render/war/WarRenderer';
import { warEventStory } from '../src/historian/WarStory';
import { warFixture } from './fixtures/war';

function grant(settlement: Settlement, ids: readonly string[], practice = 0.96): void {
  for (const id of ids) {
    settlement.knowledge.records[id] = {
      id,
      theory: practice,
      practice,
      discoveredMonth: 0,
      adoptedMonth: 0,
      transformedMonth: 0,
      lastUsedMonth: 0,
      originSettlementId: settlement.id,
      lineageId: `presentation-test:${settlement.id}:${id}`,
      parentLineages: [],
      source: 'discovery',
      dormant: false,
    };
  }
}

function modernize(settlement: Settlement): void {
  settlement.foodSecurity = 0.96;
  settlement.prosperity = 0.94;
  settlement.resources.food = 220;
  settlement.resources.wood = 160;
  settlement.resources.minerals = 210;
  settlement.resources.goods = 220;
  settlement.resources.wealth = 210;
  settlement.infrastructure.workshops = 0.94;
  settlement.infrastructure.factories = 0.93;
  settlement.infrastructure.roads = 0.9;
  settlement.infrastructure.rail = 0.8;
  settlement.infrastructure.power = 0.95;
  settlement.industry.active = true;
  settlement.industry.intensity = 0.95;
  settlement.politicalPower.military = 0.88;
  settlement.politicalPower.institutional = 0.8;
  settlement.politicalPower.council = 0.64;
  grant(settlement, [
    'fire-control', 'stone-composites', 'leverage', 'wheel-axle', 'iron-working',
    'durable-records', 'civic-administration', 'precision-tools', 'standardized-parts',
    'chemical-reactions', 'industrial-chemistry', 'precision-manufacturing', 'mechanical-power',
    'improved-roads', 'rail-transport', 'internal-combustion', 'electrical-generation',
    'electric-grid', 'mass-communication', 'computation', 'automation', 'aviation',
    'rocketry', 'satellite-systems',
  ]);
}

describe('Step 3 military presentation', () => {
  it('maps capability to recognizably different formations and support assets', () => {
    const fixture = warFixture('war-presentation-style');
    const primitive = militaryVisualStyle(deriveMilitaryProfile(fixture.b));
    modernize(fixture.a);
    const modern = militaryVisualStyle(deriveMilitaryProfile(fixture.a));
    expect(primitive.doctrine).toBe('warband');
    expect(modern.doctrine).toBe('combined-arms');
    expect(modern.vehicles).toBeGreaterThan(0);
    expect(modern.aircraft).toBeGreaterThan(0);
    expect(modern.missiles).toBeGreaterThan(0);
    expect(modern.tracer).toBeGreaterThan(primitive.tracer);
  });

  it('renders capability-specific equipment without mutating the simulation', () => {
    const fixture = warFixture('war-presentation-renderer');
    modernize(fixture.a);
    for (const person of fixture.state.people) person.traits.ambition = person.homeId === fixture.a.id ? 1 : 0;
    const war = fixture.declare();
    fixture.tick(4);
    const renderer = new WarRenderer(fixture.state, () => 2);
    const before = JSON.stringify(fixture.state);
    renderer.update(0.1, 1, war.id);
    expect(renderer.group.getObjectByName('vehicle-0')).toBeDefined();
    expect(renderer.group.getObjectByName('artillery-0')).toBeDefined();
    expect(renderer.group.getObjectByName('Capability battle spectacle')).toBeDefined();
    expect(JSON.stringify(fixture.state)).toBe(before);
    renderer.dispose();
  });

  it('lets the Watcher describe first-use capability and the changed character of battle from frozen evidence', () => {
    const fixture = warFixture('war-presentation-watcher');
    modernize(fixture.a);
    for (const person of fixture.state.people) person.traits.ambition = person.homeId === fixture.a.id ? 1 : 0;
    const war = fixture.declare();
    const declaration = fixture.state.history.find(event => event.type === 'war-declared' && event.actors.includes(war.id))!;
    const opening = warEventStory(fixture.state, declaration)!;
    expect(opening).toContain('guided missiles');
    expect(opening).toContain('first war in my record');
    expect(opening).toContain('outcome was still unwritten');

    for (let month = 0; month < 70 && !fixture.state.history.some(event => event.type === 'battle' && event.actors.includes(war.id)); month++) fixture.tick();
    const battle = fixture.state.history.find(event => event.type === 'battle' && event.actors.includes(war.id))!;
    expect(battle).toBeDefined();
    const story = warEventStory(fixture.state, battle)!;
    const characterMarkers = ['killing distance', 'Machines, fire', 'bombardment', 'across distance'];
    expect(characterMarkers.some(candidate => story.includes(candidate))).toBe(true);
    expect(/life|lives/.test(story)).toBe(true);
  });
});
