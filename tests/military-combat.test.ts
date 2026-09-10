import { describe, expect, it } from 'vitest';
import type { Settlement } from '../src/sim/types';
import { deriveMilitaryProfile } from '../src/sim/war/MilitaryCapability';
import {
  assessMilitaryCombat,
  militaryMarchMultiplier,
  militaryOperationalSupply,
} from '../src/sim/war/MilitaryCombat';
import { warFixture } from './fixtures/war';

function grant(settlement: Settlement, ids: readonly string[], practice = 0.94): void {
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
      lineageId: `combat-test:${settlement.id}:${id}`,
      parentLineages: [],
      source: 'discovery',
      dormant: false,
    };
  }
}

function industrialize(settlement: Settlement): void {
  settlement.foodSecurity = 0.94;
  settlement.prosperity = 0.9;
  settlement.resources.food = 200;
  settlement.resources.wood = 150;
  settlement.resources.minerals = 180;
  settlement.resources.goods = 190;
  settlement.resources.wealth = 170;
  settlement.infrastructure.workshops = 0.92;
  settlement.infrastructure.factories = 0.9;
  settlement.infrastructure.roads = 0.86;
  settlement.infrastructure.rail = 0.74;
  settlement.infrastructure.power = 0.92;
  settlement.industry.active = true;
  settlement.industry.intensity = 0.92;
  settlement.politicalPower.military = 0.8;
  settlement.politicalPower.institutional = 0.72;
  settlement.politicalPower.council = 0.58;
}

const ORGANIZED = ['fire-control', 'stone-composites', 'leverage', 'wheel-axle', 'iron-working', 'durable-records', 'civic-administration', 'precision-tools'] as const;
const INDUSTRIAL = [
  ...ORGANIZED,
  'standardized-parts', 'chemical-reactions', 'industrial-chemistry', 'precision-manufacturing',
  'mechanical-power', 'improved-roads', 'rail-transport', 'internal-combustion',
  'electrical-generation', 'electric-grid',
] as const;
const MODERN = [...INDUSTRIAL, 'mass-communication', 'computation', 'automation', 'aviation', 'rocketry', 'satellite-systems'] as const;

describe('Capability-driven military mechanics', () => {
  it('keeps near-peer early fighting bounded while making a modern mismatch nonlinear', () => {
    const fixture = warFixture('military-combat-mismatch');
    const primitiveA = deriveMilitaryProfile(fixture.a);
    const primitiveB = deriveMilitaryProfile(fixture.b);
    const peer = assessMilitaryCombat(primitiveA, primitiveB, fixture.b);
    expect(peer.casualtyPressureA).toBeGreaterThan(0.4);
    expect(peer.casualtyPressureA).toBeLessThan(1.5);
    expect(peer.engagementMode).toBe('close');

    industrialize(fixture.a);
    grant(fixture.a, MODERN);
    const modern = deriveMilitaryProfile(fixture.a);
    const mismatch = assessMilitaryCombat(modern, primitiveB, fixture.b);
    expect(['combined-arms', 'stand-off']).toContain(mismatch.engagementMode);
    expect(mismatch.effectivenessA).toBeGreaterThan(peer.effectivenessA);
    expect(mismatch.casualtyPressureB).toBeGreaterThan(peer.casualtyPressureB);
    expect(mismatch.mismatchA).toBeGreaterThan(0.2);
    expect(mismatch.rangeA).toBeGreaterThan(mismatch.rangeB);
  });

  it('lets siege and firepower erode prepared defensive works rather than deleting defense outright', () => {
    const fixture = warFixture('military-combat-siege');
    fixture.b.buildings = 35;
    fixture.b.urbanization = 0.7;
    fixture.b.infrastructure.workshops = 0.72;
    grant(fixture.b, ORGANIZED);
    const defender = deriveMilitaryProfile(fixture.b);

    grant(fixture.a, ORGANIZED);
    const organized = deriveMilitaryProfile(fixture.a);
    const weakBreach = assessMilitaryCombat(organized, defender, fixture.b);

    industrialize(fixture.a);
    grant(fixture.a, INDUSTRIAL);
    const industrial = deriveMilitaryProfile(fixture.a);
    const strongBreach = assessMilitaryCombat(industrial, defender, fixture.b);
    expect(strongBreach.breachA).toBeGreaterThan(weakBreach.breachA);
    expect(strongBreach.defenderWorksMultiplier).toBeLessThan(weakBreach.defenderWorksMultiplier);
    expect(strongBreach.defenderWorksMultiplier).toBeGreaterThanOrEqual(1);
  });

  it('makes sophisticated armies fast when supported and fragile when their home system collapses', () => {
    const fixture = warFixture('military-combat-logistics');
    const primitive = deriveMilitaryProfile(fixture.b);
    industrialize(fixture.a);
    grant(fixture.a, MODERN);
    const mobilized = deriveMilitaryProfile(fixture.a);
    expect(militaryMarchMultiplier(mobilized)).toBeGreaterThan(militaryMarchMultiplier(primitive));

    const supplied = militaryOperationalSupply(fixture.a, mobilized, 0.9);
    fixture.a.resources.food = 2;
    fixture.a.resources.goods = 0;
    fixture.a.resources.minerals = 0;
    fixture.a.resources.wealth = 0;
    fixture.a.infrastructure.power = 0;
    fixture.a.infrastructure.factories = 0;
    fixture.a.industry.intensity = 0;
    const stranded = militaryOperationalSupply(fixture.a, mobilized, 0.9);
    expect(supplied).toBeGreaterThan(stranded);
    expect(stranded).toBeLessThan(0.8);
  });

  it('wires the capability model into real campaign ticks without replacing the existing war state machine', () => {
    const fixture = warFixture('military-combat-runtime');
    industrialize(fixture.a);
    grant(fixture.a, MODERN);
    for (const person of fixture.state.people) person.traits.ambition = person.homeId === fixture.a.id ? 1 : 0;

    const goodsBefore = fixture.a.resources.goods;
    const war = fixture.declare();
    expect(war.attacker).toBe(fixture.a.id);
    for (let month = 0; month < 50 && war.campaign.battleCount === 0; month++) fixture.tick();
    if (war.campaign.battleCount === 0 && war.active) fixture.tick(20);

    const battle = fixture.state.history.find(event => event.type === 'battle' && event.actors.includes(war.id));
    expect(battle).toBeDefined();
    expect(battle?.context.engagementMode).toBeTruthy();
    expect(Number(battle?.context.militaryRangeA ?? 0)).toBeGreaterThan(Number(battle?.context.militaryRangeB ?? 0));
    expect(Number(battle?.context.militaryMismatchA ?? 0)).toBeGreaterThan(0.2);
    expect(String(battle?.context.militaryEquipmentA ?? '')).toContain('guided-missiles');
    expect(war.campaign.dispatches).toContain('capability-mismatch');
    expect(fixture.a.resources.goods).toBeLessThan(goodsBefore);
  });
});
