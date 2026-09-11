import { describe, expect, it, vi } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import type { Settlement, TradeRoute, Vec2, WorldCell, WorldState } from '../src/sim/types';
import { createTransportationState, type NetworkMode } from '../src/sim/transport/types';
import { RoutePlanner, type PlannedEdge } from '../src/sim/transport/RoutePlanner';
import { edgeKey, fineSegmentDry, gradeLimit, navigableAt, pointKey, surveyEdge, waterAt } from '../src/sim/transport/TerrainTraversal';
import { gradeViolations, pathLength, positionAlongPath, TransportNetwork } from '../src/sim/transport/TransportNetwork';
import { TransportationSystem } from '../src/sim/transport/TransportationSystem';
import { transportRibbon } from '../src/render/transport/TransportGeometry';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { WalkabilityLayer } from '../src/sim/people/WalkabilityLayer';

const point = (x: number, z: number): Vec2 => ({ x: (x - 6.5) * 2, z: (z - 6.5) * 2 });

/** Small deterministic worlds whose lake, ridge/pass and river are evident from the coordinates. */
function testWorld(kind: 'flat' | 'lake' | 'ridge' | 'river' = 'flat'): WorldState {
  const size = 13;
  const cells: WorldCell[] = [];
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const p = point(x, z);
    const lake = kind === 'lake' && x >= 5 && x <= 7 && z >= 3 && z <= 9;
    const river = kind === 'river' && x === 6;
    const mountain = kind === 'ridge' && x >= 5 && x <= 7 && (z >= 5 || z === 0);
    cells.push({ x, z, worldX: p.x, worldZ: p.z, elevation: mountain ? 0.87 : lake || river ? 0.29 : 0.45,
      water: lake || river, lake, river, coast: false, slope: mountain ? 0.8 : 0, relief: mountain ? 0.4 : 0,
      flow: river ? 0.6 : 0, rockiness: mountain ? 1 : 0, landform: mountain ? 'peak' : 'lowland', biome: lake || river ? 'water' : 'grassland',
      movementCost: mountain ? 8 : 1, moisture: 0.5, temperature: 0.5, fertility: 0.5, wood: 0.5, minerals: 0.5, habitability: 0.7 });
  }
  const resolution = (size - 1) * 3 + 1;
  const count = resolution ** 2;
  const height = new Float32Array(count);
  const waterLevel = new Float32Array(count).fill(-1);
  const river = new Uint8Array(count);
  const lake = new Uint8Array(count);
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const cell = cells[Math.round(z / 3) * size + Math.round(x / 3)]!;
    const index = z * resolution + x;
    height[index] = cell.elevation;
    if (cell.water) waterLevel[index] = 0.31;
    river[index] = Number(cell.river);
    lake[index] = Number(cell.lake);
  }
  return { size, cellSize: 2, cells, seaLevel: 0.2, mountainLevel: 0.72, landmarks: [], environmentRevision: 0,
    terrain: { resolution, step: 2 / 3, originX: -13, originZ: -13, height, waterLevel, floodDepth: new Float32Array(count), river, lake, flow: new Float32Array(count), rock: new Float32Array(count), fall: new Float32Array(count) } };
}

function install(edges: PlannedEdge[], mode: NetworkMode, complete = edges.length) {
  const state = createTransportationState();
  edges.forEach((edge, i) => {
    const id = edgeKey(edge.a, edge.b, mode);
    state.segments[id] = { id, from: pointKey(edge.a), to: pointKey(edge.b), mode, kind: edge.kind, points: edge.points,
      length: edge.length, cost: edge.cost, work: i < complete ? edge.cost : 0, status: i < complete ? 'complete' : 'planned' };
  });
  return state;
}

function surveyed(world: WorldState, a: Vec2, b: Vec2, mode: NetworkMode, bridge = false): PlannedEdge {
  const edge = surveyEdge(world, a, b, mode, bridge);
  expect(edge, `survey ${JSON.stringify(a)} -> ${JSON.stringify(b)} (${mode})`).toBeDefined();
  return { ...edge!, a, b };
}

describe('Geography-aware transportation', () => {
  it('reuses disconnected pedestrian components and reconnects after fine water recedes', () => {
    const world = testWorld();
    for (let sampleZ = 0; sampleZ < world.terrain.resolution; sampleZ++) {
      world.terrain.waterLevel[sampleZ * world.terrain.resolution + 18] = 0.5;
    }
    const walking = new WalkabilityLayer(world);
    expect(walking.route(point(3, 6), point(9, 6))).toEqual([]);
    const check = vi.spyOn(walking, 'isSegmentWalkable');
    expect(walking.route(point(3, 5), point(9, 5))).toEqual([]);
    expect(check.mock.calls.length).toBeLessThan(10);
    world.terrain.waterLevel.fill(-1);
    world.environmentRevision!++;
    const recovered = walking.route(point(3, 5), point(9, 5));
    expect(recovered.at(-1)).toEqual(point(9, 5));
    expect(walking.routeIsValid([point(3, 5), ...recovered])).toBe(true);
    check.mockRestore();
  });

  it('reuses bounded ground searches until barriers change without exposing cached points', () => {
    const world = testWorld('lake');
    const walking = new WalkabilityLayer(world);
    const origin = point(6, 6);
    const first = walking.nearestWalkable(origin, 'shared-home');
    const check = vi.spyOn(walking, 'isWalkable');
    const cached = walking.nearestWalkable(origin, 'shared-home');
    expect(cached).toEqual(first);
    expect(check).toHaveBeenCalledTimes(1);
    cached.x += 100;
    expect(walking.nearestWalkable(origin, 'shared-home')).toEqual(first);
    const cellX = Math.round(first.x / world.cellSize + world.size / 2);
    const cellZ = Math.round(first.z / world.cellSize + world.size / 2);
    world.cells[cellZ * world.size + cellX]!.water = true;
    world.environmentRevision!++;
    const recovered = walking.nearestWalkable(origin, 'shared-home');
    expect(recovered).not.toEqual(first);
    expect(walking.isWalkable(recovered)).toBe(true);
    check.mockRestore();
  });

  it.each(['road', 'rail'] as const)('A: takes %s around a lake and never builds an open-water shortcut', mode => {
    const world = testWorld('lake');
    const edges = new RoutePlanner(world).plan(point(2, 6), point(10, 6), mode, createTransportationState(), true);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.flatMap(e => e.points).every(p => !waterAt(world, p))).toBe(true);
    expect(edges.some(e => e.a.z < point(0, 3).z || e.a.z > point(0, 9).z)).toBe(true);
    expect(surveyEdge(world, point(4, 6), point(8, 6), mode, true)).toBeUndefined();
  });

  it.each(['road', 'rail'] as const)('B: takes %s through the pass instead of climbing a mountain ridge', mode => {
    const world = testWorld('ridge');
    const edges = new RoutePlanner(world).plan(point(2, 8), point(10, 8), mode, createTransportationState());
    expect(edges.length).toBeGreaterThan(0);
    const ridge = edges.flatMap(e => e.points).filter(p => Math.abs(p.x - point(6, 0).x) < 1);
    expect(ridge.length).toBeGreaterThan(0);
    expect(ridge.every(p => p.z < point(0, 5).z)).toBe(true);
    expect(edges.every(e => gradeViolations({ ...e, mode }) === 0)).toBe(true);
  });

  it('rail rejects grades a road can use and chooses a longer low-grade route', () => {
    const world = testWorld();
    // A smooth hill in the middle, with a flat northern/southern corridor.
    for (let z = 0; z < world.terrain.resolution; z++) for (let x = 0; x < world.terrain.resolution; x++) {
      const hill = Math.max(0, 1 - Math.abs(x / 3 - 6) / 3) * Math.max(0, 1 - Math.abs(z / 3 - 6) / 3);
      world.terrain.height[z * world.terrain.resolution + x] = 0.45 + hill * 0.035;
    }
    const existingRoad = install(Array.from({ length: 8 }, (_, i) => surveyed(world, point(i + 2, 6), point(i + 3, 6), 'road')), 'road');
    const road = new RoutePlanner(world).plan(point(2, 6), point(10, 6), 'road', existingRoad);
    const rail = new RoutePlanner(world).plan(point(2, 6), point(10, 6), 'rail', createTransportationState());
    expect(road.length).toBeGreaterThan(0);
    expect(rail.length).toBeGreaterThan(0);
    expect(rail.reduce((n, e) => n + e.length, 0)).toBeGreaterThan(road.reduce((n, e) => n + e.length, 0));
    expect(rail.every(e => gradeViolations({ ...e, mode: 'rail' }) === 0)).toBe(true);
    expect(gradeLimit('rail')).toBeLessThan(gradeLimit('road'));
  });

  it.each(['road', 'rail'] as const)('C: %s cannot cross a river until the actual bank-to-bank bridge completes', mode => {
    const world = testWorld('river');
    const planner = new RoutePlanner(world);
    expect(planner.plan(point(3, 6), point(9, 6), mode, createTransportationState())).toEqual([]);
    const bridge = surveyed(world, point(5, 6), point(7, 6), mode, true);
    expect(bridge.kind).toBe('bridge');
    const state = install([bridge], mode, 0);
    const network = new TransportNetwork(world, state);
    expect(network.findPath(pointKey(bridge.a), pointKey(bridge.b), mode)).toBeUndefined();
    Object.values(state.segments)[0]!.status = 'complete';
    state.revision++;
    expect(network.findPath(pointKey(bridge.a), pointKey(bridge.b), mode)).toBeDefined();
    expect(network.findPath(pointKey(point(5, 5)), pointKey(bridge.b), mode)).toBeUndefined();
    expect(network.findPath(pointKey(point(6, 6)), pointKey(bridge.b), mode)).toBeUndefined();
    expect(network.findPath(pointKey(bridge.a), pointKey(bridge.b), mode === 'road' ? 'rail' : 'road')).toBeUndefined();
  });

  it('checks fine rivers missed by the coarse grid and refuses mode-label water bypasses', () => {
    const world = testWorld();
    const field = world.terrain;
    for (let z = 0; z < field.resolution; z++) {
      const i = z * field.resolution + 18;
      field.river[i] = 1;
      field.waterLevel[i] = 0.45;
    }
    expect(fineSegmentDry(world, point(5, 6), point(7, 6))).toBe(false);
    expect(surveyEdge(world, point(5, 6), point(7, 6), 'road')).toBeUndefined();
    const walking = new WalkabilityLayer(world);
    expect(walking.isSegmentWalkable(point(5, 6), point(7, 6))).toBe(false);
    expect(walking.route(point(5, 6), point(7, 6), [], 'boat')).toEqual([]);
    expect(walking.routeIsValid([point(5, 6), point(7, 6)], 'ferry')).toBe(false);
  });
});

describe('Completed network authority', () => {
  it.each(['road', 'rail'] as const)('D: partially built %s is usable only up to the 40 percent construction frontier', mode => {
    const world = testWorld();
    const edges = Array.from({ length: 5 }, (_, i) => surveyed(world, point(i + 2, 6), point(i + 3, 6), mode));
    const state = install(edges, mode, 2);
    const network = new TransportNetwork(world, state);
    expect(network.findPath(pointKey(point(2, 6)), pointKey(point(4, 6)), mode)).toBeDefined();
    expect(network.findPath(pointKey(point(2, 6)), pointKey(point(7, 6)), mode)).toBeUndefined();
    Object.values(state.segments)[4]!.status = 'complete';
    state.revision++;
    expect(network.findPath(pointKey(point(2, 6)), pointKey(point(7, 6)), mode)).toBeUndefined();
    expect(network.findPath(pointKey(point(6, 6)), pointKey(point(7, 6)), mode)).toBeDefined();
  });

  it('flooding invalidates a cached route and recession restores it without rebuilding', () => {
    const world = testWorld();
    const edge = surveyed(world, point(3, 6), point(4, 6), 'road');
    const state = install([edge], 'road');
    const network = new TransportNetwork(world, state);
    const path = network.findPath(pointKey(edge.a), pointKey(edge.b), 'road')!;
    expect(network.pathValid(path)).toBe(true);
    world.environmentRevision!++;
    expect(network.findPath(pointKey(edge.a), pointKey(edge.b), 'road')).toBe(path);
    world.cells[6 * world.size + 4]!.water = true;
    world.environmentRevision!++;
    expect(network.pathValid(path)).toBe(false);
    expect(network.findPath(pointKey(edge.a), pointKey(edge.b), 'road')).toBeUndefined();
    world.cells[6 * world.size + 4]!.water = false;
    world.environmentRevision!++;
    expect(network.pathValid(path)).toBe(true);
  });

  it('reuses completed corridors and reproduces identical surveys without mutating world or network', () => {
    const world = testWorld('lake');
    const planner = new RoutePlanner(world);
    const first = planner.plan(point(2, 6), point(10, 6), 'road', createTransportationState());
    const state = install(first, 'road');
    const before = JSON.stringify({ world, state });
    const reused = planner.plan(point(2, 6), point(10, 6), 'road', state);
    expect(reused.every(e => state.segments[edgeKey(e.a, e.b, 'road')])).toBe(true);
    expect(new RoutePlanner(world).plan(point(2, 6), point(10, 6), 'road', state)).toEqual(reused);
    expect(JSON.stringify({ world, state })).toBe(before);
  });

  it('vehicles follow arc distance on the same infrastructure used by surface geometry', () => {
    const world = testWorld();
    const edges = [surveyed(world, point(2, 5), point(3, 6), 'road'), surveyed(world, point(3, 6), point(5, 6), 'road')];
    const state = install(edges, 'road');
    const path = new TransportNetwork(world, state).findPath(pointKey(edges[0]!.a), pointKey(edges[1]!.b), 'road')!;
    const before = JSON.stringify({ world, state, path });
    const surface = new TerrainSurface(world);
    for (let t = 0; t <= path.length; t += 0.1) {
      const pose = positionAlongPath(path, t)!;
      expect(Math.abs(pose.position.y - surface.heightAt(pose.position.x, pose.position.z) - 0.04)).toBeLessThan(0.015);
      expect(Number.isFinite(pose.yaw)).toBe(true);
    }
    for (const segment of Object.values(state.segments)) {
      const geometry = transportRibbon(world, segment, 0.62);
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) expect(positions.getY(i)).toBeCloseTo(surface.heightAt(positions.getX(i), positions.getZ(i)) + 0.04, 5);
      geometry.dispose();
    }
    expect(path.length).toBeCloseTo(pathLength(path.points));
    expect(JSON.stringify({ world, state, path })).toBe(before);
  });
});

function freightFixture() {
  const simulation = new Simulation({ seed: 'transport-fixture', startingPopulation: 40, settlementCount: [2, 2] });
  const state = simulation.state;
  state.world = testWorld();
  state.transportation = createTransportationState();
  const [a, b] = state.settlements;
  for (const [i, settlement] of [a!, b!].entries()) {
    settlement.position = point(i ? 9 : 3, 6);
    settlement.foodSecurity = 0.9;
    settlement.prosperity = 0.8;
    settlement.buildings = 1;
    settlement.resources = { food: 100, wood: 100, minerals: 100, goods: i ? 0 : 200, wealth: 100 };
  }
  const route: TradeRoute = { id: 'freight-test', a: a!.id, b: b!.id, active: true, mode: 'land', volume: 1,
    ageMonths: 0, caravanProgress: 0, caravanDirection: 1, knowledgeFlow: 0, cumulativeKnowledge: 0 };
  const system = new TransportationSystem(state);
  expect(system.planTrade(route, a!, b!)).toBe(true);
  state.tradeRoutes = [route];
  return { state, system, route, a: a!, b: b! };
}

function grant(settlement: Settlement, id: string): void {
  settlement.knowledge.records[id] = { id, theory: 0.9, practice: 0.9, discoveredMonth: 0, lastUsedMonth: 0,
    originSettlementId: settlement.id, lineageId: `transport-test:${id}`, parentLineages: [], source: 'discovery', dormant: false, adoptedMonth: 0, transformedMonth: 0 };
}

describe('Simulated construction and purposeful freight', () => {
  it('requires bridge capability and funded bank-to-bank construction to connect river settlements', () => {
    const { state, route, a, b } = freightFixture();
    state.world = testWorld('river');
    state.transportation = createTransportationState();
    a.position = point(3, 6); b.position = point(9, 6);
    route.transport = undefined;
    let system = new TransportationSystem(state);
    expect(system.planTrade(route, a, b)).toBe(false);
    for (const town of [a, b]) grant(town, 'improved-roads');
    a.resources.wealth = 0;
    system = new TransportationSystem(state);
    expect(system.planTrade(route, a, b)).toBe(false);
    a.resources.wealth = 100;
    system = new TransportationSystem(state);
    expect(system.planTrade(route, a, b)).toBe(true);
    expect(Object.values(state.transportation.segments).some(s => s.kind === 'bridge')).toBe(true);
    expect((route as TradeRoute).transport?.path).toBeUndefined();
    for (let month = 1; month < 160; month++) { state.month = month; system.advanceMonth(); }
    expect((route as TradeRoute).transport?.path).toBeDefined();
    expect(a.resources.wealth).toBeLessThan(100);
  });

  it('ships use commissioned ports and continuous navigable water, with no overland fallback', () => {
    const { state, route, a, b } = freightFixture();
    state.world = testWorld('river');
    for (const cell of state.world.cells) if (!cell.water) cell.elevation = 0.34;
    const field = state.world.terrain;
    for (let i = 0; i < field.height.length; i++) if (field.waterLevel[i]! < 0) field.height[i] = 0.34;
    state.transportation = createTransportationState();
    a.position = point(4, 3); b.position = point(8, 9);
    route.transport = undefined;
    let system = new TransportationSystem(state);
    expect(system.planTrade(route, a, b)).toBe(false);
    for (const town of [a, b]) { town.infrastructure.ports = 0.6; grant(town, 'buoyancy-currents'); }
    system = new TransportationSystem(state);
    expect(system.planTrade(route, a, b)).toBe(true);
    for (let month = 1; month < 100 && !route.transport!.trip; month++) {
      state.month = month; system.advanceMonth(); system.advanceFreight(route, a, b);
    }
    const trip = route.transport!.trip!;
    expect(trip.mode).toBe('water');
    expect(trip.path.points.every(p => navigableAt(state.world, p))).toBe(true);
    const stops = Object.values(state.transportation.stops);
    expect(stops).toHaveLength(2);
    expect(stops.every(s => s.kind === 'port' && s.status === 'complete' && s.access.length > 1)).toBe(true);
    expect(surveyEdge(state.world, point(4, 3), point(8, 9), 'water')).toBeUndefined();
  });

  it('keeps an existing trip in its mode, then dispatches trains only over completed rail and stations', () => {
    const { state, system, route, a, b } = freightFixture();
    for (let month = 1; month < 100 && !route.transport!.trip; month++) {
      state.month = month; system.advanceMonth(); system.advanceFreight(route, a, b);
    }
    const original = route.transport!.trip!;
    const originalMode = original.mode;
    for (const town of [a, b]) { town.infrastructure.rail = 0.6; grant(town, 'rail-transport'); }
    for (let month = state.month + 1; month < 300 && route.transport!.path?.mode !== 'rail'; month++) { state.month = month; system.advanceMonth(); }
    expect(route.transport!.path?.mode).toBe('rail');
    expect(original.mode).toBe(originalMode);
    expect(Object.values(state.transportation.stops).filter(s => s.kind === 'station').every(s => s.status === 'complete')).toBe(true);
    original.status = 'arrived';
    route.transport!.nextDispatchMonth = 0;
    system.advanceFreight(route, a, b);
    const train = route.transport!.trip!;
    expect(train.mode).toBe('rail');
    const segment = state.transportation.segments[train.path.segmentIds[1]!]!;
    segment.status = 'planned'; state.transportation.revision++;
    system.advanceFreight(route, a, b);
    expect(train.status).toBe('blocked');
    expect(train.distance).toBe(0);
  });

  it('waits for complete infrastructure and delivers reserved cargo only after arrival', () => {
    const { state, system, route, a, b } = freightFixture();
    const initialGoods = b.resources.goods;
    expect(system.advanceFreight(route, a, b)).toBeUndefined();
    expect(route.transport?.trip).toBeUndefined();
    for (let month = 1; month < 180 && !route.transport?.trip; month++) {
      state.month = month;
      system.advanceMonth();
      system.advanceFreight(route, a, b);
    }
    const trip = route.transport!.trip!;
    expect(trip).toBeDefined();
    expect(trip.reason).toBe('trade');
    expect(trip.origin).not.toBe(trip.destination);
    expect(b.resources.goods).toBe(initialGoods);
    expect(trip.quantity).toBeGreaterThan(0);
    expect(system.network.pathValid(trip.path)).toBe(true);
    const quantity = trip.quantity;
    let delivery;
    while (trip.status !== 'arrived') { state.month++; delivery = system.advanceFreight(route, a, b); }
    expect(delivery?.id).toBe(trip.id);
    expect(b.resources.goods).toBeCloseTo(initialGoods + quantity * 0.96);
    expect(system.advanceFreight(route, a, b)).toBeUndefined();
    expect(route.transport!.nextDispatchMonth).toBeGreaterThan(state.month);
  });

  it('halts a vehicle on a disconnected network without changing mode or delivering cargo', () => {
    const { state, system, route, a, b } = freightFixture();
    for (let month = 1; month < 180 && !route.transport!.trip; month++) {
      state.month = month; system.advanceMonth(); system.advanceFreight(route, a, b);
    }
    const trip = route.transport!.trip!;
    expect(trip).toBeDefined();
    const last = state.transportation.segments[trip.path.segmentIds[trip.path.segmentIds.length - 1]!]!;
    last.status = 'under-construction';
    state.transportation.revision++;
    const before = { distance: trip.distance, mode: trip.mode, goods: b.resources.goods };
    state.month++;
    expect(system.advanceFreight(route, a, b)).toBeUndefined();
    expect(trip.status).toBe('blocked');
    expect({ distance: trip.distance, mode: trip.mode, goods: b.resources.goods }).toEqual(before);
  });

  it('does not dispatch decorative trips with no resource demand', () => {
    const { state, system, route, a, b } = freightFixture();
    for (let month = 1; month < 100; month++) { state.month = month; system.advanceMonth(); }
    expect(route.transport!.path).toBeDefined();
    a.resources = { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 };
    b.resources = { ...a.resources };
    system.advanceFreight(route, a, b);
    expect(route.transport!.trip).toBeUndefined();
  });

  it('same seeds reproduce construction, trips and resource accounting', () => {
    const a = freightFixture();
    const b = freightFixture();
    for (const fixture of [a, b]) for (let month = 1; month < 100; month++) {
      fixture.state.month = month;
      fixture.system.advanceMonth();
      fixture.system.advanceFreight(fixture.route, fixture.a, fixture.b);
    }
    expect(b.state.transportation).toEqual(a.state.transportation);
    expect(b.route).toEqual(a.route);
    expect(b.a.resources).toEqual(a.a.resources);
    expect(b.b.resources).toEqual(a.b.resources);
  });
});
