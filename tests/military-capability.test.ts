import { describe, expect, it } from 'vitest';
import type { Settlement } from '../src/sim/types';
import {
  deriveMilitaryProfile,
  militaryEventContext,
  militaryProfileForWar,
} from '../src/sim/war/MilitaryCapability';
import { warFixture } from './fixtures/war';
import { materialEconomy, publishBulkStocks } from '../src/sim/resources/Inventory';

function grant(settlement: Settlement, ids: readonly string[], practice = 0.92): void {
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
      lineageId: `test:${settlement.id}:${id}`,
      parentLineages: [],
      source: 'discovery',
      dormant: false,
    };
  }
}

function provision(settlement: Settlement, industrial = false): void {
  settlement.foodSecurity = 0.92;
  settlement.prosperity = 0.88;
  settlement.resources.food = 180;
  settlement.resources.wood = 140;
  settlement.resources.minerals = 160;
  settlement.localMaterials.timber = 140; settlement.localMaterials.stone = 160;
  publishBulkStocks(settlement);
  materialEconomy(settlement).arms = 12;
  materialEconomy(settlement).timberArms = 6;
  settlement.resources.goods = industrial ? 170 : 80;
  settlement.resources.wealth = industrial ? 150 : 70;
  settlement.infrastructure.workshops = industrial ? 0.9 : 0.62;
  settlement.infrastructure.factories = industrial ? 0.88 : 0.08;
  settlement.infrastructure.roads = industrial ? 0.82 : 0.38;
  settlement.infrastructure.rail = industrial ? 0.72 : 0;
  settlement.infrastructure.power = industrial ? 0.9 : 0.05;
  settlement.industry.active = industrial;
  settlement.industry.intensity = industrial ? 0.9 : 0.08;
  settlement.politicalPower.military = 0.78;
  settlement.politicalPower.institutional = 0.7;
  settlement.politicalPower.council = 0.55;
}

const ORGANIZED = ['fire-control', 'stone-composites', 'leverage', 'wheel-axle', 'iron-working', 'durable-records', 'civic-administration', 'precision-tools'] as const;
const INDUSTRIAL = [
  ...ORGANIZED,
  'standardized-parts',
  'chemical-reactions',
  'industrial-chemistry',
  'precision-manufacturing',
  'mechanical-power',
  'improved-roads',
  'rail-transport',
  'internal-combustion',
  'electrical-generation',
  'electric-grid',
] as const;
const MODERN = [...INDUSTRIAL, 'mass-communication', 'computation', 'automation', 'aviation', 'rocketry', 'satellite-systems'] as const;

describe('Military capability model', () => {
  it('derives weapons from knowledge and material capability instead of the calendar', () => {
    const { a } = warFixture('military-capability-progression');
    provision(a);

    const primitive = deriveMilitaryProfile(a);
    expect(primitive.equipment).toContain('clubs');
    expect(primitive.equipment).toContain('stone-spears');
    expect(primitive.equipment).not.toContain('metal-weapons');
    expect(primitive.equipment).not.toContain('rifles');

    grant(a, ORGANIZED);
    const organized = deriveMilitaryProfile(a);
    expect(organized.equipment).toContain('bows');
    expect(organized.equipment).toContain('shields');
    expect(organized.equipment).toContain('metal-weapons');
    expect(organized.equipment).toContain('siege-engines');
    expect(['organized-melee', 'siege']).toContain(organized.regime);
    expect(organized.equipment).not.toContain('automatic-weapons');
  });

  it('requires industrial production and power to sustain modern equipment even when knowledge exists', () => {
    const { a, b } = warFixture('military-capability-sustainment');
    grant(a, MODERN);
    grant(b, MODERN);

    // A knows the theory and practice but lacks the industrial base and stocks to field it.
    a.resources.food = 8;
    a.resources.wood = 4;
    a.resources.minerals = 3;
    a.resources.goods = 2;
    a.resources.wealth = 2;
    a.infrastructure.workshops = 0.08;
    a.infrastructure.factories = 0;
    a.infrastructure.roads = 0.08;
    a.infrastructure.rail = 0;
    a.infrastructure.power = 0;
    a.industry.active = false;
    a.industry.intensity = 0;

    provision(b, true);
    const stranded = deriveMilitaryProfile(a);
    const supplied = deriveMilitaryProfile(b);

    expect(stranded.equipment).not.toContain('automatic-weapons');
    expect(stranded.equipment).not.toContain('aircraft');
    expect(stranded.equipment).not.toContain('guided-missiles');
    expect(supplied.equipment).toContain('rifles');
    expect(supplied.equipment).toContain('grenades');
    expect(supplied.equipment).toContain('artillery');
    expect(supplied.equipment).toContain('automatic-weapons');
    expect(supplied.equipment).toContain('motor-transport');
    expect(supplied.equipment).toContain('aircraft');
    expect(supplied.equipment).toContain('guided-missiles');
    expect(supplied.regime).toBe('modern');
    expect(supplied.energy).toBeGreaterThan(stranded.energy);
    expect(supplied.production).toBeGreaterThan(stranded.production);
    expect(supplied.sustainment).toBeGreaterThan(stranded.sustainment);
  });

  it('freezes each side military profile at mobilization for renderer and historical-event use', () => {
    const fixture = warFixture('military-capability-snapshot');
    provision(fixture.a, true);
    provision(fixture.b);
    grant(fixture.a, MODERN);
    grant(fixture.b, ORGANIZED);

    for (const person of fixture.state.people) person.traits.ambition = person.homeId === fixture.a.id ? 1 : 0;
    const war = fixture.declare();
    expect(war.attacker).toBe(fixture.a.id);

    const attacker = militaryProfileForWar(war, 'attacker');
    const defender = militaryProfileForWar(war, 'defender');
    expect(attacker?.regime).toBe('modern');
    expect(attacker?.equipment).toContain('guided-missiles');
    expect(defender?.equipment).toContain('metal-weapons');
    expect(defender?.equipment).not.toContain('rifles');

    // Later discovery changes future mobilizations, not the evidence of this campaign.
    grant(fixture.b, MODERN);
    provision(fixture.b, true);
    expect(deriveMilitaryProfile(fixture.b).regime).toBe('modern');
    expect(militaryProfileForWar(war, 'defender')?.regime).not.toBe('modern');

    const context = militaryEventContext(war);
    expect(context.militaryRegimeA).toBe('modern');
    expect(String(context.militaryEquipmentA)).toContain('guided-missiles');
    expect(context.militaryPowerA).toBeTruthy();
    expect(Number(context.militarySustainmentA)).toBeGreaterThan(0);
  });
});
