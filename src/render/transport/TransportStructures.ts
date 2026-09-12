import * as THREE from 'three';
import type { TransportSegment } from '../../sim/transport/types';

export interface DockStructureMaterials {
  timber: THREE.Material;
  stone: THREE.Material;
  metal: THREE.Material;
  accent: THREE.Material;
  glow: THREE.Material;
  cloth: THREE.Material;
  shadow: THREE.Material;
}

export interface DockStructureOptions {
  bank: THREE.Vector3;
  water: THREE.Vector3;
  eraRank: number;
  materials: DockStructureMaterials;
  /** Stable identity used for small visual asymmetries without nondeterminism. */
  identity?: string;
  /** 0..1 working intensity. More active harbours accumulate more visible freight. */
  activity?: number;
  /** Terrain height in the same local Y frame as bank/water. */
  groundAt: (x: number, z: number) => number;
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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
  const supportBottom = Math.min(bottomY, topY - 0.12);
  const height = Math.max(0.16, topY - supportBottom);
  const support = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.88, radius, height, 7), material);
  support.position.set(x, topY - height / 2, z);
  support.castShadow = true;
  support.receiveShadow = true;
  return support;
}

function harbourLantern(x: number, y: number, z: number, post: THREE.Material, glow: THREE.Material, accent: THREE.Material): THREE.Group {
  const lantern = new THREE.Group();
  lantern.name = 'harbour-lantern';
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.032, 0.62, 6), post);
  stem.position.set(x, y + 0.31, z);
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), glow);
  light.position.set(x, y + 0.69, z);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.08, 4), accent);
  cap.position.set(x, y + 0.81, z);
  cap.rotation.y = Math.PI / 4;
  stem.castShadow = true;
  light.castShadow = true;
  cap.castShadow = true;
  lantern.add(stem, light, cap);
  return lantern;
}

/**
 * A harbour is a shoreline workplace, not a floating rectangle. The visual grammar deliberately
 * keeps one berth open for boats, while the opposite side accumulates railings, freight, light,
 * shelter and handling gear as the settlement becomes more capable.
 */
export function createDockStructure(options: DockStructureOptions): THREE.Group {
  const { bank, water, eraRank: rank, materials, groundAt } = options;
  const identity = options.identity ?? 'harbour';
  const activity = clamp01(options.activity ?? 0.45);
  const group = new THREE.Group();
  group.name = 'harbour-structure';
  group.userData['portalKind'] = 'dock';
  group.userData['harbourActivity'] = activity;

  const dx = water.x - bank.x;
  const dz = water.z - bank.z;
  const horizontal = Math.max(0.001, Math.hypot(dx, dz));
  const dirX = dx / horizontal;
  const dirZ = dz / horizontal;
  const perpX = -dirZ;
  const perpZ = dirX;
  const yaw = Math.atan2(dirX, dirZ);
  const berthSide = stableUnit(`${identity}:berth`) < 0.5 ? -1 : 1;
  const protectedSide = -berthSide;
  const deckWidth = rank <= 1 ? 0.48 : rank <= 3 ? 0.64 : 0.82;
  const deckThickness = rank >= 4 ? 0.12 : 0.085;
  const waterDeckY = water.y + (rank >= 4 ? 0.17 : 0.13);
  const deckY = Math.min(Math.max(waterDeckY, bank.y - 0.12), waterDeckY + 0.22);
  const rampLength = Math.min(horizontal * 0.34, 0.9);
  const deckStart = new THREE.Vector3(bank.x + dirX * rampLength, deckY, bank.z + dirZ * rampLength);
  const deckEnd = new THREE.Vector3(water.x + dirX * Math.min(0.45, horizontal * 0.18), deckY, water.z + dirZ * Math.min(0.45, horizontal * 0.18));

  if (rank >= 3) {
    const abutment = new THREE.Mesh(new THREE.BoxGeometry(deckWidth * 1.28, 0.36, 0.42), materials.stone);
    abutment.position.set(bank.x + dirX * 0.06, bank.y - 0.12, bank.z + dirZ * 0.06);
    abutment.rotation.y = yaw;
    abutment.castShadow = true;
    abutment.receiveShadow = true;
    group.add(abutment);
  }

  const rampStart = new THREE.Vector3(bank.x, bank.y + 0.08, bank.z);
  const gangway = deckBetween(rampStart, deckStart, deckWidth * 0.9, 0.07, materials.timber);
  gangway.name = 'harbour-gangway';
  group.add(gangway);

  const deckLength = Math.max(0.45, deckStart.distanceTo(deckEnd));
  const deck = new THREE.Mesh(new THREE.BoxGeometry(deckWidth, deckThickness, deckLength), rank >= 4 ? materials.metal : materials.timber);
  deck.name = 'harbour-main-deck';
  deck.position.copy(deckStart).lerp(deckEnd, 0.5);
  deck.rotation.y = yaw;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  if (rank < 4) {
    const plankCount = Math.max(3, Math.min(14, Math.round(deckLength / 0.2)));
    const planks = new THREE.Group();
    planks.name = 'harbour-planks';
    for (let index = 0; index <= plankCount; index += 1) {
      const t = index / plankCount;
      const x = THREE.MathUtils.lerp(deckStart.x, deckEnd.x, t);
      const z = THREE.MathUtils.lerp(deckStart.z, deckEnd.z, t);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(deckWidth * 1.04, 0.025, 0.045), materials.timber);
      plank.position.set(x, deckY + deckThickness * 0.58, z);
      plank.rotation.y = yaw;
      plank.castShadow = true;
      planks.add(plank);
    }
    group.add(planks);
  }

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

  // The landward/protected edge gets a handrail. The berth remains deliberately open.
  if (rank >= 2) {
    const rail = new THREE.Group();
    rail.name = 'harbour-rail';
    const posts: THREE.Vector3[] = [];
    const postCount = Math.max(3, Math.min(6, Math.ceil(deckLength / 0.65)));
    for (let index = 0; index < postCount; index += 1) {
      const t = index / (postCount - 1);
      const x = THREE.MathUtils.lerp(deckStart.x, deckEnd.x, t) + perpX * deckWidth * 0.46 * protectedSide;
      const z = THREE.MathUtils.lerp(deckStart.z, deckEnd.z, t) + perpZ * deckWidth * 0.46 * protectedSide;
      const point = new THREE.Vector3(x, deckY + 0.43, z);
      posts.push(point);
      const post = verticalSupport(x, z, point.y, deckY + deckThickness * 0.35, 0.026, rank >= 4 ? materials.metal : materials.timber);
      rail.add(post);
    }
    for (let index = 1; index < posts.length; index += 1) {
      rail.add(beamBetween(posts[index - 1]!, posts[index]!, rank >= 4 ? 0.025 : 0.032, rank >= 4 ? materials.metal : materials.timber));
    }
    group.add(rail);
  }

  let headWidth = deckWidth;
  let headDepth = 0;
  if (rank >= 2) {
    headWidth = deckWidth * (rank >= 4 ? 2.45 : 2.05);
    headDepth = rank >= 4 ? 0.7 : 0.55;
    const head = new THREE.Mesh(new THREE.BoxGeometry(headWidth, deckThickness, headDepth), rank >= 4 ? materials.metal : materials.timber);
    head.name = 'harbour-working-head';
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

    // Dark fenders break the waterline silhouette and make the berth read immediately.
    const fenders = new THREE.Group();
    fenders.name = 'harbour-fenders';
    for (const along of [-0.32, 0.32]) {
      const fx = deckEnd.x + dirX * along * headDepth + perpX * headWidth * 0.49 * berthSide;
      const fz = deckEnd.z + dirZ * along * headDepth + perpZ * headWidth * 0.49 * berthSide;
      const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.48, 7), materials.shadow);
      fender.position.set(fx, deckY - 0.16, fz);
      fender.castShadow = true;
      fenders.add(fender);
    }
    group.add(fenders);

    // A real working pier needs a ladder to the water, not just a flat platform.
    const ladder = new THREE.Group();
    ladder.name = 'harbour-ladder';
    const ladderX = deckEnd.x + perpX * headWidth * 0.5 * berthSide;
    const ladderZ = deckEnd.z + perpZ * headWidth * 0.5 * berthSide;
    const ladderBottom = water.y - 0.14;
    for (const along of [-0.1, 0.1]) {
      const lx = ladderX + dirX * along;
      const lz = ladderZ + dirZ * along;
      ladder.add(verticalSupport(lx, lz, deckY + 0.18, ladderBottom, 0.018, rank >= 4 ? materials.metal : materials.timber));
    }
    for (let rung = 0; rung < 4; rung += 1) {
      const y = THREE.MathUtils.lerp(ladderBottom + 0.1, deckY + 0.1, rung / 3);
      ladder.add(beamBetween(
        new THREE.Vector3(ladderX - dirX * 0.1, y, ladderZ - dirZ * 0.1),
        new THREE.Vector3(ladderX + dirX * 0.1, y, ladderZ + dirZ * 0.1),
        0.018,
        rank >= 4 ? materials.metal : materials.timber,
      ));
    }
    group.add(ladder);
  }

  // Modest roofed shelter at the shore end: nets and ledgers early, harbour office later.
  if (rank >= 3) {
    const shelter = new THREE.Group();
    shelter.name = 'harbour-shelter';
    const centerX = bank.x + dirX * 0.18 + perpX * deckWidth * 0.95 * protectedSide;
    const centerZ = bank.z + dirZ * 0.18 + perpZ * deckWidth * 0.95 * protectedSide;
    for (const side of [-1, 1]) {
      const px = centerX + dirX * 0.34 * side;
      const pz = centerZ + dirZ * 0.34 * side;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.72, 0.045), materials.timber);
      post.position.set(px, bank.y + 0.36, pz);
      post.castShadow = true;
      shelter.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.64), materials.cloth);
    roof.position.set(centerX, bank.y + 0.76, centerZ);
    roof.rotation.y = yaw;
    roof.rotation.z = protectedSide * 0.05;
    roof.castShadow = true;
    shelter.add(roof);
    group.add(shelter);
  }

  // Freight gives the harbour scale and purpose. Quantity is tied to real route activity input.
  if (rank >= 2) {
    const freight = new THREE.Group();
    freight.name = 'harbour-freight';
    const freightCount = 2 + Math.round(activity * 4);
    for (let index = 0; index < freightCount; index += 1) {
      const jitter = stableUnit(`${identity}:freight:${index}`);
      const along = 0.28 + (index % 3) * 0.18;
      const lateral = protectedSide * (0.05 + (Math.floor(index / 3) * 0.16));
      const x = THREE.MathUtils.lerp(deckStart.x, deckEnd.x, along) + perpX * lateral;
      const z = THREE.MathUtils.lerp(deckStart.z, deckEnd.z, along) + perpZ * lateral;
      const size = 0.13 + jitter * 0.05;
      const cargo = index % 3 === 2
        ? new THREE.Mesh(new THREE.CylinderGeometry(size * 0.46, size * 0.5, size * 1.25, 8), materials.timber)
        : new THREE.Mesh(new THREE.BoxGeometry(size * 1.18, size, size), index === 0 ? materials.accent : materials.timber);
      cargo.position.set(x, deckY + deckThickness * 0.5 + size * 0.5, z);
      cargo.rotation.y = yaw + (jitter - 0.5) * 0.6;
      cargo.castShadow = true;
      freight.add(cargo);
    }
    group.add(freight);
  }

  if (rank >= 3) {
    const lightX = deckEnd.x + perpX * Math.max(deckWidth, headWidth) * 0.38 * protectedSide;
    const lightZ = deckEnd.z + perpZ * Math.max(deckWidth, headWidth) * 0.38 * protectedSide;
    group.add(harbourLantern(lightX, deckY + deckThickness * 0.45, lightZ, rank >= 4 ? materials.metal : materials.timber, materials.glow, materials.accent));
  }

  if (rank >= 4) {
    const crane = new THREE.Group();
    crane.name = 'harbour-crane';
    const craneBase = deckEnd.clone().add(new THREE.Vector3(perpX * deckWidth * 0.72 * protectedSide, 0, perpZ * deckWidth * 0.72 * protectedSide));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.95, 8), materials.metal);
    mast.position.set(craneBase.x, deckY + 0.48, craneBase.z);
    mast.castShadow = true;
    const boomStart = new THREE.Vector3(craneBase.x, deckY + 0.88, craneBase.z);
    const boomEnd = new THREE.Vector3(craneBase.x + dirX * 0.72 - perpX * 0.18 * protectedSide, deckY + 1.04, craneBase.z + dirZ * 0.72 - perpZ * 0.18 * protectedSide);
    const boom = beamBetween(boomStart, boomEnd, 0.07, materials.metal);
    const cableEnd = boomEnd.clone().add(new THREE.Vector3(0, -0.48, 0));
    const cable = beamBetween(boomEnd, cableEnd, 0.015, materials.shadow);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 5, 8, Math.PI * 1.45), materials.metal);
    hook.position.copy(cableEnd);
    hook.rotation.z = Math.PI / 2;
    crane.add(mast, boom, cable, hook);
    group.add(crane);
  }

  group.userData['harbourStyle'] = rank >= 4 ? 'industrial-pier' : rank >= 3 ? 'quay-pier' : rank >= 2 ? 'working-pier' : 'timber-landing';
  group.userData['berthSide'] = berthSide;
  return group;
}

function transportMaterialStyle(segment: TransportSegment): 'timber' | 'masonry' | 'metal' {
  const spent = segment.materialSpent ?? {};
  const metal = (spent.steel ?? 0) + (spent.iron ?? 0) + (spent.bronze ?? 0);
  const timber = (spent.lumber ?? 0) + (spent.timber ?? 0);
  const masonry = (spent.stone ?? 0) + (spent.brick ?? 0);
  // Foundation masonry is required for every typed bridge, so it must not mask the material
  // actually carrying the span. Construction consumes metal before timber when available.
  if (metal > 0.0001) return 'metal';
  if (timber > 0.0001) return 'timber';
  if (masonry > 0.0001) return 'masonry';
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
  const yaw = Math.atan2(axisX, axisZ);

  const abutments = new THREE.Group();
  abutments.name = 'bridge-abutments';
  for (const point of [first, last]) {
    const bottom = groundAt(point.x, point.z);
    const height = Math.max(0.28, point.y - bottom + 0.14);
    const abutment = new THREE.Mesh(new THREE.BoxGeometry(width * 1.18, height, 0.28), stone);
    abutment.position.set(point.x, point.y - height / 2 + 0.04, point.z);
    abutment.rotation.y = yaw;
    abutment.castShadow = true;
    abutment.receiveShadow = true;
    abutments.add(abutment);
  }
  group.add(abutments);

  const supports = new THREE.Group();
  supports.name = 'bridge-supports';
  const braces = new THREE.Group();
  braces.name = 'bridge-bracing';
  const supportCount = Math.max(1, Math.min(5, Math.floor(segment.length / 2.6)));
  for (let index = 1; index <= supportCount; index += 1) {
    const t = index / (supportCount + 1);
    const pointIndex = Math.min(segment.points.length - 1, Math.max(0, Math.round(t * (segment.points.length - 1))));
    const point = segment.points[pointIndex]!;
    const bottom = groundAt(point.x, point.z);
    if (style === 'timber') {
      const feet: THREE.Vector3[] = [];
      for (const side of [-1, 1]) {
        const x = point.x + perpX * width * 0.38 * side;
        const z = point.z + perpZ * width * 0.38 * side;
        supports.add(verticalSupport(x, z, point.y - 0.03, bottom, 0.075, timber));
        feet.push(new THREE.Vector3(x, Math.min(bottom + 0.12, point.y - 0.28), z));
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(width * 1.12, 0.09, 0.12), timber);
      cap.position.set(point.x, point.y - 0.07, point.z);
      cap.rotation.y = yaw;
      cap.castShadow = true;
      supports.add(cap);
      if (feet.length === 2) {
        const leftTop = new THREE.Vector3(point.x + perpX * width * 0.36, point.y - 0.08, point.z + perpZ * width * 0.36);
        const rightTop = new THREE.Vector3(point.x - perpX * width * 0.36, point.y - 0.08, point.z - perpZ * width * 0.36);
        braces.add(beamBetween(feet[0]!, rightTop, 0.045, timber));
        braces.add(beamBetween(feet[1]!, leftTop, 0.045, timber));
      }
    } else {
      const pierWidth = style === 'metal' ? width * 0.42 : width * 0.58;
      const height = Math.max(0.25, point.y - bottom);
      const pier = new THREE.Mesh(new THREE.BoxGeometry(pierWidth, height, style === 'metal' ? 0.18 : 0.28), structuralMaterial);
      pier.position.set(point.x, point.y - height / 2, point.z);
      pier.rotation.y = yaw;
      pier.castShadow = true;
      pier.receiveShadow = true;
      supports.add(pier);
    }
  }
  group.add(supports);
  if (braces.children.length > 0) group.add(braces);

  const edge = new THREE.Group();
  edge.name = 'bridge-edge-detail';
  if (style === 'masonry') {
    // Low parapets make a masonry bridge read as deliberately engineered rather than a road strip.
    for (const side of [-1, 1]) {
      for (let index = 1; index < segment.points.length; index += 1) {
        const previous = segment.points[index - 1]!;
        const point = segment.points[index]!;
        edge.add(beamBetween(
          new THREE.Vector3(previous.x + perpX * width * 0.52 * side, previous.y + 0.2, previous.z + perpZ * width * 0.52 * side),
          new THREE.Vector3(point.x + perpX * width * 0.52 * side, point.y + 0.2, point.z + perpZ * width * 0.52 * side),
          0.1,
          stone,
        ));
      }
    }
  } else if (style === 'timber') {
    const sampleStep = Math.max(1, Math.ceil(segment.points.length / 8));
    for (const side of [-1, 1]) {
      let previousTop: THREE.Vector3 | undefined;
      for (let index = 0; index < segment.points.length; index += sampleStep) {
        const point = segment.points[index]!;
        const x = point.x + perpX * width * 0.5 * side;
        const z = point.z + perpZ * width * 0.5 * side;
        const top = new THREE.Vector3(x, point.y + 0.34, z);
        edge.add(verticalSupport(x, z, top.y, point.y + 0.05, 0.025, timber));
        if (previousTop) edge.add(beamBetween(previousTop, top, 0.03, timber));
        previousTop = top;
      }
      const lastPoint = segment.points[segment.points.length - 1]!;
      const finalTop = new THREE.Vector3(lastPoint.x + perpX * width * 0.5 * side, lastPoint.y + 0.34, lastPoint.z + perpZ * width * 0.5 * side);
      if (previousTop && previousTop.distanceTo(finalTop) > 0.08) edge.add(beamBetween(previousTop, finalTop, 0.03, timber));
    }
  }
  if (edge.children.length > 0) group.add(edge);

  if (style === 'metal') {
    const truss = new THREE.Group();
    truss.name = 'bridge-metal-truss';
    const railY = segment.mode === 'rail' ? 0.54 : 0.44;
    const samples = Math.max(2, Math.min(8, segment.points.length - 1));
    const portalPoints: Array<{ left: THREE.Vector3; right: THREE.Vector3; deckY: number }> = [];
    for (let index = 0; index <= samples; index += 1) {
      const pointIndex = Math.min(segment.points.length - 1, Math.round(index / samples * (segment.points.length - 1)));
      const point = segment.points[pointIndex]!;
      portalPoints.push({
        left: new THREE.Vector3(point.x + perpX * width * 0.51, point.y + railY, point.z + perpZ * width * 0.51),
        right: new THREE.Vector3(point.x - perpX * width * 0.51, point.y + railY, point.z - perpZ * width * 0.51),
        deckY: point.y,
      });
    }
    for (const side of [-1, 1]) {
      let previousTop: THREE.Vector3 | undefined;
      for (const portal of portalPoints) {
        const current = side === 1 ? portal.left : portal.right;
        const foot = new THREE.Vector3(current.x, portal.deckY + 0.08, current.z);
        truss.add(beamBetween(foot, current, 0.045, metal));
        if (previousTop) {
          truss.add(beamBetween(previousTop, current, 0.045, metal));
          truss.add(beamBetween(previousTop, foot, 0.038, metal));
        }
        previousTop = current;
      }
    }
    // Every other frame gets an overhead tie: a strong silhouette at medium camera distance.
    for (let index = 0; index < portalPoints.length; index += 2) {
      const portal = portalPoints[index]!;
      truss.add(beamBetween(portal.left, portal.right, 0.038, metal));
    }
    group.add(truss);
  }

  if (segment.mode === 'rail') {
    const sleepers = new THREE.Group();
    sleepers.name = 'bridge-rail-sleepers';
    const count = Math.max(4, Math.min(18, Math.ceil(segment.length / 0.42)));
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const pointIndex = Math.min(segment.points.length - 1, Math.round(t * (segment.points.length - 1)));
      const point = segment.points[pointIndex]!;
      const previous = segment.points[Math.max(0, pointIndex - 1)]!;
      const next = segment.points[Math.min(segment.points.length - 1, pointIndex + 1)]!;
      const sleeperYaw = Math.atan2(next.x - previous.x, next.z - previous.z);
      const sleeper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, 0.045, 0.16), timber);
      sleeper.position.set(point.x, point.y + 0.055, point.z);
      sleeper.rotation.y = sleeperYaw;
      sleeper.castShadow = true;
      sleepers.add(sleeper);
    }
    group.add(sleepers);
  }

  // Paired approach markers give every completed span a readable threshold at either bank.
  const thresholds = new THREE.Group();
  thresholds.name = 'bridge-thresholds';
  for (const point of [first, last]) {
    for (const side of [-1, 1]) {
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.12), style === 'metal' ? metal : stone);
      marker.position.set(point.x + perpX * width * 0.58 * side, point.y + 0.17, point.z + perpZ * width * 0.58 * side);
      marker.castShadow = true;
      thresholds.add(marker);
    }
  }
  group.add(thresholds);

  return group;
}
