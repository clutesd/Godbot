import * as THREE from 'three';
import type { TransportSegment } from '../../sim/transport/types';

export interface DockStructureMaterials {
  timber: THREE.Material;
  stone: THREE.Material;
  metal: THREE.Material;
}

export interface DockStructureOptions {
  bank: THREE.Vector3;
  water: THREE.Vector3;
  eraRank: number;
  materials: DockStructureMaterials;
  /** Terrain height in the same local Y frame as bank/water. */
  groundAt: (x: number, z: number) => number;
}

function beamBetween(a: THREE.Vector3, b: THREE.Vector3, thickness: number, material: THREE.Material): THREE.Mesh {
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const length = Math.max(0.001, a.distanceTo(b));
  const beam = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, length), material);
  beam.position.copy(midpoint);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  beam.castShadow = true;
  beam.receiveShadow = true;
  return beam;
}

function deckBetween(a: THREE.Vector3, b: THREE.Vector3, width: number, thickness: number, material: THREE.Material): THREE.Mesh {
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const length = Math.max(0.001, a.distanceTo(b));
  const deck = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, length), material);
  deck.position.copy(midpoint);
  deck.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  deck.castShadow = true;
  deck.receiveShadow = true;
  return deck;
}

function verticalSupport(x: number, z: number, topY: number, bottomY: number, radius: number, material: THREE.Material): THREE.Mesh {
  const height = Math.max(0.16, topY - bottomY);
  const support = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.88, radius, height, 7), material);
  support.position.set(x, topY - height / 2, z);
  support.castShadow = true;
  support.receiveShadow = true;
  return support;
}

/**
 * A harbour is a real shoreline structure rather than one long rotated box. The landward
 * approach is allowed to slope, while the working pier stays level over water on visible piles.
 * Later eras widen the berth, add a quay head and finally metal handling gear.
 */
export function createDockStructure(options: DockStructureOptions): THREE.Group {
  const { bank, water, eraRank: rank, materials, groundAt } = options;
  const group = new THREE.Group();
  group.name = 'harbour-structure';
  group.userData['portalKind'] = 'dock';

  const dx = water.x - bank.x;
  const dz = water.z - bank.z;
  const horizontal = Math.max(0.001, Math.hypot(dx, dz));
  const dirX = dx / horizontal;
  const dirZ = dz / horizontal;
  const perpX = -dirZ;
  const perpZ = dirX;
  const deckWidth = rank <= 1 ? 0.48 : rank <= 3 ? 0.64 : 0.82;
  const deckThickness = rank >= 4 ? 0.12 : 0.085;
  const waterDeckY = water.y + (rank >= 4 ? 0.17 : 0.13);
  const deckY = Math.min(Math.max(waterDeckY, bank.y - 0.12), waterDeckY + 0.22);
  const rampLength = Math.min(horizontal * 0.34, 0.9);
  const deckStart = new THREE.Vector3(bank.x + dirX * rampLength, deckY, bank.z + dirZ * rampLength);
  const deckEnd = new THREE.Vector3(water.x + dirX * Math.min(0.45, horizontal * 0.18), deckY, water.z + dirZ * Math.min(0.45, horizontal * 0.18));

  // Shore abutment: masonry appears once the settlement can build formal waterfront works.
  if (rank >= 3) {
    const abutment = new THREE.Mesh(new THREE.BoxGeometry(deckWidth * 1.28, 0.36, 0.42), materials.stone);
    abutment.position.set(bank.x + dirX * 0.06, bank.y - 0.12, bank.z + dirZ * 0.06);
    abutment.rotation.y = Math.atan2(dirX, dirZ);
    abutment.castShadow = true;
    abutment.receiveShadow = true;
    group.add(abutment);
  }

  // A short gangway absorbs bank elevation instead of pitching the whole pier into the sky.
  const rampStart = new THREE.Vector3(bank.x, bank.y + 0.08, bank.z);
  group.add(deckBetween(rampStart, deckStart, deckWidth * 0.9, 0.07, materials.timber));

  const deckLength = Math.max(0.45, deckStart.distanceTo(deckEnd));
  const yaw = Math.atan2(dirX, dirZ);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(deckWidth, deckThickness, deckLength), rank >= 4 ? materials.metal : materials.timber);
  deck.position.copy(deckStart).lerp(deckEnd, 0.5);
  deck.rotation.y = yaw;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Cross planks make the deck read as constructed rather than as a monolithic beam.
  if (rank < 4) {
    const plankCount = Math.max(3, Math.min(12, Math.round(deckLength / 0.22)));
    for (let index = 0; index <= plankCount; index += 1) {
      const t = index / plankCount;
      const x = THREE.MathUtils.lerp(deckStart.x, deckEnd.x, t);
      const z = THREE.MathUtils.lerp(deckStart.z, deckEnd.z, t);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(deckWidth * 1.04, 0.025, 0.045), materials.timber);
      plank.position.set(x, deckY + deckThickness * 0.58, z);
      plank.rotation.y = yaw;
      plank.castShadow = true;
      group.add(plank);
    }
  }

  // Pile pairs carry the deck to the lake/river bed. Supports follow terrain independently.
  const pileStations = rank <= 1 ? [0.42, 0.82] : [0.3, 0.58, 0.86];
  for (const t of pileStations) {
    const x = THREE.MathUtils.lerp(deckStart.x, deckEnd.x, t);
    const z = THREE.MathUtils.lerp(deckStart.z, deckEnd.z, t);
    for (const side of [-1, 1]) {
      const px = x + perpX * deckWidth * 0.43 * side;
      const pz = z + perpZ * deckWidth * 0.43 * side;
      group.add(verticalSupport(px, pz, deckY - deckThickness * 0.25, groundAt(px, pz), rank >= 4 ? 0.055 : 0.07, rank >= 4 ? materials.metal : materials.timber));
    }
  }

  // A working head gives boats somewhere to lie alongside instead of ending at a needle point.
  if (rank >= 2) {
    const headWidth = deckWidth * (rank >= 4 ? 2.45 : 2.05);
    const headDepth = rank >= 4 ? 0.7 : 0.55;
    const head = new THREE.Mesh(new THREE.BoxGeometry(headWidth, deckThickness, headDepth), rank >= 4 ? materials.metal : materials.timber);
    head.position.set(deckEnd.x, deckY, deckEnd.z);
    head.rotation.y = yaw;
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);

    for (const side of [-1, 1]) {
      const bx = deckEnd.x + perpX * headWidth * 0.38 * side;
      const bz = deckEnd.z + perpZ * headWidth * 0.38 * side;
      const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.28, 7), rank >= 4 ? materials.metal : materials.timber);
      bollard.position.set(bx, deckY + 0.14, bz);
      bollard.castShadow = true;
      group.add(bollard);
    }
  }

  if (rank >= 4) {
    // Industrial waterfront: one compact derrick is enough to communicate cargo handling.
    const craneBase = deckEnd.clone().add(new THREE.Vector3(perpX * deckWidth * 0.72, 0, perpZ * deckWidth * 0.72));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.95, 8), materials.metal);
    mast.position.set(craneBase.x, deckY + 0.48, craneBase.z);
    mast.castShadow = true;
    const boomStart = new THREE.Vector3(craneBase.x, deckY + 0.88, craneBase.z);
    const boomEnd = new THREE.Vector3(craneBase.x + dirX * 0.72 - perpX * 0.18, deckY + 1.04, craneBase.z + dirZ * 0.72 - perpZ * 0.18);
    const boom = beamBetween(boomStart, boomEnd, 0.07, materials.metal);
    group.add(mast, boom);
  }

  group.userData['harbourStyle'] = rank >= 4 ? 'industrial-pier' : rank >= 3 ? 'quay-pier' : rank >= 2 ? 'working-pier' : 'timber-landing';
  return group;
}

function transportMaterialStyle(segment: TransportSegment): 'timber' | 'masonry' | 'metal' {
  const spent = segment.materialSpent ?? {};
  const metal = (spent.steel ?? 0) + (spent.iron ?? 0) + (spent.bronze ?? 0);
  const masonry = (spent.stone ?? 0) + (spent.brick ?? 0);
  const timber = (spent.lumber ?? 0) + (spent.timber ?? 0);
  if (metal > Math.max(masonry, timber) * 0.65) return 'metal';
  if (masonry > timber * 0.8) return 'masonry';
  return 'timber';
}

export interface BridgeStructureOptions {
  segment: TransportSegment;
  width: number;
  groundAt: (x: number, z: number) => number;
  timber: THREE.Material;
  stone: THREE.Material;
  metal: THREE.Material;
}

/** Structural layer added beneath/around the authoritative transport ribbon. */
export function createBridgeStructure(options: BridgeStructureOptions): THREE.Group {
  const { segment, width, groundAt, timber, stone, metal } = options;
  const group = new THREE.Group();
  const style = transportMaterialStyle(segment);
  const structuralMaterial = style === 'metal' ? metal : style === 'masonry' ? stone : timber;
  group.name = 'bridge-structure';
  group.userData['bridgeStyle'] = style;
  group.userData['segmentId'] = segment.id;
  if (segment.points.length < 2) return group;

  const first = segment.points[0]!;
  const last = segment.points[segment.points.length - 1]!;
  const axisX = last.x - first.x;
  const axisZ = last.z - first.z;
  const axisLength = Math.max(0.001, Math.hypot(axisX, axisZ));
  const perpX = -axisZ / axisLength;
  const perpZ = axisX / axisLength;

  // Proper abutments visually terminate the span in the banks.
  for (const point of [first, last]) {
    const bottom = groundAt(point.x, point.z);
    const height = Math.max(0.28, point.y - bottom + 0.14);
    const abutment = new THREE.Mesh(new THREE.BoxGeometry(width * 1.18, height, 0.28), stone);
    abutment.position.set(point.x, point.y - height / 2 + 0.04, point.z);
    abutment.rotation.y = Math.atan2(axisX, axisZ);
    abutment.castShadow = true;
    abutment.receiveShadow = true;
    group.add(abutment);
  }

  const supportCount = Math.max(1, Math.min(5, Math.floor(segment.length / 2.6)));
  for (let index = 1; index <= supportCount; index += 1) {
    const t = index / (supportCount + 1);
    const pointIndex = Math.min(segment.points.length - 1, Math.max(0, Math.round(t * (segment.points.length - 1))));
    const point = segment.points[pointIndex]!;
    const bottom = groundAt(point.x, point.z);
    if (style === 'timber') {
      for (const side of [-1, 1]) {
        const x = point.x + perpX * width * 0.38 * side;
        const z = point.z + perpZ * width * 0.38 * side;
        group.add(verticalSupport(x, z, point.y - 0.03, bottom, 0.075, timber));
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(width * 1.12, 0.09, 0.12), timber);
      cap.position.set(point.x, point.y - 0.07, point.z);
      cap.rotation.y = Math.atan2(axisX, axisZ);
      cap.castShadow = true;
      group.add(cap);
    } else {
      const pierWidth = style === 'metal' ? width * 0.42 : width * 0.58;
      const height = Math.max(0.25, point.y - bottom);
      const pier = new THREE.Mesh(new THREE.BoxGeometry(pierWidth, height, style === 'metal' ? 0.18 : 0.28), structuralMaterial);
      pier.position.set(point.x, point.y - height / 2, point.z);
      pier.rotation.y = Math.atan2(axisX, axisZ);
      pier.castShadow = true;
      pier.receiveShadow = true;
      group.add(pier);
    }
  }

  if (style === 'metal') {
    // Sparse side trusses: enough silhouette to read as engineered steel without excessive draw calls.
    const railY = 0.42;
    const samples = Math.max(2, Math.min(6, segment.points.length - 1));
    for (const side of [-1, 1]) {
      let previous: THREE.Vector3 | undefined;
      for (let index = 0; index <= samples; index += 1) {
        const t = index / samples;
        const pointIndex = Math.min(segment.points.length - 1, Math.round(t * (segment.points.length - 1)));
        const point = segment.points[pointIndex]!;
        const current = new THREE.Vector3(point.x + perpX * width * 0.48 * side, point.y + railY, point.z + perpZ * width * 0.48 * side);
        const foot = new THREE.Vector3(current.x, point.y + 0.08, current.z);
        group.add(beamBetween(foot, current, 0.045, metal));
        if (previous) {
          group.add(beamBetween(previous, current, 0.045, metal));
          const diagonalTarget = new THREE.Vector3(current.x, point.y + 0.08, current.z);
          group.add(beamBetween(previous, diagonalTarget, 0.038, metal));
        }
        previous = current;
      }
    }
  }

  return group;
}
