import * as THREE from 'three';
import { GodboxRenderer } from '../GodboxRenderer';
import type { MemorialSite } from '../../sim/development/types';
import type { Settlement, SimulationState, StructurePlot, Vec2 } from '../../sim/types';
import { WalkabilityLayer } from '../../sim/people/WalkabilityLayer';
import { boundedStreetRoute, densifyStreetRoute } from './SettlementPathGeometry';

export interface MemorialLandscapeProfile {
  radiusScale: number;
  boundaryElements: number;
  treeCount: number;
  shrubCount: number;
  pathWidth: number;
  gateHeight: number;
  language: 'burial-field' | 'ancestor-grove' | 'cairn-garden' | 'stela-court';
}

interface RendererInternals {
  state: SimulationState;
  elevationAt: (x: number, z: number) => number;
}

interface SettlementVisualLike {
  group: THREE.Group;
}

type CreateSettlementVisual = (this: GodboxRenderer, settlement: Settlement) => SettlementVisualLike;

const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));

function stableUnit(identity: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function angularDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

export function memorialLandscapeProfile(memorial: MemorialSite, condition = 1): MemorialLandscapeProfile {
  const age = Math.max(0, Math.min(4, Math.floor(memorial.ageBand)));
  const integrity = 0.55 + clamp(condition) * 0.45;
  switch (memorial.form) {
    case 'ancestor-posts':
      return {
        radiusScale: 0.9,
        boundaryElements: Math.max(5, Math.round((7 + age) * integrity)),
        treeCount: 1 + age,
        shrubCount: 2 + age * 2,
        pathWidth: 0.2,
        gateHeight: 0.72,
        language: 'ancestor-grove',
      };
    case 'stone-cairns':
      return {
        radiusScale: 0.88,
        boundaryElements: Math.max(6, Math.round((9 + age) * integrity)),
        treeCount: Math.max(0, age - 2),
        shrubCount: 1 + age,
        pathWidth: 0.18,
        gateHeight: 0.5,
        language: 'cairn-garden',
      };
    case 'stelae':
      return {
        radiusScale: 0.92,
        boundaryElements: Math.max(8, Math.round((11 + age * 2) * integrity)),
        treeCount: Math.floor(age / 2),
        shrubCount: 2 + age,
        pathWidth: 0.23,
        gateHeight: 0.78,
        language: 'stela-court',
      };
    case 'earth-mounds':
    default:
      return {
        radiusScale: 0.9,
        boundaryElements: Math.max(4, Math.round((6 + age) * integrity)),
        treeCount: Math.max(0, age - 1),
        shrubCount: 3 + age * 3,
        pathWidth: 0.17,
        gateHeight: 0.42,
        language: 'burial-field',
      };
  }
}

function mutedGroundColour(memorial: MemorialSite): THREE.Color {
  const base = memorial.form === 'ancestor-posts' ? '#4d5840'
    : memorial.form === 'stone-cairns' ? '#5a5a50'
      : memorial.form === 'stelae' ? '#545047' : '#615844';
  const colour = new THREE.Color(base);
  const age = Math.max(0, Math.min(4, memorial.ageBand));
  colour.offsetHSL(0, -age * 0.018, -age * 0.012);
  return colour;
}

function createTerrainPatch(
  settlement: Settlement,
  plot: StructurePlot,
  memorial: MemorialSite,
  settlementY: number,
  elevationAt: (x: number, z: number) => number,
  radius: number,
): THREE.Mesh {
  const segments = memorial.form === 'stelae' ? 28 : 24;
  const ratioX = memorial.form === 'stelae' ? 1.04 : memorial.form === 'ancestor-posts' ? 0.94 : 1;
  const ratioZ = memorial.form === 'earth-mounds' ? 0.9 : memorial.form === 'stone-cairns' ? 0.94 : 1;
  const positions: number[] = [];
  const colours: number[] = [];
  const base = mutedGroundColour(memorial);
  const age = Math.max(0, Math.min(4, memorial.ageBand));
  const centerY = elevationAt(plot.worldX, plot.worldZ) - settlementY + 0.016;
  const centerColour = base.clone().offsetHSL(0, -0.015 * age, 0.015);
  for (let index = 0; index < segments; index += 1) {
    const a = index / segments * Math.PI * 2;
    const b = (index + 1) / segments * Math.PI * 2;
    const edgeA = 0.965 + (stableUnit(\`${plot.id}:ground-a:${index}\`) - 0.5) * (memorial.form === 'stelae' ? 0.025 : 0.085);
    const edgeB = 0.965 + (stableUnit(\`${plot.id}:ground-b:${index}\`) - 0.5) * (memorial.form === 'stelae' ? 0.025 : 0.085);
    const ax = Math.cos(a) * radius * ratioX * edgeA;
    const az = Math.sin(a) * radius * ratioZ * edgeA;
    const bx = Math.cos(b) * radius * ratioX * edgeB;
    const bz = Math.sin(b) * radius * ratioZ * edgeB;
    const ay = elevationAt(plot.worldX + ax, plot.worldZ + az) - settlementY + 0.016;
    const by = elevationAt(plot.worldX + bx, plot.worldZ + bz) - settlementY + 0.016;
    positions.push(0, centerY, 0, ax, ay, az, bx, by, bz);
    const variation = (stableUnit(\`${plot.id}:ground-colour:${index}\`) - 0.5) * 0.05;
    const edgeColour = base.clone().offsetHSL(0, -age * 0.006, variation - age * 0.006);
    for (const colour of [centerColour, edgeColour, edgeColour]) colours.push(colour.r, colour.g, colour.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const ground = new THREE.Mesh(geometry, material);
  ground.name = 'memorial-ground';
  ground.position.set(plot.worldX - settlement.position.x, 0, plot.worldZ - settlement.position.z);
  ground.receiveShadow = true;
  ground.userData['memorialGround'] = true;
  ground.userData['terrainIntegrated'] = true;
  ground.userData['ageBand'] = age;
  return ground;
}

function createTerrainPath(function createTerrainPath(
  settlement: Settlement,
  route: readonly Vec2[],
  settlementY: number,
  elevationAt: (x: number, z: number) => number,
  width: number,
  memorial: MemorialSite,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'memorial-access-path';
  const material = new THREE.MeshStandardMaterial({
    color: memorial.form === 'stelae' ? '#756d5d' : '#6f5b43',
    roughness: 1,
    metalness: 0,
  });
  const samples = densifyStreetRoute(route, 0.34);
  let previous: THREE.Vector3 | undefined;
  let tiles = 0;
  for (const point of samples) {
    const current = new THREE.Vector3(
      point.x - settlement.position.x,
      elevationAt(point.x, point.z) - settlementY + 0.024,
      point.z - settlement.position.z,
    );
    if (!previous) {
      previous = current;
      continue;
    }
    const delta = current.clone().sub(previous);
    const horizontal = Math.hypot(delta.x, delta.z);
    if (horizontal < 0.025 || horizontal > 0.7 || Math.abs(delta.y) / horizontal > 0.72) {
      previous = current;
      continue;
    }
    const length = Math.max(0.035, delta.length());
    const tile = new THREE.Mesh(new THREE.BoxGeometry(width, 0.022, length), material);
    tile.name = 'memorial-path-tile';
    tile.position.copy(previous).add(current).multiplyScalar(0.5);
    tile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), delta.normalize());
    tile.receiveShadow = true;
    tile.userData['memorialPath'] = true;
    group.add(tile);
    previous = current;
    tiles += 1;
  }
  group.userData['pathTiles'] = tiles;
  return group;
}

function memorialWeathering(memorial: MemorialSite, condition: number): number {
  const age = Math.max(0, Math.min(4, memorial.ageBand)) / 4;
  return clamp(age * 0.72 + (1 - clamp(condition)) * 0.5);
}

function createBoundaryElement(
  form: MemorialSite['form'],
  material: THREE.Material,
  index: number,
  weathering: number,
  identity: string,
): THREE.Object3D {
  const lean = (stableUnit(\`${identity}:lean:${index}\`) - 0.5) * weathering * 0.22;
  if (form === 'ancestor-posts') {
    const group = new THREE.Group();
    group.name = 'memorial-boundary-post';
    const height = 0.48 + (index % 3) * 0.075;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.07, height, 6), material);
    post.position.y = height / 2;
    post.castShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.045, 0.07), material);
    cap.position.y = height * 0.82;
    cap.rotation.y = (stableUnit(\`${identity}:cap:${index}\`) - 0.5) * 0.3;
    cap.castShadow = true;
    group.add(post, cap);
    group.rotation.z = lean;
    return group;
  }
  if (form === 'stelae') {
    const group = new THREE.Group();
    group.name = 'memorial-boundary-wall';
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, 0.17), material);
    base.position.y = 0.045;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18 + (index % 2) * 0.04, 0.105), material);
    wall.position.y = 0.15;
    base.castShadow = wall.castShadow = true;
    base.receiveShadow = wall.receiveShadow = true;
    group.add(base, wall);
    group.rotation.z = lean * 0.45;
    return group;
  }
  if (form === 'stone-cairns') {
    const cairn = new THREE.Group();
    cairn.name = 'memorial-boundary-cairn';
    for (let layer = 0; layer < 3; layer += 1) {
      const size = 0.125 - layer * 0.025;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), material);
      stone.position.set(
        (stableUnit(\`${identity}:cairn-x:${index}:${layer}\`) - 0.5) * 0.045,
        size * 0.75 + layer * 0.105,
        (stableUnit(\`${identity}:cairn-z:${index}:${layer}\`) - 0.5) * 0.045,
      );
      stone.rotation.set(
        stableUnit(\`${identity}:cairn-rx:${index}:${layer}\`) * 0.5,
        stableUnit(\`${identity}:cairn-ry:${index}:${layer}\`) * Math.PI,
        stableUnit(\`${identity}:cairn-rz:${index}:${layer}\`) * 0.5,
      );
      stone.scale.y = 0.7 + stableUnit(\`${identity}:cairn-sy:${index}:${layer}\`) * 0.35;
      stone.castShadow = true;
      cairn.add(stone);
    }
    cairn.rotation.z = lean * 0.3;
    return cairn;
  }
  const group = new THREE.Group();
  group.name = 'memorial-boundary-stone';
  const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.095 + (index % 2) * 0.025, 0), material);
  stone.position.y = 0.075;
  stone.scale.set(1.25, 0.72, 0.9);
  stone.rotation.set(0.08, stableUnit(\`${identity}:stone-y:${index}\`) * Math.PI, lean);
  stone.castShadow = true;
  group.add(stone);
  return group;
}

function addBoundaryAndEntrance(function addBoundaryAndEntrance(
  root: THREE.Group,
  settlement: Settlement,
  plot: StructurePlot,
  memorial: MemorialSite,
  settlementY: number,
  elevationAt: (x: number, z: number) => number,
  radius: number,
  profile: MemorialLandscapeProfile,
): void {
  const stone = new THREE.MeshStandardMaterial({ color: '#69655d', roughness: 0.96 });
  const timber = new THREE.MeshStandardMaterial({ color: '#514132', roughness: 0.98 });
  const boundaryMaterial = memorial.form === 'ancestor-posts' ? timber : stone;
  const weathering = memorialWeathering(memorial, plot.condition);
  const gateAngle = Math.atan2(settlement.position.z - plot.worldZ, settlement.position.x - plot.worldX);
  const siteX = plot.worldX - settlement.position.x;
  const siteZ = plot.worldZ - settlement.position.z;
  const boundary = new THREE.Group();
  boundary.name = 'memorial-boundary';
  let emitted = 0;

  for (let index = 0; index < profile.boundaryElements; index += 1) {
    const jitter = (stableUnit(`${plot.id}:boundary:${index}`) - 0.5) * (memorial.form === 'stelae' ? 0.035 : 0.14);
    const angle = index / profile.boundaryElements * Math.PI * 2 + jitter;
    if (angularDistance(angle, gateAngle) < 0.34) continue;
    const r = radius * (0.94 + (stableUnit(`${plot.id}:radius:${index}`) - 0.5) * 0.06);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const element = createBoundaryElement(memorial.form, boundaryMaterial, index, weathering, plot.id);
    const worldX = plot.worldX + x;
    const worldZ = plot.worldZ + z;
    const baseY = elevationAt(worldX, worldZ) - settlementY;
    element.position.set(siteX + x, baseY + (memorial.form === 'stelae' ? 0 : memorial.form === 'ancestor-posts' ? 0 : 0.015), siteZ + z);
    element.rotation.y = memorial.form === 'stelae' ? Math.PI / 2 - angle : 0;
    boundary.add(element);
    emitted += 1;
  }

  const radialX = Math.cos(gateAngle);
  const radialZ = Math.sin(gateAngle);
  const tangentX = -radialZ;
  const tangentZ = radialX;
  const gateRadius = radius * 0.93;
  const gateMaterial = memorial.form === 'ancestor-posts' ? timber : stone;
  const gate = new THREE.Group();
  gate.name = 'memorial-entrance';
  const half = memorial.form === 'stelae' ? 0.34 : 0.28;
  for (const side of [-1, 1]) {
    const x = radialX * gateRadius + tangentX * half * side;
    const z = radialZ * gateRadius + tangentZ * half * side;
    const y = elevationAt(plot.worldX + x, plot.worldZ + z) - settlementY;
    const post = new THREE.Mesh(
      memorial.form === 'earth-mounds'
        ? new THREE.DodecahedronGeometry(0.13, 0)
        : new THREE.BoxGeometry(0.075, profile.gateHeight, 0.075),
      gateMaterial,
    );
    post.name = 'memorial-entrance-post';
    post.position.set(siteX + x, y + (memorial.form === 'earth-mounds' ? 0.1 : profile.gateHeight / 2), siteZ + z);
    post.castShadow = true;
    gate.add(post);
  }
  if (memorial.sacred || memorial.form === 'ancestor-posts' || memorial.form === 'stelae') {
    const centerX = radialX * gateRadius;
    const centerZ = radialZ * gateRadius;
    const y = elevationAt(plot.worldX + centerX, plot.worldZ + centerZ) - settlementY;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(half * 2.45, 0.07, 0.09), gateMaterial);
    lintel.name = 'memorial-entrance-lintel';
    lintel.position.set(siteX + centerX, y + profile.gateHeight, siteZ + centerZ);
    lintel.rotation.y = Math.PI / 2 - gateAngle;
    lintel.castShadow = true;
    gate.add(lintel);
    const accent = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.045, 0.045),
      new THREE.MeshStandardMaterial({ color: plot.development?.style.accent ?? '#c9aa68', roughness: 0.82 }),
    );
    accent.name = 'memorial-entrance-accent';
    accent.position.copy(lintel.position);
    accent.position.y += 0.065;
    accent.rotation.y = lintel.rotation.y;
    gate.add(accent);
  }
  boundary.userData['boundaryElements'] = emitted;
  root.add(boundary, gate);
}

function addVegetation(
  root: THREE.Group,
  settlement: Settlement,
  plot: StructurePlot,
  memorial: MemorialSite,
  settlementY: number,
  elevationAt: (x: number, z: number) => number,
  radius: number,
  profile: MemorialLandscapeProfile,
): void {
  const age = Math.max(0, Math.min(4, memorial.ageBand));
  const weathering = memorialWeathering(memorial, plot.condition);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#4b3b2f', roughness: 1 });
  const foliageMaterial = new THREE.MeshStandardMaterial({
    color: memorial.form === 'ancestor-posts' ? '#334b37' : '#3e5139',
    roughness: 1,
  });
  const shrubMaterial = new THREE.MeshStandardMaterial({ color: '#46583d', roughness: 1 });
  const siteX = plot.worldX - settlement.position.x;
  const siteZ = plot.worldZ - settlement.position.z;
  const gateAngle = Math.atan2(settlement.position.z - plot.worldZ, settlement.position.x - plot.worldX);

  for (let index = 0; index < profile.treeCount; index += 1) {
    let angle = stableUnit(\`${plot.id}:tree-angle:${index}\`) * Math.PI * 2;
    if (angularDistance(angle, gateAngle) < 0.48) angle += 0.72;
    const radial = radius * (0.6 + stableUnit(\`${plot.id}:tree-radius:${index}\`) * 0.25);
    const x = Math.cos(angle) * radial;
    const z = Math.sin(angle) * radial;
    const ground = elevationAt(plot.worldX + x, plot.worldZ + z) - settlementY;
    const maturity = 0.4 + age * 0.12 + stableUnit(\`${plot.id}:tree-size:${index}\`) * 0.14;
    const height = 0.72 + maturity * 1.05;
    const tree = new THREE.Group();
    tree.name = 'memorial-tree';
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035 + maturity * 0.025, 0.058 + maturity * 0.032, height * 0.62, 7), trunkMaterial);
    trunk.position.y = height * 0.31;
    trunk.rotation.z = (stableUnit(\`${plot.id}:tree-lean:${index}\`) - 0.5) * 0.08;
    trunk.castShadow = true;
    tree.add(trunk);
    const crownCount = memorial.form === 'ancestor-posts' ? 4 : 3;
    for (let crownIndex = 0; crownIndex < crownCount; crownIndex += 1) {
      const crownSize = 0.18 + maturity * (0.13 + crownIndex * 0.015);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(crownSize, 1), foliageMaterial);
      const phase = crownIndex / crownCount * Math.PI * 2 + stableUnit(\`${plot.id}:crown-phase:${index}\`) * 0.8;
      crown.position.set(
        Math.cos(phase) * crownSize * 0.52,
        height * (0.64 + crownIndex * 0.075),
        Math.sin(phase) * crownSize * 0.42,
      );
      crown.scale.set(1.12, 0.84 + crownIndex * 0.05, 1);
      crown.castShadow = true;
      tree.add(crown);
    }
    tree.position.set(siteX + x, ground, siteZ + z);
    tree.rotation.y = stableUnit(\`${plot.id}:tree-yaw:${index}\`) * Math.PI * 2;
    root.add(tree);
  }

  for (let index = 0; index < profile.shrubCount; index += 1) {
    let angle = stableUnit(\`${plot.id}:shrub-angle:${index}\`) * Math.PI * 2;
    if (angularDistance(angle, gateAngle) < 0.34) angle += 0.5;
    const radial = radius * (0.42 + stableUnit(\`${plot.id}:shrub-radius:${index}\`) * 0.46);
    const x = Math.cos(angle) * radial;
    const z = Math.sin(angle) * radial;
    const ground = elevationAt(plot.worldX + x, plot.worldZ + z) - settlementY;
    const size = 0.07 + stableUnit(\`${plot.id}:shrub-size:${index}\`) * (0.06 + age * 0.012);
    const shrub = new THREE.Group();
    shrub.name = 'memorial-shrub';
    for (let lobe = 0; lobe < 3; lobe += 1) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(size * (0.82 + lobe * 0.08), 0), shrubMaterial);
      const phase = lobe / 3 * Math.PI * 2;
      leaf.position.set(Math.cos(phase) * size * 0.65, size * (0.55 + lobe * 0.12), Math.sin(phase) * size * 0.65);
      leaf.scale.y = 0.7 + stableUnit(\`${plot.id}:shrub-shape:${index}:${lobe}\`) * 0.5;
      leaf.castShadow = true;
      shrub.add(leaf);
    }
    shrub.position.set(siteX + x, ground, siteZ + z);
    root.add(shrub);
  }

  if (weathering > 0.35) {
    const litterMaterial = new THREE.MeshStandardMaterial({ color: '#504a38', roughness: 1 });
    const litterCount = Math.min(10, 2 + Math.floor(weathering * 10));
    for (let index = 0; index < litterCount; index += 1) {
      const angle = stableUnit(\`${plot.id}:litter-angle:${index}\`) * Math.PI * 2;
      const radial = radius * (0.18 + stableUnit(\`${plot.id}:litter-radius:${index}\`) * 0.64);
      const x = Math.cos(angle) * radial;
      const z = Math.sin(angle) * radial;
      const y = elevationAt(plot.worldX + x, plot.worldZ + z) - settlementY + 0.02;
      const patch = new THREE.Mesh(new THREE.CircleGeometry(0.035 + stableUnit(\`${plot.id}:litter-size:${index}\`) * 0.055, 6), litterMaterial);
      patch.name = 'memorial-age-litter';
      patch.rotation.x = -Math.PI / 2;
      patch.rotation.z = stableUnit(\`${plot.id}:litter-yaw:${index}\`) * Math.PI;
      patch.scale.y = 0.55;
      patch.position.set(siteX + x, y, siteZ + z);
      patch.receiveShadow = true;
      root.add(patch);
    }
  }
}

function addCulturalDetails(
  root: THREE.Group,
  settlement: Settlement,
  plot: StructurePlot,
  memorial: MemorialSite,
  settlementY: number,
  elevationAt: (x: number, z: number) => number,
  radius: number,
): void {
  const siteX = plot.worldX - settlement.position.x;
  const siteZ = plot.worldZ - settlement.position.z;
  const age = Math.max(0, Math.min(4, memorial.ageBand));
  const weathering = memorialWeathering(memorial, plot.condition);
  const communal = Math.min(12, Math.ceil(Math.log2(1 + memorial.deaths)));
  const count = Math.max(memorial.events.length > 0 ? 3 : 2, Math.min(14, communal + memorial.people.length));
  const stone = new THREE.MeshStandardMaterial({ color: '#747067', roughness: 0.98 });
  const paleStone = new THREE.MeshStandardMaterial({ color: '#8a8478', roughness: 0.96 });
  const earth = new THREE.MeshStandardMaterial({ color: '#665b43', roughness: 1 });
  const timber = new THREE.MeshStandardMaterial({ color: '#5a4330', roughness: 1 });
  const moss = new THREE.MeshStandardMaterial({ color: '#48543d', roughness: 1 });
  let weatheringAccents = 0;

  const place = (object: THREE.Object3D, x: number, z: number, lift = 0): void => {
    object.position.set(
      siteX + x,
      elevationAt(plot.worldX + x, plot.worldZ + z) - settlementY + lift,
      siteZ + z,
    );
    root.add(object);
  };

  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / 5);
    const column = index % 5;
    const ordered = memorial.form === 'stelae' || memorial.form === 'earth-mounds';
    const angle = index * 2.399 + stableUnit(\`${plot.id}:detail-angle:${index}\`) * 0.35;
    const radial = radius * (0.22 + Math.sqrt(index + 1) / Math.sqrt(count + 1) * 0.48);
    let x = ordered ? (column - 2) * radius * 0.23 : Math.cos(angle) * radial;
    let z = ordered ? (row - (Math.ceil(count / 5) - 1) / 2) * radius * 0.22 : Math.sin(angle) * radial;
    x += (stableUnit(\`${plot.id}:detail-x:${index}\`) - 0.5) * (ordered ? 0.09 : 0.13);
    z += (stableUnit(\`${plot.id}:detail-z:${index}\`) - 0.5) * (ordered ? 0.08 : 0.13);
    const named = index >= Math.max(0, count - memorial.people.length);
    const lean = (stableUnit(\`${plot.id}:detail-lean:${index}\`) - 0.5) * weathering * 0.26;

    if (memorial.form === 'earth-mounds') {
      const marker = new THREE.Group();
      marker.name = 'memorial-burial-mound';
      const mound = new THREE.Mesh(new THREE.SphereGeometry(0.21 + (named ? 0.025 : 0), 10, 6), earth);
      mound.scale.set(1, 0.22 + stableUnit(\`${plot.id}:mound-height:${index}\`) * 0.08, 1.35);
      mound.position.y = 0.035;
      mound.castShadow = mound.receiveShadow = true;
      marker.add(mound);
      const headstone = new THREE.Mesh(new THREE.DodecahedronGeometry(named ? 0.085 : 0.06, 0), named ? paleStone : stone);
      headstone.scale.set(0.82, 1.15, 0.58);
      headstone.position.set(0, 0.09, -0.17);
      headstone.rotation.z = lean;
      headstone.castShadow = true;
      marker.add(headstone);
      marker.rotation.y = Math.atan2(-x, -z) + (stableUnit(\`${plot.id}:mound-yaw:${index}\`) - 0.5) * 0.16;
      place(marker, x, z, 0.005);
    } else if (memorial.form === 'ancestor-posts') {
      const marker = new THREE.Group();
      marker.name = 'memorial-ancestor-post';
      const height = 0.38 + (named ? 0.12 : 0) + stableUnit(\`${plot.id}:ancestor-height:${index}\`) * 0.16;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, height, 7), timber);
      post.position.y = height / 2;
      post.castShadow = true;
      const shoulders = new THREE.Mesh(new THREE.BoxGeometry(named ? 0.2 : 0.14, 0.045, 0.055), timber);
      shoulders.position.y = height * 0.72;
      shoulders.rotation.y = (stableUnit(\`${plot.id}:ancestor-shoulders:${index}\`) - 0.5) * 0.25;
      shoulders.castShadow = true;
      marker.add(post, shoulders);
      if (named) {
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.09, 5), paleStone);
        crown.position.y = height + 0.035;
        crown.rotation.y = stableUnit(\`${plot.id}:ancestor-crown:${index}\`) * Math.PI;
        crown.castShadow = true;
        marker.add(crown);
      }
      marker.rotation.z = lean * 0.75;
      marker.rotation.y = stableUnit(\`${plot.id}:ancestor-yaw:${index}\`) * Math.PI * 2;
      place(marker, x, z);
    } else if (memorial.form === 'stone-cairns') {
      const marker = new THREE.Group();
      marker.name = 'memorial-cairn-stack';
      const layers = named ? 5 : 4;
      for (let layer = 0; layer < layers; layer += 1) {
        const size = 0.105 - layer * 0.012 + (named ? 0.01 : 0);
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), layer === layers - 1 && named ? paleStone : stone);
        rock.position.set(
          (stableUnit(\`${plot.id}:stack-x:${index}:${layer}\`) - 0.5) * 0.055,
          0.055 + layer * 0.095,
          (stableUnit(\`${plot.id}:stack-z:${index}:${layer}\`) - 0.5) * 0.055,
        );
        rock.scale.set(1.08, 0.62 + stableUnit(\`${plot.id}:stack-y:${index}:${layer}\`) * 0.28, 0.92);
        rock.rotation.set(
          stableUnit(\`${plot.id}:stack-rx:${index}:${layer}\`) * 0.4,
          stableUnit(\`${plot.id}:stack-ry:${index}:${layer}\`) * Math.PI,
          stableUnit(\`${plot.id}:stack-rz:${index}:${layer}\`) * 0.4,
        );
        rock.castShadow = true;
        marker.add(rock);
      }
      marker.rotation.z = lean * 0.35;
      place(marker, x, z);
    } else {
      const marker = new THREE.Group();
      marker.name = 'memorial-stela-marker';
      const base = new THREE.Mesh(new THREE.BoxGeometry(named ? 0.28 : 0.23, 0.075, named ? 0.19 : 0.16), stone);
      base.position.y = 0.038;
      base.castShadow = base.receiveShadow = true;
      const slabHeight = 0.32 + (named ? 0.12 : 0) + stableUnit(\`${plot.id}:stela-height:${index}\`) * 0.08;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(named ? 0.2 : 0.16, slabHeight, 0.075), named ? paleStone : stone);
      slab.position.y = 0.075 + slabHeight / 2;
      slab.castShadow = true;
      marker.add(base, slab);
      const cap = new THREE.Mesh(new THREE.BoxGeometry((named ? 0.2 : 0.16) * 1.12, 0.04, 0.09), stone);
      cap.position.y = 0.075 + slabHeight;
      cap.castShadow = true;
      marker.add(cap);
      marker.rotation.z = lean * 0.55;
      marker.rotation.y = (stableUnit(\`${plot.id}:stela-yaw:${index}\`) - 0.5) * 0.12;
      place(marker, x, z);
    }

    if (weathering > 0.28 && stableUnit(\`${plot.id}:moss:${index}\`) < weathering * 0.75) {
      const patch = new THREE.Mesh(new THREE.CircleGeometry(0.045 + stableUnit(\`${plot.id}:moss-size:${index}\`) * 0.045, 7), moss);
      patch.name = 'memorial-weathering-accent';
      patch.rotation.x = -Math.PI / 2;
      patch.rotation.z = stableUnit(\`${plot.id}:moss-yaw:${index}\`) * Math.PI;
      patch.scale.y = 0.55;
      place(patch, x + 0.045, z + 0.035, 0.018);
      weatheringAccents += 1;
    }
  }

  if (memorial.events.length > 0) {
    const focus = new THREE.Group();
    focus.name = 'memorial-event-focus';
    if (memorial.form === 'stelae') {
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.1, 0.4), stone);
      plinth.position.y = 0.05;
      const monolith = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.12), paleStone);
      monolith.position.y = 0.46;
      monolith.castShadow = plinth.castShadow = true;
      focus.add(plinth, monolith);
    } else if (memorial.form === 'ancestor-posts') {
      for (const side of [-1, 0, 1]) {
        const height = 0.58 + (side === 0 ? 0.15 : 0);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, height, 7), timber);
        post.position.set(side * 0.17, height / 2, 0);
        post.castShadow = true;
        focus.add(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.08), timber);
      beam.position.y = 0.58;
      beam.castShadow = true;
      focus.add(beam);
    } else if (memorial.form === 'stone-cairns') {
      for (let layer = 0; layer < 6; layer += 1) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 - layer * 0.012, 0), layer === 5 ? paleStone : stone);
        rock.position.set((layer % 2 ? 1 : -1) * 0.02, 0.07 + layer * 0.11, 0);
        rock.scale.y = 0.7;
        rock.castShadow = true;
        focus.add(rock);
      }
    } else {
      const mound = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 6), earth);
      mound.scale.set(1.25, 0.25, 1);
      mound.position.y = 0.04;
      mound.castShadow = mound.receiveShadow = true;
      const stoneFocus = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), paleStone);
      stoneFocus.scale.set(0.9, 1.25, 0.62);
      stoneFocus.position.set(0, 0.14, -0.24);
      stoneFocus.castShadow = true;
      focus.add(mound, stoneFocus);
    }
    place(focus, 0, radius * 0.18, 0.01);
  }

  root.userData['memorialDetailMarkers'] = count;
  root.userData['weatheringAccents'] = weatheringAccents;
  root.userData['memorialVisualKit'] = 'v2';
  root.userData['memorialWeathering'] = weathering;
  root.userData['memorialAgeBand'] = age;
}

function memorialRoute(function memorialRoute(
  state: SimulationState,
  settlement: Settlement,
  plot: StructurePlot,
  radius: number,
): Vec2[] {
  const dx = plot.worldX - settlement.position.x;
  const dz = plot.worldZ - settlement.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < radius + 0.7) return [];
  const ux = dx / distance;
  const uz = dz / distance;
  const startDistance = Math.min(Math.max(0.85, distance * 0.32), 2.25);
  const start = { x: settlement.position.x + ux * startDistance, z: settlement.position.z + uz * startDistance };
  const end = { x: plot.worldX - ux * radius * 0.78, z: plot.worldZ - uz * radius * 0.78 };
  const walking = new WalkabilityLayer(state.world);
  walking.setStructures((settlement.structurePlots ?? []).filter(candidate => candidate.id !== plot.id && candidate.condition > 0.1)
    .map(candidate => ({ worldX: candidate.worldX, worldZ: candidate.worldZ, width: candidate.width, depth: candidate.depth })));
  return boundedStreetRoute(walking, start, end, {
    identity: `${settlement.id}:${plot.id}:memorial-path`,
    endpointSearchRadius: state.world.cellSize * 1.5,
    maxEndpointDrift: state.world.cellSize * 1.15,
    maxDetourFactor: 1.8,
    maxLength: Math.max(4, distance * 1.8),
  });
}

/**
 * Presentation-only landscape around persistent burial/memorial plots. The simulation owns the
 * deaths, culture, construction and reserved footprint; this layer only makes that history legible
 * at settlement camera distance.
 */
export function createMemorialSiteLandscape(
  state: SimulationState,
  settlement: Settlement,
  settlementY: number,
  elevationAt: (x: number, z: number) => number,
): THREE.Group {
  const landscape = new THREE.Group();
  landscape.name = 'memorial-site-landscape';
  let sites = 0;
  let pathTiles = 0;

  for (const plot of settlement.structurePlots ?? []) {
    const memorial = plot.development?.memorial;
    if (!memorial || plot.condition <= 0.02) continue;
    const profile = memorialLandscapeProfile(memorial, plot.condition);
    const radius = Math.max(1.05, plot.radius * profile.radiusScale);
    const site = new THREE.Group();
    site.name = `memorial-precinct:${plot.id}`;
    site.userData['memorialPrecinct'] = true;
    site.userData['memorialForm'] = memorial.form;
    site.userData['memorialAgeBand'] = memorial.ageBand;
    site.userData['landscapeLanguage'] = profile.language;
    site.add(createTerrainPatch(settlement, plot, memorial, settlementY, elevationAt, radius));
    addBoundaryAndEntrance(site, settlement, plot, memorial, settlementY, elevationAt, radius, profile);
    addVegetation(site, settlement, plot, memorial, settlementY, elevationAt, radius, profile);
    addCulturalDetails(site, settlement, plot, memorial, settlementY, elevationAt, radius);

    const route = memorialRoute(state, settlement, plot, radius);
    if (route.length >= 2) {
      const path = createTerrainPath(settlement, route, settlementY, elevationAt, profile.pathWidth, memorial);
      pathTiles += Number(path.userData['pathTiles'] ?? 0);
      landscape.add(path);
    }

    landscape.add(site);
    sites += 1;
  }

  landscape.userData['memorialPrecinctCount'] = sites;
  landscape.userData['memorialPathTiles'] = pathTiles;
  landscape.traverse((object) => {
    if (object instanceof THREE.Mesh) object.userData['weatherSurface'] = true;
  });
  return landscape;
}

const rendererPrototype = GodboxRenderer.prototype as unknown as Record<string, unknown>;
const originalCreateSettlementVisual = rendererPrototype['createSettlementVisual'] as CreateSettlementVisual | undefined;

if (originalCreateSettlementVisual && !rendererPrototype['memorialLandscapePatched']) {
  rendererPrototype['memorialLandscapePatched'] = true;
  rendererPrototype['createSettlementVisual'] = (function createSettlementVisualWithMemorialLandscape(
    this: GodboxRenderer,
    settlement: Settlement,
  ): SettlementVisualLike {
    const visual = originalCreateSettlementVisual.call(this, settlement);
    const self = this as unknown as RendererInternals;
    const settlementY = self.elevationAt(settlement.position.x, settlement.position.z);
    const landscape = createMemorialSiteLandscape(
      self.state,
      settlement,
      settlementY,
      (x, z) => self.elevationAt(x, z),
    );
    if (Number(landscape.userData['memorialPrecinctCount'] ?? 0) > 0) visual.group.add(landscape);
    return visual;
  }) as CreateSettlementVisual;
}
