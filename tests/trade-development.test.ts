import { describe, expect, it } from 'vitest';
import { developmentContext, responseForNeed } from '../src/sim/development/SettlementDevelopmentSystem';
import { materialEconomy } from '../src/sim/resources/Inventory';
import { PeopleSystem } from '../src/sim/people/PeopleSystem';
import { connect, societyFixture } from './fixtures/settlementDevelopment';

describe('settlement trade integration', () => {
  it('supports markets and merchant roles through delivered footpath trade, then storage through imports', () => {
    const { state, settlements } = societyFixture();
    const [a, b] = settlements;
    connect(state, a!, b!);
    const route = state.tradeRoutes[0]!;
    route.transport!.path!.segmentIds = [];
    route.transport!.deliveries = 0;
    const people = new PeopleSystem(state.world, state.seed);
    expect(developmentContext(state, a!).routes).toBe(0);
    expect(people.roleSupported('merchant', a!, state)).toBe(false);
    route.transport!.deliveries = 2;
    expect(developmentContext(state, a!).routes).toBe(1);
    expect(people.roleSupported('merchant', a!, state)).toBe(true);
    expect(responseForNeed(developmentContext(state, a!), 'trade')?.form).toBe('gathering');
    materialEconomy(a!).imports.pottery = 12;
    expect(responseForNeed(developmentContext(state, a!), 'trade')?.form).toBe('store');
    route.weatherBlocked = true;
    expect(developmentContext(state, a!).routes).toBe(0);
  });
});
