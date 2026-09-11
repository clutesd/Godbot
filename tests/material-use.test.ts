import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import type { DevelopmentProject, DevelopmentResponse } from '../src/sim/development/types';
import { ensureMaterialInventory, type MaterialKind } from '../src/sim/resources/MaterialEconomy';
import {
  advanceSettlementMaterialUse,
  consumeConstructionMaterials,
  materialRequirementCoverage,
  maxMaterialProgressIncrement,
  structureMaterialRequirements,
} from '../src/sim/resources/MaterialUse';
import type { Settlement } from '../src/sim/types';
import { deriveMilitaryProfile } from '../src/sim/war/MilitaryCapability';
import { warFixture } from './fixtures/war';

function zeroCost() { return { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }; }

function grant(settlement: Settlement, ids: readonly string[], practice = 0.92): void {
  for (const id of ids) {
    settlement.knowledge.records[id] = {
      id, theory: practice, practice, discoveredMonth: 0, adoptedMonth: 0, transformedMonth: 0, lastUsedMonth: 0,
      originSettlementId: settlement.id, lineageId: `material-use:${settlement.id}:${id}`, parentLineages: [], source: 'discovery', dormant: false,
    };
  }
}

const MODERN = [
  'fire-control', 'stone-composites', 'leverage', 'wheel-axle', 'iron-working', 'durable-records', 'civic-administration', 'precision-tools',
  'standardized-parts', 'chemical-reactions', 'industrial-chemistry', 'precision-manufacturing', 'mechanical-power', 'improved-roads',
  'rail-transport', 'internal-combustion', 'electrical-generation', 'electric-grid', 'mass-communication', 'computation', 'automation',
  'aviation', 'rocketry', 'satellite-systems',
] as const;

function provisionModern(settlement: Settlement): void {
  settlement.foodSecurity = 0.94;
  settlement.prosperity = 0.9;
  settlement.resources.food = 220;
  settlement.resources.wood = 180;
  settlement.resources.minerals = 220;
  settlement.resources.goods = 220;
  settlement.resources.wealth = 200;
  settlement.infrastructure.workshops = 0.95;
  settlement.infrastructure.factories = 0.92;
  settlement.infrastructure.roads = 0.9;
  settlement.infrastructure.rail = 0.8;
  settlement.infrastructure.power = 0.95;
  settlement.industry.active = true;
  settlement.industry.intensity = 0.92;
  settlement.politicalPower.military = 0.82;
  settlement.politicalPower.institutional = 0.76;
  settlement.politicalPower.council = 0.62;
}

function fill(settlement: Settlement, amount: number): void {
  const inventory = ensureMaterialInventory(settlement);
  for (const kind of Object.keys(inventory.stock) as MaterialKind[]) inventory.stock[kind] = amount;
}

describe('authoritative material use', () => {
  it('freezes a physical construction bill and consumes exactly the progress-supported share', () => {
    const sim = new Simulation({ seed: 'material-construction-authority', startingPopulation: 120, settlementCount: [2, 2] });
    const settlement = sim.state.settlements[0]!;
    const culture = sim.state.cultures[0]!;
    const response: DevelopmentResponse = {
      need: 'housing', form: 'dwelling', name: 'timber house', level: 1, material: 'timber', cultureId: culture.id, style: { ...culture.style },
      services: { housing: 1 }, reasons: ['test'], capabilities: [], cost: zeroCost(), labor: 1,
    };
    const requirements = structureMaterialRequirements(response);
    const inventory = ensureMaterialInventory(settlement);
    inventory.stock.lumber = requirements[0]!.amount * 0.5;
    inventory.stock.textile = requirements[1]!.amount * 0.5;

    expect(materialRequirementCoverage(settlement, requirements)).toBeCloseTo(0.5, 5);
    expect(maxMaterialProgressIncrement(settlement, requirements)).toBeCloseTo(0.5, 5);

    const project: DevelopmentProject = {
      plotId: 'material-test', response, action: 'founded', startedMonth: 1, progress: 0, spent: zeroCost(),
      materialRequirements: requirements, materialSpent: {},
    };
    consumeConstructionMaterials(settlement, project, 0.5, 1);

    expect(inventory.stock.lumber).toBeCloseTo(0, 5);
    expect(inventory.stock.textile).toBeCloseTo(0, 5);
    expect(project.materialSpent?.lumber).toBeCloseTo(requirements[0]!.amount * 0.5, 5);
    expect(project.materialSpent?.textile).toBeCloseTo(requirements[1]!.amount * 0.5, 5);
    expect(maxMaterialProgressIncrement(settlement, requirements)).toBe(0);
  });

  it('turns operating shortages into explicit pressure and never consumes twice in one month', () => {
    const sim = new Simulation({ seed: 'material-operating-pressure', startingPopulation: 240, settlementCount: [3, 3] });
    const settlement = sim.state.settlements[0]!;
    const residents = sim.state.people.filter(person => person.alive && person.homeId === settlement.id);
    ensureMaterialInventory(settlement);
    settlement.infrastructure.roads = 0.7;
    settlement.infrastructure.bridges = 0.5;
    settlement.infrastructure.rail = 0.8;
    settlement.infrastructure.power = 0.85;
    settlement.infrastructure.factories = 0.8;
    settlement.industry.active = true;
    settlement.industry.intensity = 0.9;
    settlement.conflictPressure = 0.8;
    settlement.politicalPower.military = 0.7;
    sim.state.month = 12;

    const first = advanceSettlementMaterialUse(sim.state, settlement, residents);
    expect(settlement.resourceScarcityPressure).toBeGreaterThan(0.75);
    expect(first.readiness.infrastructure).toBeLessThan(0.2);
    expect(first.readiness.industry).toBeLessThan(0.2);
    expect(first.criticalInputs.length).toBeGreaterThan(0);
    expect(settlement.industry.vulnerableInputs.length).toBeGreaterThan(0);

    const revision = settlement.materials!.revision;
    const second = advanceSettlementMaterialUse(sim.state, settlement, residents);
    expect(second).toBe(first);
    expect(settlement.materials!.revision).toBe(revision);
  });

  it('consumes stocked operating materials while preserving full readiness', () => {
    const sim = new Simulation({ seed: 'material-operating-supplied', startingPopulation: 180, settlementCount: [3, 3] });
    const settlement = sim.state.settlements[0]!;
    const residents = sim.state.people.filter(person => person.alive && person.homeId === settlement.id);
    fill(settlement, 100);
    settlement.infrastructure.rail = 0.7;
    settlement.infrastructure.power = 0.75;
    settlement.infrastructure.factories = 0.8;
    settlement.industry.active = true;
    settlement.industry.intensity = 0.8;
    settlement.conflictPressure = 0.6;
    settlement.politicalPower.military = 0.65;
    sim.state.month = 24;
    const steelBefore = settlement.materials!.stock.steel;
    const coalBefore = settlement.materials!.stock.coal;

    const state = advanceSettlementMaterialUse(sim.state, settlement, residents);

    expect(state.readiness.infrastructure).toBeCloseTo(1);
    expect(state.readiness.industry).toBeCloseTo(1);
    expect(state.readiness.military).toBeCloseTo(1);
    expect(settlement.materials!.stock.steel).toBeLessThan(steelBefore);
    expect(settlement.materials!.stock.coal).toBeLessThan(coalBefore);
    expect(settlement.resourceScarcityPressure).toBe(0);
  });

  it('prevents an advanced but physically empty settlement from fielding the same force as a stocked peer', () => {
    const { a, b } = warFixture('material-military-readiness');
    grant(a, MODERN); grant(b, MODERN);
    provisionModern(a); provisionModern(b);
    ensureMaterialInventory(a);
    fill(b, 120);

    a.materialUse = {
      month: 1, domains: {
        infrastructure: { demand: 1, supplied: 0, unmet: 1, coverage: 0, pressure: 1 },
        industry: { demand: 1, supplied: 0, unmet: 1, coverage: 0, pressure: 1 },
        healthcare: { demand: 0, supplied: 0, unmet: 0, coverage: 1, pressure: 0 },
        military: { demand: 1, supplied: 0, unmet: 1, coverage: 0, pressure: 1 },
      }, materials: {}, criticalInputs: ['steel', 'coal'], readiness: { infrastructure: 0, industry: 0, healthcare: 1, military: 0 },
    };
    b.materialUse = {
      month: 1, domains: {
        infrastructure: { demand: 1, supplied: 1, unmet: 0, coverage: 1, pressure: 0 },
        industry: { demand: 1, supplied: 1, unmet: 0, coverage: 1, pressure: 0 },
        healthcare: { demand: 0, supplied: 0, unmet: 0, coverage: 1, pressure: 0 },
        military: { demand: 1, supplied: 1, unmet: 0, coverage: 1, pressure: 0 },
      }, materials: {}, criticalInputs: [], readiness: { infrastructure: 1, industry: 1, healthcare: 1, military: 1 },
    };

    const empty = deriveMilitaryProfile(a);
    const stocked = deriveMilitaryProfile(b);
    expect(empty.equipment).not.toContain('automatic-weapons');
    expect(empty.equipment).not.toContain('aircraft');
    expect(empty.equipment).not.toContain('guided-missiles');
    expect(stocked.equipment).toContain('automatic-weapons');
    expect(stocked.equipment).toContain('aircraft');
    expect(stocked.equipment).toContain('guided-missiles');
    expect(stocked.production).toBeGreaterThan(empty.production);
    expect(stocked.sustainment).toBeGreaterThan(empty.sustainment);
  });
});
