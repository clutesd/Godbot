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
  const segments = memorial.form === 'stelae' ? 24 : 20;
  const ratioX = memorial.form === 'stelae' ? 1.04 : memorial.form === 'ancestor-posts' ? 0.94 : 1;
  const ratioZ = memorial.form === 'earth-mounds' ? 0.9 : memorial.form === 'stone-cairns' ? 0.94 : 1;
  const positions: number[] = [];
  const centerY = elevationAt(plot.worldX, plot.worldZ) - settlementY + 0.016;
  for (let index = 0; index < segments; index += 1) {
    const a = index / segments * Math.PI * 2;
    const b = (index + 1) / segments * Math.PI * 2;
    const ax = Math.cos(a) * radius * ratioX;
    const az = Math.sin(a) * radius * ratioZ;
    const bx = Math.cos(b) * radius * ratioX;
    const bz = Math.sin(b) * radius * ratioZ;
    const ay = elevationAt(plot.worldX + ax, plot.worldZ + az) - settlementY + 0.016;
    const by = elevationAt(plot.worldX + bx, plot.worldZ + bz) - settlementY + 0.016;
    positions.push(0, centerY, 0, ax, ay, az, bx, by, bz);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: mutedGroundColour(memorial),
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const ground = new THREE.Mesh(geometry, material);
  ground.name = 'memorial-ground';
  ground.position.set(plot.worldX - settlement.position.x, 0, plot.worldZ - settlement.position.z);
  ground.receiveShadow = true;
  ground.userData['memorialGround'] = true;
  return ground;
}

function createTerrainPath(
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

function createBoundaryElement(form: MemorialSite['form'], material: THREE.Material, index: number): THREE.Object3D {
  if (form === 'ancestor-posts') {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.52 + (index % 3) * 0.06, 6), material);
    post.name = 'memorial-boundary-post';
    post.castShadow = true;
    return post;
  }
  if (form === 'stelae') {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.13), material);
    wall.name = 'memorial-boundary-wall';
    wall.castShadow = true;
    wall.receiveShadow = true;
    return wall;
  }
  if (form === 'stone-cairns') {
    const cairn = new THREE.Group();
    cairn.name = 'memorial-boundary-cairn';
    const lower = new THREE.Mesh(new THREE.DodecahedronGeometry(0.115, 0), material);
    const upper = new THREE.Mesh(new THREE.DodecahedronGeometry(0.075, 0), material);
    upper.position.y = 0.12;
    lower.castShadow = upper.castShadow = true;
    cairn.add(lower, upper);
    return cairn;
  }
  const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.095 + (index % 2) * 0.025, 0), material);
  stone.name = 'memorial-boundary-stone';
  stone.castShadow = true;
  return stone;
}

function addBoundaryAndEntrance(
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
    const element = createBoundaryElement(memorial.form, boundaryMaterial, index);
    const worldX = plot.worldX + x;
    const worldZ = plot.worldZ + z;
    const baseY = elevationAt(worldX, worldZ) - settlementY;
    const height = element instanceof THREE.Mesh ? Number((element.geometry as THREE.BufferGeometry).boundingBox?.max.y ?? 0) : 0;
    void height;
    element.position.set(siteX + x, baseY + (memorial.form === 'stelae' ? 0.08 : memorial.form === 'ancestor-posts' ? 0.27 : 0.08), siteZ + z);
    element.rotation.y = memorial.form === 'stelae' ? -angle : 0;
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
    lintel.rotation.y = gateAngle + Math.PI / 2;
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
    let angle = stableUnit(`${plot.id}:tree-angle:${index}`) * Math.PI * 2;
    if (angularDistance(angle, gateAngle) < 0.48) angle += 0.72;
    const radial = radius * (0.62 + stableUnit(`${plot.id}:tree-radius:${index}`) * 0.22);
    const x = Math.cos(angle) * radial;
    const z = Math.sin(angle) * radial;
    const ground = elevationAt(plot.worldX + x, plot.worldZ + z) - settlementY;
    const maturity = 0.38 + age * 0.12 + stableUnit(`${plot.id}:tree-size:${index}`) * 0.12;
    const height = 0.62 + maturity * 0.9;
    const tree = new THREE.Group();
    tree.name = 'memorial-tree';
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035 + maturity * 0.025, 0.055 + maturity * 0.03, height * 0.58, 6), trunkMaterial);
    trunk.position.y = height * 0.29;
    trunk.castShadow = true;
    const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + maturity * 0.18, 1), foliageMaterial);
    crown.position.y = height * 0.72;
    crown.scale.set(0.9, 1.15, 0.9);
    crown.castShadow = true;
    tree.add(trunk, crown);
    tree.position.set(siteX + x, ground, siteZ + z);
    root.add(tree);
  }

  for (let index = 0; index < profile.shrubCount; index += 1) {
    let angle = stableUnit(`${plot.id}:shrub-angle:${index}`) * Math.PI * 2;
    if (angularDistance(angle, gateAngle) < 0.34) angle += 0.5;
    const radial = radius * (0.42 + stableUnit(`${plot.id}:shrub-radius:${index}`) * 0.46);
    const x = Math.cos(angle) * radial;
    const z = Math.sin(angle) * radial;
    const ground = elevationAt(plot.worldX + x, plot.worldZ + z) - settlementY;
    const size = 0.07 + stableUnit(`${plot.id}:shrub-size:${index}`) * (0.06 + age * 0.012);
    const shrub = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), shrubMaterial);
    shrub.name = 'memorial-shrub';
    shrub.position.set(siteX + x, ground + size * 0.6, siteZ + z);
    shrub.scale.y = 0.7 + stableUnit(`${plot.id}:shrub-shape:${index}`) * 0.6;
    shrub.castShadow = true;
    root.add(shrub);
  }
}

function memorialRoute(
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
