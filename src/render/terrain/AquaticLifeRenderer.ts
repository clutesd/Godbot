import * as THREE from 'three';
import type { Vec2, WorldState } from '../../sim/types';
import { elevationToY } from '../../sim/terrain/SurfaceGeometry';
import { nearestIndex, type TerrainField } from '../../sim/terrain/TerrainField';
import type { EcologyField } from '../ecology/EcologyField';

export type KoiWaterKind = 'lake' | 'river' | 'coast';

export interface KoiRoutePoint {
  x: number;
  z: number;
  waterY: number;
}

export interface KoiSchoolPlan {
  centerX: number;
  centerZ: number;
  waterY: number;
  depth: number;
  swimWidth: number;
  count: number;
  phase: number;
  speed: number;
  direction: -1 | 1;
  kind: KoiWaterKind;
  flowX: number;
  flowZ: number;
  humanProximity: number;
  route: KoiRoutePoint[];
}

interface SchoolCandidate {
  x: number;
  z: number;
  waterY: number;
  depth: number;
  safeRadius: number;
  score: number;
  kind: KoiWaterKind;
  flowX: number;
  flowZ: number;
  humanProximity: number;
}

interface KoiVisual {
  school: KoiSchoolPlan;
  pathOffset: number;
  lateralOffset: number;
  radiusFactor: number;
  phase: number;
  size: number;
  patchOffset: number;
  patchVisible: boolean;
  body: THREE.Color;
  patch: THREE.Color;
}

const KOI_PATTERNS: ReadonlyArray<readonly [string, string]> = [
  ['#fff3dc', '#f06b2b'],
  ['#f07a2c', '#fff0d7'],
  ['#fff7eb', '#cf4036'],
  ['#e6a746', '#fff0cb'],
  ['#3c3430', '#f0792b'],
  ['#f3e2bd', '#3c3632'],
  ['#f5efe3', '#b93232'],
  ['#fff2d8', '#e2ad43'],
];

const COAST_PATTERNS: ReadonlyArray<readonly [string, string]> = [
  ['#d8eef0', '#5c8790'],
  ['#f2d685', '#d77839'],
  ['#d5e8df', '#6a9ea5'],
  ['#f5efe0', '#c85e3a'],
  ['#c7dce2', '#8799aa'],
];

const MAX_SCHOOLS_HIGH = 16;
const MAX_SCHOOLS_MEDIUM = 8;
const MAX_FISH_HIGH = 140;
const MAX_FISH_MEDIUM = 64;
const MAX_HUMAN_SCHOOLS_HIGH = 12;
const MAX_HUMAN_SCHOOLS_MEDIUM = 6;

function hashUnit(value: string): number {
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

function sampleDepth(field: TerrainField, seaLevel: number, index: number): number {
  const water = field.waterLevel[index] ?? -1;
  const floor = field.height[index] ?? seaLevel;
  if (water < 0) return 0;
  return Math.max(0, elevationToY(water, seaLevel) - elevationToY(floor, seaLevel));
}

function settlementProximity(x: number, z: number, settlements: readonly Vec2[]): number {
  if (!settlements.length) return 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (const settlement of settlements) nearest = Math.min(nearest, Math.hypot(x - settlement.x, z - settlement.z));
  return clamp01((26 - nearest) / 22);
}

function lakeAt(field: TerrainField, x: number, z: number): boolean {
  const index = nearestIndex(field, x, z);
  return Boolean(field.lake[index]) && !field.river[index] && (field.waterLevel[index] ?? -1) >= 0;
}

function oceanAt(field: TerrainField, seaLevel: number, x: number, z: number): boolean {
  const index = nearestIndex(field, x, z);
  return (field.height[index] ?? seaLevel) < seaLevel && !field.river[index] && !field.lake[index];
}

function riverAt(field: TerrainField, x: number, z: number): boolean {
  const index = nearestIndex(field, x, z);
  return Boolean(field.river[index]) && (field.waterLevel[index] ?? -1) >= 0;
}

function safeLakeRadius(field: TerrainField, x: number, z: number): number {
  const radii = [field.step * 3.1, field.step * 2.4, field.step * 1.75, field.step * 1.15];
  for (const radius of radii) {
    let safe = true;
    for (let sample = 0; sample < 12; sample += 1) {
      const angle = sample / 12 * Math.PI * 2;
      if (!lakeAt(field, x + Math.cos(angle) * radius, z + Math.sin(angle) * radius)) {
        safe = false;
        break;
      }
    }
    if (safe) return radius;
  }
  return 0;
}

function safeCoastRadius(field: TerrainField, seaLevel: number, x: number, z: number): number {
  const radii = [field.step * 2.6, field.step * 1.9, field.step * 1.3, field.step * 0.82];
  for (const radius of radii) {
    let safe = true;
    for (let sample = 0; sample < 10; sample += 1) {
      const angle = sample / 10 * Math.PI * 2;
      if (!oceanAt(field, seaLevel, x + Math.cos(angle) * radius, z + Math.sin(angle) * radius)) {
        safe = false;
        break;
      }
    }
    if (safe) return radius;
  }
  return 0;
}

function riverDirection(field: TerrainField, index: number): readonly [number, number] {
  const next = field.drainage?.downstream[index] ?? -1;
  if (next >= 0 && next !== index) {
    const dx = next % field.resolution - index % field.resolution;
    const dz = Math.floor(next / field.resolution) - Math.floor(index / field.resolution);
    const length = Math.hypot(dx, dz);
    if (length > 0.001) return [dx / length, dz / length];
  }
  const angle = hashUnit(`river-direction:${index}`) * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
}

function candidateSpacing(field: TerrainField, candidate: SchoolCandidate): number {
  if (candidate.humanProximity > 0.28) return Math.max(field.step * 2.7, candidate.safeRadius * 2.2);
  if (candidate.kind === 'river') return Math.max(field.step * 3.2, candidate.safeRadius * 4.2);
  if (candidate.kind === 'coast') return Math.max(field.step * 4.1, candidate.safeRadius * 2.6);
  return Math.max(field.step * 4.6, candidate.safeRadius * 1.9);
}

function selectCandidates(
  candidates: readonly SchoolCandidate[],
  selected: SchoolCandidate[],
  limit: number,
  field: TerrainField,
): void {
  for (const candidate of candidates) {
    const spacing = candidateSpacing(field, candidate);
    if (selected.some(existing => Math.hypot(existing.x - candidate.x, existing.z - candidate.z) < spacing)) continue;
    selected.push(candidate);
    if (selected.length >= limit) return;
  }
}

function pointForIndex(field: TerrainField, seaLevel: number, index: number, kind: KoiWaterKind): KoiRoutePoint {
  const x = field.originX + index % field.resolution * field.step;
  const z = field.originZ + Math.floor(index / field.resolution) * field.step;
  const waterY = kind === 'coast'
    ? elevationToY(seaLevel, seaLevel) - 0.014
    : elevationToY(field.waterLevel[index] ?? seaLevel, seaLevel);
  return { x, z, waterY };
}

function routePointAt(field: TerrainField, seaLevel: number, kind: KoiWaterKind, x: number, z: number): KoiRoutePoint {
  const index = nearestIndex(field, x, z);
  const point = pointForIndex(field, seaLevel, index, kind);
  return { x, z, waterY: point.waterY };
}

function waterKindAt(field: TerrainField, seaLevel: number, kind: KoiWaterKind, x: number, z: number): boolean {
  if (kind === 'river') return riverAt(field, x, z);
  if (kind === 'lake') return lakeAt(field, x, z);
  return oceanAt(field, seaLevel, x, z);
}

function upstreamNeighbour(field: TerrainField, current: number): number {
  const cx = current % field.resolution;
  const cz = Math.floor(current / field.resolution);
  let best = -1;
  let bestAccumulation = -1;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue;
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= field.resolution || z >= field.resolution) continue;
      const index = z * field.resolution + x;
      if (!field.river[index] || (field.waterLevel[index] ?? -1) < 0) continue;
      if ((field.drainage?.downstream[index] ?? -1) !== current) continue;
      const accumulation = field.drainage?.accumulation[index] ?? 0;
      if (accumulation > bestAccumulation) {
        best = index;
        bestAccumulation = accumulation;
      }
    }
  }
  return best;
}

function riverRoute(field: TerrainField, seaLevel: number, candidate: SchoolCandidate): KoiRoutePoint[] {
  const start = nearestIndex(field, candidate.x, candidate.z);
  const upstream: number[] = [];
  const downstream: number[] = [start];
  const visited = new Set<number>([start]);

  let current = start;
  for (let step = 0; step < 5; step += 1) {
    const previous = upstreamNeighbour(field, current);
    if (previous < 0 || visited.has(previous)) break;
    upstream.push(previous);
    visited.add(previous);
    current = previous;
  }

  current = start;
  for (let step = 0; step < 10; step += 1) {
    const next = field.drainage?.downstream[current] ?? -1;
    if (next < 0 || next === current || visited.has(next) || !field.river[next] || (field.waterLevel[next] ?? -1) < 0) break;
    downstream.push(next);
    visited.add(next);
    current = next;
  }

  const indices = [...upstream.reverse(), ...downstream];
  if (indices.length >= 3) return indices.map(index => pointForIndex(field, seaLevel, index, 'river'));

  const fallback: KoiRoutePoint[] = [];
  const span = field.step * 1.7;
  for (const sign of [-1, 0, 1]) {
    const x = candidate.x + candidate.flowX * span * sign;
    const z = candidate.z + candidate.flowZ * span * sign;
    if (waterKindAt(field, seaLevel, 'river', x, z)) fallback.push(routePointAt(field, seaLevel, 'river', x, z));
  }
  return fallback.length >= 2 ? fallback : [routePointAt(field, seaLevel, 'river', candidate.x, candidate.z)];
}

function openWaterRoute(
  field: TerrainField,
  seaLevel: number,
  candidate: SchoolCandidate,
  identity: string,
): KoiRoutePoint[] {
  const points: KoiRoutePoint[] = [routePointAt(field, seaLevel, candidate.kind, candidate.x, candidate.z)];
  let x = candidate.x;
  let z = candidate.z;
  let heading = hashUnit(`${identity}:heading`) * Math.PI * 2;
  const stepLength = field.step * (candidate.kind === 'coast' ? 2.05 : 1.55);
  const targetPoints = candidate.kind === 'coast' ? 12 : 10;
  const turns = [0, 0.34, -0.34, 0.68, -0.68, 1.02, -1.02, 1.38, -1.38];

  for (let routeIndex = 1; routeIndex < targetPoints; routeIndex += 1) {
    let chosen: { x: number; z: number; heading: number } | undefined;
    for (let attempt = 0; attempt < turns.length; attempt += 1) {
      const jitter = (hashUnit(`${identity}:turn:${routeIndex}:${attempt}`) - 0.5) * 0.22;
      const angle = heading + turns[attempt]! + jitter;
      const nx = x + Math.cos(angle) * stepLength;
      const nz = z + Math.sin(angle) * stepLength;
      if (!waterKindAt(field, seaLevel, candidate.kind, nx, nz)) continue;
      const clearance = candidate.kind === 'coast'
        ? safeCoastRadius(field, seaLevel, nx, nz)
        : safeLakeRadius(field, nx, nz);
      if (clearance < field.step * 0.8) continue;
      if (points.some(point => Math.hypot(point.x - nx, point.z - nz) < stepLength * 0.52)) continue;
      chosen = { x: nx, z: nz, heading: angle };
      break;
    }
    if (!chosen) break;
    x = chosen.x;
    z = chosen.z;
    heading = chosen.heading;
    points.push(routePointAt(field, seaLevel, candidate.kind, x, z));
  }

  if (points.length >= 3) return points;

  const fallbackHeading = hashUnit(`${identity}:fallback-heading`) * Math.PI * 2;
  const fallbackSpan = Math.max(field.step, candidate.safeRadius * 0.72);
  const fallback: KoiRoutePoint[] = [];
  for (const sign of [-1, 0, 1]) {
    const fx = candidate.x + Math.cos(fallbackHeading) * fallbackSpan * sign;
    const fz = candidate.z + Math.sin(fallbackHeading) * fallbackSpan * sign;
    if (waterKindAt(field, seaLevel, candidate.kind, fx, fz)) fallback.push(routePointAt(field, seaLevel, candidate.kind, fx, fz));
  }
  return fallback.length >= 2 ? fallback : points;
}

function buildSwimRoute(
  field: TerrainField,
  seaLevel: number,
  candidate: SchoolCandidate,
  identity: string,
): KoiRoutePoint[] {
  return candidate.kind === 'river'
    ? riverRoute(field, seaLevel, candidate)
    : openWaterRoute(field, seaLevel, candidate, identity);
}

/**
 * Deterministic renderer-only aquatic planning. Freshwater produces colourful koi/carp schools;
 * shoreline ocean cells can produce subdued harbour schools so coastal settlements do not have
 * visually dead water. Human-adjacent water is deliberately preferred over distant wilderness.
 */
export function planKoiSchools(
  field: TerrainField,
  seaLevel: number,
  seedPhase: number,
  complexity: 0 | 1 | 2,
  settlements: readonly Vec2[] = [],
): KoiSchoolPlan[] {
  if (complexity === 0) return [];
  const stride = Math.max(1, Math.floor(field.resolution / 58));
  const candidates: SchoolCandidate[] = [];
  const seed = seedPhase.toFixed(5);

  for (let gz = 1; gz < field.resolution - 1; gz += stride) {
    for (let gx = 1; gx < field.resolution - 1; gx += stride) {
      const index = gz * field.resolution + gx;
      const x = field.originX + gx * field.step;
      const z = field.originZ + gz * field.step;
      const humanProximity = settlementProximity(x, z, settlements);
      const water = field.waterLevel[index] ?? -1;
      const river = water >= 0 && Boolean(field.river[index]);
      const lake = water >= 0 && Boolean(field.lake[index]);
      const coast = !river && !lake && (field.height[index] ?? seaLevel) < seaLevel;
      if (!river && !lake && !coast) continue;

      const kind: KoiWaterKind = river ? 'river' : lake ? 'lake' : 'coast';
      const depth = coast
        ? Math.max(0, elevationToY(seaLevel, seaLevel) - elevationToY(field.height[index] ?? seaLevel, seaLevel))
        : sampleDepth(field, seaLevel, index);
      const minimumDepth = kind === 'river' ? 0.055 : kind === 'coast' ? 0.07 : 0.075;
      if (depth < minimumDepth) continue;
      if (kind === 'coast' && settlements.length > 0 && humanProximity <= 0.04) continue;

      const safeRadius = kind === 'river'
        ? field.step * (0.34 + Math.min(0.32, depth * 0.5))
        : kind === 'coast'
          ? safeCoastRadius(field, seaLevel, x, z)
          : safeLakeRadius(field, x, z);
      if (safeRadius <= 0) continue;

      const waterY = kind === 'coast'
        ? elevationToY(seaLevel, seaLevel) - 0.014
        : elevationToY(water, seaLevel);
      const depthScore = Math.min(1, depth / 0.5);
      const flow = kind === 'river' ? riverDirection(field, index) : [0, 0] as const;
      const flowStrength = kind === 'river' ? Math.min(1, field.flow[index] ?? 0) : 0;
      const random = hashUnit(`${seed}:${gx}:${gz}:${kind}:school`);
      const score = random * 0.3 + depthScore * 0.18 + humanProximity * 0.47
        + (kind === 'river' ? 0.04 + flowStrength * 0.04 : kind === 'lake' ? 0.035 : 0.02);
      candidates.push({ x, z, waterY, depth, safeRadius, score, kind, flowX: flow[0], flowZ: flow[1], humanProximity });
    }
  }

  const maxSchools = complexity === 2 ? MAX_SCHOOLS_HIGH : MAX_SCHOOLS_MEDIUM;
  const humanLimit = complexity === 2 ? MAX_HUMAN_SCHOOLS_HIGH : MAX_HUMAN_SCHOOLS_MEDIUM;
  const selected: SchoolCandidate[] = [];
  const humanCandidates = candidates.filter(candidate => candidate.humanProximity > 0.08).sort((a, b) => b.score - a.score);
  selectCandidates(humanCandidates, selected, Math.min(maxSchools, humanLimit), field);

  const remaining = candidates.filter(candidate => !selected.includes(candidate)).sort((a, b) => b.score - a.score);
  if (selected.length < maxSchools) selectCandidates(remaining, selected, maxSchools, field);

  return selected.map((candidate, index) => {
    const identity = `${seed}:aquatic-school:${index}:${candidate.kind}:${candidate.x.toFixed(3)}:${candidate.z.toFixed(3)}`;
    const countBase = complexity === 2
      ? candidate.kind === 'river' ? 6 : candidate.kind === 'coast' ? 8 : 9
      : candidate.kind === 'river' ? 4 : 6;
    const countRange = complexity === 2 ? 5 : 3;
    const route = buildSwimRoute(field, seaLevel, candidate, identity);
    return {
      centerX: candidate.x,
      centerZ: candidate.z,
      waterY: candidate.waterY,
      depth: candidate.depth,
      swimWidth: candidate.safeRadius * (candidate.kind === 'river' ? 0.2 : candidate.kind === 'coast' ? 0.2 : 0.18),
      count: countBase + Math.floor(hashUnit(`${identity}:count`) * countRange),
      phase: hashUnit(`${identity}:phase`) * Math.PI * 2,
      speed: candidate.kind === 'river'
        ? 0.035 + hashUnit(`${identity}:speed`) * 0.018
        : candidate.kind === 'coast'
          ? 0.019 + hashUnit(`${identity}:speed`) * 0.012
          : 0.016 + hashUnit(`${identity}:speed`) * 0.011,
      direction: hashUnit(`${identity}:direction`) < 0.5 ? -1 : 1,
      kind: candidate.kind,
      flowX: candidate.flowX,
      flowZ: candidate.flowZ,
      humanProximity: candidate.humanProximity,
      route,
    };
  });
}

interface RouteSample {
  x: number;
  z: number;
  waterY: number;
  tangentX: number;
  tangentZ: number;
}

function pingPong01(value: number): number {
  const wrapped = ((value % 2) + 2) % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
}

function pingPongDirection(value: number): 1 | -1 {
  const wrapped = ((value % 2) + 2) % 2;
  return wrapped <= 1 ? 1 : -1;
}

function sampleRoute(route: readonly KoiRoutePoint[], progress: number): RouteSample {
  if (route.length === 0) return { x: 0, z: 0, waterY: 0, tangentX: 0, tangentZ: 1 };
  if (route.length === 1) {
    const point = route[0]!;
    return { x: point.x, z: point.z, waterY: point.waterY, tangentX: 0, tangentZ: 1 };
  }
  const scaled = clamp01(progress) * (route.length - 1);
  const index = Math.min(route.length - 2, Math.floor(scaled));
  const t = scaled - index;
  const a = route[index]!;
  const b = route[index + 1]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.max(0.0001, Math.hypot(dx, dz));
  return {
    x: a.x + dx * t,
    z: a.z + dz * t,
    waterY: a.waterY + (b.waterY - a.waterY) * t,
    tangentX: dx / length,
    tangentZ: dz / length,
  };
}

/**
 * Camera-readable aquatic life that actually travels through the water. Each school owns a long,
 * water-valid route and loosely follows it back and forth; individual fish have small along-route
 * and cross-route offsets, so the result reads as swimming rather than orbiting a fixed spawn point.
 */
export class AquaticLifeRenderer {
  readonly group = new THREE.Group();
  readonly schools: readonly KoiSchoolPlan[];
  readonly fishCount: number;

  private readonly body: THREE.InstancedMesh;
  private readonly patches: THREE.InstancedMesh;
  private readonly tails: THREE.InstancedMesh;
  private readonly fish: KoiVisual[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly patchPosition = new THREE.Vector3();
  private readonly patchLocal = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly tailQuaternion = new THREE.Quaternion();
  private readonly wagQuaternion = new THREE.Quaternion();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private lastTime = Number.NaN;

  constructor(
    world: WorldState,
    private readonly ecology: EcologyField,
    complexity: 0 | 1 | 2,
  ) {
    this.group.name = 'aquatic-life';
    this.schools = planKoiSchools(world.terrain, world.seaLevel, ecology.seedPhase, complexity, ecology.settlementPositions);
    const fishBudget = complexity === 2 ? MAX_FISH_HIGH : complexity === 1 ? MAX_FISH_MEDIUM : 0;
    const seed = ecology.seedPhase.toFixed(5);

    let remaining = fishBudget;
    for (let schoolIndex = 0; schoolIndex < this.schools.length && remaining > 0; schoolIndex += 1) {
      const school = this.schools[schoolIndex]!;
      const count = Math.min(school.count, remaining);
      for (let index = 0; index < count; index += 1) {
        const identity = `${seed}:fish:${schoolIndex}:${index}`;
        const patterns = school.kind === 'coast' ? COAST_PATTERNS : KOI_PATTERNS;
        const pattern = patterns[Math.floor(hashUnit(`${identity}:pattern`) * patterns.length)] ?? patterns[0]!;
        this.fish.push({
          school,
          pathOffset: (index / Math.max(1, count - 1) - 0.5) * 0.14 + (hashUnit(`${identity}:path`) - 0.5) * 0.035,
          lateralOffset: (hashUnit(`${identity}:lateral`) - 0.5) * 1.7,
          radiusFactor: 0.34 + hashUnit(`${identity}:radius`) * 0.66,
          phase: hashUnit(`${identity}:phase`) * Math.PI * 2,
          size: 0.9 + hashUnit(`${identity}:size`) * 0.58,
          patchOffset: (hashUnit(`${identity}:patch-offset`) - 0.5) * 0.046,
          patchVisible: hashUnit(`${identity}:patch-visible`) > 0.08,
          body: new THREE.Color(pattern[0]),
          patch: new THREE.Color(pattern[1]),
        });
      }
      remaining -= count;
    }
    this.fishCount = this.fish.length;

    const capacity = Math.max(1, this.fishCount);
    const bodyGeometry = new THREE.SphereGeometry(1, 10, 6);
    const patchGeometry = new THREE.SphereGeometry(1, 8, 5);
    const tailGeometry = new THREE.ConeGeometry(0.058, 0.112, 3, 1, false)
      .rotateX(Math.PI / 2)
      .translate(0, 0, -0.148);
    const bodyMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    const patchMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.94, depthWrite: false, toneMapped: false });
    const tailMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.84, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });

    this.body = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, capacity);
    this.patches = new THREE.InstancedMesh(patchGeometry, patchMaterial, capacity);
    this.tails = new THREE.InstancedMesh(tailGeometry, tailMaterial, capacity);
    for (const mesh of [this.body, this.patches, this.tails]) {
      mesh.count = this.fishCount;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 5;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.body.name = 'aquatic-fish-bodies';
    this.patches.name = 'aquatic-fish-patterns';
    this.tails.name = 'aquatic-fish-tails';

    for (let index = 0; index < this.fish.length; index += 1) {
      const fish = this.fish[index]!;
      this.body.setColorAt(index, fish.body);
      this.tails.setColorAt(index, fish.body);
      this.patches.setColorAt(index, fish.patch);
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.tails.instanceColor) this.tails.instanceColor.needsUpdate = true;
    if (this.patches.instanceColor) this.patches.instanceColor.needsUpdate = true;

    this.group.add(this.body, this.patches, this.tails);
    this.body.onBeforeRender = () => this.update(this.ecology.time.value);
    this.update(0, true);
  }

  get report(): { schools: number; fish: number; humanAdjacentSchools: number; coastalSchools: number } {
    return {
      schools: this.schools.length,
      fish: this.fishCount,
      humanAdjacentSchools: this.schools.filter(school => school.humanProximity > 0.08).length,
      coastalSchools: this.schools.filter(school => school.kind === 'coast').length,
    };
  }

  private update(elapsedSeconds: number, force = false): void {
    if (!force && Math.abs(elapsedSeconds - this.lastTime) < 0.0001) return;
    this.lastTime = elapsedSeconds;

    for (let index = 0; index < this.fish.length; index += 1) {
      const fish = this.fish[index]!;
      const school = fish.school;
      const phaseProgress = school.phase / (Math.PI * 2);
      const wander = Math.sin(elapsedSeconds * 0.19 + fish.phase) * 0.012;
      const rawProgress = elapsedSeconds * school.speed * school.direction + phaseProgress + fish.pathOffset + wander;
      const routeProgress = pingPong01(rawProgress);
      const routeDirection = pingPongDirection(rawProgress) * school.direction;
      const sample = sampleRoute(school.route, routeProgress);

      const lateralWander = Math.sin(elapsedSeconds * (0.36 + fish.radiusFactor * 0.11) + fish.phase) * 0.18;
      const lateral = school.swimWidth * (fish.lateralOffset + lateralWander);
      const acrossX = -sample.tangentZ;
      const acrossZ = sample.tangentX;
      const x = sample.x + acrossX * lateral;
      const z = sample.z + acrossZ * lateral;
      const y = sample.waterY + 0.015 + Math.sin(elapsedSeconds * 0.82 + fish.phase) * 0.003;
      const yaw = Math.atan2(sample.tangentX * routeDirection, sample.tangentZ * routeDirection)
        + Math.sin(elapsedSeconds * 0.7 + fish.phase) * 0.055;

      this.position.set(x, y, z);
      this.quaternion.setFromAxisAngle(this.yAxis, yaw);

      this.scale.set(0.052 * fish.size, 0.012 * fish.size, 0.116 * fish.size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.body.setMatrixAt(index, this.matrix);

      const wag = Math.sin(elapsedSeconds * (7.6 + fish.radiusFactor * 1.9) + fish.phase) * 0.4;
      this.wagQuaternion.setFromAxisAngle(this.yAxis, wag);
      this.tailQuaternion.copy(this.quaternion).multiply(this.wagQuaternion);
      this.scale.setScalar(fish.size);
      this.matrix.compose(this.position, this.tailQuaternion, this.scale);
      this.tails.setMatrixAt(index, this.matrix);

      if (fish.patchVisible) {
        this.patchLocal.set(0, 0.012 * fish.size, fish.patchOffset);
        this.patchLocal.applyQuaternion(this.quaternion);
        this.patchPosition.copy(this.position).add(this.patchLocal);
        this.scale.set(0.032 * fish.size, 0.0048 * fish.size, 0.05 * fish.size);
      } else {
        this.patchPosition.copy(this.position);
        this.scale.setScalar(0);
      }
      this.matrix.compose(this.patchPosition, this.quaternion, this.scale);
      this.patches.setMatrixAt(index, this.matrix);
    }

    this.body.instanceMatrix.needsUpdate = true;
    this.tails.instanceMatrix.needsUpdate = true;
    this.patches.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.body.onBeforeRender = () => undefined;
    this.group.removeFromParent();
    for (const mesh of [this.body, this.patches, this.tails]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
