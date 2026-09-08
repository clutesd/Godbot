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
}

/**
 * The small stuff that keeps the ground from reading as a painted surface: boulders clustered
 * along outcrops, scree under cliffs, grass and reeds softening every edge.
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
    this.report = { boulders, scree, groundCover };
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
      if (random.chance(0.05)) colour.set(random.chance(0.5) ? '#c9799a' : '#d8b661');
      mesh.setColorAt(placed, colour);
      placed += 1;
    }
    mesh.count = placed;
    mesh.receiveShadow = true;
    if (placed > 0) this.group.add(mesh);
    return placed;
  }
}
