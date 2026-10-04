import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { clamp01, fbm, smoothstep } from '../../sim/terrain/noise';
import type { Vec2, WorldState } from '../../sim/types';
import { isInsideReservedGround, type ReservedGround } from '../../shared/StructureGrounding';
import type { TerrainSurface } from './TerrainSurface';

/** A scattered instance set, with its ground positions and pristine matrices kept for clearing. */
interface ScatterSet {
  mesh: THREE.InstancedMesh;
  xz: Float32Array;
  count: number;
  pristine: Float32Array;
  hidden: Uint8Array;
}

export interface DecorReport {
  boulders: number;
  scree: number;
  groundCover: number;
}

interface BoulderCollider {
  x: number;
  z: number;
  radius: number;
}

/**
 * The small stuff that keeps the ground from reading as a painted surface: boulders clustered
 * along outcrops and scree under cliffs. Vegetation owns grass, reeds and scrub.
 */
export class TerrainDecor {
  readonly group = new THREE.Group();
  readonly report: DecorReport;
  private readonly boulderBuckets = new Map<string, BoulderCollider[]>();
  private readonly scatterSets: ScatterSet[] = [];

  constructor(world: WorldState, surface: TerrainSurface, seed: string, density: number) {
    this.group.name = 'terrain-decor';
    const random = new SeededRandom(`${seed}:decor`);
    const boulders = this.scatterRocks(world, surface, random, seed, Math.round(520 * density));
    const scree = this.scatterScree(world, surface, random, Math.round(900 * density));
    // The old four-sided green cones were a second, placeholder vegetation layer. In particular
    // they poked through construction fabric. Keep plant geometry in VegetationRenderer.
    this.report = { boulders, scree, groundCover: 0 };
  }

  /**
   * Hides decorative instances that fall inside reserved ground (occupied plots, worksites, fields).
   * Scatter is generated once at startup, but structures appear later, so this runs whenever the
   * reserved set changes. Hidden instances collapse to a zero matrix and return when released.
   * Presentation only: scatter positions and collisions are not part of simulation state.
   */
  setReservedGround(zones: readonly ReservedGround[]): void {
    for (const set of this.scatterSets) {
      let changed = false;
      for (let index = 0; index < set.count; index += 1) {
        const hide = isInsideReservedGround(set.xz[index * 2]!, set.xz[index * 2 + 1]!, 0.25, zones);
        if (hide === Boolean(set.hidden[index])) continue;
        set.hidden[index] = hide ? 1 : 0;
        const offset = index * 16;
        const target = set.mesh.instanceMatrix.array as Float32Array;
        for (let element = 0; element < 16; element += 1) {
          target[offset + element] = hide ? 0 : set.pristine[offset + element]!;
        }
        changed = true;
      }
      if (changed) set.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private registerScatter(mesh: THREE.InstancedMesh, xz: Float32Array, count: number): void {
    this.scatterSets.push({
      mesh,
      xz,
      count,
      pristine: (mesh.instanceMatrix.array as Float32Array).slice(0, count * 16),
      hidden: new Uint8Array(count),
    });
  }

  /** Boulders follow the rock field, so they gather along ridges and cliff bases instead of dusting the map evenly. */
  private scatterRocks(world: WorldState, surface: TerrainSurface, random: SeededRandom, seed: string, budget: number): number {
    const mesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0.04, vertexColors: true, flatShading: true }),
      Math.max(1, budget),
    );
    const matrix = new THREE.Matrix4();
    const xz = new Float32Array(Math.max(1, budget) * 2);
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
      xz[placed * 2] = worldX;
      xz[placed * 2 + 1] = worldZ;
      this.addBoulderCollider(worldX, worldZ, 0.34 * Math.max(scale.x, scale.z));
      colour.setHSL(0.08, 0.05, 0.54 + random.range(-0.06, 0.1)).lerp(new THREE.Color('#b3a99c'), sample.elevation * 0.4);
      mesh.setColorAt(placed, colour);
      placed += 1;
    }
    mesh.count = placed;
    this.registerScatter(mesh, xz, placed);
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
    const xz = new Float32Array(Math.max(1, budget) * 2);
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
      xz[placed * 2] = worldX;
      xz[placed * 2 + 1] = worldZ;
      colour.setHSL(0.08, 0.05, 0.5 + random.range(-0.07, 0.08));
      mesh.setColorAt(placed, colour);
      placed += 1;
    }
    mesh.count = placed;
    this.registerScatter(mesh, xz, placed);
    mesh.receiveShadow = true;
    if (placed > 0) this.group.add(mesh);
    return placed;
  }

  /**
   * Foot-level collision against the same boulders that are actually drawn. Scree and ground cover
   * remain traversable; only substantial rock bodies become pedestrian obstacles.
   */
  pedestrianSegmentClear(a: Vec2, b: Vec2, padding = 0.12): boolean {
    const margin = 0.8 + padding;
    const minX = Math.floor((Math.min(a.x, b.x) - margin) / 4);
    const maxX = Math.floor((Math.max(a.x, b.x) + margin) / 4);
    const minZ = Math.floor((Math.min(a.z, b.z) - margin) / 4);
    const maxZ = Math.floor((Math.max(a.z, b.z) + margin) / 4);
    const seen = new Set<BoulderCollider>();
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      for (const boulder of this.boulderBuckets.get(`${x}:${z}`) ?? []) {
        if (seen.has(boulder)) continue;
        seen.add(boulder);
        if (distanceToSegment(a, b, boulder.x, boulder.z) < boulder.radius + padding) return false;
      }
    }
    return true;
  }

  private addBoulderCollider(x: number, z: number, radius: number): void {
    // Tiny stones read as ground clutter and should not make pedestrians jitter around them.
    if (radius < 0.075) return;
    const collider = { x, z, radius };
    const margin = radius + 0.14;
    for (let bx = Math.floor((x - margin) / 4); bx <= Math.floor((x + margin) / 4); bx++) {
      for (let bz = Math.floor((z - margin) / 4); bz <= Math.floor((z + margin) / 4); bz++) {
        const key = `${bx}:${bz}`;
        const bucket = this.boulderBuckets.get(key) ?? [];
        bucket.push(collider);
        this.boulderBuckets.set(key, bucket);
      }
    }
  }
}


function distanceToSegment(a: Vec2, b: Vec2, x: number, z: number): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
