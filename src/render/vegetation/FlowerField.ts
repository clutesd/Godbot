import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRandom } from '../../sim/prng';
import { clamp01, smoothstep } from '../../sim/terrain/noise';
import type { WorldState } from '../../sim/types';
import { cellAt } from '../../sim/world';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import type { TreePlacement } from './ForestPlanner';
import { UnderstoryField, type UnderstoryReport } from './UnderstoryField';
import { insideVegetationTerrain } from './VegetationPlacement';

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
  understory: Pick<UnderstoryReport, 'placements' | 'visible' | 'byKind'>;
  drawCalls: number;
  triangles: number;
}

/** All ordinary documentary framings stay at full flower scale, including 66-unit establishing shots. */
const FLOWER_FULL_DETAIL_RANGE = 68;
/** Fade only outside ordinary framing so the focal ground remains legible without rendering the whole world. */
const FLOWER_VIEW_RANGE = 90;
/** Still much smaller than a person, but large enough to read from settlement/street framing. */
const FLOWER_STEM_HEIGHT = 0.18;
const TREE_FLOWER_SHARE = 0.52;
const MAX_PLAN_ATTEMPTS_MULTIPLIER = 8;
const FLOWER_COLOURS = [
  new THREE.Color('#f0d96c'),
  new THREE.Color('#ede8dc'),
  new THREE.Color('#d98ca7'),
  new THREE.Color('#a58bc7'),
  new THREE.Color('#83a9c9'),
] as const;
const SEED_COLOUR = new THREE.Color('#a78a5c');
const STEM_COLOUR = new THREE.Color('#587348');
const POLLEN_COLOUR = new THREE.Color('#d5a544');

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

/** Keeps flowers fully readable through normal camera framing, then smoothly retires distant instances. */
export function flowerDistanceScale(distance: number): number {
  return smoothstep(FLOWER_VIEW_RANGE, FLOWER_FULL_DETAIL_RANGE, Math.max(0, distance));
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
    return { stage: 'sprout', visible: true, scale: lerp(0, 0.52, progress), bloom: 0, seed: 0 };
  }
  if (localMonth < 3.2) {
    const progress = (localMonth - 2.1) / 1.1;
    return { stage: 'bud', visible: true, scale: lerp(0.52, 0.86, progress), bloom: smoothstep(0, 1, progress), seed: 0 };
  }
  if (localMonth < 6.8) {
    const progress = (localMonth - 3.2) / 3.6;
    return { stage: 'bloom', visible: true, scale: lerp(0.86, 1.04, Math.sin(progress * Math.PI)), bloom: 1, seed: 0 };
  }
  if (localMonth < 8.8) {
    const progress = (localMonth - 6.8) / 2;
    return { stage: 'seed', visible: true, scale: lerp(0.86, 0.66, progress), bloom: 1 - smoothstep(0, 1, progress), seed: progress };
  }
  const progress = (localMonth - 8.8) / 1.2;
  return { stage: 'senescent', visible: true, scale: lerp(0.66, 0, progress), bloom: 0, seed: 1 };
}

/**
 * Cheap annual ground flora. Placements are planned once from grass/open ground and around a
 * subset of trees. The same bounded layer also owns shrubs, bushes and ferns so the renderer gets
 * a coherent forest floor without creating another simulation subsystem.
 */
export class FlowerField {
  readonly group = new THREE.Group();
  private readonly placements: FlowerPlacement[];
  private readonly understory: UnderstoryField;
  private readonly stems: THREE.InstancedMesh;
  private readonly blooms: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly colour = new THREE.Color();
  private visibleCount = 0;

  constructor(
    private readonly world: WorldState,
    private readonly surface: TerrainSurface,
    seed: string,
    budget: number,
    trees: readonly TreePlacement[],
  ) {
    this.group.name = 'seasonal-flowers';
    const plannedBudget = Math.max(0, Math.floor(budget));
    const capacity = Math.max(1, plannedBudget);
    this.placements = planFlowers(world, surface, seed, plannedBudget, trees);
    const understoryBudget = plannedBudget <= 0 ? 0 : Math.max(500, Math.min(3200, Math.round(plannedBudget * 1.15)));
    this.understory = new UnderstoryField(world, surface, `${seed}:understory`, understoryBudget, trees);

    const stalk = new THREE.CylinderGeometry(0.004, 0.007, FLOWER_STEM_HEIGHT, 4)
      .translate(0, FLOWER_STEM_HEIGHT * 0.5, 0);
    const leaf = new THREE.SphereGeometry(1, 4, 2).scale(0.034, 0.006, 0.012)
      .rotateZ(0.45).translate(0.024, FLOWER_STEM_HEIGHT * 0.4, 0);
    const secondLeaf = leaf.clone().rotateY(Math.PI).translate(0, FLOWER_STEM_HEIGHT * 0.2, 0);
    const stemGeometry = mergeGeometries([stalk, leaf, secondLeaf]);
    stalk.dispose(); leaf.dispose(); secondLeaf.dispose();
    const bloomGeometry = flowerPetals();
    const stemMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.98, metalness: 0 });
    const bloomMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    this.stems = new THREE.InstancedMesh(stemGeometry, stemMaterial, capacity);
    this.blooms = new THREE.InstancedMesh(bloomGeometry, bloomMaterial, capacity);
    this.heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.013, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.95 }), capacity);
    this.stems.name = 'seasonal-flower-stems';
    this.blooms.name = 'seasonal-flower-blooms';
    this.heads.name = 'seasonal-flower-seed-heads';
    for (const mesh of [this.stems, this.blooms, this.heads]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    }
    this.group.add(this.understory.group, this.stems, this.blooms, this.heads);
  }

  get report(): FlowerFieldReport {
    const understoryReport = this.understory.report;
    return {
      placements: this.placements.length,
      visible: this.visibleCount,
      understory: {
        placements: understoryReport.placements,
        visible: understoryReport.visible,
        byKind: { ...understoryReport.byKind },
      },
      drawCalls: [this.stems, this.blooms, this.heads].filter(mesh => mesh.count > 0).length + understoryReport.drawCalls,
      triangles: [this.stems, this.blooms, this.heads].reduce((sum, mesh) =>
        sum + mesh.count * (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3, 0) + understoryReport.triangles,
    };
  }

  update(camera: THREE.Vector3, month: number, disturbance: readonly FlowerDisturbanceZone[]): void {
    let count = 0;
    let blooms = 0;
    let heads = 0;
    for (const placement of this.placements) {
      if (count >= this.stems.instanceMatrix.count) break;
      const distance = Math.hypot(placement.worldX - camera.x, placement.worldZ - camera.z);
      const distanceScale = flowerDistanceScale(distance);
      if (distanceScale <= 0) continue;
      if (disturbance.some((zone) => Math.hypot(placement.worldX - zone.x, placement.worldZ - zone.z) < zone.radius)) continue;

      const growth = resolveFlowerGrowth(month, placement.phase);
      if (!growth.visible) continue;
      const cell = cellAt(this.world, placement.worldX, placement.worldZ);
      const weather = cell ? this.world.weather?.cells[cell.z * this.world.size + cell.x] : undefined;
      if (weather && weather.snowpack > 0.08) continue;
      if (weather && weather.temperature < 0.2) continue;
      const waterY = this.surface.waterYAt(placement.worldX, placement.worldZ);
      const groundY = this.surface.heightAt(placement.worldX, placement.worldZ);
      if (Number.isFinite(waterY) && waterY > groundY - 0.025) continue;

      const currentMoisture = cell?.moisture ?? 0.5;
      const moistureVigor = 0.55 + smoothstep(0.18, 0.52, currentMoisture) * smoothstep(0.96, 0.62, currentMoisture) * 0.45;
      const annualMonth = ((month % 12) + 12) % 12;
      const emergence = smoothstep(1, 1.4, annualMonth) * smoothstep(10, 9.6, annualMonth);
      const size = placement.scale * placement.vigor * moistureVigor * growth.scale * emergence * distanceScale;
      if (size <= 0.01) continue;

      this.position.set(placement.worldX, groundY + 0.004, placement.worldZ);
      this.quaternion.setFromAxisAngle(this.axis, placement.rotation);
      this.scale.set(size * 0.8, size, size * 0.8);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.stems.setMatrixAt(count, this.matrix);
      this.stems.setColorAt(count, this.colour.copy(STEM_COLOUR).lerp(SEED_COLOUR, growth.seed * 0.8));

      this.position.y = groundY + 0.004 + FLOWER_STEM_HEIGHT * size;
      if (growth.bloom > 0.01) {
        this.scale.setScalar(size * growth.bloom);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.blooms.setMatrixAt(blooms, this.matrix);
        this.colour.copy(FLOWER_COLOURS[placement.colour] ?? FLOWER_COLOURS[0]).lerp(SEED_COLOUR, growth.seed * 0.35);
        this.blooms.setColorAt(blooms++, this.colour);
      }
      if (growth.bloom > 0.05 || growth.seed > 0) {
        this.scale.setScalar(size * (0.6 + growth.seed * 0.65));
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.heads.setMatrixAt(heads, this.matrix);
        this.heads.setColorAt(heads++, this.colour.copy(POLLEN_COLOUR).lerp(SEED_COLOUR, growth.seed));
      }
      count += 1;
    }

    this.visibleCount = count;
    this.stems.count = count;
    this.blooms.count = blooms;
    this.heads.count = heads;
    for (const mesh of [this.stems, this.blooms, this.heads]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.understory.update(camera, month, disturbance);
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
      const tree = suitableTrees[(offset + index) % suitableTrees.length];
      if (!tree) continue;
      const angle = random.range(0, Math.PI * 2);
      const radius = random.range(0.6, 2.5);
      tryAddFlower(world, surface, random, placements, tree.worldX + Math.cos(angle) * radius, tree.worldZ + Math.sin(angle) * radius, 0.9 + tree.regrowth * 0.18);
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
    // Related colors and phases form small meadow drifts, with breathing room between colonies.
    const colour = random.int(0, FLOWER_COLOURS.length);
    const phase = random.float();
    const colonySize = random.int(5, 12);
    for (let flower = 0; flower < colonySize && placements.length < budget; flower += 1) {
      const angle = random.range(0, Math.PI * 2);
      const radius = Math.sqrt(random.float()) * 0.85;
      tryAddFlower(world, surface, random, placements, worldX + Math.cos(angle) * radius,
        worldZ + Math.sin(angle) * radius, 0.78 + suitability * 0.3, colour, clamp01(phase + random.range(-0.12, 0.12)));
    }
  }
  return placements;
}

function tryAddFlower(
  world: WorldState,
  surface: TerrainSurface,
  random: SeededRandom,
  placements: FlowerPlacement[],
  worldX: number,
  worldZ: number,
  vigor: number,
  colour = random.int(0, FLOWER_COLOURS.length),
  phase = random.float(),
): void {
  if (!insideVegetationTerrain(world, worldX, worldZ, 0.08)) return;
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
    phase,
    colour,
    vigor: clamp01(vigor),
  });
}

/** Five cupped, scalloped petals instead of a flat pentagonal marker. */
function flowerPetals(): THREE.BufferGeometry {
  const positions = [0, 0, 0];
  const indices: number[] = [];
  const segments = 40;
  for (let index = 0; index < segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    const radius = 0.06 * (0.73 + 0.27 * Math.cos(angle * 5));
    positions.push(Math.cos(angle) * radius, 0.01 * (radius / 0.06) ** 2, Math.sin(angle) * radius);
    indices.push(0, (index + 1) % segments + 1, index + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
