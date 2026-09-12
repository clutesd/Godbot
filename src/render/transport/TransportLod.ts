import * as THREE from 'three';
import type { TransportSegment } from '../../sim/transport/types';

export const TRANSPORT_LOD_DISTANCES = Object.freeze({
  approach: 16,
  regional: 36,
});

export interface TransportLodMaterials {
  timber: THREE.Material;
  stone: THREE.Material;
  metal: THREE.Material;
}

function beamBetween(a: THREE.Vector3, b: THREE.Vector3, width: number, height: number, material: THREE.Material): THREE.Mesh {
  const delta = b.clone().sub(a);
  const length = Math.max(0.001, delta.length());
  const beam = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), material);
  beam.position.copy(a).add(b).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), delta.normalize());
  beam.castShadow = true;
  beam.receiveShadow = true;
  return beam;
}

function supportBox(
  x: number,
  z: number,
  topY: number,
  bottomY: number,
  width: number,
  depth: number,
  material: THREE.Material,
): THREE.Mesh {
  const bottom = Math.min(bottomY, topY - 0.14);
  const height = Math.max(0.18, topY - bottom);
  const support = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  support.position.set(x, topY - height * 0.5, z);
  support.castShadow = true;
  support.receiveShadow = true;
  return support;
}

function centeredPoint(point: THREE.Vector3, anchor: THREE.Vector3): THREE.Vector3 {
  return point.clone().sub(anchor);
}

export interface HarbourLodOptions {
  detail: THREE.Group;
  bank: THREE.Vector3;
  water: THREE.Vector3;
  eraRank: number;
  materials: TransportLodMaterials;
}

/**
 * GODBOX normally observes settlements from well above street level. Fine pier furniture is useful
 * in a close documentary shot, but at ordinary observation distance it becomes high-contrast noise.
 * This LOD preserves the full harbour up close and collapses it to a compact, unmistakable shoreline
 * silhouette at approach/regional distances.
 */
export function createHarbourPresentationLod(options: HarbourLodOptions): THREE.LOD {
  const { detail, bank, water, eraRank: rank, materials } = options;
  const lod = new THREE.LOD();
  lod.name = 'harbour-presentation-lod';
  lod.autoUpdate = true;

  const anchor = bank.clone().lerp(water, 0.5);
  lod.position.copy(anchor);
  detail.position.sub(anchor);
  detail.name = detail.name || 'harbour-close-detail';

  const bankLocal = centeredPoint(bank, anchor);
  const waterLocal = centeredPoint(water, anchor);
  const delta = waterLocal.clone().sub(bankLocal);
  const horizontal = Math.max(0.001, Math.hypot(delta.x, delta.z));
  const dirX = delta.x / horizontal;
  const dirZ = delta.z / horizontal;
  const perpX = -dirZ;
  const perpZ = dirX;
  const deckWidth = rank <= 1 ? 0.48 : rank <= 3 ? 0.62 : 0.76;
  const deckMaterial = rank >= 4 ? materials.metal : materials.timber;
  const deckY = Math.min(Math.max(waterLocal.y + 0.12, bankLocal.y - 0.08), waterLocal.y + 0.24);
  const start = new THREE.Vector3(bankLocal.x + dirX * 0.08, deckY, bankLocal.z + dirZ * 0.08);
  const end = new THREE.Vector3(waterLocal.x, deckY, waterLocal.z);

  const approach = new THREE.Group();
  approach.name = 'harbour-approach-silhouette';
  approach.add(beamBetween(start, end, deckWidth, rank >= 4 ? 0.13 : 0.1, deckMaterial));

  // Two chunky pile pairs are enough to make the structure read as a pier without producing
  // black spaghetti at documentary scale.
  for (const t of [0.38, 0.78]) {
    const x = THREE.MathUtils.lerp(start.x, end.x, t);
    const z = THREE.MathUtils.lerp(start.z, end.z, t);
    for (const side of [-1, 1]) {
      approach.add(supportBox(
        x + perpX * deckWidth * 0.34 * side,
        z + perpZ * deckWidth * 0.34 * side,
        deckY - 0.03,
        waterLocal.y - 0.18,
        rank >= 4 ? 0.09 : 0.11,
        rank >= 4 ? 0.09 : 0.11,
        deckMaterial,
      ));
    }
  }

  if (rank >= 2) {
    const headWidth = deckWidth * (rank >= 4 ? 1.9 : 1.65);
    const head = new THREE.Mesh(new THREE.BoxGeometry(headWidth, rank >= 4 ? 0.13 : 0.1, 0.48), deckMaterial);
    head.name = 'harbour-approach-head';
    head.position.copy(end);
    head.rotation.y = Math.atan2(dirX, dirZ);
    head.castShadow = true;
    head.receiveShadow = true;
    approach.add(head);
  }

  const regional = new THREE.Group();
  regional.name = 'harbour-regional-silhouette';
  regional.add(beamBetween(start, end, deckWidth * 1.08, 0.12, deckMaterial));
  if (rank >= 2) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(deckWidth * 1.75, 0.12, 0.45), deckMaterial);
    head.position.copy(end);
    head.rotation.y = Math.atan2(dirX, dirZ);
    head.castShadow = true;
    head.receiveShadow = true;
    regional.add(head);
  }

  lod.addLevel(detail, 0);
  lod.addLevel(approach, TRANSPORT_LOD_DISTANCES.approach);
  lod.addLevel(regional, TRANSPORT_LOD_DISTANCES.regional);
  lod.userData['transportPresentation'] = 'harbour';
  lod.userData['lodDistances'] = { ...TRANSPORT_LOD_DISTANCES };
  return lod;
}

export interface BridgeLodOptions {
  detail: THREE.Group;
  segment: TransportSegment;
  width: number;
  groundAt: (x: number, z: number) => number;
  materials: TransportLodMaterials;
}

function bridgeStructuralMaterial(detail: THREE.Group, materials: TransportLodMaterials): THREE.Material {
  const style = detail.userData['bridgeStyle'];
  if (style === 'metal') return materials.metal;
  if (style === 'masonry') return materials.stone;
  return materials.timber;
}

function addBridgeSupports(
  target: THREE.Group,
  segment: TransportSegment,
  anchor: THREE.Vector3,
  width: number,
  count: number,
  groundAt: (x: number, z: number) => number,
  material: THREE.Material,
): void {
  if (segment.points.length < 2) return;
  for (let index = 1; index <= count; index += 1) {
    const t = index / (count + 1);
    const pointIndex = Math.min(segment.points.length - 1, Math.max(0, Math.round(t * (segment.points.length - 1))));
    const point = segment.points[pointIndex]!;
    const bottom = groundAt(point.x, point.z);
    target.add(supportBox(
      point.x - anchor.x,
      point.z - anchor.z,
      point.y - anchor.y - 0.02,
      bottom - anchor.y,
      width * 0.52,
      Math.max(0.16, width * 0.32),
      material,
    ));
  }
}

/**
 * Full trusses, braces, sleepers and rails only survive when the camera can actually resolve them.
 * Approach and regional tiers keep the load-bearing massing but deliberately drop wire-like detail.
 */
export function createBridgePresentationLod(options: BridgeLodOptions): THREE.LOD {
  const { detail, segment, width, groundAt, materials } = options;
  const lod = new THREE.LOD();
  lod.name = 'bridge-presentation-lod';
  lod.autoUpdate = true;
  if (segment.points.length < 2) {
    lod.addLevel(detail, 0);
    return lod;
  }

  const first = segment.points[0]!;
  const last = segment.points[segment.points.length - 1]!;
  const anchor = new THREE.Vector3(
    (first.x + last.x) * 0.5,
    (first.y + last.y) * 0.5,
    (first.z + last.z) * 0.5,
  );
  lod.position.copy(anchor);
  detail.position.sub(anchor);

  const structural = bridgeStructuralMaterial(detail, materials);
  const approach = new THREE.Group();
  approach.name = 'bridge-approach-silhouette';
  const approachSupports = Math.max(1, Math.min(3, Math.round(segment.length / 5)));
  addBridgeSupports(approach, segment, anchor, width, approachSupports, groundAt, structural);

  // Strong stone end masses remain visible and make the crossing read as intentional infrastructure.
  for (const point of [first, last]) {
    const bottom = groundAt(point.x, point.z);
    approach.add(supportBox(
      point.x - anchor.x,
      point.z - anchor.z,
      point.y - anchor.y + 0.02,
      bottom - anchor.y,
      width * 0.92,
      0.24,
      materials.stone,
    ));
  }

  const regional = new THREE.Group();
  regional.name = 'bridge-regional-silhouette';
  const regionalSupports = segment.length >= 8 ? 2 : 1;
  addBridgeSupports(regional, segment, anchor, width, regionalSupports, groundAt, structural);

  lod.addLevel(detail, 0);
  lod.addLevel(approach, TRANSPORT_LOD_DISTANCES.approach);
  lod.addLevel(regional, TRANSPORT_LOD_DISTANCES.regional);
  lod.userData['transportPresentation'] = 'bridge';
  lod.userData['segmentId'] = segment.id;
  lod.userData['bridgeStyle'] = detail.userData['bridgeStyle'];
  lod.userData['lodDistances'] = { ...TRANSPORT_LOD_DISTANCES };
  return lod;
}
