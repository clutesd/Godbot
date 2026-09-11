import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { ensureMaterialInventory } from '../src/sim/resources/MaterialEconomy';
import { chooseMaterialShipment } from '../src/sim/resources/MaterialLogistics';
import type { MaterialUseState } from '../src/sim/resources/MaterialUse';
import { nearestIndex } from '../src/sim/terrain/TerrainField';
import { createTransportationState } from '../src/sim/transport/types';
import { TransportationSystem } from '../src/sim/transport/TransportationSystem';
import type { ResourceStock, Settlement, TradeRoute, Vec2, WorldCell, WorldState } from '../src/sim/types';

const point = (x: number, z: number): Vec2 => ({ x: (x - 6.5) * 2, z: (z - 6.5) * 2 });
const stock = (): ResourceStock => ({ food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 });

function flatWorld(): WorldState {
  const size = 13;
  const cells: WorldCell[] = [];
  for (let z = 0; z < size; z += 1) for (let x = 0; x < size; x += 1) {
    const p = point(x, z);
    cells.push({ x, z, worldX: p.x, worldZ: p.z, elevation: 0.45, water: false, lake: false, river: false, coast: false,
      slope: 0, relief: 0, flow: 0, rockiness: 0, landform: 'lowland', biome: 'grassland', movementCost: 1,
      moisture: 0.5, temperature: 0.5, fertility: 0.5, wood: 0.5, minerals: 0.5, habitability: 0.7 });
  }
  const resolution = (size - 1) * 3 + 1;
  const count = resolution ** 2;
  return { size, cellSize: 2, cells, seaLevel: 0.2, mountainLevel: 0.72, landmarks: [], environmentRevision: 0,
    terrain: { resolution, step: 2 / 3, originX: -13, originZ: -13, height: new Float32Array(count).fill(0.45),
      waterLevel: new Float32Array(count).fill(-1), river: new Uint8Array(count), lake: new Uint8Array(count),
      flow: new Float32Array(count), rock: new Float32Array(count), fall: new Float32Array(count) } };
}

function pressureState(month: number, material: 'steel', demand: number, supplied: number): MaterialUseState {
  const zero = { demand: 0, supplied: 0, unmet: 0, coverage: 1, pressure: 0 };
  const unmet = Math.max(0, demand - supplied);
  const coverage = demand > 0 ? Math.min(1, supplied / demand) : 1;
  return {
    month,
    domains: { infrastructure: zero, industry: zero, healthcare: zero, military: zero },
    materials: { [material]: { demand, supplied, unmet, coverage, pressure: 1 - coverage } },
    criticalInputs: unmet > 0 ? [material] : [],
    readiness: { infrastructure: 1, industry: coverage, healthcare: 1, military: coverage },
  };
}

function fixture() {
  const simulation = new Simulation({ seed: 'material-logistics-fixture', startingPopulation: 40, settlementCount: [2, 2] });
  const state = simulation.state;
  state.world = flatWorld();
  state.transportation = createTransportationState();
  const [a, b] = state.settlements as [Settlement, Settlement];
  for (const [index, settlement] of [a, b].entries()) {
    settlement.position = point(index ? 9 : 3, 6);
    settlement.cellIndex = nearestIndex(state.world.terrain, settlement.position.x, settlement.position.z);
    settlement.foodSecurity = 0.9;
    settlement.prosperity = 0.8;
    settlement.buildings = 1;
    settlement.resources = { food: 100, wood: 100, minerals: 100, goods: index ? 0 : 200, wealth: 100 };
  }
  const route: TradeRoute = { id: 'material-route', a: a.id, b: b.id, active: true, mode: 'land', volume: 1,
    ageMonths: 0, caravanProgress: 0, caravanDirection: 1, knowledgeFlow: 0, cumulativeKnowledge: 0 };
  const system = new TransportationSystem(state);
  expect(system.planTrade(route, a, b)).toBe(true);
  state.tradeRoutes = [route];
  return { state, system, route, a, b };
}

function completeLegacyRoad(f: ReturnType<typeof fixture>): void {
  for (let month = 1; month < 180 && !f.route.transport?.path; month += 1) {
    f.state.month = month;
    f.system.advanceMonth();
  }
  expect(f.route.transport?.path).toBeDefined();
}

describe('typed material logistics', () => {
  it('dispatches a critical material surplus physically, keeps it in transit, and records delivery dependency', () => {
    const f = fixture();
    completeLegacyRoad(f);
    const aInventory = ensureMaterialInventory(f.a);
    const bInventory = ensureMaterialInventory(f.b);
    aInventory.stock.steel = 20;
    bInventory.stock.steel = 0;
    f.a.materialUse = pressureState(f.state.month, 'steel', 0, 0);
    f.b.materialUse = pressureState(f.state.month, 'steel', 1, 0);
    f.route.transport!.trip = undefined;
    f.route.transport!.nextDispatchMonth = 0;
    f.a.resources = { food: 10, wood: 10, minerals: 10, goods: 10, wealth: 100 };
    f.b.resources = { ...f.a.resources };

    const beforeSource = aInventory.stock.steel;
    expect(f.system.advanceFreight(f.route, f.a, f.b)).toBeUndefined();
    const trip = f.route.transport!.trip!;
    expect(trip.reason).toBe('scarcity-relief');
    expect(trip.material).toBe('steel');
    expect(trip.resource).toBeUndefined();
    expect(aInventory.stock.steel).toBeCloseTo(beforeSource - trip.quantity);
    expect(bInventory.stock.steel).toBe(0);

    let delivered;
    while (trip.status !== 'arrived') {
      f.state.month += 1;
      delivered = f.system.advanceFreight(f.route, f.a, f.b);
    }
    expect(delivered?.id).toBe(trip.id);
    expect(bInventory.stock.steel).toBeCloseTo(trip.quantity * 0.96);
    expect(f.b.materialLogistics?.lifetimeImports.steel).toBeCloseTo(trip.quantity * 0.96);
    expect(f.a.materialLogistics?.lifetimeExports.steel).toBeCloseTo(trip.quantity);
    expect(f.b.materialLogistics?.lifetimeTransitLosses.steel).toBeCloseTo(trip.quantity * 0.04);
    expect(f.b.materialLogistics?.dependencies[`${f.a.id}:steel`]?.lastDeliveryMonth).toBe(f.state.month);
  });

  it('does not export a material that is itself critical at the source', () => {
    const f = fixture();
    ensureMaterialInventory(f.a).stock.steel = 20;
    ensureMaterialInventory(f.b).stock.steel = 0;
    f.a.materialUse = pressureState(10, 'steel', 2, 0);
    f.b.materialUse = pressureState(10, 'steel', 2, 0);
    expect(chooseMaterialShipment(f.a, f.b, 1)).toBeUndefined();
  });

  it('treats a stalled project bill as import demand before operating maintenance exists', () => {
    const f = fixture();
    ensureMaterialInventory(f.a).stock.steel = 20;
    ensureMaterialInventory(f.b).stock.steel = 0;
    f.a.materialUse = pressureState(20, 'steel', 0, 0);
    f.b.materialUse = pressureState(20, 'steel', 0, 0);
    f.b.development = { pressures: {}, unmet: {}, informal: {}, providers: {}, evaluatedMonth: 20, nextAttemptMonth: 30, revision: 0,
      project: {
        plotId: 'stalled-metal-project',
        response: { need: 'manufacturing', form: 'works', name: 'metal works', level: 3, material: 'metal', cultureId: 'test', style: { primary: '#000', secondary: '#111', accent: '#222', symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['ka'] }, services: { manufacturing: 3.5 }, reasons: [], capabilities: [], cost: stock(), labor: 3 },
        action: 'founded', startedMonth: 12, progress: 0.5, spent: stock(),
        materialRequirements: [{ id: 'structural-metal', amount: 8, options: ['steel', 'iron'], reason: 'load-bearing-metal' }],
        materialSpent: {},
      } };
    const shipment = chooseMaterialShipment(f.a, f.b, 1);
    expect(shipment?.material).toBe('steel');
    expect(shipment?.target.id).toBe(f.b.id);
    expect(shipment?.targetPressure).toBeGreaterThan(0.8);
  });
});

describe('typed transport capital', () => {
  it('stalls road construction without real aggregate, then resumes by consuming stone without double-charging generic minerals', () => {
    const f = fixture();
    const aInventory = ensureMaterialInventory(f.a);
    const bInventory = ensureMaterialInventory(f.b);
    const genericMinerals = f.a.resources.minerals + f.b.resources.minerals;
    f.state.month = 1;
    f.system.advanceMonth();
    const segments = Object.values(f.state.transportation.segments);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((segment) => segment.work === 0)).toBe(true);
    expect(segments.some((segment) => segment.materialBlockedSince === 1)).toBe(true);

    aInventory.stock.stone = 10;
    bInventory.stock.stone = 10;
    f.state.month = 2;
    f.system.advanceMonth();
    expect(segments.some((segment) => segment.work > 0)).toBe(true);
    expect(segments.some((segment) => (segment.materialSpent?.stone ?? 0) > 0)).toBe(true);
    expect(aInventory.stock.stone + bInventory.stock.stone).toBeLessThan(20);
    expect(f.a.resources.minerals + f.b.resources.minerals).toBe(genericMinerals);
  });
});
