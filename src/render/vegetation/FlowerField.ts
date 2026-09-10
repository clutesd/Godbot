import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { clamp01, smoothstep } from '../../sim/terrain/noise';
import type { WorldState } from '../../sim/types';
import { cellAt } from '../../sim/world';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import type { TreePlacement } from './ForestPlanner';

export type FlowerStage = 'dormant' | 'sprout' | 'bud' | 'bloom' | 'seed' | 'senescent';

export interface FlowerGrowth {
  stage: FlowerStage;
  visible: boolean;
  scale: number;
  bloom: number;
  seed: number;
}

interface FlowerPlacement {
  worldX: number;
  worldZ: number;
  scale: number;
  rotation: number;
  phase: number;
  colour: number;
  vigor: number;
}

export interface FlowerDisturbanceZone {
  x: number;
  z: number;
  radius: number;
}

export interface FlowerFieldReport {
  placements: number;
  visible: number;
  drawCalls: number;
  triangles: number;
}

const FLOWER_VIEW_RANGE = 30;
const FLOWER_STEM_HEIGHT = 0.065;
const TREE_FLOWER_SHARE = 0.38;
const MAX_PLAN_ATTEMPTS_MULTIPLIER = 8;
const FLOWER_COLOURS = [
  new THREE.Color('#f0d96c'),
  new THREE.Color('#ede8dc'),
  new THREE.Color('#d98ca7'),
  new THREE.Color('#a58bc7'),
  new THREE.Color('#83a9c9'),
] as const;
const SEED_COLOUR = new THREE.Color('#a78a5c');
const HIDDEN_SCALE = new THREE.Vector3(0.0001, 0.0001, 0.0001);

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

/**
 * One annual flower cycle. Month zero is winter in GODBOX. Winter is authoritative: individual
 * phase offsets stagger emergence and senescence inside the growing season but can never keep a
 * flower alive into months 10, 11 or 0.
 */
export function resolveFlowerGrowth(month: number, phase = 0.5): FlowerGrowth {
  const baseMonth = ((month % 12) + 12) % 12;
  if (baseMonth < 1 || baseMonth >= 10) return { stage: 'dormant', visible: false, scale: 0, bloom: 0, seed: 0 };

  const localMonth = Math.min(9.999, Math.max(1, baseMonth + (clamp01(phase) - 0.5) * 0.8));
  if (localMonth < 2.1) {
    const progress = (localMonth - 1) / 1.1;
    return { stage: 'sprout', visible: true, scale: lerp(0.16, 0.52, progress), bloom: 0, seed: 0 };
  }
  if (localMonth < 3.2) {
    const progress = (localMonth - 2.1) / 1.1;
    return { stage: 'bud', visible: true, scale: lerp(0.52, 0.86, progress), bloom: lerp(0.08, 0.42, progress), seed: 0 };
  }
  if (localMonth < 6.8) {
    const progress = (localMonth - 3.2) / 3.6;
    return { stage: 'bloom', visible: true, scale: lerp(0.86, 1.04, Math.sin(progress * Math.PI)), bloom: 1, seed: 0 };
  }
  if (localMonth < 8.8) {
    const progress = (localMonth - 6.8) / 2;
    return { stage: 'seed', visible: true, scale: lerp(0.96, 0.66, progress), bloom: lerp(0.62, 0.08, progress), seed: progress };
  }
  const progress = (localMonth - 8.8) / 1.2;
  return { stage: 'senescent', visible: true, scale: lerp(0.58, 0.12, progress), bloom: 0, seed: 1 };
}

/**
 * Cheap annual ground flora. Placements are planned once from grass/open ground and around a
 * subset of trees, then two instanced meshes express the seasonal cycle. Nothing ticks per flower.
 */
export class FlowerField {
  readonly group = new THREE.Group();
  private readonly placements: FlowerPlacement[];
  private readonly stems: THREE.InstancedMesh;
  private readonly blooms: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly colour = new THREE.Color();
  private visibleCount = 0;
  private readonly trianglesPerFlower: number;

  constructor(
    private readonly world: WorldState,
    private readonly surface: TerrainSurface,
    seed: string,
    budget: number,
    trees: readonly TreePlacement[],
  ) {
    this.group.name = 'seasonal-flowers';
    const capacity = Math.max(1, Math.floor(budget));
    this.placements = planFlowers(world, surface, seed, capacity, trees);

    const stemGeometry = new THREE.CylinderGeometry(0.0045, 0.0065, FLOWER_STEM_HEIGHT, 4)
      .translate(0, FLOWER_STEM_HEIGHT * 0.5, 0);
    const bloomGeometry = new THREE.CircleGeometry(0.025, 5);
    bloomGeometry.rotateX(-Math.PI / 2);
    const stemMaterial = new THREE.MeshStandardMaterial({ color: '#587348', roughness: 0.98, metalness: 0 });
    const bloomMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    this.stems = new THREE.InstancedMesh(stemGeometry, stemMaterial, capacity);
    this.blooms = new THREE.InstancedMesh(bloomGeometry, bloomMaterial, capacity);
    this.stems.name = 'seasonal-flower-stems';
    this.blooms.name = 'seasonal-flower-blooms';
    this.stems.count = 0;
    this.blooms.count = 0;
    this.stems.frustumCulled = false;
    this.blooms.frustumCulled = false;
    this.blooms.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.group.add(this.stems, this.blooms);

    const stemTriangles = (stemGeometry.getIndex()?.count ?? 0) / 3;
    const bloomTriangles = (bloomGeometry.getIndex()?.count ?? 0) / 3;
    this.trianglesPerFlower = stemTriangles + bloomTriangles;
  }

  get report(): FlowerFieldReport {
    return {
      placements: this.placements.length,
      visible: this.visibleCount,
      drawCalls: this.visibleCount > 0 ? 2 : 0,
      triangles: this.visibleCount * this.trianglesPerFlower,
    };
  }

  update(camera: THREE.Vector3, month: number, disturbance: readonly FlowerDisturbanceZone[]): void {
    let count = 0;
    for (const placement of this.placements) {
      if (count >= this.stems.instanceMatrix.count) break;
      if (Math.hypot(placement.worldX - camera.x, placement.worldZ - camera.z) > FLOWER_VIEW_RANGE) continue;
      if (disturbance.some((zone) => Math.hypot(placement.worldX - zone.x, placement.worldZ - zone.z) < zone.radius)) continue;

      const growth = resolveFlowerGrowth(month, placement.phase);
      if (!growth.visible) continue;
      const cell = cellAt(this.world, placement.worldX, placement.worldZ);
      const weather = cell ? this.world.weather?.cells[cell.z * this.world.size + cell.x] : undefined;
      if (weather && weather.snowpack > 0.08) continue;
      const waterY = this.surface.waterYAt(placement.worldX, placement.worldZ);
      const groundY = this.surface.heightAt(placement.worldX, placement.worldZ);
      if (Number.isFinite(waterY) && waterY > groundY - 0.025) continue;

      const currentMoisture = cell?.moisture ?? 0.5;
      const moistureVigor = 0.55 + smoothstep(0.18, 0.52, currentMoisture) * smoothstep(0.96, 0.62, currentMoisture) * 0.45;
      const size = placement.scale * placement.vigor * moistureVigor * growth.scale;
      if (size <= 0.01) continue;

      this.position.set(placement.worldX, groundY + 0.004, placement.worldZ);
      this.quaternion.setFromAxisAngle(this.axis, placement.rotation);
      this.scale.set(size * 0.8, size, size * 0.8);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.stems.setMatrixAt(count, this.matrix);

      const bloomScale = Math.max(0.0001, size * Math.max(0.05, growth.bloom));
      this.position.y = groundY + FLOWER_STEM_HEIGHT * size;
      if (growth.bloom <= 0.01) this.scale.copy(HIDDEN_SCALE);
      else this.scale.setScalar(bloomScale);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.blooms.setMatrixAt(count, this.matrix);
      const baseColour = FLOWER_COLOURS[placement.colour] ?? FLOWER_COLOURS[0];
      this.colour.copy(baseColour).lerp(SEED_COLOUR, growth.seed * 0.72);
      this.blooms.setColorAt(count, this.colour);
      count += 1;
    }

    this.visibleCount = count;
    this.stems.count = count;
    this.blooms.count = count;
    this.stems.instanceMatrix.needsUpdate = true;
    this.blooms.instanceMatrix.needsUpdate = true;
    if (this.blooms.instanceColor) this.blooms.instanceColor.needsUpdate = true;
  }
}

function planFlowers(
  world: WorldState,
  surface: TerrainSurface,
  seed: string,
  budget: number,
  trees: readonly TreePlacement[],
): FlowerPlacement[] {
  const random = new SeededRandom(`${seed}:plan`);
  const placements: FlowerPlacement[] = [];
  const suitableTrees = trees.filter((tree) => tree.family !== 'dry' && tree.family !== 'alpine');
  const treeBudget = Math.min(Math.floor(budget * TREE_FLOWER_SHARE), suitableTrees.length * 2);

  if (suitableTrees.length > 0) {
    const offset = random.int(0, suitableTrees.length);
    for (let index = 0; index < treeBudget && placements.length < budget; index += 1) {
      const tree = suitableTrees[(offset + index * 7) % suitableTrees.length];
      if (!tree) continue;
      const angle = random.range(0, Math.PI * 2);
      const radius = random.range(0.7, 2.2);
      tryAddFlower(surface, random, placements, tree.worldX + Math.cos(angle) * radius, tree.worldZ + Math.sin(angle) * radius, 0.88 + tree.regrowth * 0.18);
    }
  }

  const land = world.cells.filter((cell) => !cell.water && cell.moisture > 0.22 && cell.temperature > 0.24);
  if (land.length === 0) return placements;
  const half = world.cellSize * 0.5;
  const maxAttempts = Math.max(budget, budget * MAX_PLAN_ATTEMPTS_MULTIPLIER);
  for (let attempt = 0; attempt < maxAttempts && placements.length < budget; attempt += 1) {
    const cell = random.pick(land);
    const worldX = cell.worldX + random.range(-half, half);
    const worldZ = cell.worldZ + random.range(-half, half);
    const sample = surface.sample(worldX, worldZ);
    const openGround = 1 - smoothstep(0.5, 0.88, sample.wood);
    const moisture = smoothstep(0.2, 0.5, sample.moisture) * smoothstep(0.95, 0.7, sample.moisture);
    const warmth = smoothstep(0.24, 0.46, sample.temperature);
    const gentle = smoothstep(0.52, 0.2, sample.slope);
    const suitability = clamp01((0.28 + openGround * 0.72) * moisture * warmth * gentle);
    if (!random.chance(suitability * 0.72)) continue;
    tryAddFlower(surface, random, placements, worldX, worldZ, 0.78 + suitability * 0.3);
  }
  return placements;
}

function tryAddFlower(
  surface: TerrainSurface,
  random: SeededRandom,
  placements: FlowerPlacement[],
  worldX: number,
  worldZ: number,
  vigor: number,
): void {
  const sample = surface.sample(worldX, worldZ);
  if (sample.slope > 0.5 || sample.moisture < 0.18 || sample.temperature < 0.2) return;
  const y = surface.heightAt(worldX, worldZ);
  const waterY = surface.waterYAt(worldX, worldZ);
  if (Number.isFinite(waterY) && waterY > y - 0.025) return;
  placements.push({
    worldX,
    worldZ,
    scale: random.range(0.72, 1.18),
    rotation: random.range(0, Math.PI * 2),
    phase: random.float(),
    colour: random.int(0, FLOWER_COLOURS.length),
    vigor: clamp01(vigor),
  });
}
