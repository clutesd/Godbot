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

/** Understory should be a landscape layer, not a close-up-only decoration. */
const FULL_DETAIL_RANGE = 78;
const VIEW_RANGE = 110;
/** Most understory belongs to actual woodland; the rest fills gaps and forest edges. */
const TREE_ASSOCIATED_SHARE = 0.72;
const MAX_PLAN_ATTEMPTS_MULTIPLIER = 12;
const DISPLAY_SCALE: Record<UnderstoryKind, number> = {
  fern: 1.32,
  shrub: 1.36,
  bush: 1.45,
};

const SUMMER_COLOURS: Record<UnderstoryKind, THREE.Color> = {
  fern: new THREE.Color('#4f8b43'),
  shrub: new THREE.Color('#71864c'),
  bush: new THREE.Color('#416c43'),
};
const AUTUMN_COLOURS: Record<UnderstoryKind, THREE.Color> = {
  fern: new THREE.Color('#a48245'),
  shrub: new THREE.Color('#a27446'),
  bush: new THREE.Color('#846a3f'),
};
const WINTER_COLOURS: Record<UnderstoryKind, THREE.Color> = {
  fern: new THREE.Color('#6d6547'),
  shrub: new THREE.Color('#74694d'),
  bush: new THREE.Color('#536347'),
};
const SNOW_COLOUR = new THREE.Color('#d8ded5');

/**
 * Understory remains fully readable beyond ordinary documentary framing, then fades through the
 * far landscape. This intentionally makes thickets visible in establishing shots.
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
      scale: 0.52 + emergence * 0.48,
      autumn,
      winter: 0,
    };
  }

  if (snowpack > 1.25) return { visible: false, scale: 0, autumn: 0, winter: winter ? 1 : 0 };
  const winterScale = kind === 'bush' ? 0.84 : 0.74;
  const snowLoad = clamp01(snowpack / 0.75);
  return {
    visible: true,
    scale: (winter ? winterScale : 1) * (1 - snowLoad * 0.16),
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
        ? 0.72 + smoothstep(0.26, 0.6, moisture) * smoothstep(0.99, 0.78, moisture) * 0.28
        : 0.78 + smoothstep(0.14, 0.48, moisture) * smoothstep(0.99, 0.74, moisture) * 0.22;
      const size = placement.scale * placement.vigor * appearance.scale * moistureVigor
        * distanceScale * DISPLAY_SCALE[placement.kind];
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
  const forestTrees = trees.filter((tree) => tree.family !== 'alpine');
  const treeTarget = Math.min(Math.floor(budget * TREE_ASSOCIATED_SHARE), forestTrees.length * 5);

  if (forestTrees.length > 0) {
    const offset = random.int(0, forestTrees.length);
    let anchor = 0;
    const maxAnchors = Math.max(forestTrees.length, treeTarget * 2);
    while (placements.length < treeTarget && anchor < maxAnchors) {
      const tree = forestTrees[(offset + anchor * 5) % forestTrees.length];
      anchor += 1;
      if (!tree) continue;
      const clusterSize = random.int(2, 6);
      for (let member = 0; member < clusterSize && placements.length < treeTarget; member += 1) {
        const angle = random.range(0, Math.PI * 2);
        const radius = random.range(0.55, 3.5);
        tryAddUnderstory(world, surface, random, placements,
          tree.worldX + Math.cos(angle) * radius,
          tree.worldZ + Math.sin(angle) * radius,
          0.94 + tree.regrowth * 0.12,
          1.18);
      }
    }
  }

  const forestCells = world.cells.filter((cell) => !cell.water && cell.wood > 0.05 && cell.moisture > 0.1 && cell.temperature > 0.13);
  if (forestCells.length === 0) return placements;
  const half = world.cellSize * 0.5;
  const maxAttempts = Math.max(budget, budget * MAX_PLAN_ATTEMPTS_MULTIPLIER);
  for (let attempt = 0; attempt < maxAttempts && placements.length < budget; attempt += 1) {
    const cell = random.pick(forestCells);
    const colonyX = cell.worldX + random.range(-half, half);
    const colonyZ = cell.worldZ + random.range(-half, half);
    const colonySize = random.int(2, 5);
    for (let member = 0; member < colonySize && placements.length < budget; member += 1) {
      const angle = random.range(0, Math.PI * 2);
      const radius = Math.sqrt(random.float()) * 1.15;
      tryAddUnderstory(world, surface, random, placements,
        colonyX + Math.cos(angle) * radius,
        colonyZ + Math.sin(angle) * radius,
        0.9,
        1.05);
    }
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
  if (sample.slope > 0.62 || sample.temperature < 0.13 || sample.moisture < 0.1 || sample.wood < 0.04) return;
  const groundY = surface.heightAt(worldX, worldZ);
  const waterY = surface.waterYAt(worldX, worldZ);
  if (Number.isFinite(waterY) && waterY > groundY - 0.035) return;

  const choice = chooseKind(random, sample.wood, sample.moisture, sample.temperature, sample.slope);
  if (!choice) return;
  const acceptance = clamp01(0.22 + choice.suitability * chanceScale);
  if (!random.chance(acceptance)) return;
  const scaleRange: Record<UnderstoryKind, readonly [number, number]> = {
    fern: [0.9, 1.55],
    shrub: [1, 1.7],
    bush: [1.1, 1.9],
  };
  const range = scaleRange[choice.kind];
  placements.push({
    worldX,
    worldZ,
    scale: random.range(range[0], range[1]),
    rotation: random.range(0, Math.PI * 2),
    kind: choice.kind,
    vigor: clamp01(vigor * (0.9 + choice.suitability * 0.18)),
  });
}

function chooseKind(
  random: SeededRandom,
  wood: number,
  moisture: number,
  temperature: number,
  slope: number,
): { kind: UnderstoryKind; suitability: number } | undefined {
  const gentle = 1 - smoothstep(0.34, 0.62, slope);
  const shade = smoothstep(0.1, 0.62, wood);
  const forestEdge = 1 - Math.abs(clamp01(wood) - 0.48) * 1.25;
  const fern = shade * smoothstep(0.3, 0.66, moisture) * smoothstep(0.15, 0.36, temperature) * (0.72 + gentle * 0.28);
  const shrub = smoothstep(0.04, 0.42, wood) * smoothstep(0.14, 0.4, temperature)
    * (0.6 + (1 - smoothstep(0.84, 1, moisture)) * 0.4) * (0.62 + gentle * 0.38);
  const bush = smoothstep(0.1, 0.54, wood) * smoothstep(0.2, 0.52, moisture) * smoothstep(0.18, 0.42, temperature)
    * (0.74 + clamp01(forestEdge) * 0.26) * (0.68 + gentle * 0.32);
  const total = fern + shrub + bush;
  if (total < 0.06) return undefined;
  const pick = random.float() * total;
  if (pick < fern) return { kind: 'fern', suitability: fern };
  if (pick < fern + shrub) return { kind: 'shrub', suitability: shrub };
  return { kind: 'bush', suitability: bush };
}

function countKinds(placements: readonly UnderstoryPlacement[]): Record<UnderstoryKind, number> {
  const result: Record<UnderstoryKind, number> = { fern: 0, shrub: 0, bush: 0 };
  for (const placement of placements) result[placement.kind] += 1;
  return result;
}

function buildShrubGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.IcosahedronGeometry(0.34, 0).scale(1.08, 0.88, 1).translate(0, 0.34, 0),
    new THREE.IcosahedronGeometry(0.28, 0).scale(0.92, 0.9, 1).translate(0.22, 0.42, 0.06),
    new THREE.IcosahedronGeometry(0.26, 0).scale(1, 0.86, 0.92).translate(-0.21, 0.39, -0.08),
    new THREE.IcosahedronGeometry(0.2, 0).scale(0.92, 0.92, 1).translate(0.02, 0.54, -0.13),
  ];
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

function buildBushGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.IcosahedronGeometry(0.44, 1).scale(1.08, 0.8, 1).translate(0, 0.44, 0),
    new THREE.IcosahedronGeometry(0.35, 0).scale(1, 0.94, 0.96).translate(0.34, 0.51, 0.1),
    new THREE.IcosahedronGeometry(0.34, 0).scale(0.96, 0.9, 1).translate(-0.33, 0.49, -0.05),
    new THREE.IcosahedronGeometry(0.31, 0).scale(0.92, 0.94, 1).translate(0.05, 0.61, 0.3),
    new THREE.IcosahedronGeometry(0.27, 0).scale(1, 0.92, 0.92).translate(-0.04, 0.68, -0.27),
  ];
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

function buildFernGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const fronds = 10;
  for (let frond = 0; frond < fronds; frond += 1) {
    const angle = frond / fronds * Math.PI * 2;
    const length = 0.48 + (frond % 3) * 0.055;
    const width = 0.1;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const px = -dz;
    const pz = dx;
    const base = positions.length / 3;
    positions.push(px * 0.02, 0.03, pz * 0.02);
    positions.push(dx * length * 0.5 + px * width, 0.21, dz * length * 0.5 + pz * width);
    positions.push(dx * length, 0.075, dz * length);
    positions.push(dx * length * 0.5 - px * width, 0.21, dz * length * 0.5 - pz * width);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}