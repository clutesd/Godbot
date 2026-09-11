import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { Simulation } from '../src/sim/Simulation';
import {
  capabilityPractice,
  hasKnowledgeCapability,
  knowledgeLifecycleStage,
} from '../src/sim/knowledge/CapabilityContract';
import { KnowledgeSystem, practical } from '../src/sim/knowledge/KnowledgeSystem';
import { SeededRandom } from '../src/sim/prng';
import type { KnowledgeRecord, Settlement } from '../src/sim/types';
import { deriveMilitaryProfile } from '../src/sim/war/MilitaryCapability';

function record(id: string, settlement: Settlement, theory = 0.95, practice = 0.95): KnowledgeRecord {
  return {
    id,
    theory,
    practice,
    discoveredMonth: 1,
    lastUsedMonth: 1,
    originSettlementId: settlement.id,
    lineageId: `stage-test:${settlement.id}:${id}`,
    parentLineages: [],
    source: 'discovery',
    dormant: false,
  };
}

function settlementFor(seed: string): Settlement {
  const simulation = new Simulation({ seed, startingPopulation: 360, settlementCount: [4, 4] });
  const settlement = simulation.state.settlements[0];
  if (!settlement) throw new Error('Expected a settlement');
  return settlement;
}

describe('knowledge capability contract', () => {
  it('keeps a major high-practice discovery experimental until adoption is explicit', () => {
    const settlement = settlementFor('stage-major-lifecycle');
    const rail = record('rail-transport', settlement);
    settlement.knowledge.records['rail-transport'] = rail;

    expect(knowledgeLifecycleStage(settlement, 'rail-transport')).toBe('experimental');
    expect(capabilityPractice(settlement, 'rail-transport', 'experimental')).toBeCloseTo(0.95);
    expect(capabilityPractice(settlement, 'rail-transport', 'adopted')).toBe(0);
    expect(capabilityPractice(settlement, 'rail-transport', 'transformed')).toBe(0);
    expect(practical(settlement, 'rail-transport')).toBe(0);

    rail.adoptedMonth = 24;
    expect(knowledgeLifecycleStage(settlement, 'rail-transport')).toBe('adopted');
    expect(hasKnowledgeCapability(settlement, 'rail-transport', 'adopted')).toBe(true);
    expect(hasKnowledgeCapability(settlement, 'rail-transport', 'transformed')).toBe(false);
    expect(practical(settlement, 'rail-transport')).toBeCloseTo(0.95);

    rail.transformedMonth = 60;
    expect(knowledgeLifecycleStage(settlement, 'rail-transport')).toBe('transformed');
    expect(capabilityPractice(settlement, 'rail-transport', 'transformed')).toBeCloseTo(0.95);
  });

  it('treats inherited foundations as established local capability', () => {
    const settlement = settlementFor('stage-inherited-foundations');
    const fire = settlement.knowledge.records['fire-control'];
    const stone = settlement.knowledge.records['stone-composites'];

    expect(fire?.source).toBe('inheritance');
    expect(stone?.source).toBe('inheritance');
    expect(knowledgeLifecycleStage(settlement, 'fire-control')).toBe('adopted');
    expect(knowledgeLifecycleStage(settlement, 'stone-composites')).toBe('adopted');
    expect(practical(settlement, 'fire-control')).toBeGreaterThan(0);
    expect(practical(settlement, 'stone-composites')).toBeGreaterThan(0);
  });

  it('allows mature minor practices to become routine without manufacturing headline history', () => {
    const settlement = settlementFor('stage-minor-practice');
    const fire = record('fire-control', settlement, 0.9, 0.9);
    settlement.knowledge.records['fire-control'] = fire;

    expect(fire.adoptedMonth).toBeUndefined();
    expect(knowledgeLifecycleStage(settlement, 'fire-control')).toBe('adopted');
    expect(capabilityPractice(settlement, 'fire-control', 'adopted')).toBeCloseTo(0.9);
    expect(capabilityPractice(settlement, 'fire-control', 'transformed')).toBe(0);
  });

  it('removes deployed capability immediately when knowledge becomes dormant', () => {
    const settlement = settlementFor('stage-dormancy');
    const recordState = record('iron-working', settlement);
    recordState.adoptedMonth = 24;
    settlement.knowledge.records['iron-working'] = recordState;

    expect(capabilityPractice(settlement, 'iron-working', 'adopted')).toBeGreaterThan(0);
    recordState.dormant = true;
    expect(knowledgeLifecycleStage(settlement, 'iron-working')).toBe('unknown');
    expect(capabilityPractice(settlement, 'iron-working', 'experimental')).toBe(0);
    expect(practical(settlement, 'iron-working')).toBe(0);
  });

  it('requires transformation before civilization-scale production multipliers appear', () => {
    const seed = 'stage-production-transformation';
    const simulation = new Simulation({ seed, startingPopulation: 360, settlementCount: [4, 4] });
    const settlement = simulation.state.settlements[0];
    if (!settlement) throw new Error('Expected a settlement');
    const system = new KnowledgeSystem(configWith({ seed }), new SeededRandom(`${seed}:stage-production`));

    const surplus = record('agrarian-surplus', settlement);
    surplus.adoptedMonth = 24;
    settlement.knowledge.records['agrarian-surplus'] = surplus;
    const manufacturing = record('precision-manufacturing', settlement);
    manufacturing.adoptedMonth = 24;
    settlement.knowledge.records['precision-manufacturing'] = manufacturing;
    const rail = record('rail-transport', settlement);
    rail.adoptedMonth = 24;
    settlement.knowledge.records['rail-transport'] = rail;

    const adoptedOnly = system.productionFactors(settlement);
    expect(adoptedOnly.food).toBeCloseTo(1);
    expect(adoptedOnly.goods).toBeCloseTo(1);
    expect(adoptedOnly.transport).toBeCloseTo(1);

    surplus.transformedMonth = 72;
    manufacturing.transformedMonth = 72;
    rail.transformedMonth = 72;
    const transformed = system.productionFactors(settlement);
    expect(transformed.food).toBeGreaterThan(adoptedOnly.food);
    expect(transformed.goods).toBeGreaterThan(adoptedOnly.goods);
    expect(transformed.transport).toBeGreaterThan(adoptedOnly.transport);
  });

  it('requires transformed rail knowledge before rail infrastructure can grow', () => {
    const seed = 'stage-rail-infrastructure';
    const overrides = { seed, startingPopulation: 360, settlementCount: [4, 4] as const };
    const simulation = new Simulation(overrides);
    const settlement = simulation.state.settlements[0];
    if (!settlement) throw new Error('Expected a settlement');
    const system = new KnowledgeSystem(configWith(overrides), new SeededRandom(`${seed}:stage-infrastructure`));

    simulation.state.institutions = [];
    settlement.institutionIds = [];
    settlement.resources.wood = 500;
    settlement.resources.minerals = 500;
    settlement.resources.goods = 500;
    settlement.resources.wealth = 500;
    const rail = record('rail-transport', settlement);
    rail.adoptedMonth = 24;
    settlement.knowledge.records['rail-transport'] = rail;

    simulation.state.month = 12;
    system.advanceYear(simulation.state);
    expect(settlement.infrastructure.rail).toBe(0);

    rail.transformedMonth = 24;
    simulation.state.month = 24;
    system.advanceYear(simulation.state);
    expect(settlement.infrastructure.rail).toBeGreaterThan(0);
  });

  it('prevents experimental metallurgy from silently creating fieldable metal weapons', () => {
    const settlement = settlementFor('stage-military-adoption');
    settlement.resources.food = 500;
    settlement.resources.wood = 500;
    settlement.resources.minerals = 500;
    settlement.resources.goods = 500;
    settlement.resources.wealth = 500;
    settlement.infrastructure.workshops = 0.9;
    settlement.foodSecurity = 0.9;
    settlement.prosperity = 0.9;

    const iron = record('iron-working', settlement);
    settlement.knowledge.records['iron-working'] = iron;
    expect(deriveMilitaryProfile(settlement).equipment).not.toContain('metal-weapons');

    iron.adoptedMonth = 24;
    expect(deriveMilitaryProfile(settlement).equipment).toContain('metal-weapons');
  });

  it('requires transformation before advanced military systems can be fielded', () => {
    const settlement = settlementFor('stage-military-transformation');
    settlement.resources.food = 1000;
    settlement.resources.wood = 1000;
    settlement.resources.minerals = 1000;
    settlement.resources.goods = 1000;
    settlement.resources.wealth = 1000;
    settlement.infrastructure.workshops = 1;
    settlement.infrastructure.factories = 1;
    settlement.infrastructure.power = 1;
    settlement.infrastructure.roads = 1;
    settlement.industry.active = true;
    settlement.industry.intensity = 1;
    settlement.foodSecurity = 1;
    settlement.prosperity = 1;

    const transformedStack = [
      'precision-manufacturing',
      'industrial-chemistry',
      'internal-combustion',
      'electrical-generation',
      'electric-grid',
      'mass-communication',
      'computation',
      'aviation',
      'rocketry',
    ];
    for (const id of transformedStack) {
      const capability = record(id, settlement);
      capability.adoptedMonth = 24;
      settlement.knowledge.records[id] = capability;
    }
    const iron = record('iron-working', settlement);
    iron.adoptedMonth = 24;
    settlement.knowledge.records['iron-working'] = iron;
    const precision = record('precision-tools', settlement);
    precision.adoptedMonth = 24;
    settlement.knowledge.records['precision-tools'] = precision;
    const chemistry = record('chemical-reactions', settlement);
    chemistry.adoptedMonth = 24;
    settlement.knowledge.records['chemical-reactions'] = chemistry;
    const mechanical = record('mechanical-power', settlement);
    mechanical.adoptedMonth = 24;
    settlement.knowledge.records['mechanical-power'] = mechanical;

    const adoptedOnly = deriveMilitaryProfile(settlement);
    expect(adoptedOnly.equipment).not.toContain('aircraft');
    expect(adoptedOnly.equipment).not.toContain('guided-missiles');

    for (const id of transformedStack) settlement.knowledge.records[id]!.transformedMonth = 72;
    const transformed = deriveMilitaryProfile(settlement);
    expect(transformed.equipment).toContain('aircraft');
    expect(transformed.airPower).toBeGreaterThan(adoptedOnly.airPower);
    expect(transformed.missile).toBeGreaterThan(adoptedOnly.missile);
  });
});
