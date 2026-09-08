import { SeededRandom } from '../sim/prng';
import type { Settlement, TradeRoute, Vec2 } from '../sim/types';
import type { TransportationState } from '../sim/transport/types';

/**
 * Semantic city plan shared by simulation and presentation. It contains no render state: the
 * simulation uses it for destinations and road-biased movement, while the renderer uses the
 * same anchors for buildings, streets, gates, stations, and docks.
 */
export type BuildingDistrict = 'civic' | 'sacred' | 'market' | 'residential' | 'craft' | 'industrial';

export interface LayoutAnchor {
  district: BuildingDistrict;
  localX: number;
  localZ: number;
  worldX: number;
  worldZ: number;
  radius: number;
}

export interface RoutePortal {
  routeId: string;
  mode: 'land' | 'water' | 'rail';
  kind: 'gate' | 'dock' | 'station';
  localX: number;
  localZ: number;
  worldX: number;
  worldZ: number;
  angle: number;
  bank?: Vec2;
}

export interface StreetSegment {
  kind: 'primary' | 'secondary' | 'service';
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  width: number;
}

export interface SettlementLayoutPlan {
  radius: number;
  anchors: Record<BuildingDistrict, LayoutAnchor>;
  portals: RoutePortal[];
  streets: StreetSegment[];
}

export interface SettlementLayoutInput {
  settlement: Settlement;
  settlements: readonly Settlement[];
  routes: readonly TradeRoute[];
  transportation?: TransportationState;
  eraRank: number;
  seed: string;
}

const DISTRICTS: readonly BuildingDistrict[] = ['civic', 'sacred', 'market', 'residential', 'craft', 'industrial'];

export function createSettlementLayoutPlan(input: SettlementLayoutInput): SettlementLayoutPlan {
  const { settlement, settlements, routes, eraRank, seed } = input;
  const random = new SeededRandom(`${seed}:layout:${settlement.id}`);
  const activeRoutes = routes.filter((route) => route.active && (route.a === settlement.id || route.b === settlement.id));
  const baseRadius = 2.8 + Math.sqrt(Math.max(1, settlement.buildings)) * 0.56 + settlement.urbanization * 3.4 + eraRank * 0.42;
  const tradeAngle = averageRouteAngle(settlement, settlements, activeRoutes) ?? random.range(0, Math.PI * 2);
  const craftAngle = angleForSpecialization(settlement.specialization, tradeAngle);
  const industrialAngle = industrialFacingAngle(settlement, activeRoutes, settlements, tradeAngle + Math.PI * 0.72);

  const anchorSpecs: Record<BuildingDistrict, { angle: number; distance: number; radius: number }> = {
    civic: { angle: 0, distance: 0, radius: Math.max(1.4, baseRadius * 0.24) },
    market: { angle: tradeAngle, distance: baseRadius * 0.38, radius: Math.max(1.2, baseRadius * 0.25) },
    sacred: { angle: tradeAngle - Math.PI * 0.58, distance: baseRadius * 0.32, radius: Math.max(1.1, baseRadius * 0.2) },
    residential: { angle: tradeAngle + Math.PI * 0.72, distance: baseRadius * 0.46, radius: Math.max(1.8, baseRadius * 0.38) },
    craft: { angle: craftAngle, distance: baseRadius * 0.58, radius: Math.max(1.4, baseRadius * 0.3) },
    industrial: { angle: industrialAngle, distance: baseRadius * (eraRank >= 4 ? 0.78 : 0.68), radius: Math.max(1.5, baseRadius * 0.32) },
  };

  const anchors = Object.fromEntries(DISTRICTS.map((district) => {
    const spec = anchorSpecs[district];
    const localX = Math.cos(spec.angle) * spec.distance;
    const localZ = Math.sin(spec.angle) * spec.distance;
    return [district, { district, localX, localZ, worldX: settlement.position.x + localX, worldZ: settlement.position.z + localZ, radius: spec.radius }];
  })) as Record<BuildingDistrict, LayoutAnchor>;

  const portals = createRoutePortals(settlement, settlements, activeRoutes, baseRadius, input.transportation);
  const streets = createStreetSegments(anchors, portals, baseRadius, eraRank);
  return { radius: baseRadius, anchors, portals, streets };
}

export function districtForPlot(index: number, settlement: Settlement): BuildingDistrict {
  if (index === 0) return 'civic';
  if (index === 1) return 'sacred';
  if (index === 2) return 'market';
  const industrialEdge = settlement.industry.active || settlement.infrastructure.factories > 0.08;
  if (industrialEdge && index % 6 === 5) return 'industrial';
  if (index % 5 === 3) return 'craft';
  if (index % 11 === 7) return 'market';
  return 'residential';
}

function averageRouteAngle(settlement: Settlement, settlements: readonly Settlement[], routes: readonly TradeRoute[]): number | undefined {
  if (routes.length === 0) return undefined;
  let x = 0;
  let z = 0;
  for (const route of routes) {
    const otherId = route.a === settlement.id ? route.b : route.a;
    const other = settlements.find((candidate) => candidate.id === otherId);
    if (!other) continue;
    const angle = Math.atan2(other.position.z - settlement.position.z, other.position.x - settlement.position.x);
    const weight = Math.max(0.2, route.volume);
    x += Math.cos(angle) * weight;
    z += Math.sin(angle) * weight;
  }
  if (Math.abs(x) + Math.abs(z) < 0.001) return undefined;
  return Math.atan2(z, x);
}

function angleForSpecialization(specialization: Settlement['specialization'], tradeAngle: number): number {
  switch (specialization) {
    case 'agriculture': return tradeAngle + Math.PI * 0.86;
    case 'forestry': return tradeAngle - Math.PI * 0.72;
    case 'mining': return tradeAngle + Math.PI;
    case 'exchange': return tradeAngle + Math.PI * 0.18;
    case 'craft':
    default: return tradeAngle - Math.PI * 0.22;
  }
}

function industrialFacingAngle(settlement: Settlement, routes: readonly TradeRoute[], settlements: readonly Settlement[], fallback: number): number {
  const railRoute = routes.find((route) => {
    if (route.transport?.path?.mode !== 'rail') return false;
    const otherId = route.a === settlement.id ? route.b : route.a;
    const other = settlements.find((candidate) => candidate.id === otherId);
    return Boolean(other);
  });
  if (!railRoute) return fallback;
  const otherId = railRoute.a === settlement.id ? railRoute.b : railRoute.a;
  const other = settlements.find((candidate) => candidate.id === otherId);
  if (!other) return fallback;
  return Math.atan2(other.position.z - settlement.position.z, other.position.x - settlement.position.x);
}

function createRoutePortals(settlement: Settlement, settlements: readonly Settlement[], routes: readonly TradeRoute[], cityRadius: number, infrastructure?: TransportationState): RoutePortal[] {
  return routes.flatMap((route) => {
    const otherId = route.a === settlement.id ? route.b : route.a;
    const other = settlements.find((candidate) => candidate.id === otherId);
    if (!other) return [];
    const angle = Math.atan2(other.position.z - settlement.position.z, other.position.x - settlement.position.x);
    const portalDistance = cityRadius * 1.08;
    const stop = (route.mode === 'water' ? ['water', 'rail', 'road'] : ['rail', 'road', 'water'])
      .map(mode => infrastructure?.stops[`${settlement.id}:${mode}`]).find(stop => stop?.status === 'complete');
    const rail = stop ? stop.kind === 'station' : route.transport?.path?.mode === 'rail';
    const water = stop ? stop.kind === 'port' : route.transport?.path?.mode === 'water';
    const kind: RoutePortal['kind'] = water ? 'dock' : rail ? 'station' : 'gate';
    const mode: RoutePortal['mode'] = rail ? 'rail' : water ? 'water' : 'land';
    const path = route.transport?.path;
    if (!path && !stop) return [];
    const endpoint = stop?.position ?? (path ? (route.a === settlement.id ? path.points[0] : path.points[path.points.length - 1]) : undefined);
    const localX = endpoint ? endpoint.x - settlement.position.x : Math.cos(angle) * portalDistance;
    const localZ = endpoint ? endpoint.z - settlement.position.z : Math.sin(angle) * portalDistance;
    return [{ routeId: route.id, mode, kind, localX, localZ, worldX: settlement.position.x + localX, worldZ: settlement.position.z + localZ, angle, bank: stop?.kind === 'port' ? stop.access[stop.access.length - 1] : undefined }];
  });
}

function createStreetSegments(anchors: Record<BuildingDistrict, LayoutAnchor>, portals: readonly RoutePortal[], cityRadius: number, eraRankValue: number): StreetSegment[] {
  const width = eraRankValue >= 4 ? 0.34 : eraRankValue >= 2 ? 0.26 : 0.18;
  const segments: StreetSegment[] = [];
  for (const portal of portals) {
    segments.push({ kind: 'primary', fromX: portal.localX, fromZ: portal.localZ, toX: anchors.market.localX, toZ: anchors.market.localZ, width: width * 1.2 });
  }
  segments.push({ kind: 'primary', fromX: anchors.market.localX, fromZ: anchors.market.localZ, toX: anchors.civic.localX, toZ: anchors.civic.localZ, width: width * 1.15 });
  for (const district of ['sacred', 'residential', 'craft', 'industrial'] as const) {
    segments.push({ kind: district === 'industrial' ? 'service' : 'secondary', fromX: anchors.civic.localX, fromZ: anchors.civic.localZ, toX: anchors[district].localX, toZ: anchors[district].localZ, width });
  }
  if (portals.length === 0) {
    segments.push({ kind: 'secondary', fromX: -cityRadius * 0.5, fromZ: 0, toX: cityRadius * 0.5, toZ: 0, width });
  }
  return segments;
}
