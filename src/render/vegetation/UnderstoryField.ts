import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRandom } from '../../sim/prng';
import { clamp01, smoothstep } from '../../sim/terrain/noise';
import type { WorldState } from '../../sim/types';
import { cellAt } from '../../sim/world';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import type { TreePlacement } from './ForestPlanner';
import { insideVegetationTerrain } from './VegetationPlacement';

export type UnderstoryKind = 'fern' | 'shrub' | 'bush';

interface UnderstoryPlacement {
  worldX: number;
  worldZ: number;
  scale: number;
  rotation: number;
  kind: UnderstoryKind;
  vigor: number;
}

export interface UnderstoryDisturbanceZone {
  x: number;
  z: number;
  radius: number;
}

export interface UnderstoryAppearance {
  visible: boolean;
  scale: number;
  autumn: number;
  winter: number;
}

export interface UnderstoryReport {
  placements: number;
  visible: number;
  byKind: Record<UnderstoryKind, number>;
  drawCalls: number;
  triangles: number;
}

const FULL_DETAIL_RANGE = 68;
const VIEW_RANGE = 88;
const TREE_ASSOCIATED_SHARE = 0.58;
const MAX_PLAN_ATTEMPTS_MULTIPLIER = 8;

const SUMMER_COLOURS: Record<UnderstoryKind, THREE.Color> = {
  fern: new THREE.Color('#4d7543'),
  shrub: new THREE.Color('#65774a'),
  bush: new THREE.Color('#3f6645'),
};
const AUTUMN_COLOURS: Record<UnderstoryKind, THREE.Color> = {
  fern: new THREE.Color('#9a7a45'),
  shrub: new THREE.Color('#9a7048'),
  bush: new THREE.Color('#7d6b43'),
};
const WINTER_COLOURS: Record<UnderstoryKind, THREE.Color> = {
  fern: new THREE.Color('#6d6547'),
  shrub: new THREE.Color('#72674e'),
  bush: new THREE.Color('#526047'),
};
const SNOW_COLOUR = new THREE.Color('#d8ded5');

/**
 * Understory remains readable through ordinary documentary framing, then fades before the far
 * landscape. Keeping the same full-detail boundary as flowers avoids a visible vegetation seam.
 */
export function understoryDistanceScale(distance: number): number {
  return smoothstep(VIEW_RANGE, FULL_DETAIL_RANGE, Math.max(0, distance));
}

/**
 * Seasonal presentation only: ferns die back in winter while woody shrubs and bushes persist at
 * reduced volume. Snow can bury ferns but merely weighs down taller woody growth.
 */
export function resolveUnderstoryAppearance(
  kind: UnderstoryKind,
  month: number,
  temperature: number,
  snowpack: number,
): UnderstoryAppearance {
  const annualMonth = ((month % 12) + 12) % 12;
  const winter = annualMonth < 1 || annualMonth >= 10;
  const autumn = winter ? 0 : smoothstep(7.2, 9.2, annualMonth) * smoothstep(10, 9.3, annualMonth);

  if (kind === 'fern') {
    if (winter || temperature < 0.2 || snowpack > 0.14) return { visible: false, scale: 0, autumn: 0, winter: winter ? 1 : 0 };
    const emergence = smoothstep(1.1, 2.5, annualMonth) * smoothstep(10, 8.8, annualMonth);
    return {
      visible: emergence > 0.02,
      scale: 0.48 + emergence * 0.52,
      autumn,
      winter: 0,
    };
  }

  if (snowpack > 1.25) return { visible: false, scale: 0, autumn: 0, winter: winter ? 1 : 0 };
  const winterScale = kind === 'bush' ? 0.82 : 0.72;
  const snowLoad = clamp01(snowpack / 0.75);
  return {
    visible: true,
    scale: (winter ? winterScale : 1) * (1 - snowLoad * 0.18),
    autumn,
    winter: winter ? 1 : 0,
  };
}

/**
 * Instanced forest-floor layer. It is deliberately presentation-only: terrain, tree distribution,
 * weather and settlement clearing determine what is drawn, but no new simulation state is added.
 */
export class UnderstoryField {
  readonly group = new THREE.Group();
  private readonly placements: UnderstoryPlacement[];
  private readonly meshes: Record<UnderstoryKind, THREE.InstancedMesh>;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly colour = new THREE.Color();
  private visibleCount = 0;
  private readonly plannedByKind: Record<UnderstoryKind, number>;

  constructor(
    private readonly world: WorldState,
    private readonly surface: TerrainSurface,
    seed: string,
    budget: number,
    trees: readonly TreePlacement[],
  ) {
    this.group.name = 'forest-understory';
    const plannedBudget = Math.max(0, Math.floor(budget));
    this.placements = planUnderstory(world, surface, seed, plannedBudget, trees);
    this.plannedByKind = countKinds(this.placements);

    const fernGeometry = buildFernGeometry();
    const shrubGeometry = buildShrubGeometry();
    const bushGeometry = buildBushGeometry();
    this.meshes = {
      fern: this.createMesh('ferns', fernGeometry, this.plannedByKind.fern),
      shrub: this.createMesh('shrubs', shrubGeometry, this.plannedByKind.shrub),
      bush: this.createMesh('bushes', bushGeometry, this.plannedByKind.bush),
    };
    this.group.add(this.meshes.fern, this.meshes.shrub, this.meshes.bush);
  }

  get report(): UnderstoryReport {
    let triangles = 0;
    let drawCalls = 0;
    for (const kind of ['fern', 'shrub', 'bush'] as const) {
      const mesh = this.meshes[kind];
      if (mesh.count > 0) drawCalls += 1;
      triangles += mesh.count * (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
    }
    return {
      placements: this.placements.length,
      visible: this.visibleCount,
      byKind: { ...this.plannedByKind },
      drawCalls,
      triangles,
    };
  }

  update(camera: THREE.Vector3, month: number, disturbance: readonly UnderstoryDisturbanceZone[]): void {
    const counts: Record<UnderstoryKind, number> = { fern: 0, shrub: 0, bush: 0 };
    let visible = 0;

    for (const placement of this.placements) {
      const distance = Math.hypot(placement.worldX - camera.x, placement.worldZ - camera.z);
      const distanceScale = understoryDistanceScale(distance);
      if (distanceScale <= 0) continue;
      if (disturbance.some((zone) => Math.hypot(placement.worldX - zone.x, placement.worldZ - zone.z) < zone.radius)) continue;

      const cell = cellAt(this.world, placement.worldX, placement.worldZ);
      if (!cell) continue;
      const weather = this.world.weather?.cells[cell.z * this.world.size + cell.x];
      const temperature = weather?.temperature ?? cell.temperature;
      const snowpack = weather?.snowpack ?? 0;
      const appearance = resolveUnderstoryAppearance(placement.kind, month, temperature, snowpack);
      if (!appearance.visible) continue;

      const groundY = this.surface.heightAt(placement.worldX, placement.worldZ);
      const waterY = this.surface.waterYAt(placement.worldX, placement.worldZ);
      if (Number.isFinite(waterY) && waterY > groundY - 0.035) continue;

      const moisture = cell.moisture;
      const moistureVigor = placement.kind === 'fern'
        ? smoothstep(0.32, 0.62, moisture) * smoothstep(0.96, 0.76, moisture)
        : 0.65 + smoothstep(0.18, 0.5, moisture) * smoothstep(0.98, 0.72, moisture) * 0.35;
      const size = placement.scale * placement.vigor * appearance.scale * moistureVigor * distanceScale;
      if (size <= 0.04) continue;

      const mesh = this.meshes[placement.kind];
      const index = counts[placement.kind];
      if (index >= mesh.instanceMatrix.count) continue;
      this.position.set(placement.worldX, groundY + 0.01, placement.worldZ);
      this.quaternion.setFromAxisAngle(this.axis, placement.rotation);
      this.scale.setScalar(size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(index, this.matrix);

      this.colour.copy(SUMMER_COLOURS[placement.kind]);
      this.colour.lerp(AUTUMN_COLOURS[placement.kind], appearance.autumn);
      this.colour.lerp(WINTER_COLOURS[placement.kind], appearance.winter * 0.86);
      this.colour.lerp(SNOW_COLOUR, clamp01(snowpack / 0.7) * 0.34);
      mesh.setColorAt(index, this.colour);
      counts[placement.kind] += 1;
      visible += 1;
    }

    this.visibleCount = visible;
    for (const kind of ['fern', 'shrub', 'bush'] as const) {
      const mesh = this.meshes[kind];
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private createMesh(name: string, geometry: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, metalness: 0, side: THREE.DoubleSide }),
      Math.max(1, capacity),
    );
    mesh.name = `understory-${name}`;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3).setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }
}

function planUnderstory(
  world: WorldState,
  surface: TerrainSurface,
  seed: string,
  budget: number,
  trees: readonly TreePlacement[],
): UnderstoryPlacement[] {
  if (budget <= 0) return [];
  const random = new SeededRandom(`${seed}:plan`);
  const placements: UnderstoryPlacement[] = [];
  const forestTrees = trees.filter((tree) => tree.family !== 'dry' && tree.family !== 'alpine');
  const treeBudget = Math.min(Math.floor(budget * TREE_ASSOCIATED_SHARE), forestTrees.length * 2);

  if (forestTrees.length > 0) {
    const offset = random.int(0, forestTrees.length);
    for (let index = 0; index < treeBudget && placements.length < budget; index += 1) {
      const tree = forestTrees[(offset + index * 5) % forestTrees.length];
      if (!tree) continue;
      const angle = random.range(0, Math.PI * 2);
      const radius = random.range(0.8, 3.2);
      tryAddUnderstory(world, surface, random, placements,
        tree.worldX + Math.cos(angle) * radius,
        tree.worldZ + Math.sin(angle) * radius,
        0.88 + tree.regrowth * 0.18,
        0.95);
    }
  }

  const forestCells = world.cells.filter((cell) => !cell.water && cell.wood > 0.12 && cell.temperature > 0.16);
  if (forestCells.length === 0) return placements;
  const half = world.cellSize * 0.5;
  const maxAttempts = Math.max(budget, budget * MAX_PLAN_ATTEMPTS_MULTIPLIER);
  for (let attempt = 0; attempt < maxAttempts && placements.length < budget; attempt += 1) {
    const cell = random.pick(forestCells);
    const worldX = cell.worldX + random.range(-half, half);
    const worldZ = cell.worldZ + random.range(-half, half);
    tryAddUnderstory(world, surface, random, placements, worldX, worldZ, 0.8, 0.78);
  }
  return placements;
}

function tryAddUnderstory(
  world: WorldState,
  surface: TerrainSurface,
  random: SeededRandom,
  placements: UnderstoryPlacement[],
  worldX: number,
  worldZ: number,
  vigor: number,
  chanceScale: number,
): void {
  if (!insideVegetationTerrain(world, worldX, worldZ, 0.1)) return;
  const sample = surface.sample(worldX, worldZ);
  if (sample.slope > 0.58 || sample.temperature < 0.16 || sample.moisture < 0.14 || sample.wood < 0.08) return;
  const groundY = surface.heightAt(worldX, worldZ);
  const waterY = surface.waterYAt(worldX, worldZ);
  if (Number.isFinite(waterY) && waterY > groundY - 0.035) return;

  const choice = chooseKind(random, sample.wood, sample.moisture, sample.temperature, sample.slope);
  if (!choice || !random.chance(clamp01(choice.suitability * chanceScale))) return;
  const scaleRange: Record<UnderstoryKind, readonly [number, number]> = {
    fern: [0.62, 1.08],
    shrub: [0.72, 1.2],
    bush: [0.8, 1.28],
  };
  const range = scaleRange[choice.kind];
  placements.push({
    worldX,
    worldZ,
    scale: random.range(range[0], range[1]),
    rotation: random.range(0, Math.PI * 2),
    kind: choice.kind,
    vigor: clamp01(vigor * (0.78 + choice.suitability * 0.28)),
  });
}

function chooseKind(
  random: SeededRandom,
  wood: number,
  moisture: number,
  temperature: number,
  slope: number,
): { kind: UnderstoryKind; suitability: number } | undefined {
  const gentle = 1 - smoothstep(0.3, 0.58, slope);
  const shade = smoothstep(0.16, 0.66, wood);
  const fern = shade * smoothstep(0.38, 0.72, moisture) * smoothstep(0.18, 0.4, temperature) * gentle;
  const shrub = smoothstep(0.1, 0.48, wood) * smoothstep(0.18, 0.44, temperature)
    * (0.55 + (1 - smoothstep(0.76, 0.98, moisture)) * 0.45) * (0.65 + gentle * 0.35);
  const bush = smoothstep(0.18, 0.6, wood) * smoothstep(0.28, 0.58, moisture) * smoothstep(0.24, 0.46, temperature)
    * (0.72 + (1 - smoothstep(0.82, 0.98, wood)) * 0.28) * (0.7 + gentle * 0.3);
  const total = fern + shrub + bush;
  if (total < 0.08) return undefined;
  let pick = random.float() * total;
  if ((pick -= fern) < 0) return { kind: 'fern', suitability: fern };
  if ((pick -= shrub) < 0) return { kind: 'shrub', suitability: shrub };
  return { kind: 'bush', suitability: bush };
}

function countKinds(placements: readonly UnderstoryPlacement[]): Record<UnderstoryKind, number> {
  const result: Record<UnderstoryKind, number> = { fern: 0, shrub: 0, bush: 0 };
  for (const placement of placements) result[placement.kind] += 1;
  return result;
}

function buildShrubGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.IcosahedronGeometry(0.29, 0).scale(1, 0.82, 1).translate(0, 0.28, 0),
    new THREE.IcosahedronGeometry(0.23, 0).scale(0.9, 0.86, 1).translate(0.18, 0.34, 0.05),
    new THREE.IcosahedronGeometry(0.21, 0).scale(1, 0.82, 0.9).translate(-0.16, 0.32, -0.07),
  ];
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

function buildBushGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.IcosahedronGeometry(0.36, 1).scale(1.05, 0.76, 1).translate(0, 0.36, 0),
    new THREE.IcosahedronGeometry(0.29, 0).scale(1, 0.9, 0.95).translate(0.27, 0.42, 0.08),
    new THREE.IcosahedronGeometry(0.28, 0).scale(0.95, 0.86, 1).translate(-0.26, 0.4, -0.04),
    new THREE.IcosahedronGeometry(0.25, 0).scale(0.9, 0.9, 1).translate(0.04, 0.48, 0.25),
  ];
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

function buildFernGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const fronds = 8;
  for (let frond = 0; frond < fronds; frond += 1) {
    const angle = frond / fronds * Math.PI * 2;
    const length = 0.38 + (frond % 2) * 0.07;
    const width = 0.075;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const px = -dz;
    const pz = dx;
    const base = positions.length / 3;
    positions.push(px * 0.018, 0.025, pz * 0.018);
    positions.push(dx * length * 0.52 + px * width, 0.15, dz * length * 0.52 + pz * width);
    positions.push(dx * length, 0.055, dz * length);
    positions.push(dx * length * 0.52 - px * width, 0.15, dz * length * 0.52 - pz * width);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
