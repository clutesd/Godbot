import * as THREE from 'three';
import type { WorldState } from '../../sim/types';
import { elevationToY } from '../../sim/terrain/SurfaceGeometry';
import { nearestIndex, type TerrainField } from '../../sim/terrain/TerrainField';
import type { EcologyField } from '../ecology/EcologyField';

export type KoiWaterKind = 'lake' | 'river';

export interface KoiSchoolPlan {
  centerX: number;
  centerZ: number;
  waterY: number;
  depth: number;
  orbitRadius: number;
  count: number;
  phase: number;
  speed: number;
  direction: -1 | 1;
  kind: KoiWaterKind;
  flowX: number;
  flowZ: number;
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
}

interface KoiVisual {
  school: KoiSchoolPlan;
  angleOffset: number;
  radiusFactor: number;
  phase: number;
  size: number;
  patchOffset: number;
  patchVisible: boolean;
  body: THREE.Color;
  patch: THREE.Color;
}

const KOI_PATTERNS: ReadonlyArray<readonly [string, string]> = [
  ['#f5ead7', '#e95e25'],
  ['#ec7028', '#f8ead5'],
  ['#f5efe2', '#c83b2f'],
  ['#d99c37', '#fff1d1'],
  ['#332f2c', '#e96728'],
  ['#efe0bd', '#3b3531'],
  ['#f1ede1', '#a82f2d'],
  ['#f6efe0', '#e2a33d'],
];

const MAX_SCHOOLS_HIGH = 12;
const MAX_SCHOOLS_MEDIUM = 6;
const MAX_RIVER_SCHOOLS_HIGH = 7;
const MAX_RIVER_SCHOOLS_MEDIUM = 4;
const MAX_FISH_HIGH = 96;
const MAX_FISH_MEDIUM = 42;

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function sampleDepth(field: TerrainField, seaLevel: number, index: number): number {
  const water = field.waterLevel[index] ?? -1;
  const floor = field.height[index] ?? seaLevel;
  if (water < 0) return 0;
  return Math.max(0, elevationToY(water, seaLevel) - elevationToY(floor, seaLevel));
}

function lakeAt(field: TerrainField, x: number, z: number): boolean {
  const index = nearestIndex(field, x, z);
  return Boolean(field.lake[index]) && !field.river[index] && (field.waterLevel[index] ?? -1) >= 0;
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
  return candidate.kind === 'river'
    ? Math.max(field.step * 3.2, candidate.safeRadius * 4.2)
    : Math.max(field.step * 4.6, candidate.safeRadius * 1.9);
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

/**
 * Deterministic renderer-only koi planning. Standing water creates broad circling schools while
 * mapped rivers create tighter current-aware schools. Flood water and dry terrain remain excluded.
 */
export function planKoiSchools(
  field: TerrainField,
  seaLevel: number,
  seedPhase: number,
  complexity: 0 | 1 | 2,
): KoiSchoolPlan[] {
  if (complexity === 0) return [];
  const stride = Math.max(1, Math.floor(field.resolution / 52));
  const candidates: SchoolCandidate[] = [];
  const seed = seedPhase.toFixed(5);

  for (let gz = 1; gz < field.resolution - 1; gz += stride) {
    for (let gx = 1; gx < field.resolution - 1; gx += stride) {
      const index = gz * field.resolution + gx;
      const water = field.waterLevel[index] ?? -1;
      if (water < 0) continue;
      const river = Boolean(field.river[index]);
      const lake = Boolean(field.lake[index]);
      if (!river && !lake) continue;
      const kind: KoiWaterKind = river ? 'river' : 'lake';
      const depth = sampleDepth(field, seaLevel, index);
      const minimumDepth = kind === 'river' ? 0.065 : 0.085;
      if (depth < minimumDepth) continue;
      const x = field.originX + gx * field.step;
      const z = field.originZ + gz * field.step;
      const safeRadius = kind === 'river'
        ? field.step * (0.3 + Math.min(0.28, depth * 0.45))
        : safeLakeRadius(field, x, z);
      if (safeRadius <= 0) continue;
      const waterY = elevationToY(water, seaLevel);
      const depthScore = Math.min(1, depth / 0.48);
      const flow = kind === 'river' ? riverDirection(field, index) : [0, 0] as const;
      const flowStrength = kind === 'river' ? Math.min(1, field.flow[index] ?? 0) : 0;
      const score = hashUnit(`${seed}:${gx}:${gz}:${kind}:school`) * 0.54
        + depthScore * 0.26
        + (kind === 'river' ? 0.14 + flowStrength * 0.06 : 0.06);
      candidates.push({ x, z, waterY, depth, safeRadius, score, kind, flowX: flow[0], flowZ: flow[1] });
    }
  }

  const riverCandidates = candidates.filter(candidate => candidate.kind === 'river').sort((a, b) => b.score - a.score);
  const lakeCandidates = candidates.filter(candidate => candidate.kind === 'lake').sort((a, b) => b.score - a.score);
  const maxSchools = complexity === 2 ? MAX_SCHOOLS_HIGH : MAX_SCHOOLS_MEDIUM;
  const riverLimit = Math.min(maxSchools, complexity === 2 ? MAX_RIVER_SCHOOLS_HIGH : MAX_RIVER_SCHOOLS_MEDIUM);
  const selected: SchoolCandidate[] = [];
  selectCandidates(riverCandidates, selected, riverLimit, field);
  if (selected.length < maxSchools) selectCandidates(lakeCandidates, selected, maxSchools, field);
  if (selected.length < maxSchools) selectCandidates(riverCandidates, selected, maxSchools, field);

  return selected.map((candidate, index) => {
    const identity = `${seed}:koi-school:${index}:${candidate.kind}:${candidate.x.toFixed(3)}:${candidate.z.toFixed(3)}`;
    const countBase = complexity === 2 ? candidate.kind === 'river' ? 5 : 7 : candidate.kind === 'river' ? 4 : 5;
    const countRange = complexity === 2 ? 5 : 3;
    return {
      centerX: candidate.x,
      centerZ: candidate.z,
      waterY: candidate.waterY,
      depth: candidate.depth,
      orbitRadius: candidate.safeRadius * (candidate.kind === 'river' ? 0.92 : 0.46 + hashUnit(`${identity}:radius`) * 0.18),
      count: countBase + Math.floor(hashUnit(`${identity}:count`) * countRange),
      phase: hashUnit(`${identity}:phase`) * Math.PI * 2,
      speed: candidate.kind === 'river'
        ? 0.28 + hashUnit(`${identity}:speed`) * 0.22
        : 0.12 + hashUnit(`${identity}:speed`) * 0.11,
      direction: hashUnit(`${identity}:direction`) < 0.5 ? -1 : 1,
      kind: candidate.kind,
      flowX: candidate.flowX,
      flowZ: candidate.flowZ,
    };
  });
}

/**
 * Visible aquatic life deliberately lives outside the water shader. The fish are rendered as a
 * near-surface optical presentation: the authoritative water stays opaque, while muted translucent
 * koi sit a few millimetres above the water depth buffer so they read as visible through the surface.
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
    this.group.name = 'aquatic-life-koi';
    this.schools = planKoiSchools(world.terrain, world.seaLevel, ecology.seedPhase, complexity);
    const fishBudget = complexity === 2 ? MAX_FISH_HIGH : complexity === 1 ? MAX_FISH_MEDIUM : 0;
    const seed = ecology.seedPhase.toFixed(5);

    let remaining = fishBudget;
    for (let schoolIndex = 0; schoolIndex < this.schools.length && remaining > 0; schoolIndex += 1) {
      const school = this.schools[schoolIndex]!;
      const count = Math.min(school.count, remaining);
      for (let index = 0; index < count; index += 1) {
        const identity = `${seed}:koi:${schoolIndex}:${index}`;
        const pattern = KOI_PATTERNS[Math.floor(hashUnit(`${identity}:pattern`) * KOI_PATTERNS.length)] ?? KOI_PATTERNS[0]!;
        this.fish.push({
          school,
          angleOffset: index / Math.max(1, count) * Math.PI * 2 + (hashUnit(`${identity}:angle`) - 0.5) * 0.75,
          radiusFactor: 0.38 + hashUnit(`${identity}:radius`) * 0.62,
          phase: hashUnit(`${identity}:phase`) * Math.PI * 2,
          size: 0.86 + hashUnit(`${identity}:size`) * 0.52,
          patchOffset: (hashUnit(`${identity}:patch-offset`) - 0.5) * 0.032,
          patchVisible: hashUnit(`${identity}:patch-visible`) > 0.1,
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
    const tailGeometry = new THREE.ConeGeometry(0.044, 0.082, 3, 1, false)
      .rotateX(Math.PI / 2)
      .translate(0, 0, -0.104);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.58,
      metalness: 0,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      emissive: '#1a0904',
      emissiveIntensity: 0.2,
    });
    const patchMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.52,
      metalness: 0,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      emissive: '#1c0904',
      emissiveIntensity: 0.18,
    });
    const tailMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.6,
      metalness: 0,
      vertexColors: true,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      side: THREE.DoubleSide,
      emissive: '#150603',
      emissiveIntensity: 0.16,
    });

    this.body = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, capacity);
    this.patches = new THREE.InstancedMesh(patchGeometry, patchMaterial, capacity);
    this.tails = new THREE.InstancedMesh(tailGeometry, tailMaterial, capacity);
    for (const mesh of [this.body, this.patches, this.tails]) {
      mesh.count = this.fishCount;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 3;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.body.name = 'koi-bodies';
    this.patches.name = 'koi-patterns';
    this.tails.name = 'koi-tails';

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

  private update(elapsedSeconds: number, force = false): void {
    if (!force && Math.abs(elapsedSeconds - this.lastTime) < 0.0001) return;
    this.lastTime = elapsedSeconds;

    for (let index = 0; index < this.fish.length; index += 1) {
      const fish = this.fish[index]!;
      const school = fish.school;
      let x: number;
      let z: number;
      let yaw: number;

      if (school.kind === 'river') {
        const acrossX = -school.flowZ;
        const acrossZ = school.flowX;
        const travel = Math.sin(elapsedSeconds * school.speed + fish.phase + fish.angleOffset)
          * school.orbitRadius * (0.72 + fish.radiusFactor * 0.28);
        const lateral = Math.sin(elapsedSeconds * (school.speed * 0.66) + fish.phase * 1.7)
          * school.orbitRadius * 0.24 * fish.radiusFactor;
        x = school.centerX + school.flowX * travel + acrossX * lateral;
        z = school.centerZ + school.flowZ * travel + acrossZ * lateral;
        const facing = school.direction;
        yaw = Math.atan2(school.flowX * facing, school.flowZ * facing)
          + Math.sin(elapsedSeconds * 0.8 + fish.phase) * 0.11;
      } else {
        const breathe = 0.93 + Math.sin(elapsedSeconds * 0.53 + fish.phase) * 0.07;
        const radius = school.orbitRadius * fish.radiusFactor * breathe;
        const angle = school.phase + fish.angleOffset + elapsedSeconds * school.speed * school.direction
          + Math.sin(elapsedSeconds * 0.31 + fish.phase) * 0.08;
        x = school.centerX + Math.cos(angle) * radius;
        z = school.centerZ + Math.sin(angle) * radius * 0.72;
        const dx = -Math.sin(angle) * school.direction;
        const dz = Math.cos(angle) * 0.72 * school.direction;
        yaw = Math.atan2(dx, dz) + Math.sin(elapsedSeconds * 0.7 + fish.phase) * 0.055;
      }

      // The inland water material is intentionally opaque. A tiny positive lift makes the fish a
      // convincing surface-visible optical projection instead of allowing the water depth buffer to
      // erase them completely. The lift is smaller than the normal water displacement amplitude.
      const y = school.waterY + 0.006 + Math.sin(elapsedSeconds * 0.82 + fish.phase) * 0.0025;
      this.position.set(x, y, z);
      this.quaternion.setFromAxisAngle(this.yAxis, yaw);

      this.scale.set(0.036 * fish.size, 0.0105 * fish.size, 0.074 * fish.size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.body.setMatrixAt(index, this.matrix);

      const wag = Math.sin(elapsedSeconds * (7.6 + fish.radiusFactor * 1.9) + fish.phase) * 0.38;
      this.wagQuaternion.setFromAxisAngle(this.yAxis, wag);
      this.tailQuaternion.copy(this.quaternion).multiply(this.wagQuaternion);
      this.scale.setScalar(fish.size);
      this.matrix.compose(this.position, this.tailQuaternion, this.scale);
      this.tails.setMatrixAt(index, this.matrix);

      if (fish.patchVisible) {
        this.patchLocal.set(0, 0.0102 * fish.size, fish.patchOffset);
        this.patchLocal.applyQuaternion(this.quaternion);
        this.patchPosition.copy(this.position).add(this.patchLocal);
        this.scale.set(0.022 * fish.size, 0.0042 * fish.size, 0.032 * fish.size);
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
