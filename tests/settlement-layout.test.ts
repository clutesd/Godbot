import { describe, expect, it } from 'vitest';
import { createSettlementLayoutPlan, districtForPlot } from '../src/render/placement/SettlementLayoutPlan';
import type { Settlement, TradeRoute } from '../src/sim/types';

function settlement(id: string, x: number, z: number, overrides: Partial<Settlement> = {}): Settlement {
  return {
    id,
    name: id,
    position: { x, z },
    cellIndex: 0,
    foundedMonth: 0,
    cultureShares: {},
    resources: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
    monthlyBalance: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
    buildings: 24,
    targetBuildings: 24,
    constructionProgress: 0,
    specialization: 'exchange',
    foodSecurity: 0.8,
    prosperity: 0.6,
    knowledge: {} as Settlement['knowledge'],
    infrastructure: { roads: 0.5, ports: 0, bridges: 0.2, workshops: 0.3, archives: 0.1, rail: 0, power: 0, factories: 0 },
    industry: { active: false, intensity: 0, stage: 'pre-industrial', stageProgress: 0, route: [], vulnerableInputs: [] },
    pollution: 0,
    urbanization: 0.45,
    climateStress: 0,
    conflictPressure: 0,
    crisisMonths: 0,
    depopulationMonths: 0,
    politicalPower: {} as Settlement['politicalPower'],
    polityId: 'polity',
    institutionIds: [],
    alive: true,
    materials: {},
    discoveredDeposits: [],
    workedDeposits: [],
    knownRecipes: [],
    ...overrides,
  };
}

function route(id: string, a: string, b: string, mode: TradeRoute['mode'], volume = 0.6): TradeRoute {
  return { id, a, b, mode, volume, ageMonths: 120, caravanProgress: 0.4, caravanDirection: 1, knowledgeFlow: 0, cumulativeKnowledge: 0, active: true, transport: { projectIds: ['surveyed-project'], nextDispatchMonth: 0, path: { mode: mode === 'water' ? 'water' : 'road', segmentIds: ['completed-segment'], length: 10, points: [{ x: 10, y: 1, z: 0 }, { x: 20, y: 1, z: 0 }] } } };
}

describe('Settlement layout plan', () => {
  it('is deterministic for the same settlement, routes and seed', () => {
    const town = settlement('town', 0, 0);
    const neighbor = settlement('east-port', 30, 0);
    const routes = [route('route-1', town.id, neighbor.id, 'land')];

    const first = createSettlementLayoutPlan({ settlement: town, settlements: [town, neighbor], routes, eraRank: 3, seed: 'layout-seed' });
    const second = createSettlementLayoutPlan({ settlement: town, settlements: [town, neighbor], routes, eraRank: 3, seed: 'layout-seed' });

    expect(second).toEqual(first);
  });

  it('orients market and portals toward active external routes', () => {
    const town = settlement('town', 0, 0);
    const neighbor = settlement('east-port', 30, 0);
    const routes = [route('route-1', town.id, neighbor.id, 'land')];

    const plan = createSettlementLayoutPlan({ settlement: town, settlements: [town, neighbor], routes, eraRank: 3, seed: 'layout-seed' });

    expect(plan.anchors.market.localX).toBeGreaterThan(0);
    expect(Math.abs(plan.anchors.market.localZ)).toBeLessThan(plan.radius * 0.05);
    expect(plan.portals).toHaveLength(1);
    expect(plan.portals[0]?.kind).toBe('gate');
    expect(plan.portals[0]?.localX).toBeGreaterThan(plan.anchors.market.localX);
    expect(plan.streets.some((street) => street.kind === 'primary')).toBe(true);
  });

  it('marks constructed maritime and railway routes at their actual endpoints', () => {
    const harbor = settlement('harbor', 0, 0, { infrastructure: { roads: 0.7, ports: 0.6, bridges: 0.2, workshops: 0.3, archives: 0.2, rail: 0.5, power: 0, factories: 0 } });
    const inland = settlement('inland', 40, 0, { infrastructure: { roads: 0.7, ports: 0, bridges: 0.2, workshops: 0.3, archives: 0.2, rail: 0.5, power: 0, factories: 0 } });
    const island = settlement('island', 0, 40);
    const routes = [route('rail-route', harbor.id, inland.id, 'land'), route('water-route', harbor.id, island.id, 'water')];

    routes[0]!.transport!.path!.mode = 'rail';
    const plan = createSettlementLayoutPlan({ settlement: harbor, settlements: [harbor, inland, island], routes, eraRank: 4, seed: 'layout-seed' });

    expect(plan.portals.find((portal) => portal.routeId === 'rail-route')?.kind).toBe('station');
    expect(plan.portals.find((portal) => portal.routeId === 'rail-route')?.worldX).toBe(10);
    expect(plan.portals.find((portal) => portal.routeId === 'water-route')?.kind).toBe('dock');
  });

  it('keeps industrial plots on the industrial district only when the settlement supports it', () => {
    const village = settlement('village', 0, 0);
    const industrial = settlement('works', 0, 0, { industry: { active: true, intensity: 0.7, stage: 'transport-integration', stageProgress: 0.8, route: [], vulnerableInputs: [] } });

    expect(districtForPlot(5, village)).not.toBe('industrial');
    expect(districtForPlot(5, industrial)).toBe('industrial');
  });
});