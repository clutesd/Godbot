import { createSettlementLayoutPlan } from '../../shared/SettlementLayoutPlan';
import { capabilityPractice } from '../knowledge/CapabilityContract';
import { WalkabilityLayer } from '../people/WalkabilityLayer';
import { stableHash } from '../prng';
import {
  chooseMaterialShipment,
  deliverMaterialShipment,
  dispatchMaterialShipment,
} from '../resources/MaterialLogistics';
import type { MaterialKind } from '../resources/MaterialEconomy';
import { consumeMaterial } from '../resources/MaterialUse';
import { surfaceHeightAt, surfaceWaterAt } from '../terrain/SurfaceGeometry';
import type { Settlement, SimulationState, TradeRoute } from '../types';
import { RoutePlanner, type PlannedEdge } from './RoutePlanner';
import { distance, edgeKey, landAllowed, navigableAt, pointKey, snowTravelMultiplier, surveyEdge } from './TerrainTraversal';
import { positionAlongPath, TransportNetwork } from './TransportNetwork';
import type { FreightTrip, NetworkMode, TransportProject, TransportSegment, TransportStop } from './types';

interface CapitalRequirement {
  id: string;
  perWork: number;
  options: readonly MaterialKind[];
}

const EPSILON = 1e-9;

function capitalRequirements(segment: TransportSegment): CapitalRequirement[] {
  if (segment.mode === 'rail') return [
    { id: 'rail-metal', perWork: 0.58, options: ['steel', 'iron'] },
    { id: 'rail-ties', perWork: 0.22, options: ['lumber', 'timber'] },
    { id: 'rail-bed', perWork: 0.16, options: ['stone', 'brick'] },
  ];
  if (segment.kind === 'bridge') return [
    { id: 'bridge-foundation', perWork: 0.34, options: ['stone', 'brick'] },
    { id: 'bridge-structure', perWork: 0.18, options: ['steel', 'iron', 'bronze', 'lumber', 'timber'] },
  ];
  if (segment.mode === 'water') return [
    { id: 'water-route-works', perWork: 0.08, options: ['lumber', 'timber'] },
  ];
  return [{ id: 'road-surface', perWork: 0.12, options: ['stone', 'brick'] }];
}

function materialAuthority(a: Settlement, b: Settlement): boolean {
  return a.id === b.id ? Boolean(a.materials) : Boolean(a.materials && b.materials);
}

function contributors(a: Settlement, b: Settlement): Settlement[] {
  return a.id === b.id ? [a] : [a, b];
}

function availableAcross(settlements: readonly Settlement[], options: readonly MaterialKind[]): number {
  return settlements.reduce((total, settlement) => total + options.reduce((sum, material) =>
    sum + (settlement.materials?.stock[material] ?? 0), 0), 0);
}

function maxCapitalWork(a: Settlement, b: Settlement, segment: TransportSegment): number {
  if (!materialAuthority(a, b)) return Number.POSITIVE_INFINITY;
  const settlements = contributors(a, b);
  return Math.max(0, Math.min(...capitalRequirements(segment).map((requirement) =>
    requirement.perWork <= EPSILON ? Number.POSITIVE_INFINITY : availableAcross(settlements, requirement.options) / requirement.perWork)));
}

function consumeCapital(a: Settlement, b: Settlement, segment: TransportSegment, work: number, month: number): void {
  if (!materialAuthority(a, b) || work <= EPSILON) return;
  segment.materialSpent ??= {};
  const settlements = contributors(a, b);
  for (const requirement of capitalRequirements(segment)) {
    let remaining = requirement.perWork * work;
    for (const material of requirement.options) {
      for (const settlement of settlements) {
        if (remaining <= EPSILON) break;
        const used = consumeMaterial(settlement, material, remaining, month);
        if (used <= 0) continue;
        segment.materialSpent[material] = (segment.materialSpent[material] ?? 0) + used;
        remaining -= used;
      }
      if (remaining <= EPSILON) break;
    }
    if (remaining > 1e-6) throw new Error(`transport material conservation violation: ${segment.id}:${requirement.id}`);
  }
}

/** Simulation-owned investment, construction, dispatch and delivery. No random draws. */
export class TransportationSystem {
  readonly network: TransportNetwork;
  private readonly planner: RoutePlanner;
  private readonly walking: WalkabilityLayer;
  private readonly retries = new Map<string, number>();
  private readonly localPlans = new Set<string>();

  constructor(private readonly state: SimulationState) {
    this.network = new TransportNetwork(state.world, state.transportation);
    this.planner = new RoutePlanner(state.world);
    this.walking = new WalkabilityLayer(state.world);
  }

  planTrade(route: TradeRoute, a: Settlement, b: Settlement): boolean {
    const projects: string[] = [];
    const road = this.planConnection(route.id, a, b, 'road');
    if (road) projects.push(road.id);
    if (this.canShip(a) && this.canShip(b)) {
      const water = this.planConnection(route.id, a, b, 'water');
      if (water) projects.push(water.id);
    }
    if (!projects.length) return false;
    route.mode = road ? 'land' : 'water';
    route.transport = { projectIds: projects, nextDispatchMonth: this.state.month + Math.floor(stableHash(route.id, 0, 0) * 9) };
    return true;
  }

  advanceMonth(): void {
    const { state } = this;
    if (state.month % 12 === 0) {
      for (const settlement of state.settlements.filter(s => s.alive)) this.planLocalAccess(settlement);
      for (const route of state.tradeRoutes.filter(r => r.active && r.transport)) {
        const a = state.settlements.find(s => s.id === route.a);
        const b = state.settlements.find(s => s.id === route.b);
        if (!a?.alive || !b?.alive) continue;
        const railA = capabilityPractice(a, 'rail-transport', 'transformed');
        const railB = capabilityPractice(b, 'rail-transport', 'transformed');
        if (railA > 0.34 && railB > 0.34
          && Math.min(a.infrastructure.rail, b.infrastructure.rail) > 0.16 && route.volume > 0.5) {
          this.addUpgrade(route, a, b, 'rail');
        }
        if (this.canShip(a) && this.canShip(b) && route.volume > 0.5) this.addUpgrade(route, a, b, 'water');
      }
    }
    for (const project of Object.values(state.transportation.projects)) this.build(project);
    this.network.refresh();
    for (const route of state.tradeRoutes) {
      if (!route.transport) continue;
      const projects = route.transport.projectIds.map(id => state.transportation.projects[id]).filter((p): p is TransportProject => Boolean(p));
      // A rail upgrade does not change the mode of an already dispatched vehicle.
      const ordered = projects.sort((a, b) => ({ rail: 0, water: 1, road: 2 })[a.mode] - ({ rail: 0, water: 1, road: 2 })[b.mode]);
      route.transport.path = undefined;
      for (const project of ordered) {
        if (!project.stopIds.every(id => state.transportation.stops[id]?.status === 'complete')) continue;
        const path = this.network.findPath(project.from, project.to, project.mode);
        if (!path) continue;
        route.transport.path = path;
        route.mode = path.mode === 'water' ? 'water' : 'land';
        break;
      }
      route.weatherBlocked = !route.transport.path;
    }
  }

  /** Returns delivered cargo exactly once. Cargo in transit has already left the source. */
  advanceFreight(route: TradeRoute, a: Settlement, b: Settlement): FreightTrip | undefined {
    const transport = route.transport;
    if (!transport) return undefined;
    const trip = transport.trip;
    if (trip && trip.status !== 'arrived') {
      if (!route.active || !a.alive || !b.alive || !this.network.pathValid(trip.path)) {
        trip.status = 'blocked';
        return undefined;
      }
      trip.status = 'moving';
      const speed = { walk: 0.9, road: 1.6, rail: 3.8, water: 2.1 }[trip.mode];
      const position = positionAlongPath(trip.path, trip.distance)?.position ?? trip.path.points[0]!;
      const maintenance = Math.min(a.infrastructure.roads, b.infrastructure.roads);
      const weatherCost = snowTravelMultiplier(this.state.world, position, trip.mode, maintenance);
      trip.distance = Math.min(trip.path.length, trip.distance + speed / weatherCost);
      route.caravanProgress = trip.path.length ? trip.distance / trip.path.length : 0;
      if (trip.distance < trip.path.length) return undefined;
      trip.status = 'arrived';
      const target = trip.destination === a.id ? a : b;
      const source = trip.origin === a.id ? a : b;
      if (trip.material) deliverMaterialShipment(source, target, trip.material, trip.quantity, 0.96, this.state.month);
      else if (trip.resource) target.resources[trip.resource] += trip.quantity * 0.96;
      else throw new Error(`freight trip ${trip.id} has no cargo`);
      transport.nextDispatchMonth = this.state.month + 3 + Math.floor(stableHash(route.id, this.state.month, 0) * 13);
      return trip;
    }
    if (!route.active || !a.alive || !b.alive || this.state.month < transport.nextDispatchMonth || !transport.path || !this.network.pathValid(transport.path)) return undefined;
    const population = (id: string): number => Math.max(1, this.state.people.filter(p => p.alive && p.homeId === id).length);
    const aPopulation = population(a.id);
    const bPopulation = population(b.id);

    let shipment: {
      source: Settlement;
      target: Settlement;
      resource?: NonNullable<FreightTrip['resource']>;
      material?: MaterialKind;
      quantity: number;
      reason: FreightTrip['reason'];
    } | undefined;

    const materialShipment = chooseMaterialShipment(a, b, route.volume);
    if (materialShipment) {
      const quantity = dispatchMaterialShipment(
        materialShipment.source,
        materialShipment.target,
        materialShipment.material,
        materialShipment.quantity,
        this.state.month,
      );
      if (quantity > 0.08) shipment = {
        source: materialShipment.source,
        target: materialShipment.target,
        material: materialShipment.material,
        quantity,
        reason: 'scarcity-relief',
      };
    }

    if (!shipment) {
      for (const resource of ['food', 'wood', 'minerals', 'goods'] as const) {
        const gap = a.resources[resource] / aPopulation - b.resources[resource] / bPopulation;
        const source = gap > 0 ? a : b;
        const target = gap > 0 ? b : a;
        const quantity = Math.min(Math.abs(gap) * route.volume * 1.8, source.resources[resource] * 0.04, route.volume * 6);
        if (quantity > 0.08 && quantity > (shipment?.quantity ?? 0)) shipment = { source, target, resource, quantity, reason: 'trade' };
      }
      if (shipment?.resource) shipment.source.resources[shipment.resource] -= shipment.quantity;
    }

    transport.nextDispatchMonth = this.state.month + 6;
    if (!shipment) return undefined;
    const path = transport.path;
    const reverse = shipment.source.id === b.id;
    const mode = path.mode === 'road' && capabilityPractice(shipment.source, 'wheel-axle', 'adopted') < 0.22 ? 'walk' : path.mode;
    transport.trip = {
      id: `${route.id}:freight:${this.state.month}`, origin: shipment.source.id, destination: shipment.target.id,
      reason: shipment.reason, mode, resource: shipment.resource, material: shipment.material,
      quantity: shipment.quantity, departedMonth: this.state.month,
      distance: 0, status: 'moving',
      path: { ...path, points: (reverse ? [...path.points].reverse() : path.points).map(p => ({ ...p })), segmentIds: reverse ? [...path.segmentIds].reverse() : [...path.segmentIds] },
    };
    route.caravanProgress = 0;
    route.caravanDirection = reverse ? -1 : 1;
    return undefined;
  }

  private addUpgrade(route: TradeRoute, a: Settlement, b: Settlement, mode: NetworkMode): void {
    if (route.transport!.projectIds.some(id => this.state.transportation.projects[id]?.mode === mode)) return;
    const project = this.planConnection(route.id, a, b, mode);
    if (project) route.transport!.projectIds.push(project.id);
  }

  private planConnection(id: string, a: Settlement, b: Settlement, mode: NetworkMode): TransportProject | undefined {
    const projectId = `${id}:${mode}`;
    if (this.state.transportation.projects[projectId]) return this.state.transportation.projects[projectId];
    const retryKey = `${a.id}:${b.id}:${mode}`;
    if (this.state.month < (this.retries.get(retryKey) ?? 0)) return undefined;
    this.retries.set(retryKey, this.state.month + 120);
    const stops = [this.stop(a, mode), this.stop(b, mode)];
    if (!stops[0] || !stops[1]) return undefined;
    const bridgeCapability = mode !== 'water'
      && capabilityPractice(a, 'improved-roads', 'adopted') > 0.28
      && capabilityPractice(b, 'improved-roads', 'adopted') > 0.28
      && Math.min(a.resources.wealth, b.resources.wealth) > 12;
    const edges = this.planner.plan(stops[0].position, stops[1].position, mode, this.state.transportation, bridgeCapability);
    if (!edges.length) return undefined;
    return this.register(projectId, a.id, b.id, mode, edges, [stops[0], stops[1]], 'trade');
  }

  private stop(settlement: Settlement, mode: NetworkMode): TransportStop | undefined {
    const id = `${settlement.id}:${mode}`;
    const existing = this.state.transportation.stops[id];
    if (existing) return existing;
    if (mode !== 'water') {
      if (!landAllowed(this.state.world, settlement.position, mode)) return undefined;
      return { id, settlementId: settlement.id, kind: mode === 'rail' ? 'station' : 'market', node: pointKey(settlement.position), position: { ...settlement.position }, access: [{ ...settlement.position }], status: 'planned' };
    }
    // A port needs navigable water and a reachable dry bank, not just a coastal settlement flag.
    const candidates = this.state.world.cells.map(c => ({ x: c.worldX, z: c.worldZ }))
      .filter(p => distance(p, settlement.position) <= this.state.world.cellSize * 3 && navigableAt(this.state.world, p))
      .sort((a, b) => distance(a, settlement.position) - distance(b, settlement.position) || (pointKey(a) < pointKey(b) ? -1 : 1));
    for (const p of candidates) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const bank = { x: p.x + dx! * this.state.world.cellSize * 0.75, z: p.z + dz! * this.state.world.cellSize * 0.75 };
        if (!this.walking.isWalkable(bank)) continue;
        if (Math.abs(surfaceHeightAt(this.state.world, bank.x, bank.z) - surfaceWaterAt(this.state.world, p.x, p.z)) / distance(bank, p) > 0.6) continue;
        const access = this.walking.route(settlement.position, bank);
        if (!access.length || distance(access[access.length - 1]!, bank) > 0.05) continue;
        return { id, settlementId: settlement.id, kind: 'port', node: pointKey(p), position: p, access: [{ ...settlement.position }, ...access], status: 'planned' };
      }
    }
    return undefined;
  }

  private register(id: string, a: string, b: string, mode: NetworkMode, edges: PlannedEdge[], stops: TransportStop[], reason: TransportProject['reason']): TransportProject {
    const network = this.state.transportation;
    const segmentIds = edges.map(edge => {
      const key = edgeKey(edge.a, edge.b, mode);
      if (!network.segments[key]) network.segments[key] = { id: key, from: pointKey(edge.a), to: pointKey(edge.b), mode, kind: edge.kind,
        status: 'planned', points: edge.points.map(p => ({ ...p })), length: edge.length, cost: Math.max(0.3, edge.cost * (mode === 'rail' ? 0.8 : mode === 'water' ? 0.12 : 0.18)), work: 0 };
      return key;
    });
    for (const stop of stops) network.stops[stop.id] ??= stop;
    const project: TransportProject = { id, a, b, mode, reason, segmentIds, from: pointKey(edges[0]!.a), to: pointKey(edges[edges.length - 1]!.b), stopIds: stops.map(s => s.id) };
    network.projects[id] = project;
    network.revision++;
    return project;
  }

  private build(project: TransportProject): void {
    const network = this.state.transportation;
    const a = this.state.settlements.find(s => s.id === project.a);
    const b = this.state.settlements.find(s => s.id === project.b);
    if (!a?.alive || !b?.alive || Math.min(a.foodSecurity, b.foodSecurity) < 0.35) return;
    if (project.reason === 'trade' && !this.state.tradeRoutes.some(r => r.active && r.transport?.projectIds.includes(project.id))) return;
    if (project.mode === 'rail'
      && Math.min(capabilityPractice(a, 'rail-transport', 'transformed'), capabilityPractice(b, 'rail-transport', 'transformed')) <= 0.34) return;
    if (project.mode === 'water' && (!this.canShip(a) || !this.canShip(b))) return;
    let work = 0.22 + Math.min(a.prosperity, b.prosperity) * 0.28;
    let cursor = project.from;
    for (const id of project.segmentIds) {
      const segment = network.segments[id]!;
      if ((segment.floodDepth ?? 0) > 0.06 || segment.damagedMonth === this.state.month) return;
      if (segment.status === 'complete') {
        cursor = segment.from === cursor ? segment.to : segment.from;
        continue;
      }
      // Only the frontier grows. No scattered completed pieces ahead of construction.
      if (segment.from !== cursor && segment.to !== cursor) return;
      const survey = surveyEdge(this.state.world, segment.points[0]!, segment.points[segment.points.length - 1]!, segment.mode, segment.kind === 'bridge');
      if (!survey) return;
      if (segment.kind === 'bridge'
        && Math.min(capabilityPractice(a, 'improved-roads', 'adopted'), capabilityPractice(b, 'improved-roads', 'adopted')) <= 0.28) return;

      const typedAuthority = materialAuthority(a, b);
      const typedWork = maxCapitalWork(a, b, segment);
      const legacyMinerals = project.mode === 'rail' ? 0.65 : segment.kind === 'bridge' ? 0.4 : 0.05;
      const amount = typedAuthority
        ? Math.min(work, segment.cost - segment.work, a.resources.wealth, typedWork)
        : Math.min(work, segment.cost - segment.work, a.resources.wealth, a.resources.wood / 0.3, a.resources.minerals / legacyMinerals);
      if (amount <= 0.0001) {
        if (typedAuthority && typedWork <= 0.0001) segment.materialBlockedSince ??= this.state.month;
        return;
      }

      a.resources.wealth -= amount;
      if (typedAuthority) {
        consumeCapital(a, b, segment, amount, this.state.month);
        segment.materialBlockedSince = undefined;
      } else {
        a.resources.wood -= amount * 0.3;
        a.resources.minerals -= amount * legacyMinerals;
      }
      segment.work += amount;
      work -= amount;
      if (segment.status === 'planned') { segment.status = 'under-construction'; network.revision++; }
      if (segment.work + 0.00001 < segment.cost) return;
      segment.status = 'complete';
      segment.completedMonth = this.state.month;
      network.revision++;
      cursor = segment.from === cursor ? segment.to : segment.from;
      if (work <= 0.0001) break;
    }
    if (project.segmentIds.every(id => network.segments[id]?.status === 'complete')) {
      for (const id of project.stopIds) {
        const stop = network.stops[id]!;
        if (stop.status !== 'complete') { stop.status = 'complete'; network.revision++; }
      }
    }
  }

  private planLocalAccess(settlement: Settlement): void {
    if (settlement.buildings < 3 || this.localPlans.has(settlement.id)) return;
    this.localPlans.add(settlement.id);
    const layout = createSettlementLayoutPlan({ settlement, settlements: this.state.settlements, routes: [], eraRank: 1, seed: this.state.seed });
    for (const district of ['market', 'residential', 'craft'] as const) {
      const anchor = layout.anchors[district];
      const end = { x: settlement.position.x + anchor.localX, z: settlement.position.z + anchor.localZ };
      const edges = this.planner.plan(settlement.position, end, 'road', this.state.transportation);
      if (edges.length) this.register(`${settlement.id}:${district}:access`, settlement.id, settlement.id, 'road', edges, [], 'district-access');
    }
  }

  private canShip(settlement: Settlement): boolean {
    return settlement.infrastructure.ports > 0.12 && capabilityPractice(settlement, 'buoyancy-currents', 'adopted') > 0.25;
  }
}
