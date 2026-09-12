import * as THREE from 'three';
import type { SimulationState } from '../../sim/types';
import type { TransportSegment } from '../../sim/transport/types';
import { transportRibbon } from './TransportGeometry';

export type TransportDebugKind = 'dock' | 'bridge' | 'road' | 'rail' | 'construction' | 'planned' | 'station' | 'gate';

export interface TransportDebugPoint {
  x: number;
  y: number;
  z: number;
}

export interface TransportDebugRecord {
  kind: TransportDebugKind;
  id: string;
  length: number;
  mode?: TransportSegment['mode'];
  status?: TransportSegment['status'];
  settlementId?: string;
  routeId?: string;
  from?: TransportDebugPoint;
  to?: TransportDebugPoint;
}

export const TRANSPORT_DEBUG_COLORS: Readonly<Record<TransportDebugKind, number>> = {
  dock: 0x168cff,
  bridge: 0xff3154,
  road: 0xc9772e,
  rail: 0xd8e0e8,
  construction: 0xffd43b,
  planned: 0xff43d1,
  station: 0xa76bff,
  gate: 0x48d17a,
};

const DEBUG_FLAG = 'transportDebugOverlay';
const DEBUG_RECORD = 'transportDebugRecord';

function point(value: THREE.Vector3): TransportDebugPoint {
  return { x: value.x, y: value.y, z: value.z };
}

function debugMaterial(kind: TransportDebugKind, opacity = 0.78): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: TRANSPORT_DEBUG_COLORS[kind],
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function beamBetween(a: THREE.Vector3, b: THREE.Vector3, thickness: number, material: THREE.Material): THREE.Mesh {
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const delta = b.clone().sub(a);
  const length = Math.max(0.001, delta.length());
  const beam = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, length), material);
  beam.position.copy(midpoint);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), delta.normalize());
  beam.renderOrder = 1000;
  return beam;
}

function anchorMarker(position: THREE.Vector3, kind: TransportDebugKind, scale = 1): THREE.Group {
  const marker = new THREE.Group();
  const material = debugMaterial(kind, 0.96);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.13 * scale, 8, 6), material);
  sphere.position.copy(position);
  sphere.renderOrder = 1001;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025 * scale, 0.025 * scale, 0.7 * scale, 6), material);
  stem.position.set(position.x, position.y + 0.35 * scale, position.z);
  stem.renderOrder = 1001;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.09 * scale, 0.2 * scale, 6), material);
  cap.position.set(position.x, position.y + 0.8 * scale, position.z);
  cap.renderOrder = 1001;
  marker.add(sphere, stem, cap);
  return marker;
}

function tag(group: THREE.Group, record: TransportDebugRecord): THREE.Group {
  group.userData[DEBUG_FLAG] = true;
  group.userData[DEBUG_RECORD] = record;
  group.visible = false;
  return group;
}

export interface PortalDebugOptions {
  kind: 'dock' | 'station' | 'gate';
  id: string;
  settlementId: string;
  routeId: string;
  from: THREE.Vector3;
  to?: THREE.Vector3;
}

/** Diagnostic overlay for a physical portal. Docks show both bank and water anchors. */
export function createPortalDebugOverlay(options: PortalDebugOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = `transport-debug-${options.kind}`;
  const end = options.to ?? options.from;
  const length = options.from.distanceTo(end);
  const record: TransportDebugRecord = {
    kind: options.kind,
    id: options.id,
    settlementId: options.settlementId,
    routeId: options.routeId,
    length,
    from: point(options.from),
    to: point(end),
  };
  tag(group, record);
  group.add(anchorMarker(options.from, options.kind, 1.05));
  if (length > 0.02) {
    const material = debugMaterial(options.kind, 0.86);
    group.add(beamBetween(options.from, end, options.kind === 'dock' ? 0.11 : 0.08, material));
    group.add(anchorMarker(end, options.kind, 0.9));
  }
  return group;
}

export function transportDebugKindForSegment(segment: TransportSegment): TransportDebugKind {
  if (segment.status === 'planned') return 'planned';
  if (segment.status === 'under-construction') return 'construction';
  if (segment.kind === 'bridge') return 'bridge';
  if (segment.mode === 'rail') return 'rail';
  return 'road';
}

/**
 * Diagnostic ribbon drawn directly over the authoritative segment. If an ugly slab is a road,
 * bridge, rail line or construction segment, this overlay makes its identity unambiguous.
 */
export function createSegmentDebugOverlay(world: SimulationState['world'], segment: TransportSegment): THREE.Group {
  const kind = transportDebugKindForSegment(segment);
  const group = new THREE.Group();
  group.name = `transport-debug-${kind}`;
  const first = segment.points[0];
  const last = segment.points[segment.points.length - 1];
  tag(group, {
    kind,
    id: segment.id,
    length: segment.length,
    mode: segment.mode,
    status: segment.status,
    from: first ? { x: first.x, y: first.y, z: first.z } : undefined,
    to: last ? { x: last.x, y: last.y, z: last.z } : undefined,
  });
  if (!first || !last) return group;

  const width = segment.mode === 'rail' ? 1.02 : segment.kind === 'bridge' ? 0.86 : 0.76;
  const ribbon = new THREE.Mesh(
    transportRibbon(world, segment, width, 0, 0.12),
    debugMaterial(kind, kind === 'planned' ? 0.42 : 0.66),
  );
  ribbon.renderOrder = 999;
  group.add(ribbon);
  group.add(anchorMarker(new THREE.Vector3(first.x, first.y + 0.12, first.z), kind, 1));
  group.add(anchorMarker(new THREE.Vector3(last.x, last.y + 0.12, last.z), kind, 1));
  return group;
}

export function setTransportDebugVisibility(root: THREE.Object3D, visible: boolean): void {
  root.traverse((object) => {
    if (object.userData[DEBUG_FLAG] === true) object.visible = visible;
  });
}

export function collectTransportDebugRecords(root: THREE.Object3D): TransportDebugRecord[] {
  const records: TransportDebugRecord[] = [];
  root.traverse((object) => {
    if (object.userData[DEBUG_FLAG] !== true) return;
    const record = object.userData[DEBUG_RECORD] as TransportDebugRecord | undefined;
    if (record) records.push(record);
  });
  return records.sort((a, b) => a.kind.localeCompare(b.kind) || b.length - a.length || a.id.localeCompare(b.id));
}
