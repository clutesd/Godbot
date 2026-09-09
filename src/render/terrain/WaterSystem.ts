import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { clamp01 } from '../../sim/terrain/noise';
import type { WorldState } from '../../sim/types';
import { softPointTexture } from '../atmosphere/sprites';
import { elevationToY, type TerrainSurface } from './TerrainSurface';
import { surfaceHeightAt } from '../../sim/terrain/SurfaceGeometry';

export interface WaterReport {
  lakeSurfaces: number;
  riverSamples: number;
  waterfalls: number;
}

const read = (values: Float32Array, index: number): number => values[index] ?? 0;

/**
 * Everything wet. The ocean is a single sheet, inland water is meshed from the filled basins the
 * hydrology found, and the falls get their own foam so a big drop reads as an event.
 */
export class WaterSystem {
  readonly group = new THREE.Group();
  readonly report: WaterReport;
  private readonly ocean: THREE.Mesh;
  private readonly oceanY: number;
  private readonly foam: THREE.Points | undefined;
  private readonly foamBase: Float32Array;
  private readonly mist: THREE.Points | undefined;
  private inland: THREE.Mesh | undefined;
  private revision = -1;

  constructor(private readonly world: WorldState, surface: TerrainSurface, seed: string) {
    // Far enough out that fog swallows the edge of the sheet before the camera can see it.
    const span = Math.max(world.size * world.cellSize * 6, 720);
    this.group.name = 'water';

    const oceanMaterial = new THREE.MeshPhysicalMaterial({
      color: '#2a6b7a',
      roughness: 0.16,
      metalness: 0.02,
      depthWrite: true,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
    });
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(span, span, 1, 1), oceanMaterial);
    this.ocean.rotation.x = -Math.PI / 2;
    this.oceanY = surface.seaLevelY - 0.02;
    this.ocean.position.y = this.oceanY;
    this.ocean.receiveShadow = true;
    this.group.add(this.ocean);

    const inland = buildInlandWater(world);
    this.inland = inland;
    if (inland) this.group.add(inland);

    const random = new SeededRandom(`${seed}:water`);
    const falls = collectFalls(world);
    const foam = buildFoam(falls, world, random);
    this.foam = foam?.points;
    this.foamBase = foam?.base ?? new Float32Array(0);
    if (foam) this.group.add(foam.points);
    this.mist = buildMist(falls, world, random);
    if (this.mist) this.group.add(this.mist);

    this.report = {
      lakeSurfaces: countChannel(world.terrain.lake),
      riverSamples: countChannel(world.terrain.river),
      waterfalls: falls.length,
    };
  }

  /** Slow swell on the open sea plus tumbling foam at the falls; both are cheap and restrained. */
  update(elapsedSeconds: number): void {
    this.ocean.position.y = this.oceanY + Math.sin(elapsedSeconds * 0.42) * 0.0016;
    if (!this.foam) return;
    const positions = this.foam.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      const baseY = this.foamBase[index * 2] ?? 0;
      const drop = this.foamBase[index * 2 + 1] ?? 1;
      const phase = (elapsedSeconds * 0.55 + index * 0.137) % 1;
      positions.setY(index, baseY - phase * drop);
    }
    positions.needsUpdate = true;
  }

  syncHydrology(): void {
    const revision = this.world.environmentRevision ?? 0;
    if (revision === this.revision) return;
    this.revision = revision;
    if (this.inland) {
      this.group.remove(this.inland);
      this.inland.geometry.dispose();
      const materials = Array.isArray(this.inland.material) ? this.inland.material : [this.inland.material];
      for (const material of materials) material.dispose();
    }
    this.inland = buildInlandWater(this.world);
    if (this.inland) this.group.add(this.inland);
  }

  setSeasonalTint(colour: THREE.Color): void {
    const material = this.ocean.material;
    if (material instanceof THREE.MeshPhysicalMaterial) material.color.copy(colour);
  }
}

function countChannel(values: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) if (values[index]) total += 1;
  return total;
}

interface FallSite {
  worldX: number;
  worldZ: number;
  topY: number;
  drop: number;
  intensity: number;
}

function collectFalls(world: WorldState): FallSite[] {
  const { terrain, seaLevel } = world;
  const { resolution, step, originX, originZ, fall, height } = terrain;
  const sites: FallSite[] = [];
  for (let z = 1; z < resolution - 1; z += 1) {
    for (let x = 1; x < resolution - 1; x += 1) {
      const index = z * resolution + x;
      const intensity = read(fall, index);
      if (intensity < 0.22) continue;
      let lowest = read(height, index);
      for (const offset of [-1, 1, -resolution, resolution]) lowest = Math.min(lowest, read(height, index + offset));
      const topY = elevationToY(read(height, index), seaLevel);
      const drop = topY - elevationToY(lowest, seaLevel);
      if (drop < 0.7) continue;
      sites.push({ worldX: originX + x * step, worldZ: originZ + z * step, topY, drop, intensity });
    }
  }
  // Rare by design: keep only the strongest falls so each one is a landmark.
  sites.sort((a, b) => b.intensity * b.drop - a.intensity * a.drop);
  const kept: FallSite[] = [];
  for (const site of sites) {
    if (kept.some((other) => Math.hypot(other.worldX - site.worldX, other.worldZ - site.worldZ) < world.cellSize * 2.5)) continue;
    kept.push(site);
    if (kept.length >= 8) break;
  }
  return kept;
}

/** Mesh the canonical fine hydrology cells. No visual-only widening onto dry banks. */
export function buildInlandWater(world: WorldState): THREE.Mesh | undefined {
  const { terrain, seaLevel } = world;
  const { resolution, step, originX, originZ, waterLevel, flow, height } = terrain;
  const positions: number[] = [];
  const colors: number[] = [];
  const shallow = new THREE.Color('#4f8f92');
  const deep = new THREE.Color('#245f6d');
  const colour = new THREE.Color();
  type Vertex = { x: number; z: number; depth: number };
  // A fine sample owns its nearest-sample square, exactly as surfaceWaterAt does.
  for (let index = 0; index < height.length; index++) {
    if (waterLevel[index]! < 0 || height[index]! < seaLevel) continue;
    const x = originX + index % resolution * step;
    const z = originZ + Math.floor(index / resolution) * step;
    const y = elevationToY(waterLevel[index]!, seaLevel);
    const vertex = (dx: number, dz: number): Vertex => ({ x: x + dx * step, z: z + dz * step,
      depth: y - surfaceHeightAt(world, x + dx * step, z + dz * step) });
    const center = vertex(0, 0);
    const corners = [vertex(-0.5, -0.5), vertex(-0.5, 0.5), vertex(0.5, 0.5), vertex(0.5, -0.5)];
    colour.copy(shallow).lerp(deep, clamp01(Math.max(0, center.depth) * 0.5 + flow[index]! * 0.3));
    for (let side = 0; side < 4; side++) {
      const triangle = [center, corners[side]!, corners[(side + 1) % 4]!];
      const clipped: Vertex[] = [];
      for (let i = 0; i < 3; i++) {
        const a = triangle[i]!;
        const b = triangle[(i + 1) % 3]!;
        if (a.depth > 0) clipped.push(a);
        if ((a.depth > 0) !== (b.depth > 0)) {
          const t = a.depth / (a.depth - b.depth);
          clipped.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, depth: 0 });
        }
      }
      for (let i = 1; i < clipped.length - 1; i++) {
        for (const p of [clipped[0]!, clipped[i]!, clipped[i + 1]!]) {
          positions.push(p.x, y, p.z);
          colors.push(colour.r, colour.g, colour.b);
        }
      }
    }
  }
  if (!positions.length) return undefined;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.24, metalness: 0.04,
    depthWrite: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'inland-water';
  mesh.receiveShadow = true;
  return mesh;
}

function buildFoam(falls: FallSite[], world: WorldState, random: SeededRandom): { points: THREE.Points; base: Float32Array } | undefined {
  if (falls.length === 0) return undefined;
  const perFall = 46;
  const count = falls.length * perFall;
  const positions = new Float32Array(count * 3);
  const base = new Float32Array(count * 2);
  let cursor = 0;
  for (const fall of falls) {
    for (let index = 0; index < perFall; index += 1) {
      const spread = world.terrain.step * 1.4;
      positions[cursor * 3] = fall.worldX + random.range(-spread, spread);
      positions[cursor * 3 + 1] = fall.topY - random.range(0, fall.drop);
      positions[cursor * 3 + 2] = fall.worldZ + random.range(-spread, spread);
      base[cursor * 2] = fall.topY + random.range(0, 0.25);
      base[cursor * 2 + 1] = fall.drop + 0.4;
      cursor += 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: '#e9f4f6', size: 0.3, map: softPointTexture(), transparent: true, opacity: 0.7, depthWrite: false, sizeAttenuation: true }),
  );
  points.name = 'waterfall-foam';
  points.frustumCulled = false;
  return { points, base };
}

/** A low, soft cloud at the base of each fall. It is the cheapest way to sell scale. */
function buildMist(falls: FallSite[], world: WorldState, random: SeededRandom): THREE.Points | undefined {
  if (falls.length === 0) return undefined;
  const perFall = 34;
  const positions = new Float32Array(falls.length * perFall * 3);
  let cursor = 0;
  for (const fall of falls) {
    for (let index = 0; index < perFall; index += 1) {
      const spread = world.terrain.step * 3.2;
      positions[cursor * 3] = fall.worldX + random.range(-spread, spread);
      positions[cursor * 3 + 1] = fall.topY - fall.drop + random.range(-0.2, 1.1);
      positions[cursor * 3 + 2] = fall.worldZ + random.range(-spread, spread);
      cursor += 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mist = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: '#dbe8ea', size: 2.4, map: softPointTexture(), transparent: true, opacity: 0.24, depthWrite: false, sizeAttenuation: true }),
  );
  mist.name = 'waterfall-mist';
  mist.frustumCulled = false;
  return mist;
}
