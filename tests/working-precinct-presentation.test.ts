import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import type { Settlement, StructurePlot } from '../src/sim/types';
import type { SettlementNeed, ServiceSupply, StructureDevelopment, StructureForm } from '../src/sim/development/types';
import { planWorkingPrecinct, precinctStockOwner } from '../src/render/settlement/WorkingPrecinctPresentation';

function development(
  settlement: Settlement,
  need: SettlementNeed,
  form: StructureForm,
  services: ServiceSupply,
  capabilities: string[] = [],
): StructureDevelopment {
  const cultureId = Object.keys(settlement.cultureShares)[0] ?? 'culture';
  return {
    need,
    form,
    name: `${need} site`,
    level: 2,
    material: 'timber',
    cultureId,
    style: {
      primary: '#765544',
      secondary: '#4a3e38',
      accent: '#c8a65a',
      symbol: 'sun-step',
      pattern: 'chevron',
      nameSyllables: ['ka'],
    },
    services,
    reasons: ['test'],
    capabilities,
    cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
    labor: 4,
    status: 'active',
    origin: {
      month: 0,
      action: 'founded',
      name: `${need} site`,
      need,
      cultureId,
      reasons: ['test'],
      form,
      level: 2,
      material: 'timber',
    },
    history: [],
    transitionCount: 0,
    lastUsedMonth: 0,
  };
}

function plot(id: string, developmentState: StructureDevelopment): StructurePlot {
  return {
    id,
    development: developmentState,
    worldX: 0,
    worldZ: 0,
    radius: 1.65,
    width: 2.1,
    height: 1.2,
    depth: 1.72,
    condition: 1,
    foundedMonth: 0,
  };
}

function settlement(seed: string): Settlement {
  const simulation = new Simulation({ seed, startingPopulation: 24, settlementCount: [1, 1], world: { size: 20 } });
  const value = simulation.state.settlements[0]!;
  value.resources = { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 };
  value.localMaterials = {};
  value.structurePlots = [];
  return value;
}

describe('working precinct presentation', () => {
  it('shows manufacturing function without inventing resource stock', () => {
    const town = settlement('precinct-empty-workshop');
    const site = plot('workshop-a', development(town, 'manufacturing', 'workshop', { manufacturing: 1 }, ['precision-tools']));
    town.structurePlots = [site];

    const plan = planWorkingPrecinct(town, site, { width: site.width, depth: site.depth });
    expect(plan).toBeDefined();
    expect(plan!.primitives.some(primitive => primitive.cue === 'working-ground')).toBe(true);
    expect(plan!.primitives.some(primitive => primitive.cue === 'work-surface')).toBe(true);
    expect(plan!.primitives.some(primitive => primitive.cue.startsWith('stock:'))).toBe(false);
  });

  it('renders real stock only at one deterministic eligible precinct', () => {
    const town = settlement('precinct-stock-owner');
    town.resources.minerals = 18;
    const first = plot('workshop-a', development(town, 'manufacturing', 'workshop', { manufacturing: 1 }));
    const second = plot('workshop-b', development(town, 'manufacturing', 'workshop', { manufacturing: 1 }));
    town.structurePlots = [second, first];

    expect(precinctStockOwner(town, 'minerals')).toBe('workshop-a');
    const firstPlan = planWorkingPrecinct(town, first, { width: first.width, depth: first.depth })!;
    const secondPlan = planWorkingPrecinct(town, second, { width: second.width, depth: second.depth })!;
    expect(firstPlan.primitives.some(primitive => primitive.cue === 'stock:minerals')).toBe(true);
    expect(secondPlan.primitives.some(primitive => primitive.cue === 'stock:minerals')).toBe(false);
  });

  it('gives sacred and domestic structures distinct readable precinct grammar', () => {
    const town = settlement('precinct-functional-grammar');
    const home = plot('home', development(town, 'housing', 'dwelling', { housing: 1 }));
    const shrine = plot('shrine', development(town, 'religion', 'sanctuary', { religion: 1 }));
    town.structurePlots = [home, shrine];

    const homePlan = planWorkingPrecinct(town, home, { width: home.width, depth: home.depth })!;
    const shrinePlan = planWorkingPrecinct(town, shrine, { width: shrine.width, depth: shrine.depth })!;
    expect(homePlan.primitives.some(primitive => primitive.cue === 'domestic-yard')).toBe(true);
    expect(homePlan.primitives.some(primitive => primitive.cue === 'fence')).toBe(true);
    expect(shrinePlan.primitives.some(primitive => primitive.cue === 'gathering-space')).toBe(true);
    expect(shrinePlan.primitives.some(primitive => primitive.cue === 'sacred-marker')).toBe(true);
  });

  it('does not dress abandoned or ruined development as active work', () => {
    const town = settlement('precinct-inactive');
    const site = plot('store', development(town, 'trade', 'store', { trade: 1 }));
    town.structurePlots = [site];

    site.development!.status = 'abandoned';
    expect(planWorkingPrecinct(town, site, { width: site.width, depth: site.depth })).toBeUndefined();

    site.development!.status = 'ruin';
    expect(planWorkingPrecinct(town, site, { width: site.width, depth: site.depth })).toBeUndefined();
  });
});
