import * as THREE from 'three';
import { GodboxRenderer } from '../GodboxRenderer';
import { eraRank } from '../assets/BuildingGrammar';
import type { Era, MaterialPalette } from '../materials/MaterialPalette';
import { CultureStyleProfileFactory } from '../style/CultureStyleProfile';
import { createSettlementLayoutPlan, type SettlementLayoutPlan, type StreetSegment } from '../placement/SettlementLayoutPlan';
import { WalkabilityLayer } from '../../sim/people/WalkabilityLayer';
import type { Settlement, SimulationState, Vec2 } from '../../sim/types';
import type { TerrainQueries } from '../placement/TerrainQueries';
import {
  boundedStreetRoute,
  densifyStreetRoute,
  pointAlongStreet,
  settlementStreetWidth,
  type SettlementStreetKind,
} from './SettlementPathGeometry';

interface RendererInternals {
  state: SimulationState;
  terrainQueries: TerrainQueries;
  elevationAt: (x: number, z: number) => number;
}

const walkabilityByRenderer = new WeakMap<GodboxRenderer, WalkabilityLayer>();

function walkabilityFor(renderer: GodboxRenderer, state: SimulationState): WalkabilityLayer {
  const existing = walkabilityByRenderer.get(renderer);
  if (existing) return existing;
  const walking = new WalkabilityLayer(state.world);
  walkabilityByRenderer.set(renderer, walking);
  return walking;
}

function settlementForGroup(self: RendererInternals, group: THREE.Group): Settlement | undefined {
  let best: Settlement | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const settlement of self.state.settlements) {
    const distance = Math.hypot(settlement.position.x - group.position.x, settlement.position.z - group.position.z);
    if (distance < bestDistance) {
      best = settlement;
      bestDistance = distance;
    }
  }
  return bestDistance <= 0.08 ? best : undefined;
}

function layoutFor(self: RendererInternals, settlement: Settlement, era: Era): SettlementLayoutPlan {
  return createSettlementLayoutPlan({
    settlement,
    settlements: self.state.settlements,
    routes: self.state.tradeRoutes,
    transportation: self.state.transportation,
    eraRank: eraRank(era),
    seed: self.state.seed,
  });
}

function worldPoint(settlement: Settlement, localX: number, localZ: number): Vec2 {
  return { x: settlement.position.x + localX, z: settlement.position.z + localZ };
}

function routeForStreet(
  renderer: GodboxRenderer,
  self: RendererInternals,
  settlement: Settlement,
  start: Vec2,
  end: Vec2,
  identity: string,
  maxLength: number,
): Vec2[] {
  const world = self.state.world;
  const walking = walkabilityFor(renderer, self.state);
  return boundedStreetRoute(walking, start, end, {
    identity,
    endpointSearchRadius: world.cellSize * 1.35,
    maxEndpointDrift: world.cellSize * 1.05,
    maxDetourFactor: 1.75,
    maxLength,
  });
}

/**
 * Emits many short terrain-aligned tiles instead of one long rigid box. Every tile is rechecked
 * against the fine terrain authority; water/cliff samples break the path rather than producing a
 * floating runway across them.
 */
function addTerrainFollowingStreet(
  group: THREE.Group,
  self: RendererInternals,
  settlement: Settlement,
  route: readonly Vec2[],
  width: number,
  material: THREE.Material,
  name: string,
  kind: SettlementStreetKind,
): void {
  if (route.length < 2) return;
  const settlementY = self.elevationAt(settlement.position.x, settlement.position.z);
  const samples = densifyStreetRoute(route, Math.min(0.58, self.state.world.cellSize * 0.24));
  let previous: THREE.Vector3 | undefined;

  for (const sample of samples) {
    const terrain = self.terrainQueries.queryTerrainAt(sample.x, sample.z);
    if (!terrain || terrain.water || terrain.maxSlope > 38) {
      previous = undefined;
      continue;
    }
    const current = new THREE.Vector3(
      sample.x - settlement.position.x,
      self.elevationAt(sample.x, sample.z) - settlementY + 0.018,
      sample.z - settlement.position.z,
    );
    if (!previous) {
      previous = current;
      continue;
    }

    const delta = current.clone().sub(previous);
    const horizontal = Math.hypot(delta.x, delta.z);
    if (horizontal < 0.04 || horizontal > 0.9) {
      previous = current;
      continue;
    }
    // A local path tile may slope with the ground, but a near-vertical tile is a geometry error.
    if (Math.abs(delta.y) / horizontal > 0.72) {
      previous = undefined;
      continue;
    }

    const length = Math.max(0.04, delta.length());
    const tile = new THREE.Mesh(new THREE.BoxGeometry(width, 0.026, length), material);
    tile.name = name;
    tile.position.copy(previous).add(current).multiplyScalar(0.5);
    tile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), delta.normalize());
    tile.receiveShadow = true;
    tile.castShadow = false;
    tile.userData['settlementStreet'] = true;
    tile.userData['streetKind'] = kind;
    tile.userData['weatherSurface'] = true;
    group.add(tile);
    previous = current;
  }
}

function streetMaterial(era: Era, palette: MaterialPalette): THREE.Material {
  const rank = eraRank(era);
  return rank >= 3
    ? palette.getSurfaceMaterial('ground')
    : new THREE.MeshStandardMaterial({ color: '#765f46', roughness: 1 });
}

function enhancedAddGroundCraft(
  this: GodboxRenderer,
  group: THREE.Group,
  era: Era,
  palette: MaterialPalette,
  _random: unknown,
): void {
  const self = this as unknown as RendererInternals;
  const settlement = settlementForGroup(self, group);
  if (!settlement) return;
  const rank = eraRank(era);

  if (rank === 0) {
    // Camps keep one compact trodden-earth hearth area; there are no invented radial highways.
    const earth = new THREE.Mesh(
      new THREE.CircleGeometry(1.65, 18),
      new THREE.MeshStandardMaterial({ color: '#756149', roughness: 1 }),
    );
    earth.name = 'settlement-trodden-ground';
    earth.rotation.x = -Math.PI / 2;
    earth.position.y = 0.012;
    earth.receiveShadow = true;
    group.add(earth);
    return;
  }

  const layout = layoutFor(self, settlement, era);
  const material = streetMaterial(era, palette);
  const ordered = [...layout.streets].sort((a, b) => streetPriority(a) - streetPriority(b));
  const limit = rank >= 4 ? 8 : rank >= 2 ? 7 : 5;

  for (const [index, street] of ordered.slice(0, limit).entries()) {
    const start = worldPoint(settlement, street.fromX, street.fromZ);
    const end = worldPoint(settlement, street.toX, street.toZ);
    const route = routeForStreet(
      this,
      self,
      settlement,
      start,
      end,
      `${settlement.id}:street:${street.kind}:${index}`,
      Math.max(layout.radius * 1.8, Math.hypot(street.toX - street.fromX, street.toZ - street.fromZ) * 1.85),
    );
    if (route.length < 2) continue;
    addTerrainFollowingStreet(
      group,
      self,
      settlement,
      route,
      settlementStreetWidth(rank, street.kind),
      material,
      `settlement-${street.kind}-street`,
      street.kind,
    );
  }
}

function streetPriority(street: StreetSegment): number {
  return street.kind === 'primary' ? 0 : street.kind === 'secondary' ? 1 : 2;
}

function enhancedAddCeremonialAxis(
  this: GodboxRenderer,
  group: THREE.Group,
  palette: MaterialPalette,
  profile: ReturnType<typeof CultureStyleProfileFactory.createFromCulture>,
  era: Era,
  angle: number,
): void {
  const self = this as unknown as RendererInternals;
  const settlement = settlementForGroup(self, group);
  if (!settlement) return;
  const rank = eraRank(era);
  const layout = layoutFor(self, settlement, era);
  const scaleFactor = profile.getScaleFactor(era);
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);

  // The ceremonial axis is a decorated town street, not an eight-unit floating podium.
  const startDistance = Math.min(1.75, 1.05 + scaleFactor * 0.48);
  const endDistance = Math.min(layout.radius * 0.72, startDistance + 2.25 + rank * 0.28);
  if (endDistance <= startDistance + 0.4) return;

  const start = { x: settlement.position.x + dirX * startDistance, z: settlement.position.z + dirZ * startDistance };
  const end = { x: settlement.position.x + dirX * endDistance, z: settlement.position.z + dirZ * endDistance };
  const route = routeForStreet(
    this,
    self,
    settlement,
    start,
    end,
    `${settlement.id}:ceremonial-axis`,
    Math.max(layout.radius, endDistance * 1.45),
  );
  if (route.length < 2) return;

  addTerrainFollowingStreet(
    group,
    self,
    settlement,
    route,
    settlementStreetWidth(rank, 'ceremonial'),
    palette.getSurfaceMaterial('ground'),
    'settlement-ceremonial-street',
    'ceremonial',
  );

  // Keep only a few strong landmarks along the safe routed street. Their bases use real terrain,
  // so they cannot hover over a hill or continue after the road has detoured around water.
  const timber = palette.getSurfaceMaterial('timber');
  const motif = palette.getSurfaceMaterial('motif');
  const stone = palette.getSurfaceMaterial('stone');
  const glow = palette.getSurfaceMaterial('glow');
  const settlementY = self.elevationAt(settlement.position.x, settlement.position.z);
  const gateFractions = rank >= 4 ? [0.42, 0.78] : [0.58];

  for (const fraction of gateFractions) {
    const sample = pointAlongStreet(route, fraction);
    if (!sample) continue;
    const terrain = self.terrainQueries.queryTerrainAt(sample.point.x, sample.point.z);
    if (!terrain || terrain.water || terrain.maxSlope > 24) continue;
    const tangentLength = Math.max(0.001, Math.hypot(sample.tangent.x, sample.tangent.z));
    const tx = sample.tangent.x / tangentLength;
    const tz = sample.tangent.z / tangentLength;
    const px = -tz;
    const pz = tx;
    const localX = sample.point.x - settlement.position.x;
    const localZ = sample.point.z - settlement.position.z;
    const groundY = self.elevationAt(sample.point.x, sample.point.z) - settlementY;
    const half = 0.38 * scaleFactor;
    const height = 0.82 * scaleFactor;
    const gate = new THREE.Group();
    gate.name = 'ceremonial-gate';
    gate.position.set(localX, groundY, localZ);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.065, height, 0.065), timber);
      post.position.set(px * half * side, height * 0.5, pz * half * side);
      post.castShadow = true;
      gate.add(post);
    }
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(half * 2.2, 0.075, 0.09), motif);
    crossbar.position.y = height;
    crossbar.rotation.y = Math.atan2(tx, tz);
    crossbar.castShadow = true;
    gate.add(crossbar);
    group.add(gate);
  }

  for (const fraction of [0.28, 0.68]) {
    const sample = pointAlongStreet(route, fraction);
    if (!sample) continue;
    const terrain = self.terrainQueries.queryTerrainAt(sample.point.x, sample.point.z);
    if (!terrain || terrain.water || terrain.maxSlope > 28) continue;
    const tangentLength = Math.max(0.001, Math.hypot(sample.tangent.x, sample.tangent.z));
    const px = -sample.tangent.z / tangentLength;
    const pz = sample.tangent.x / tangentLength;
    const localX = sample.point.x - settlement.position.x;
    const localZ = sample.point.z - settlement.position.z;
    const groundY = self.elevationAt(sample.point.x, sample.point.z) - settlementY;
    for (const side of [-1, 1]) {
      const offset = 0.42 * side;
      const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.07), stone);
      pedestal.position.set(localX + px * offset, groundY + 0.08, localZ + pz * offset);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.075), glow);
      lamp.position.set(localX + px * offset, groundY + 0.22, localZ + pz * offset);
      group.add(pedestal, lamp);
    }
  }
}

const rendererPrototype = GodboxRenderer.prototype as unknown as Record<string, unknown>;
rendererPrototype['addGroundCraft'] = enhancedAddGroundCraft;
rendererPrototype['addCeremonialAxis'] = enhancedAddCeremonialAxis;
