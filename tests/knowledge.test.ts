import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { Simulation } from '../src/sim/Simulation';
import { KnowledgeSystem } from '../src/sim/knowledge/KnowledgeSystem';
import { SeededRandom } from '../src/sim/prng';
import type { Institution, KnowledgeRecord, Settlement, SimulationState, TradeRoute } from '../src/sim/types';

function record(id: string, settlement: Settlement, theory = 0.85, practice = 0.85): KnowledgeRecord {
  return {
    id,
    theory,
    practice,
    discoveredMonth: 0,
    lastUsedMonth: 0,
    originSettlementId: settlement.id,
    lineageId: `test:${settlement.id}:${id}`,
    parentLineages: [],
    source: 'discovery',
    dormant: false,
  };
}

function harness(seed: string, industrializationDifficulty = 1): { simulation: Simulation; system: KnowledgeSystem; state: SimulationState; settlement: Settlement } {
  const overrides = { seed, startingPopulation: 360, settlementCount: [4, 4] as const, knowledge: { industrializationDifficulty }, historicalPace: { industrialStageYears: industrializationDifficulty <= 0.05 ? 0.25 : 12 } };
  const simulation = new Simulation(overrides);
  const system = new KnowledgeSystem(configWith(overrides), new SeededRandom(`${seed}:knowledge-test`));
  const settlement = simulation.state.settlements[0];
  if (!settlement) throw new Error('Expected a settlement');
  return { simulation, system, state: simulation.state, settlement };
}

function addInstitution(state: SimulationState, settlement: Settlement, kind: Institution['kind']): void {
  const institution: Institution = {
    id: `test-${kind}-${settlement.id}`,
    name: `Test ${kind}`,
    kind,
    settlementId: settlement.id,
    cultureId: Object.keys(settlement.cultureShares)[0] ?? 'culture-1',
    foundedMonth: 0,
    support: 0.85,
    prestige: 0.8,
    resources: 30,
    reach: 0.6,
    members: 18,
    interests: ['testing'],
  };
  state.institutions.push(institution);
  settlement.institutionIds.push(institution.id);
}

describe('Causal knowledge', () => {
  it('requires material, institutional, demographic, and prior-knowledge conditions', () => {
    const { system, state, settlement } = harness('requirements');
    expect(system.canDiscover(state, settlement, 'electrical-generation')).toBe(false);

    for (const id of ['electromagnetism', 'rotary-machinery', 'mechanical-power']) settlement.knowledge.records[id] = record(id, settlement);
    settlement.resources.minerals = 100;
    settlement.resources.goods = 100;
    settlement.resources.wealth = 100;
    addInstitution(state, settlement, 'knowledge-keepers');

    expect(system.canDiscover(state, settlement, 'electrical-generation')).toBe(true);
  });

  it('moves practical knowledge gradually through a specific trade connection', () => {
    const { system, state, settlement: source } = harness('diffusion');
    const target = state.settlements[1];
    if (!target) throw new Error('Expected a second settlement');
    source.knowledge.records['precision-tools'] = record('precision-tools', source, 1, 1);
    for (const id of ['material-testing', 'counting-measure', 'iron-working']) target.knowledge.records[id] = record(id, target);
    for (const person of state.people.filter((candidate) => candidate.homeId === target.id).slice(0, 8)) person.occupation = 'artisan';
    addInstitution(state, target, 'craft-circle');
    const route: TradeRoute = { id: 'test-route', a: source.id, b: target.id, volume: 1, ageMonths: 0, caravanProgress: 0, caravanDirection: 1, mode: 'land', knowledgeFlow: 0, cumulativeKnowledge: 0, active: true };
    let events = system.diffuseTrade(state, source, target, route);
    expect(target.knowledge.records['precision-tools']).toBeUndefined();
    for (let month = 1; month < 120 && !target.knowledge.records['precision-tools']; month += 1) {
      state.month = month;
      events = [...events, ...system.diffuseTrade(state, source, target, route)];
    }

    expect(target.knowledge.records['precision-tools']?.lineageId).toBe(source.knowledge.records['precision-tools']?.lineageId);
    expect(target.knowledge.records['precision-tools']?.dormant).toBe(false);
    expect(events.some((event) => event.type === 'knowledge-exchange' && event.causes?.includes('persistent-trade'))).toBe(true);
    expect(state.settlements.slice(2).every((other) => !other.knowledge.records['precision-tools'])).toBe(true);
  });

  it('records sustained trade improvements to existing knowledge without counting zero gains', () => {
    const { system, state, settlement: source } = harness('reinforcement');
    const target = state.settlements[1]!;
    source.knowledge.records['counting-measure'] = record('counting-measure', source, 1, 1);
    target.knowledge.records = { 'counting-measure': record('counting-measure', target, 0.4, 0.4) };
    source.knowledge.records = { 'counting-measure': source.knowledge.records['counting-measure']! };
    const route: TradeRoute = { id: 'reinforcement', a: source.id, b: target.id, volume: 1, ageMonths: 24, caravanProgress: 0, caravanDirection: 1, mode: 'land', knowledgeFlow: 0, cumulativeKnowledge: 0, active: true };
    expect(system.diffuseTrade(state, source, target, route)).toEqual([]);
    const events = [];
    for (let month = 1; month <= 120; month += 1) {
      state.month = month;
      events.push(...system.diffuseTrade(state, source, target, route));
    }
    expect(target.knowledge.records['counting-measure']!.theory).toBeGreaterThan(0.4);
    expect(events.some(event => event.type === 'knowledge-exchange' && event.causes?.includes('persistent-trade'))).toBe(true);
    expect(state.stats.knowledgeExchanges).toBe(events.length);
    target.knowledge.records['counting-measure'] = record('counting-measure', target, 1, 1);
    expect(system.diffuseTrade(state, source, target, route)).toEqual([]);
    expect(state.stats.knowledgeExchanges).toBe(events.length);
  });

  it('can lose a practical capability and recover it from surviving fragments', () => {
    const { system, state, settlement } = harness('loss-and-recovery');
    settlement.knowledge.records['precision-tools'] = record('precision-tools', settlement, 0.08, 0.076);
    settlement.conflictPressure = 1;
    for (const person of state.people.filter((candidate) => candidate.homeId === settlement.id)) person.occupation = 'farmer';

    const lossEvents = system.advanceYear(state);
    expect(settlement.knowledge.records['precision-tools']?.dormant).toBe(true);
    expect(lossEvents.some((event) => event.type === 'knowledge-lost' && event.context?.knowledge === 'precision-tools')).toBe(true);

    const survivingRecord = settlement.knowledge.records['precision-tools'];
    if (!survivingRecord) throw new Error('Expected surviving fragments');
    survivingRecord.practice = 0.189;
    settlement.conflictPressure = 0;
    for (const person of state.people.filter((candidate) => candidate.homeId === settlement.id)) person.occupation = 'artisan';
    state.month += 12;
    const recoveryEvents = system.advanceYear(state);

    expect(survivingRecord.dormant).toBe(false);
    expect(recoveryEvents.some((event) => event.type === 'knowledge-rediscovered' && event.context?.knowledge === 'precision-tools')).toBe(true);
  });

  it.each([
    ['metal-machine lineage', ['mechanical-power', 'precision-manufacturing', 'iron-working']],
    ['ceramic-chemical lineage', ['mechanical-power', 'industrial-chemistry', 'high-temperature-ceramics']],
    ['electrical workshop lineage', ['electrical-generation', 'precision-manufacturing', 'improved-roads']],
  ])('permits industrialization through the %s', (routeName, knowledgeIds) => {
    const { system, state, settlement } = harness(`industry-${routeName}`, 0.05);
    for (const id of knowledgeIds) settlement.knowledge.records[id] = record(id, settlement);
    settlement.infrastructure.workshops = 0.85;
    settlement.infrastructure.roads = 0.8;
    settlement.urbanization = 0.8;
    settlement.resources.food = 500;
    settlement.resources.wood = 500;
    settlement.resources.minerals = 500;
    settlement.resources.goods = 500;
    settlement.resources.wealth = 500;
    addInstitution(state, settlement, 'craft-circle');
    let events = system.advanceYear(state);
    for (let year = 1; year < 12 && !settlement.industry.active; year += 1) {
      state.month += 12;
      events = [...events, ...system.advanceYear(state)];
    }

    expect(settlement.industry.active).toBe(true);
    expect(events.some((event) => event.type === 'industrialization' && event.context?.route === routeName)).toBe(true);
    expect(events.filter((event) => event.type === 'industrialization-stage').map((event) => event.context?.stage)).toEqual(['experimental-engines', 'specialist-workshops', 'commercial-machinery', 'transport-integration']);
  });

  it('separates major discovery from adoption and infrastructure-backed transformation', () => {
    const { system, state, settlement } = harness('adoption-stages');
    settlement.knowledge.records['mechanical-power'] = record('mechanical-power', settlement, 0.82, 0.415);
    settlement.infrastructure.workshops = 0.5;
    settlement.foodSecurity = 0.8;
    settlement.prosperity = 0.7;
    addInstitution(state, settlement, 'craft-circle');
    for (const person of state.people.filter((candidate) => candidate.homeId === settlement.id).slice(0, 14)) person.occupation = 'artisan';

    const adoption = system.advanceYear(state);
    expect(adoption.some((event) => event.type === 'knowledge-adopted' && event.context?.knowledge === 'mechanical-power')).toBe(true);
    expect(settlement.knowledge.records['mechanical-power']?.transformedMonth).toBeUndefined();

    state.month += 12;
    const capability = settlement.knowledge.records['mechanical-power'];
    if (!capability) throw new Error('Expected mechanical power');
    capability.practice = 0.68;
    const transformation = system.advanceYear(state);
    expect(transformation.some((event) => event.type === 'technology-transformation' && event.context?.knowledge === 'mechanical-power')).toBe(true);
    expect(capability.transformedMonth).toBeGreaterThan(capability.adoptedMonth ?? -1);
  });

  it('gates railways behind the full enabling stack rather than elapsed time', () => {
    const { system, state, settlement } = harness('railway-prerequisites');
    settlement.resources.minerals = 500;
    settlement.resources.goods = 500;
    settlement.resources.wealth = 500;
    // Time, population, and stockpiles alone are not enough.
    state.month = 4000 * 12;
    expect(system.canDiscover(state, settlement, 'rail-transport')).toBe(false);
    expect(system.discoveryChance(state, settlement, 'rail-transport')).toBe(0);

    // Mechanical power and metallurgy without precision tools, transport demand, engineered
    // roads, workshops, surplus, or organizing institutions: still impossible.
    for (const id of ['mechanical-power', 'iron-working']) settlement.knowledge.records[id] = record(id, settlement);
    expect(system.canDiscover(state, settlement, 'rail-transport')).toBe(false);

    // The full enabling stack makes it merely possible, not certain.
    for (const id of ['improved-roads', 'precision-tools']) settlement.knowledge.records[id] = record(id, settlement);
    settlement.infrastructure.roads = 0.6;
    settlement.infrastructure.workshops = 0.5;
    settlement.foodSecurity = 0.8;
    settlement.prosperity = 0.7;
    addInstitution(state, settlement, 'merchant-association');
    state.tradeRoutes.push(
      { id: 'route-a', a: settlement.id, b: 'elsewhere-1', volume: 1, ageMonths: 24, caravanProgress: 0, caravanDirection: 1, mode: 'land', knowledgeFlow: 0, cumulativeKnowledge: 0, active: true },
      { id: 'route-b', a: settlement.id, b: 'elsewhere-2', volume: 1, ageMonths: 24, caravanProgress: 0, caravanDirection: 1, mode: 'land', knowledgeFlow: 0, cumulativeKnowledge: 0, active: true },
    );
    const locals = state.people.filter((person) => person.homeId === settlement.id);
    locals.slice(0, 7).forEach((person) => { person.occupation = 'builder'; });
    locals.slice(7, 14).forEach((person) => { person.occupation = 'carrier'; });
    expect(system.canDiscover(state, settlement, 'rail-transport')).toBe(true);
    expect(system.discoveryChance(state, settlement, 'rail-transport')).toBeGreaterThan(0);
  });

  it('ramps discovery probability from near-impossible to likely as enabling mastery matures', () => {
    const { system, state, settlement } = harness('discovery-curves');
    settlement.resources.minerals = 500;
    settlement.resources.goods = 500;
    settlement.resources.wealth = 500;
    settlement.infrastructure.roads = 0.6;
    settlement.infrastructure.workshops = 0.5;
    settlement.foodSecurity = 0.8;
    settlement.prosperity = 0.7;
    addInstitution(state, settlement, 'merchant-association');
    state.tradeRoutes.push(
      { id: 'route-a', a: settlement.id, b: 'elsewhere-1', volume: 1, ageMonths: 24, caravanProgress: 0, caravanDirection: 1, mode: 'land', knowledgeFlow: 0, cumulativeKnowledge: 0, active: true },
      { id: 'route-b', a: settlement.id, b: 'elsewhere-2', volume: 1, ageMonths: 24, caravanProgress: 0, caravanDirection: 1, mode: 'land', knowledgeFlow: 0, cumulativeKnowledge: 0, active: true },
    );
    const locals = state.people.filter((person) => person.homeId === settlement.id);
    locals.slice(0, 7).forEach((person) => { person.occupation = 'builder'; });
    locals.slice(7, 14).forEach((person) => { person.occupation = 'carrier'; });

    // Every foundation at 60% of assumed mastery: conceivable, but very unlikely.
    settlement.knowledge.records['mechanical-power'] = record('mechanical-power', settlement, 0.3 * 0.6, 0.58 * 0.6);
    settlement.knowledge.records['improved-roads'] = record('improved-roads', settlement, 0.22 * 0.6, 0.42 * 0.6);
    settlement.knowledge.records['iron-working'] = record('iron-working', settlement, 0.25 * 0.6, 0.5 * 0.6);
    settlement.knowledge.records['precision-tools'] = record('precision-tools', settlement, 0.24 * 0.6, 0.42 * 0.6);
    const unlikely = system.discoveryChance(state, settlement, 'rail-transport');
    expect(unlikely).toBeGreaterThan(0);

    for (const id of ['mechanical-power', 'improved-roads', 'iron-working', 'precision-tools']) {
      settlement.knowledge.records[id] = record(id, settlement, 0.95, 0.95);
    }
    const likely = system.discoveryChance(state, settlement, 'rail-transport');
    expect(likely).toBeGreaterThan(unlikely * 5);
  });

  it('lets centuries pass without advanced technology when enabling conditions never accumulate', () => {
    const { system, state, settlement } = harness('quiet-millennia');
    for (let year = 0; year < 600; year += 1) {
      state.month += 12;
      system.advanceYear(state);
    }
    expect(state.month / 12).toBeGreaterThanOrEqual(600);
    // No institutions, stockpiles, precision craft, or trade demand ever formed: no scheduled unlocks.
    for (const id of ['rail-transport', 'mechanical-power', 'electrical-generation', 'electric-grid', 'computation']) {
      expect(settlement.knowledge.records[id]).toBeUndefined();
    }
  });

  it('separates local adoption from world-wide diffusion of a capability', () => {
    const simulation = new Simulation({ seed: 'widespread-adoption', startingPopulation: 240, settlementCount: [4, 4] as const });
    const firstTwo = simulation.state.settlements.slice(0, 2);
    for (const settlement of firstTwo) {
      settlement.knowledge.records['crop-selection'] = { ...record('crop-selection', settlement, 0.7, 0.6), adoptedMonth: 1 };
    }
    simulation.step(12);
    const widespread = simulation.state.history.filter((event) => event.type === 'technology-widespread' && event.context.knowledge === 'crop-selection');
    expect(widespread).toHaveLength(1);
    expect(String(widespread[0]?.context.stage)).toBe('widespread-adoption');
  });

  it('keeps discovery histories reproducible while allowing other seeds to diverge', () => {
    const run = (seed: string): unknown[] => {
      const simulation = new Simulation({ seed, startingPopulation: 240 });
      simulation.step(100 * 12);
      return simulation.state.history.filter((event) => event.type === 'discovery' || event.type === 'knowledge-lost' || event.type === 'knowledge-rediscovered').map((event) => [event.month, event.type, event.locationId, event.context.knowledge]);
    };
    expect(run('reproducible-knowledge')).toEqual(run('reproducible-knowledge'));
    expect(run('reproducible-knowledge')).not.toEqual(run('different-knowledge'));
  }, 180_000);
});
