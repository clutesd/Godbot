import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { clamp01, fbm, smoothstep } from '../../sim/terrain/noise';
import { nearestIndex } from '../../sim/terrain/TerrainField';
import type { WorldState } from '../../sim/types';
import type { TerrainSurface } from './TerrainSurface';

export interface DecorReport {
  boulders: number;
  scree: number;
  groundCover: number;
  flowers: number;
}

export type FlowerStage = 'dormant' | 'sprout' | 'bud' | 'bloom' | 'seed';

export interface FlowerSeasonState {
  stage: FlowerStage;
  stemScale: number;
  bloomScale: number;
  senescence: number;
}

interface FlowerPlacement {
  worldX: number;
  worldZ: number;
  y: number;
  scale: number;
  rotation: number;
  phaseOffset: number;
  baseColour: THREE.Color;
}

const FLOWER_COLOURS = ['#d889a8', '#e8c45c', '#d8d5ef', '#a889d7', '#f0a76d', '#e9e2c4'] as const;
const FLOWER_STEM_GREEN = new THREE.Color('#668247');
const FLOWER_DRY = new THREE.Color('#8b7747');

/**
 * Small seasonal annual/perennial presentation cycle. Winter is always dormant regardless of the
 * per-flower phase offset, so flowers cannot linger visually through snow season. The offset only
 * staggers emergence and bloom inside spring, summer and autumn.
 */
export function resolveFlowerSeason(month: number, phaseOffset = 0): FlowerSeasonState {
  const baseMonth = ((month % 12) + 12) % 12;
  if (baseMonth < 1 || baseMonth >= 10) {
    return { stage: 'dormant', stemScale: 0, bloomScale: 0, senescence: 1 };
  }

  const seasonalMonth = Math.min(9.999, Math.max(1, baseMonth + phaseOffset));
  if (seasonalMonth < 2.2) {
    const progress = clamp01((seasonalMonth - 1) / 1.2);
    return { stage: 'sprout', stemScale: 0.12 + progress * 0.5, bloomScale: 0, senescence: 0 };
  }
  if (seasonalMonth < 3.5) {
    const progress = clamp01((seasonalMonth - 2.2) / 1.3);
    return { stage: 'bud', stemScale: 0.62 + progress * 0.38, bloomScale: 0.12 + progress * 0.38, senescence: 0 };
  }
  if (seasonalMonth < 7.2) {
    const fullness = 0.86 + Math.sin(((seasonalMonth - 3.5) / 3.7) * Math.PI) * 0.14;
    return { stage: 'bloom', stemScale: 1, bloomScale: fullness, senescence: 0 };
  }

  const progress = clamp01((seasonalMonth - 7.2) / 2.8);
  return {
    stage: 'seed',
    stemScale: 1 - progress * 0.48,
    bloomScale: Math.max(0, 0.72 * (1 - progress)),
    senescence: progress,
  };
}

/**
 * The small stuff that keeps the ground from reading as a painted surface: boulders clustered
 * along outcrops, scree under cliffs, grass and reeds softening every edge, and a bounded seasonal
 * flower layer that follows meadows and woodland edges.
 */
export class TerrainDecor {
  readonly group = new THREE.Group();
  readonly report: DecorReport;

  constructor(world: WorldState, surface: TerrainSurface, seed: string, density: number) {
    this.group.name = 'terrain-decor';
    const random = new SeededRandom(`${seed}:decor`);
    const boulders = this.scatterRocks(world, surface, random, seed, Math.round(520 * density));
    const scree = this.scatterScree(world, surface, random, Math.round(900 * density));
    const groundCover = this.scatterGroundCover(world, surface, random, seed, Math.round(2600 * density));
    const flowers = this.scatterFlowers(world, surface, random, seed, Math.round(900 * density));
    this.report = { boulders, scree, groundCover, flowers };
  }

  /** Boulders follow the rock field, so they gather along ridges and cliff bases instead of dusting the map evenly. */
  private scatterRocks(world: WorldState, surface: TerrainSurface, random: SeededRandom, seed: string, budget: number): number {
    const mesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0.04, vertexColors: true, flatShading: true }),
      Math.max(1, budget),
    );
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const colour = new THREE.Color();
    const half = world.size * world.cellSize * 0.5;
    let placed = 0;
    for (let attempt = 0; attempt < budget * 8 && placed < budget; attempt += 1) {
      const worldX = random.range(-half, half);
      const worldZ = random.range(-half, half);
      const sample = surface.sample(worldX, worldZ);
      if (sample.elevation < world.seaLevel + 0.004) continue;
      const cluster = fbm(`${seed}:boulder-field`, worldX * 0.09, worldZ * 0.09, 3);
      const chance = clamp01(smoothstep(0.42, 0.86, sample.rock) * 0.75 + smoothstep(0.4, 0.8, sample.slope) * 0.55) * smoothstep(0.42, 0.84, cluster);
      if (!random.chance(chance)) continue;
      const size = random.range(0.2, 0.72) * (1 + sample.rock * 0.55);
      position.set(worldX, surface.heightAt(worldX, worldZ) + size * 0.12, worldZ);
      euler.set(random.range(-0.5, 0.5), random.range(0, Math.PI * 2), random.range(-0.5, 0.5));
      quaternion.setFromEuler(euler);
      scale.set(size * random.range(0.8, 1.3), size * random.range(0.5, 0.9), size * random.range(0.8, 1.3));
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(placed, matrix);
      colour.setHSL(0.08, 0.05, 0.54 + random.range(-0.06, 0.1)).lerp(new THREE.Color('#b3a99c'), sample.elevation * 0.4);
      mesh.setColorAt(placed, colour);
      placed += 1;
    }
    mesh.count = placed;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (placed > 0) this.group.add(mesh);
    return placed;
  }

  /** Loose stone aprons below steep faces. Small, flat and numerous; they read as erosion debris. */
  private scatterScree(world: WorldState, surface: TerrainSurface, random: SeededRandom, budget: number): number {
    const mesh = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(0.16, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, vertexColors: true, flatShading: true }),
      Math.max(1, budget),
    );
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const colour = new THREE.Color();
    const half = world.size * world.cellSize * 0.5;
    let placed = 0;
    for (let attempt = 0; attempt < budget * 6 && placed < budget; attempt += 1) {
      const worldX = random.range(-half, half);
      const worldZ = random.range(-half, half);
      const sample = surface.sample(worldX, worldZ);
      if (sample.elevation < world.seaLevel + 0.006) continue;
      if (!random.chance(smoothstep(0.4, 0.78, sample.slope) * (0.25 + sample.rock * 0.6))) continue;
      const size = random.range(0.4, 1.2);
      position.set(worldX, surface.heightAt(worldX, worldZ) + 0.03, worldZ);
      euler.set(random.range(-1, 1), random.range(0, Math.PI * 2), random.range(-1, 1));
      quaternion.setFromEuler(euler);
      scale.set(size, size * 0.55, size);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(placed, matrix);
      colour.setHSL(0.08, 0.05, 0.5 + random.range(-0.07, 0.08));
      mesh.setColorAt(placed, colour);
      placed += 1;
    }
    mesh.count = placed;
    mesh.receiveShadow = true;
    if (placed > 0) this.group.add(mesh);
    return placed;
  }

  /**
   * Grass, reeds and low scrub. Density is deliberately uneven: heaviest at shorelines, riverbanks
   * and forest edges, where a hard material boundary would otherwise show.
   */
  private scatterGroundCover(world: WorldState, surface: TerrainSurface, random: SeededRandom, seed: string, budget: number): number {
    const mesh = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.06, 0.22, 4),
      new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true }),
      Math.max(1, budget),
    );
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const colour = new THREE.Color();
    const half = world.size * world.cellSize * 0.5;
    let placed = 0;
    for (let attempt = 0; attempt < budget * 5 && placed < budget; attempt += 1) {
      const worldX = random.range(-half, half);
      const worldZ = random.range(-half, half);
      const sample = surface.sample(worldX, worldZ);
      if (sample.elevation < world.seaLevel + 0.002) continue;
      const fieldIndex = nearestIndex(world.terrain, worldX, worldZ);
      const bankside = world.terrain.river[fieldIndex] || world.terrain.lake[fieldIndex] ? 1 : 0;
      const shore = smoothstep(world.seaLevel + 0.05, world.seaLevel + 0.004, sample.elevation);
      const meadow = smoothstep(0.28, 0.62, sample.moisture) * smoothstep(0.62, 0.2, sample.slope);
      const patch = fbm(`${seed}:ground-cover`, worldX * 0.2 + 12, worldZ * 0.2 - 7, 3);
      if (!random.chance(clamp01(meadow * 0.8 + shore * 0.5 + bankside * 0.6) * smoothstep(0.32, 0.78, patch))) continue;
      const size = random.range(0.5, 1.15);
      position.set(worldX, surface.heightAt(worldX, worldZ) + 0.09 * size, worldZ);
      euler.set(random.range(-0.16, 0.16), random.range(0, Math.PI * 2), random.range(-0.16, 0.16));
      quaternion.setFromEuler(euler);
      const reed = bankside > 0 && random.chance(0.55);
      scale.set(size * (reed ? 0.7 : 1.25), size * (reed ? 1.9 : random.range(0.7, 1.2)), size * (reed ? 0.7 : 1.25));
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(placed, matrix);
      colour.set(reed ? '#5c7548' : sample.moisture < 0.32 ? '#9d9153' : '#6d8749');
      colour.offsetHSL(random.range(-0.02, 0.02), random.range(-0.07, 0.07), random.range(-0.06, 0.06));
      mesh.setColorAt(placed, colour);
      placed += 1;
    }
    mesh.count = placed;
    mesh.receiveShadow = true;
    if (placed > 0) this.group.add(mesh);
    return placed;
  }

  /**
   * Tiny flowers concentrate in grassy meadows and along the edges of woodland. Placement is fixed
   * and seeded; only the coarse seasonal growth presentation changes, so deep-time runs do not gain
   * per-flower simulation state or unbounded objects.
   */
  private scatterFlowers(world: WorldState, surface: TerrainSurface, random: SeededRandom, seed: string, budget: number): number {
    const stem = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.018, 0.2, 3).translate(0, 0.1, 0),
      new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true }),
      Math.max(1, budget),
    );
    const bloom = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.05, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0, vertexColors: true }),
      Math.max(1, budget),
    );
    stem.name = 'seasonal-flower-stems';
    bloom.name = 'seasonal-flower-blooms';

    const placements: FlowerPlacement[] = [];
    const half = world.size * world.cellSize * 0.5;
    for (let attempt = 0; attempt < budget * 8 && placements.length < budget; attempt += 1) {
      const worldX = random.range(-half, half);
      const worldZ = random.range(-half, half);
      const sample = surface.sample(worldX, worldZ);
      if (sample.elevation < world.seaLevel + 0.004 || sample.slope > 0.55) continue;
      const waterY = surface.waterYAt(worldX, worldZ);
      const y = surface.heightAt(worldX, worldZ);
      if (Number.isFinite(waterY) && waterY > y - 0.04) continue;

      const meadow = smoothstep(0.26, 0.64, sample.moisture) * smoothstep(0.56, 0.16, sample.slope);
      const woodlandEdge = smoothstep(0.12, 0.38, sample.wood) * smoothstep(0.82, 0.38, sample.wood);
      const warmth = 0.35 + smoothstep(0.2, 0.48, sample.temperature) * 0.65;
      const patch = fbm(`${seed}:flower-field`, worldX * 0.16 - 31, worldZ * 0.16 + 47, 3);
      const suitability = clamp01(meadow * 0.72 + woodlandEdge * 0.9) * warmth * smoothstep(0.34, 0.76, patch);
      if (!random.chance(suitability)) continue;

      placements.push({
        worldX,
        worldZ,
        y: y + 0.006,
        scale: random.range(0.55, 1.18),
        rotation: random.range(0, Math.PI * 2),
        phaseOffset: random.range(-0.48, 0.48),
        baseColour: new THREE.Color(FLOWER_COLOURS[random.int(0, FLOWER_COLOURS.length)] ?? FLOWER_COLOURS[0]),
      });
    }

    stem.count = placements.length;
    bloom.count = placements.length;
    stem.receiveShadow = true;
    bloom.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    const stemColour = new THREE.Color();
    const bloomColour = new THREE.Color();
    let renderedMonth = Number.NaN;

    const updateSeason = (): void => {
      const month = world.weather?.month ?? 0;
      if (month === renderedMonth) return;
      renderedMonth = month;

      for (let index = 0; index < placements.length; index += 1) {
        const flower = placements[index];
        if (!flower) continue;
        const state = resolveFlowerSeason(month, flower.phaseOffset);
        quaternion.setFromAxisAngle(axis, flower.rotation);

        const stemWidth = flower.scale * (0.55 + state.stemScale * 0.45);
        position.set(flower.worldX, flower.y, flower.worldZ);
        scale.set(stemWidth, Math.max(0.0001, flower.scale * state.stemScale), stemWidth);
        matrix.compose(position, quaternion, scale);
        stem.setMatrixAt(index, matrix);

        position.y = flower.y + 0.2 * flower.scale * state.stemScale;
        const bloomScale = Math.max(0.0001, flower.scale * state.bloomScale);
        scale.setScalar(bloomScale);
        matrix.compose(position, quaternion, scale);
        bloom.setMatrixAt(index, matrix);

        stemColour.copy(FLOWER_STEM_GREEN).lerp(FLOWER_DRY, state.senescence * 0.82);
        bloomColour.copy(flower.baseColour).lerp(FLOWER_DRY, state.senescence);
        stem.setColorAt(index, stemColour);
        bloom.setColorAt(index, bloomColour);
      }
      stem.instanceMatrix.needsUpdate = true;
      bloom.instanceMatrix.needsUpdate = true;
      if (stem.instanceColor) stem.instanceColor.needsUpdate = true;
      if (bloom.instanceColor) bloom.instanceColor.needsUpdate = true;
    };

    // Keep the meshes renderable in winter: their instances collapse to near-zero scale instead
    // of setting visible=false, allowing onBeforeRender to wake them again when spring arrives.
    stem.onBeforeRender = updateSeason;
    bloom.onBeforeRender = updateSeason;
    updateSeason();
    if (placements.length > 0) this.group.add(stem, bloom);
    return placements.length;
  }
}
