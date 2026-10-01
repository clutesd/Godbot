import { recordFootTrafficSegment } from '../people/FootTraffic';
import { freightVehicle, FREIGHT_CAPACITY, FREIGHT_SPEED, railReady, tradeOpportunity } from './FreightEconomy';
import { infrastructureLabourBudget } from '../people/HumanCapital';
import { settlementRepresentedPopulation } from '../Population';
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
import { addMaterial, materialEconomy, reconcileBulkStocks, storageRoom, takeMaterial } from '../resources/Inventory';
import { consumeMaterial } from '../resources/MaterialUse';
import { surfaceHeightAt, surfaceWaterAt } from '../terrain/SurfaceGeometry';
import type { Settlement, SimulationState, TradeRoute } from '../types';
import { RoutePlanner, type PlannedEdge } from './RoutePlanner';
import { distance, edgeKey, landAllowed, navigableAt, pointKey, snowTravelMultiplier, surveyEdge } from './TerrainTraversal';
import { pathLength, positionAlongPath, segmentUsable, TransportNetwork } from './TransportNetwork';
import type { FreightTrip, NetworkMode, TransportProject, TransportSegment, TransportStop, TraversalPath } from './types';

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
    const footpath = this.footPath(a, b);
    if (!projects.length && !footpath) return false;
    route.mode = road || footpath ? 'land' : 'water';
    route.transport = { projectIds: projects, path: footpath, nextDispatchMonth: this.state.month };
    return true;
  }

  advanceMonth(): void {
    const { state } = this;
    if (state.month % 12 === 0) {
      for (const settlement of state.settlements.filter(s => s.alive)) { this.planLocalAccess(settlement); this.planFacilityAccess(settlement); }
      for (const route of state.tradeRoutes.filter(r => r.active && r.transport)) {
        const a = state.settlements.find(s => s.id === route.a);
        const b = state.settlements.find(s => s.id === route.b);
        if (!a?.alive || !b?.alive) continue;
        if (railReady(a, b, route)) this.addUpgrade(route, a, b, 'rail');
        if (this.canShip(a) && this.canShip(b) && route.volume > 0.5) this.addUpgrade(route, a, b, 'water');
      }
    }
    for (const project of Object.values(state.transportation.projects)) this.build(project);
    this.network.refresh();
    for (const route of state.tradeRoutes) {
      if (!route.transport) continue;
      route.transport.recentFreight = (route.transport.recentFreight ?? 0) * 0.985;
      const projects = route.transport.projectIds.map(id => state.transportation.projects[id]).filter((p): p is TransportProject => Boolean(p));
      // A rail upgrade does not change the mode of an already dispatched vehicle.
      const ordered = projects.sort((a, b) => ({ rail: 0, water: 1, road: 2 })[a.mode] - ({ rail: 0, water: 1, road: 2 })[b.mode]);
      route.transport.path = undefined;
      for (const project of ordered) {
        if (project.mode === 'rail') {
          const a = state.settlements.find(s => s.id === route.a);
          const b = state.settlements.find(s => s.id === route.b);
          if (!a || !b || !railReady(a, b, route) || tradeOpportunity(a, b) < 2) continue;
        }
        if (!project.stopIds.every(id => state.transportation.stops[id]?.status === 'complete')) continue;
        const path = this.network.findPath(project.from, project.to, project.mode);
        if (!path) continue;
        route.transport.path = path;
        route.mode = path.mode === 'water' ? 'water' : 'land';
        break;
      }
      if (!route.transport.path && route.active) {
        const a = state.settlements.find(s => s.id === route.a);
        const b = state.settlements.find(s => s.id === route.b);
        if (a?.alive && b?.alive) route.transport.path = this.footPath(a, b);
      }
      route.weatherBlocked = !route.transport.path;
    }
  }

  /** Returns delivered cargo exactly once. Cargo in transit has already left the source. */
  advanceFreight(route: TradeRoute, a: Settlement, b: Settlement): FreightTrip | undefined {
    const blockaded = this.state.wars.some(w => w.active && ((w.attacker === a.id && w.defender === b.id) || (w.attacker === b.id && w.defender === a.id)));
    const transport = route.transport;
    if (!transport) return undefined;
    const trip = transport.trip;
    if (trip && trip.status !== 'arrived') {
      if (!blockaded && route.active && a.alive && b.alive && !this.validPath(trip.path) && trip.path.segmentIds.length) this.rerouteFreight(trip);
      if (!blockaded && route.active && a.alive && b.alive && !this.validPath(trip.path) && trip.mode === 'walk') {
        const current = positionAlongPath(trip.path, trip.distance)?.position;
        const destination = trip.destination === a.id ? a : b;
        const detour = current ? this.footPath({ ...a, position: current }, destination) : undefined;
        if (detour) { trip.path = detour; trip.distance = 0; }
      }
      if (blockaded || !route.active || !a.alive || !b.alive || !this.validPath(trip.path)) {
        trip.status = 'blocked';
        return undefined;
      }
      trip.status = 'moving';
      if (trip.phase === 'loading' && this.state.month < (trip.phaseUntil ?? 0)) return undefined;
      if (trip.phase === 'loading') trip.phase = 'travel';
      const speed = trip.vehicle ? FREIGHT_SPEED[trip.vehicle] : { walk: 0.9, road: 1.6, rail: 3.8, water: 2.1 }[trip.mode];
      const position = positionAlongPath(trip.path, trip.distance)?.position ?? trip.path.points[0]!;
      const maintenance = Math.min(a.infrastructure.roads, b.infrastructure.roads);
      const weatherCost = snowTravelMultiplier(this.state.world, position, trip.mode, maintenance);
      const previousDistance = trip.distance;
      trip.distance = Math.min(trip.path.length, trip.distance + speed / weatherCost * (trip.mode === 'road' ? 0.75 + maintenance * 0.5 : 1));
      if (trip.mode !== 'water' && trip.mode !== 'rail') {
        for (let d = previousDistance; d < trip.distance; d += 0.25) {
          const from = positionAlongPath(trip.path, d)!.position;
          const to = positionAlongPath(trip.path, Math.min(d + 0.25, trip.distance))!.position;
          recordFootTrafficSegment(this.state.world, from, to, this.state.month, trip.origin, 1 + trip.quantity * 0.1);
        }
      }
      route.caravanProgress = trip.path.length ? trip.distance / trip.path.length : 0;
      if (trip.distance < trip.path.length) return undefined;
      if (trip.phase !== 'unloading') {
        trip.phase = 'unloading';
        const access = trip.mode === 'water' ? pathLength(this.state.transportation.stops[`${trip.destination}:water`]?.access ?? []) : 0;
        trip.phaseUntil = this.state.month + 1 + Math.ceil(access / 0.9);
        return undefined;
      }
      if (this.state.month < (trip.phaseUntil ?? 0)) return undefined;
      trip.status = 'arrived';
      const target = trip.destination === a.id ? a : b;
      const source = trip.origin === a.id ? a : b;
      if (trip.material) trip.deliveredQuantity = deliverMaterialShipment(source, target, trip.material, trip.quantity, 0.96, this.state.month);
      else if (trip.materialId) {
        trip.deliveredQuantity = addMaterial(target, trip.materialId, trip.quantity * 0.96);
        const economy = materialEconomy(target);
        economy.imports[trip.materialId] = (economy.imports[trip.materialId] ?? 0) + trip.deliveredQuantity;
      } else if (trip.resource) { trip.deliveredQuantity = trip.quantity * 0.96; target.resources[trip.resource] += trip.deliveredQuantity; }
      else throw new Error(`freight trip ${trip.id} has no cargo`);
      trip.lostQuantity = trip.quantity - trip.deliveredQuantity;
      transport.deliveries = (transport.deliveries ?? 0) + (trip.deliveredQuantity > 0 ? 1 : 0);
      transport.deliveredQuantity = (transport.deliveredQuantity ?? 0) + trip.deliveredQuantity;
      transport.recentFreight = (transport.recentFreight ?? 0) + trip.deliveredQuantity;
      transport.lastDeliveryMonth = this.state.month;
      route.volume = Math.min(2.4, 0.42 + transport.recentFreight / 12);
      for (const id of trip.path.segmentIds) {
        const segment = this.state.transportation.segments[id];
        if (segment?.mode === 'road') { a.infrastructure.roads = Math.min(1, a.infrastructure.roads + 0.001); b.infrastructure.roads = Math.min(1, b.infrastructure.roads + 0.001); }
      }
      transport.nextDispatchMonth = this.state.month + 3 + Math.floor(stableHash(route.id, this.state.month, 0) * 13);
      return trip;
    }
    if (blockaded || !route.active || !a.alive || !b.alive || this.state.month < transport.nextDispatchMonth || !transport.path || !this.validPath(transport.path)) return undefined;
    reconcileBulkStocks(a); reconcileBulkStocks(b);
    const population = (id: string): number => Math.max(1, settlementRepresentedPopulation(this.state, id));
    const aPopulation = population(a.id);
    const bPopulation = population(b.id);

    let shipment: {
      source: Settlement;
      target: Settlement;
      resource?: NonNullable<FreightTrip['resource']>;
      material?: MaterialKind;
      materialId?: string;
      quantity: number;
      reason: FreightTrip['reason'];
    } | undefined;

    const capacity = (source: Settlement, target: Settlement): number => FREIGHT_CAPACITY[freightVehicle(source, target, route, transport.path!, 40)];
    const materialShipment = chooseMaterialShipment(a, b, Math.max(route.volume, capacity(a, b) / 4.2, capacity(b, a) / 4.2));
    if (materialShipment) {
      const quantity = dispatchMaterialShipment(
        materialShipment.source,
        materialShipment.target,
        materialShipment.material,
        Math.min(materialShipment.quantity, FREIGHT_CAPACITY[freightVehicle(materialShipment.source, materialShipment.target, route, transport.path, materialShipment.quantity)]),
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
      const ids = [...new Set([...Object.keys(materialEconomy(a).demand), ...Object.keys(materialEconomy(b).demand)])].sort();
      for (const materialId of ids) {
        for (const [source, target] of [[a, b], [b, a]] as const) {
          if (source.materialUse?.criticalInputs.includes(materialId as MaterialKind) || (source.materialUse?.materials[materialId as MaterialKind]?.pressure ?? 0) > 0.28) continue;
          const sourceDemand = materialEconomy(source).demand[materialId] ?? 0;
          const targetDemand = materialEconomy(target).demand[materialId] ?? 0;
          const surplus = Math.max(0, (source.localMaterials[materialId] ?? 0) - Math.max(0.4, sourceDemand * 6));
          const shortage = Math.max(0, targetDemand * 4 - (target.localMaterials[materialId] ?? 0));
          const quantity = Math.min(storageRoom(target), surplus * 0.32, shortage, FREIGHT_CAPACITY[freightVehicle(source, target, route, transport.path, shortage)]);
          if (quantity <= 0.08 || quantity <= (shipment?.quantity ?? 0)) continue;
          shipment = { source, target, materialId, quantity, reason: 'scarcity-relief' };
        }
      }
      if (shipment?.materialId) shipment.quantity = takeMaterial(shipment.source, shipment.materialId, shipment.quantity);
    }

    if (!shipment) {
      for (const resource of ['food'] as const) {
        const gap = a.resources[resource] / aPopulation - b.resources[resource] / bPopulation;
        const source = gap > 0 ? a : b;
        const target = gap > 0 ? b : a;
        if (source.foodSecurity <= 1.1 || target.foodSecurity >= 0.9) continue;
        const quantity = Math.min(FREIGHT_CAPACITY[freightVehicle(source, target, route, transport.path, Math.abs(gap))], Math.abs(gap) * route.volume * 1.8, source.resources[resource] * 0.04, route.volume * 6);
        if (quantity > 0.08 && quantity > (shipment?.quantity ?? 0)) shipment = { source, target, resource, quantity, reason: 'trade' };
      }
      if (shipment?.resource) shipment.source.resources[shipment.resource] -= shipment.quantity;
    }

    transport.nextDispatchMonth = this.state.month + 6;
    if (!shipment) return undefined;
    const path = transport.path;
    const reverse = shipment.source.id === b.id;
    const vehicle = freightVehicle(shipment.source, shipment.target, route, path, shipment.quantity);
    const mode = path.mode === 'road' && ['basket', 'merchant', 'pack-animal'].includes(vehicle) ? 'walk' : path.mode;
    if (vehicle === 'truck') {
      takeMaterial(shipment.source, 'charcoal', 0.1);
      takeMaterial(shipment.source, (shipment.source.localMaterials.steel ?? 0) >= 0.05 ? 'steel' : 'iron-tools', 0.05);
    }
    transport.trip = {
      id: `${route.id}:freight:${this.state.month}`, origin: shipment.source.id, destination: shipment.target.id,
      reason: shipment.reason, mode, vehicle, phase: 'loading', phaseUntil: this.state.month + 1 + (mode === 'water' ? Math.ceil(pathLength(this.state.transportation.stops[`${shipment.source.id}:water`]?.access ?? []) / 0.9) : 0), resource: shipment.resource, material: shipment.material, materialId: shipment.materialId,
      quantity: shipment.quantity, departedMonth: this.state.month,
      distance: 0, status: 'moving',
      path: { ...path, points: (reverse ? [...path.points].reverse() : path.points).map(p => ({ ...p })), segmentIds: reverse ? [...path.segmentIds].reverse() : [...path.segmentIds] },
    };
    route.caravanProgress = 0;
    route.caravanDirection = reverse ? -1 : 1;
    return undefined;
  }

  /** Keep the current segment and exact physical progress; only replace the untravelled network. */
  private rerouteFreight(trip: FreightTrip): void {
    const destination = pointKey(trip.path.points[trip.path.points.length - 1]!);
    const position = positionAlongPath(trip.path, trip.distance)?.position;
    if (!position) return;
    const direct = this.network.findPath(pointKey(position), destination, trip.path.mode);
    if (direct && distance(position, direct.points[0]!) < 1e-6) {
      trip.path = direct; trip.distance = 0; return;
    }
    let traversed = 0;
    let node = pointKey(trip.path.points[0]!);
    for (const id of trip.path.segmentIds) {
      const segment = this.state.transportation.segments[id];
      if (!segment) return;
      const forward = segment.from === node;
      const end = forward ? segment.to : segment.from;
      if (trip.distance < traversed + segment.length) {
        if (!segmentUsable(this.state.world, segment)) return;
        const tail = this.network.findPath(end, destination, trip.path.mode);
        if (!tail) return;
        const current = forward ? segment.points : [...segment.points].reverse();
        const points = [...current, ...tail.points.slice(1)].map(p => ({ ...p }));
        trip.path = { mode: trip.path.mode, points, segmentIds: [id, ...tail.segmentIds], length: pathLength(points) };
        trip.distance -= traversed;
        return;
      }
      traversed += segment.length; node = end;
    }
  }

  private validPath(path: TraversalPath): boolean {
    return path.segmentIds.length ? this.network.pathValid(path) : path.mode === 'road' && this.walking.routeIsValid(path.points);
  }

  private footPath(a: Settlement, b: Settlement): TraversalPath | undefined {
    const route = this.walking.route(a.position, b.position);
    if (!route.length || distance(route[route.length - 1]!, b.position) > 0.05) return undefined;
    const points = [a.position, ...route].map(p => ({ ...p, y: surfaceHeightAt(this.state.world, p.x, p.z) }));
    return { mode: 'road', points, segmentIds: [], length: pathLength(points) };
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
    if (project.mode === 'rail') {
      const route = this.state.tradeRoutes.find(r => r.transport?.projectIds.includes(project.id));
      if (!route || ![a, b].every(s => capabilityPractice(s, 'rail-transport', 'transformed') > 0.34 && capabilityPractice(s, 'iron-working', 'adopted') > 0.3 && capabilityPractice(s, 'mechanical-power', 'adopted') > 0.3)) return;
    }
    if (project.mode === 'water' && (!this.canShip(a) || !this.canShip(b))) return;
    if (project.reason === 'trade' && project.mode === 'road') {
      const route = this.state.tradeRoutes.find(r => r.transport?.projectIds.includes(project.id));
      if ((route?.transport?.deliveries ?? 0) < 2 && !(project.segmentIds.some(id => network.segments[id]?.kind === 'bridge') && tradeOpportunity(a, b) > 0.08)) return;
    }
    const aLabour = infrastructureLabourBudget(this.state, a), bLabour = infrastructureLabourBudget(this.state, b);
    let work = Math.min(0.22 + Math.min(a.prosperity, b.prosperity) * 0.28, aLabour.remaining + bLabour.remaining);
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
      const aWork = Math.min(aLabour.remaining, amount);
      aLabour.remaining -= aWork; bLabour.remaining -= amount - aWork;
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
    const layout = createSettlementLayoutPlan({ settlement, settlements: this.state.settlements, routes: [], eraRank: 1, seed: this.state.seed, identity: settlement.architecture });
    for (const district of ['market', 'residential', 'craft'] as const) {
      const anchor = layout.anchors[district];
      const end = { x: settlement.position.x + anchor.localX, z: settlement.position.z + anchor.localZ };
      const edges = this.planner.plan(settlement.position, end, 'road', this.state.transportation);
      if (edges.length) this.register(`${settlement.id}:${district}:access`, settlement.id, settlement.id, 'road', edges, [], 'district-access');
    }
  }

  /**
   * A powered works moves tonnes, not baskets. Once a facility reaches tier two it gets a surveyed
   * service road to the settlement centre, built by the ordinary transport construction (paid in
   * worker-months and materials); its haul cost falls only when that road is actually complete.
   */
  private planFacilityAccess(settlement: Settlement): void {
    for (const facility of [...(settlement.processing?.facilities ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
      if (facility.tier < 2 || facility.progress < 1 || facility.roadProjectId) continue;
      const plot = settlement.structurePlots?.find(p => p.id === facility.plotId);
      if (!plot) continue;
      const id = `${settlement.id}:industrial:${facility.id}:access`;
      if (this.state.transportation.projects[id]) { facility.roadProjectId = id; continue; }
      const edges = this.planner.plan(settlement.position, { x: plot.worldX, z: plot.worldZ }, 'road', this.state.transportation);
      if (!edges.length) continue;
      facility.roadProjectId = this.register(id, settlement.id, settlement.id, 'road', edges, [], 'district-access').id;
    }
  }

  private canShip(settlement: Settlement): boolean {
    return settlement.infrastructure.ports > 0.12 && capabilityPractice(settlement, 'buoyancy-currents', 'adopted') > 0.25;
  }
}
