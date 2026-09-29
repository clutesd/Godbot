import { describe, expect, it } from 'vitest';
import { electricConsumers, powerPriorityForNeed, prepareElectricDemand } from '../src/sim/energy/Demand';
import { POWER_PRIORITIES, energyAt, poweredProductivity } from '../src/sim/energy/types';
import { societyFixture } from './fixtures/settlementDevelopment';

describe('authoritative energy demand', () => {
  it('builds explicit priority classes from settlement-scale and physical structure loads', () => {
    const { state, settlements } = societyFixture();
    const settlement = settlements[0]!;
    settlement.infrastructure.archives = 0.5;
    settlement.infrastructure.workshops = 0.6;
    settlement.infrastructure.factories = 0.7;
    settlement.infrastructure.rail = 0.4;
    settlement.industry.active = true;
    settlement.industry.intensity = 0.65;
    settlement.urbanization = 0.6;
    const culture = state.cultures[0]!;
    settlement.structurePlots = [{
      id: 'water-pump', worldX: settlement.position.x + 1, worldZ: settlement.position.z, radius: 1, width: 1, height: 1, depth: 1,
      condition: 1, foundedMonth: 0,
      development: {
        need: 'water', form: 'works', name: 'pumping works', level: 1, material: 'masonry', cultureId: culture.id, style: { ...culture.style },
        services: { water: 1 }, reasons: ['test'], capabilities: [], cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 1,
        status: 'active', origin: { month: 0, action: 'founded', name: 'pumping works', need: 'water', cultureId: culture.id, reasons: ['test'] },
        history: [], transitionCount: 0, lastUsedMonth: 0,
      },
    }];

    const consumers = electricConsumers(settlement, 100);
    const demand = (priority: typeof POWER_PRIORITIES[number]) => consumers
      .filter(consumer => consumer.priority === priority)
      .reduce((sum, consumer) => sum + consumer.demand, 0);

    expect(POWER_PRIORITIES).toEqual(['critical', 'essential', 'productive', 'discretionary']);
    expect(powerPriorityForNeed('water')).toBe('critical');
    expect(powerPriorityForNeed('manufacturing')).toBe('productive');
    expect(demand('critical')).toBeGreaterThan(0);
    expect(demand('essential')).toBeGreaterThan(0);
    expect(demand('productive')).toBeGreaterThan(demand('essential'));
    expect(demand('discretionary')).toBeGreaterThan(0);

    const prepared = prepareElectricDemand(settlement, 100);
    const energy = energyAt(settlement);
    expect(energy.ledgers.electric.demand).toBeCloseTo(prepared.reduce((sum, consumer) => sum + consumer.demand, 0), 6);
    expect(energy.service.demand.critical).toBeCloseTo(demand('critical'), 6);
  });

  it('throttles only the mechanized share from power actually delivered to productive loads', () => {
    const { settlements } = societyFixture();
    const settlement = settlements[0]!;
    settlement.infrastructure.workshops = 0.8;
    settlement.infrastructure.factories = 0.8;
    settlement.industry.active = true;
    settlement.industry.intensity = 0.8;

    const energy = energyAt(settlement);
    energy.ledgers.mechanical.demand = 10;
    energy.ledgers.mechanical.supplied = 0;
    energy.service.demand.productive = 20;
    energy.service.supplied.productive = 0;
    energy.service.demand.critical = 100;
    energy.service.supplied.critical = 100;

    const starved = poweredProductivity(settlement);
    expect(starved).toBeGreaterThan(0);
    expect(starved).toBeLessThan(0.35);

    // Fully serving hospitals/pumps does not pretend factories are powered.
    energy.service.supplied.critical = 0;
    expect(poweredProductivity(settlement)).toBeCloseTo(starved, 6);

    energy.ledgers.mechanical.supplied = 10;
    energy.service.supplied.productive = 20;
    expect(poweredProductivity(settlement)).toBeCloseTo(1, 6);
  });
});
