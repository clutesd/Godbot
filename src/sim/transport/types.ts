import type { MaterialKind } from '../resources/MaterialEconomy';
import type { Vec2 } from '../types';

export type NetworkMode = 'road' | 'rail' | 'water';
export type TransportMode = NetworkMode | 'walk';
export type FreightVehicle = 'basket' | 'merchant' | 'pack-animal' | 'cart' | 'caravan' | 'barge' | 'train' | 'truck';
export type LegacyFreightResource = 'food' | 'wood' | 'minerals' | 'goods';
export interface RoutePoint extends Vec2 { y: number }
export interface TransportSegment {
  id: string;
  from: string;
  to: string;
  mode: NetworkMode;
  kind: 'surface' | 'bridge' | 'shipping';
  status: 'planned' | 'under-construction' | 'complete';
  points: RoutePoint[];
  length: number;
  cost: number;
  work: number;
  completedMonth?: number;
  floodDepth?: number;
  floodMonths?: number;
  damagedMonth?: number;
  /** Exact physical capital incorporated into this segment over construction. */
  materialSpent?: Partial<Record<MaterialKind, number>>;
  /** First month physical scarcity prevented otherwise-possible construction progress. */
  materialBlockedSince?: number;
}
export interface TransportStop {
  id: string;
  settlementId: string;
  kind: 'market' | 'station' | 'port';
  node: string;
  position: Vec2;
  access: Vec2[];
  status: 'planned' | 'complete';
}
export interface TransportProject {
  id: string;
  a: string;
  b: string;
  mode: NetworkMode;
  reason: 'trade' | 'district-access';
  segmentIds: string[];
  from: string;
  to: string;
  stopIds: string[];
}
export interface TraversalPath {
  mode: NetworkMode;
  segmentIds: string[];
  points: RoutePoint[];
  length: number;
}
export interface FreightTrip {
  id: string;
  origin: string;
  destination: string;
  reason: 'trade' | 'scarcity-relief';
  mode: TransportMode;
  vehicle?: FreightVehicle;
  phase?: 'loading' | 'travel' | 'unloading';
  phaseUntil?: number;
  /** Legacy aggregate freight retained during the migration. Exactly one cargo field is set. */
  resource?: LegacyFreightResource;
  /** Typed physical material freight selected from real destination shortages and source surplus. */
  material?: MaterialKind;
  /** Catalog material freight from the local resource economy. */
  materialId?: string;
  quantity: number;
  deliveredQuantity?: number;
  lostQuantity?: number;
  departedMonth: number;
  path: TraversalPath;
  distance: number;
  status: 'moving' | 'blocked' | 'arrived';
}
export interface RouteTransport {
  /** Real delivered throughput, never diplomatic enthusiasm. */
  deliveredQuantity?: number;
  deliveries?: number;
  recentFreight?: number;
  lastDeliveryMonth?: number;
  projectIds: string[];
  path?: TraversalPath;
  nextDispatchMonth: number;
  trip?: FreightTrip;
}
export interface TransportationState {
  revision: number;
  segments: Record<string, TransportSegment>;
  stops: Record<string, TransportStop>;
  projects: Record<string, TransportProject>;
}
export const createTransportationState = (): TransportationState => ({ revision: 0, segments: {}, stops: {}, projects: {} });
