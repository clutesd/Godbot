import * as THREE from 'three';
import type { WorldState } from '../../sim/types';
import { elevationToY } from '../../sim/terrain/SurfaceGeometry';
import { nearestIndex, type TerrainField } from '../../sim/terrain/TerrainField';
import type { EcologyField } from '../ecology/EcologyField';

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
}

interface SchoolCandidate {
  x: number;
  z: number;
  waterY: number;
  depth: number;
  safeRadius: number;
  score: number;
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
];

const MAX_SCHOOLS_HIGH = 7;
const MAX_SCHOOLS_MEDIUM = 4;
const MAX_FISH_HIGH = 64;
const MAX_FISH_MEDIUM = 28;

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
  const radii = [field.step * 3.1, field.step * 2.4, field.step * 1.75];
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

/**
 * Deterministic renderer-only koi planning. Schools are restricted to standing inland water,
 * kept away from banks, and only emitted where there is enough depth for the visible fish body.
 */
export function planKoiSchools(
  field: TerrainField,
  seaLevel: number,
  seedPhase: number,
  complexity: 0 | 1 | 2,
): KoiSchoolPlan[] {
  if (complexity === 0) return [];
  const stride = Math.max(1, Math.floor(field.resolution / 42));
  const candidates: SchoolCandidate[] = [];
  const seed = seedPhase.toFixed(5);

  for (let gz = 1; gz < field.resolution - 1; gz += stride) {
    for (let gx = 1; gx < field.resolution - 1; gx += stride) {
      const index = gz * field.resolution + gx;
      if (!field.lake[index] || field.river[index] || (field.waterLevel[index] ?? -1) < 0) continue;
      const depth = sampleDepth(field, seaLevel, index);
      if (depth < 0.105) continue;
      const x = field.originX + gx * field.step;
      const z = field.originZ + gz * field.step;
      const safeRadius = safeLakeRadius(field, x, z);
      if (safeRadius <= 0) continue;
      const waterY = elevationToY(field.waterLevel[index]!, seaLevel);
      const depthScore = Math.min(1, depth / 0.55);
      const score = hashUnit(`${seed}:${gx}:${gz}:school`) * 0.72 + depthScore * 0.28;
      candidates.push({ x, z, waterY, depth, safeRadius, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const maxSchools = complexity === 2 ? MAX_SCHOOLS_HIGH : MAX_SCHOOLS_MEDIUM;
  const selected: SchoolCandidate[] = [];
  for (const candidate of candidates) {
    const spacing = Math.max(candidate.safeRadius * 2.25, field.step * 5.5);
    if (selected.some(existing => Math.hypot(existing.x - candidate.x, existing.z - candidate.z) < spacing)) continue;
    selected.push(candidate);
    if (selected.length >= maxSchools) break;
  }

  return selected.map((candidate, index) => {
    const identity = `${seed}:koi-school:${index}:${candidate.x.toFixed(3)}:${candidate.z.toFixed(3)}`;
    const countBase = complexity === 2 ? 7 : 4;
    const countRange = complexity === 2 ? 5 : 4;
    return {
      centerX: candidate.x,
      centerZ: candidate.z,
      waterY: candidate.waterY,
      depth: candidate.depth,
      orbitRadius: candidate.safeRadius * (0.36 + hashUnit(`${identity}:radius`) * 0.22),
      count: countBase + Math.floor(hashUnit(`${identity}:count`) * countRange),
      phase: hashUnit(`${identity}:phase`) * Math.PI * 2,
      speed: 0.115 + hashUnit(`${identity}:speed`) * 0.105,
      direction: hashUnit(`${identity}:direction`) < 0.5 ? -1 : 1,
    };
  });
}

/**
 * Visible aquatic life deliberately lives outside the water shader. Hydrology remains authoritative;
 * this renderer only places a small, instanced presentation layer underneath verified lake surfaces.
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
    private readonly world: WorldState,
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
          angleOffset: index / Math.max(1, count) * Math.PI * 2 + (hashUnit(`${identity}:angle`) - 0.5) * 0.7,
          radiusFactor: 0.38 + hashUnit(`${identity}:radius`) * 0.62,
          phase: hashUnit(`${identity}:phase`) * Math.PI * 2,
          size: 0.78 + hashUnit(`${identity}:size`) * 0.46,
          patchOffset: (hashUnit(`${identity}:patch-offset`) - 0.5) * 0.026,
          patchVisible: hashUnit(`${identity}:patch-visible`) > 0.14,
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
    const tailGeometry = new THREE.ConeGeometry(0.036, 0.068, 3, 1, false)
      .rotateX(Math.PI / 2)
      .translate(0, 0, -0.083);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0,
      vertexColors: true,
      emissive: '#100704',
      emissiveIntensity: 0.13,
    });
    const patchMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.45,
      metalness: 0,
      vertexColors: true,
      emissive: '#120704',
      emissiveIntensity: 0.11,
    });
    const tailMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.55,
      metalness: 0,
      vertexColors: true,
      side: THREE.DoubleSide,
      emissive: '#0d0503',
      emissiveIntensity: 0.09,
    });

    this.body = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, capacity);
    this.patches = new THREE.InstancedMesh(patchGeometry, patchMaterial, capacity);
    this.tails = new THREE.InstancedMesh(tailGeometry, tailMaterial, capacity);
    for (const mesh of [this.body, this.patches, this.tails]) {
      mesh.count = this.fishCount;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
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
      const breathe = 0.93 + Math.sin(elapsedSeconds * 0.53 + fish.phase) * 0.07;
      const radius = school.orbitRadius * fish.radiusFactor * breathe;
      const angle = school.phase + fish.angleOffset + elapsedSeconds * school.speed * school.direction
        + Math.sin(elapsedSeconds * 0.31 + fish.phase) * 0.08;
      const x = school.centerX + Math.cos(angle) * radius;
      const z = school.centerZ + Math.sin(angle) * radius * 0.72;
      const submerge = THREE.MathUtils.clamp(school.depth * (0.22 + fish.radiusFactor * 0.08), 0.045, 0.115);
      const y = school.waterY - submerge + Math.sin(elapsedSeconds * 0.82 + fish.phase) * 0.008;
      this.position.set(x, y, z);

      const dx = -Math.sin(angle) * school.direction;
      const dz = Math.cos(angle) * 0.72 * school.direction;
      const yaw = Math.atan2(dx, dz) + Math.sin(elapsedSeconds * 0.7 + fish.phase) * 0.055;
      this.quaternion.setFromAxisAngle(this.yAxis, yaw);

      this.scale.set(0.028 * fish.size, 0.017 * fish.size, 0.060 * fish.size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.body.setMatrixAt(index, this.matrix);

      const wag = Math.sin(elapsedSeconds * (7.2 + fish.radiusFactor * 1.8) + fish.phase) * 0.34;
      this.wagQuaternion.setFromAxisAngle(this.yAxis, wag);
      this.tailQuaternion.copy(this.quaternion).multiply(this.wagQuaternion);
      this.scale.setScalar(fish.size);
      this.matrix.compose(this.position, this.tailQuaternion, this.scale);
      this.tails.setMatrixAt(index, this.matrix);

      if (fish.patchVisible) {
        this.patchLocal.set(0, 0.0155 * fish.size, fish.patchOffset);
        this.patchLocal.applyQuaternion(this.quaternion);
        this.patchPosition.copy(this.position).add(this.patchLocal);
        this.scale.set(0.017 * fish.size, 0.0065 * fish.size, 0.026 * fish.size);
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
