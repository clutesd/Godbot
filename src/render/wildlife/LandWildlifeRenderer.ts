import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRandom, stableHash } from '../../sim/prng';
import type { Vec2, WorldCell, WorldState } from '../../sim/types';
import { cellAt } from '../../sim/world';
import type { TerrainSurface } from '../terrain/TerrainSurface';

export type LandAnimalSpecies = 'elk' | 'fox' | 'bear';

export interface LandAnimalPlan {
  id: string;
  species: LandAnimalSpecies;
  route: readonly Vec2[];
  scale: number;
  speed: number;
  phase: number;
  gaitPhase: number;
  groupId?: string;
  /** Local offset from a shared herd route. Kept deliberately small so route validity is preserved. */
  offsetX: number;
  offsetZ: number;
  coat: number;
}

export interface LandWildlifeReport {
  planned: number;
  visible: number;
  drawCalls: number;
  triangles: number;
  bySpecies: Record<LandAnimalSpecies, number>;
}

/** Read-only presentation snapshot used by the documentary camera. */
export interface WildlifeCameraSubject {
  readonly id: string;
  readonly species: LandAnimalSpecies;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly moving: boolean;
}

export interface WildlifeExclusionZone {
  x: number;
  z: number;
  radius: number;
}

interface SpeciesProfile {
  viewRange: number;
  maxVisible: number;
  maxSlope: number;
  routeStep: readonly [number, number];
  speed: readonly [number, number];
  scale: readonly [number, number];
}

interface MotionSample {
  x: number;
  z: number;
  yaw: number;
  moving: boolean;
  stride: number;
}

const SPECIES: readonly LandAnimalSpecies[] = ['elk', 'fox', 'bear'];
const UP = new THREE.Vector3(0, 1, 0);
const PROFILE: Record<LandAnimalSpecies, SpeciesProfile> = {
  // World scale is calibrated against the canonical ~0.30-unit adult humanoid. Elk shoulder
  // height is just under an adult; antlers extend well above. Bears are lower but much bulkier,
  // while a fox remains unmistakably small.
  elk: { viewRange: 58, maxVisible: 9, maxSlope: 0.30, routeStep: [2.2, 4.2], speed: [0.038, 0.055], scale: [0.88, 1.08] },
  fox: { viewRange: 34, maxVisible: 5, maxSlope: 0.42, routeStep: [1.5, 3.2], speed: [0.062, 0.092], scale: [0.88, 1.08] },
  bear: { viewRange: 50, maxVisible: 4, maxSlope: 0.38, routeStep: [1.8, 3.6], speed: [0.032, 0.047], scale: [0.90, 1.12] },
};

const MODEL_HEIGHT: Record<LandAnimalSpecies, number> = {
  elk: 0.52,
  bear: 0.23,
  fox: 0.12,
};

const BIOME_WEIGHT: Record<LandAnimalSpecies, Partial<Record<WorldCell['biome'], number>>> = {
  elk: { forest: 0.96, grassland: 1, wetland: 0.64, highland: 0.52, dryland: 0.22, mountain: 0.12 },
  fox: { forest: 0.88, grassland: 1, wetland: 0.48, highland: 0.58, dryland: 0.62, mountain: 0.22 },
  bear: { forest: 1, wetland: 0.72, highland: 0.68, grassland: 0.34, dryland: 0.12, mountain: 0.38 },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smooth01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function wildlifeHabitatScore(species: LandAnimalSpecies, cell: WorldCell): number {
  if (cell.water || cell.biome === 'water') return 0;
  const biome = BIOME_WEIGHT[species][cell.biome] ?? 0.12;
  const slope = clamp01(cell.slope ?? 0);
  const movement = clamp01(1 - Math.max(0, (cell.movementCost ?? 1) - 1) * 0.35);
  const forest = clamp01(cell.wood);
  const moisture = clamp01(cell.moisture);
  const profile = PROFILE[species];
  const slopeFit = 1 - smooth01(slope / Math.max(0.01, profile.maxSlope * 1.25));
  if (species === 'elk') return clamp01(biome * (0.62 + forest * 0.22 + moisture * 0.16) * movement * slopeFit);
  if (species === 'bear') return clamp01(biome * (0.48 + forest * 0.42 + moisture * 0.10) * movement * slopeFit);
  return clamp01(biome * (0.66 + (1 - Math.abs(forest - 0.48)) * 0.22 + moisture * 0.12) * movement * slopeFit);
}

function dryLandAt(world: WorldState, surface: TerrainSurface, species: LandAnimalSpecies, x: number, z: number): boolean {
  const cell = cellAt(world, x, z);
  if (!cell || wildlifeHabitatScore(species, cell) < 0.24) return false;
  if (surface.slopeAt(x, z) > PROFILE[species].maxSlope) return false;
  const ground = surface.heightAt(x, z);
  const water = surface.waterYAt(x, z);
  return !Number.isFinite(water) || water < ground - 0.035;
}

function drySegment(world: WorldState, surface: TerrainSurface, species: LandAnimalSpecies, a: Vec2, b: Vec2): boolean {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  const samples = Math.max(2, Math.ceil(distance / Math.max(0.35, world.cellSize * 0.42)));
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    if (!dryLandAt(world, surface, species, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

function routeFrom(
  world: WorldState,
  surface: TerrainSurface,
  species: LandAnimalSpecies,
  origin: Vec2,
  random: SeededRandom,
): Vec2[] {
  const profile = PROFILE[species];
  const route: Vec2[] = [{ ...origin }];
  let heading = random.range(0, Math.PI * 2);
  const target = species === 'fox' ? 7 : species === 'elk' ? 6 : 5;

  for (let routeIndex = 1; routeIndex < target; routeIndex += 1) {
    const previous = route.at(-1)!;
    let chosen: Vec2 | undefined;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const turn = random.range(-0.95, 0.95) + (attempt % 5 - 2) * 0.18;
      const angle = heading + turn;
      const distance = random.range(profile.routeStep[0], profile.routeStep[1]);
      const candidate = { x: previous.x + Math.sin(angle) * distance, z: previous.z + Math.cos(angle) * distance };
      if (route.some((point) => Math.hypot(point.x - candidate.x, point.z - candidate.z) < profile.routeStep[0] * 0.72)) continue;
      if (!drySegment(world, surface, species, previous, candidate)) continue;
      chosen = candidate;
      heading = angle;
      break;
    }
    if (!chosen) break;
    route.push(chosen);
  }
  return route;
}

function candidateCells(
  world: WorldState,
  species: LandAnimalSpecies,
  seed: string,
  anchors: readonly Vec2[],
): WorldCell[] {
  return world.cells
    .filter((cell) => wildlifeHabitatScore(species, cell) >= 0.42)
    .filter((cell) => anchors.every((anchor) => Math.hypot(cell.worldX - anchor.x, cell.worldZ - anchor.z) > 4.8))
    .sort((left, right) => {
      const ls = wildlifeHabitatScore(species, left) + stableHash(`${seed}:wildlife-cell:${species}`, left.x, left.z) * 0.18;
      const rs = wildlifeHabitatScore(species, right) + stableHash(`${seed}:wildlife-cell:${species}`, right.x, right.z) * 0.18;
      return rs - ls;
    });
}

function chooseTerritories(
  world: WorldState,
  surface: TerrainSurface,
  species: LandAnimalSpecies,
  seed: string,
  count: number,
  anchors: readonly Vec2[],
): Vec2[] {
  const selected: Vec2[] = [];
  const spacing = species === 'bear' ? Math.max(9, world.cellSize * 7)
    : species === 'elk' ? Math.max(7, world.cellSize * 5.5)
      : Math.max(5, world.cellSize * 4.2);
  for (const cell of candidateCells(world, species, seed, anchors)) {
    const point = { x: cell.worldX, z: cell.worldZ };
    if (!dryLandAt(world, surface, species, point.x, point.z)) continue;
    if (selected.some((other) => Math.hypot(point.x - other.x, point.z - other.z) < spacing)) continue;
    selected.push(point);
    if (selected.length >= count) break;
  }
  return selected;
}

/**
 * Renderer-owned fauna planning only. This intentionally does not enter SimulationState. A future
 * wildlife simulation can provide the same LandAnimalPlan contract and take over population,
 * predation, migration, hunting and ecological consequences without replacing the visual layer.
 */
export function planLandWildlife(
  world: WorldState,
  surface: TerrainSurface,
  seed: string,
  anchors: readonly Vec2[] = [],
): LandAnimalPlan[] {
  const plans: LandAnimalPlan[] = [];
  const worldScale = Math.max(0.68, Math.min(1.35, world.size / 52));
  const targets = {
    elk: Math.max(2, Math.min(4, Math.round(2.3 * worldScale))),
    fox: Math.max(3, Math.min(7, Math.round(4.8 * worldScale))),
    bear: Math.max(2, Math.min(4, Math.round(2.4 * worldScale))),
  };

  const elkTerritories = chooseTerritories(world, surface, 'elk', seed, targets.elk, anchors);
  elkTerritories.forEach((origin, herdIndex) => {
    const random = new SeededRandom(`${seed}:elk-herd:${herdIndex}`);
    const route = routeFrom(world, surface, 'elk', origin, random);
    if (route.length < 3) return;
    const herdSize = 2 + random.int(0, 3);
    const groupId = `elk-herd-${herdIndex}`;
    const speed = random.range(...PROFILE.elk.speed);
    for (let member = 0; member < herdSize; member += 1) {
      const angle = random.range(0, Math.PI * 2);
      const radius = member === 0 ? 0 : random.range(0.08, 0.28);
      plans.push({
        id: `${groupId}:${member}`, species: 'elk', route, groupId,
        scale: random.range(...PROFILE.elk.scale), speed, phase: random.range(0, 0.22),
        gaitPhase: random.range(0, Math.PI * 2), offsetX: Math.cos(angle) * radius,
        offsetZ: Math.sin(angle) * radius, coat: random.range(0.86, 1),
      });
    }
  });

  for (const species of ['fox', 'bear'] as const) {
    const territories = chooseTerritories(world, surface, species, seed, targets[species], anchors);
    territories.forEach((origin, territoryIndex) => {
      const random = new SeededRandom(`${seed}:${species}:${territoryIndex}`);
      const route = routeFrom(world, surface, species, origin, random);
      if (route.length < 3) return;
      plans.push({
        id: `${species}:${territoryIndex}`, species, route,
        scale: random.range(...PROFILE[species].scale), speed: random.range(...PROFILE[species].speed),
        phase: random.float(), gaitPhase: random.range(0, Math.PI * 2),
        offsetX: 0, offsetZ: 0, coat: random.range(0.86, 1),
      });
    });
  }
  return plans;
}

function sampleMotion(plan: LandAnimalPlan, elapsed: number): MotionSample {
  const segmentCount = Math.max(1, plan.route.length - 1);
  const loopSegments = segmentCount * 2;
  const raw = elapsed * plan.speed + plan.phase * loopSegments;
  const step = ((Math.floor(raw) % loopSegments) + loopSegments) % loopSegments;
  const local = raw - Math.floor(raw);
  let aIndex: number;
  let bIndex: number;
  if (step < segmentCount) {
    aIndex = step;
    bIndex = step + 1;
  } else {
    aIndex = loopSegments - step;
    bIndex = aIndex - 1;
  }
  const a = plan.route[aIndex] ?? plan.route[0]!;
  const b = plan.route[bIndex] ?? a;
  const travelShare = plan.species === 'fox' ? 0.82 : plan.species === 'elk' ? 0.76 : 0.70;
  const moving = local < travelShare;
  const t = moving ? smooth01(local / travelShare) : 1;
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  const localX = plan.offsetX;
  const localZ = plan.offsetZ;
  return {
    x: a.x + (b.x - a.x) * t + localX * Math.cos(yaw) + localZ * Math.sin(yaw),
    z: a.z + (b.z - a.z) * t - localX * Math.sin(yaw) + localZ * Math.cos(yaw),
    yaw,
    moving,
    stride: raw * Math.PI * 2 + plan.gaitPhase,
  };
}

function colourGeometry(geometry: THREE.BufferGeometry, colour: THREE.ColorRepresentation): THREE.BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const c = new THREE.Color(colour);
  const values = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    values[index * 3] = c.r;
    values[index * 3 + 1] = c.g;
    values[index * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return geometry;
}

function spherePart(
  scale: readonly [number, number, number],
  position: readonly [number, number, number],
  colour: THREE.ColorRepresentation,
  segments = 7,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, segments, Math.max(4, segments - 2));
  geometry.scale(scale[0], scale[1], scale[2]);
  geometry.translate(position[0], position[1], position[2]);
  return colourGeometry(geometry, colour);
}

function cylinderPart(
  radius: number,
  height: number,
  position: readonly [number, number, number],
  colour: THREE.ColorRepresentation,
  radialSegments = 6,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius * 0.82, radius, height, radialSegments, 1);
  geometry.translate(position[0], position[1], position[2]);
  return colourGeometry(geometry, colour);
}

function conePart(
  radius: number,
  height: number,
  position: readonly [number, number, number],
  colour: THREE.ColorRepresentation,
  radialSegments = 5,
): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(radius, height, radialSegments, 1);
  geometry.translate(position[0], position[1], position[2]);
  return colourGeometry(geometry, colour);
}

function cylinderBetween(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  radius: number,
  colour: THREE.ColorRepresentation,
): THREE.BufferGeometry {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.9, length, 5, 1);
  const rotation = new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize());
  geometry.applyQuaternion(rotation);
  geometry.translate((from[0] + to[0]) * 0.5, (from[1] + to[1]) * 0.5, (from[2] + to[2]) * 0.5);
  return colourGeometry(geometry, colour);
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('Unable to merge land wildlife geometry');
  for (const part of parts) part.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function buildElkGeometry(): THREE.BufferGeometry {
  const coat = '#7b5a3d';
  const dark = '#49382c';
  const tan = '#b49770';
  const antler = '#b89d75';
  const black = '#151718';
  const parts: THREE.BufferGeometry[] = [
    spherePart([0.095, 0.065, 0.16], [0, 0.22, 0], coat, 8),
    spherePart([0.082, 0.07, 0.09], [0, 0.225, -0.10], coat, 7),
    spherePart([0.074, 0.075, 0.08], [0, 0.235, 0.105], dark, 7),
    cylinderBetween([0, 0.245, 0.10], [0, 0.34, 0.18], 0.035, dark),
    spherePart([0.050, 0.044, 0.071], [0, 0.355, 0.215], coat, 7),
    spherePart([0.034, 0.030, 0.052], [0, 0.342, 0.278], tan, 6),
    spherePart([0.010, 0.008, 0.008], [-0.030, 0.370, 0.272], black, 5),
    spherePart([0.010, 0.008, 0.008], [0.030, 0.370, 0.272], black, 5),
    conePart(0.020, 0.060, [-0.044, 0.405, 0.205], coat),
    conePart(0.020, 0.060, [0.044, 0.405, 0.205], coat),
  ];
  for (const x of [-0.055, 0.055]) {
    for (const z of [-0.090, 0.085]) {
      parts.push(cylinderPart(0.013, 0.165, [x, 0.0825, z], dark, 5));
      parts.push(spherePart([0.018, 0.010, 0.025], [x, 0.006, z + 0.007], '#2b2927', 5));
    }
  }
  for (const side of [-1, 1] as const) {
    const sx = side * 0.026;
    const mid: [number, number, number] = [side * 0.060, 0.445, 0.185];
    const tip: [number, number, number] = [side * 0.105, 0.505, 0.150];
    parts.push(cylinderBetween([sx, 0.393, 0.202], mid, 0.008, antler));
    parts.push(cylinderBetween(mid, tip, 0.007, antler));
    parts.push(cylinderBetween([side * 0.052, 0.435, 0.188], [side * 0.085, 0.480, 0.215], 0.0055, antler));
    parts.push(cylinderBetween([side * 0.076, 0.465, 0.170], [side * 0.118, 0.502, 0.185], 0.005, antler));
  }
  return mergeParts(parts);
}

function buildBearGeometry(): THREE.BufferGeometry {
  const coat = '#3f332b';
  const dark = '#261f1b';
  const muzzle = '#725c49';
  const black = '#111315';
  const parts: THREE.BufferGeometry[] = [
    spherePart([0.125, 0.083, 0.165], [0, 0.105, -0.005], coat, 8),
    spherePart([0.105, 0.090, 0.100], [0, 0.145, 0.055], coat, 7),
    spherePart([0.070, 0.063, 0.068], [0, 0.145, 0.158], coat, 7),
    spherePart([0.050, 0.034, 0.052], [0, 0.128, 0.215], muzzle, 6),
    spherePart([0.017, 0.015, 0.014], [-0.046, 0.194, 0.147], coat, 5),
    spherePart([0.017, 0.015, 0.014], [0.046, 0.194, 0.147], coat, 5),
    spherePart([0.009, 0.007, 0.007], [-0.030, 0.158, 0.209], black, 5),
    spherePart([0.009, 0.007, 0.007], [0.030, 0.158, 0.209], black, 5),
    spherePart([0.020, 0.018, 0.022], [0, 0.108, -0.175], dark, 5),
  ];
  for (const x of [-0.078, 0.078]) {
    for (const z of [-0.090, 0.090]) {
      parts.push(cylinderPart(0.026, 0.075, [x, 0.045, z], dark, 6));
      parts.push(spherePart([0.036, 0.018, 0.047], [x, 0.011, z + 0.012], dark, 6));
    }
  }
  return mergeParts(parts);
}

function buildFoxGeometry(): THREE.BufferGeometry {
  const coat = '#b95d32';
  const dark = '#322823';
  const cream = '#d9b58a';
  const black = '#121415';
  const parts: THREE.BufferGeometry[] = [
    spherePart([0.052, 0.034, 0.105], [0, 0.061, -0.010], coat, 7),
    spherePart([0.045, 0.045, 0.052], [0, 0.074, 0.070], cream, 6),
    spherePart([0.043, 0.039, 0.046], [0, 0.096, 0.118], coat, 7),
    spherePart([0.025, 0.022, 0.050], [0, 0.086, 0.170], cream, 6),
    conePart(0.022, 0.058, [-0.027, 0.145, 0.112], dark),
    conePart(0.022, 0.058, [0.027, 0.145, 0.112], dark),
    spherePart([0.008, 0.006, 0.006], [-0.024, 0.105, 0.159], black, 5),
    spherePart([0.008, 0.006, 0.006], [0.024, 0.105, 0.159], black, 5),
    spherePart([0.014, 0.012, 0.014], [0, 0.085, 0.215], black, 5),
  ];
  for (const x of [-0.032, 0.032]) {
    for (const z of [-0.060, 0.055]) parts.push(cylinderPart(0.009, 0.055, [x, 0.028, z], dark, 5));
  }
  const tail = new THREE.SphereGeometry(1, 7, 5);
  tail.scale(0.037, 0.035, 0.125);
  tail.rotateX(-0.42);
  tail.translate(0, 0.086, -0.145);
  parts.push(colourGeometry(tail, coat));
  parts.push(spherePart([0.033, 0.030, 0.040], [0, 0.118, -0.245], cream, 6));
  const geometry = mergeParts(parts);
  // Keep the fox's long readable silhouette while matching real-world height relative to a person.
  // Length remains useful from documentary camera distance; only the vertical exaggeration is removed.
  geometry.scale(1, 0.72, 1);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildLandAnimalGeometry(species: LandAnimalSpecies): THREE.BufferGeometry {
  if (species === 'elk') return buildElkGeometry();
  if (species === 'bear') return buildBearGeometry();
  return buildFoxGeometry();
}

function modelMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  });
}

/**
 * Purely visual roaming mammals. They do not eat, hunt, reproduce, flee, damage crops, affect
 * resources, or write simulation state. Plans are explicit and exported so future ecological
 * authority can replace presentation planning without replacing models, LOD, terrain grounding,
 * camera culling or animation.
 */
export class LandWildlifeRenderer {
  readonly group = new THREE.Group();
  readonly plans: readonly LandAnimalPlan[];
  private readonly meshes: Record<LandAnimalSpecies, THREE.InstancedMesh>;
  private readonly camera = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private exclusions: readonly WildlifeExclusionZone[] = [];
  private visible = 0;

  constructor(
    world: WorldState,
    private readonly surface: TerrainSurface,
    seed: string,
    anchors: readonly Vec2[] = [],
    plans?: readonly LandAnimalPlan[],
  ) {
    this.group.name = 'ambient-land-wildlife';
    this.group.userData['presentationOnly'] = true;
    this.plans = plans ?? planLandWildlife(world, surface, seed, anchors);
    const bySpecies = (species: LandAnimalSpecies) => this.plans.filter((plan) => plan.species === species).length;
    this.meshes = {
      elk: this.createSpeciesMesh('elk', bySpecies('elk')),
      fox: this.createSpeciesMesh('fox', bySpecies('fox')),
      bear: this.createSpeciesMesh('bear', bySpecies('bear')),
    };
    this.group.add(this.meshes.elk, this.meshes.fox, this.meshes.bear);
  }

  get report(): LandWildlifeReport {
    const bySpecies = { elk: 0, fox: 0, bear: 0 };
    for (const plan of this.plans) bySpecies[plan.species] += 1;
    let triangles = 0;
    let drawCalls = 0;
    for (const species of SPECIES) {
      const mesh = this.meshes[species];
      if (mesh.count > 0) drawCalls += 1;
      triangles += mesh.count * (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
    }
    return { planned: this.plans.length, visible: this.visible, drawCalls, triangles, bySpecies };
  }

  setCamera(camera: THREE.Vector3): void {
    this.camera.copy(camera);
  }

  setExclusionZones(zones: readonly WildlifeExclusionZone[]): void {
    // Copy the tiny descriptor list so presentation never observes a caller mutating it mid-frame.
    this.exclusions = zones.map((zone) => ({ ...zone }));
  }

  /**
   * Current visual animal positions for camera composition. This is deliberately derived from the
   * same presentation clock and route sampler as rendering, so the camera photographs where an
   * animal is actually drawn without promoting wildlife presentation into simulation authority.
   */
  cameraSubjects(elapsed: number): readonly WildlifeCameraSubject[] {
    const subjects: WildlifeCameraSubject[] = [];
    for (const plan of this.plans) {
      const motion = sampleMotion(plan, elapsed);
      if (this.exclusions.some((zone) => Math.hypot(motion.x - zone.x, motion.z - zone.z) < zone.radius + 0.35)) continue;
      const ground = this.surface.heightAt(motion.x, motion.z);
      const water = this.surface.waterYAt(motion.x, motion.z);
      if (Number.isFinite(water) && water > ground - 0.03) continue;
      subjects.push({ id: plan.id, species: plan.species, x: motion.x, z: motion.z, yaw: motion.yaw, moving: motion.moving });
    }
    return subjects;
  }

  update(elapsed: number): void {
    this.visible = 0;
    for (const species of SPECIES) {
      const profile = PROFILE[species];
      const candidates = this.plans
        .filter((plan) => plan.species === species)
        .map((plan) => ({ plan, motion: sampleMotion(plan, elapsed) }))
        .filter(({ motion }) => Math.hypot(motion.x - this.camera.x, motion.z - this.camera.z) <= profile.viewRange)
        .sort((left, right) =>
          Math.hypot(left.motion.x - this.camera.x, left.motion.z - this.camera.z)
          - Math.hypot(right.motion.x - this.camera.x, right.motion.z - this.camera.z))
        .slice(0, profile.maxVisible);

      const mesh = this.meshes[species];
      let count = 0;
      for (const { plan, motion } of candidates) {
        if (this.exclusions.some((zone) => Math.hypot(motion.x - zone.x, motion.z - zone.z) < zone.radius + 0.35)) continue;
        const ground = this.surface.heightAt(motion.x, motion.z);
        const water = this.surface.waterYAt(motion.x, motion.z);
        if (Number.isFinite(water) && water > ground - 0.03) continue;

        const bobAmplitude = species === 'elk' ? 0.0055 : species === 'fox' ? 0.0032 : 0.004;
        const bob = motion.moving ? Math.abs(Math.sin(motion.stride * (species === 'fox' ? 1.35 : 1))) * bobAmplitude : 0;
        const idleLook = motion.moving ? 0 : Math.sin(elapsed * 0.22 + plan.gaitPhase) * (species === 'fox' ? 0.24 : 0.12);
        this.position.set(motion.x, ground + bob, motion.z);
        this.quaternion.setFromAxisAngle(UP, motion.yaw + idleLook);
        const breathing = 1 + Math.sin(elapsed * 0.9 + plan.gaitPhase) * (motion.moving ? 0.004 : 0.009);
        this.scale.set(plan.scale, plan.scale * breathing, plan.scale);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        mesh.setMatrixAt(count, this.matrix);
        this.tint.setRGB(plan.coat, plan.coat, plan.coat);
        mesh.setColorAt(count, this.tint);
        count += 1;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.visible += count;
    }
  }

  dispose(): void {
    for (const species of SPECIES) {
      this.meshes[species].geometry.dispose();
      (this.meshes[species].material as THREE.Material).dispose();
    }
  }

  private createSpeciesMesh(species: LandAnimalSpecies, capacity: number): THREE.InstancedMesh {
    const geometry = buildLandAnimalGeometry(species);
    const mesh = new THREE.InstancedMesh(geometry, modelMaterial(), Math.max(1, capacity));
    mesh.name = `land-wildlife:${species}`;
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3)
      .setUsage(THREE.DynamicDrawUsage);
    mesh.userData['species'] = species;
    mesh.userData['referenceHeight'] = MODEL_HEIGHT[species];
    mesh.userData['presentationOnly'] = true;
    return mesh;
  }
}
