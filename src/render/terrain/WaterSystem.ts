import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { clamp01 } from '../../sim/terrain/noise';
import type { WorldState } from '../../sim/types';
import { softPointTexture } from '../atmosphere/sprites';
import { elevationToY, type TerrainSurface } from './TerrainSurface';

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
      transparent: true,
      opacity: 0.82,
      transmission: 0.08,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
    });
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(span, span, 1, 1), oceanMaterial);
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = surface.seaLevelY - 0.02;
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
    this.ocean.position.y += Math.sin(elapsedSeconds * 0.42) * 0.0016;
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

/**
 * Lakes and rivers as a single indexed mesh. Channels are only one or two samples wide in the
 * hydrology, so they are dilated by discharge into a ribbon and faded out at the banks; without
 * that a river renders as a chain of disconnected blue rectangles.
 */
function buildInlandWater(world: WorldState): THREE.Mesh | undefined {
  const { terrain, seaLevel } = world;
  const { resolution, step, originX, originZ, waterLevel, lake, river, flow, height } = terrain;
  const count = resolution * resolution;
  const level = new Float32Array(count).fill(-1);
  const coverage = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    if (!lake[index] && !(read(waterLevel, index) > read(height, index) && read(height, index) >= seaLevel)) continue;
    level[index] = read(waterLevel, index);
    coverage[index] = 1;
  }

  // Stamp channels widest-first from the headwaters down, so a lower reach always wins and the
  // surface never climbs back uphill where two rivers meet.
  const channels: number[] = [];
  for (let index = 0; index < count; index += 1) if (river[index]) channels.push(index);
  channels.sort((a, b) => read(waterLevel, b) - read(waterLevel, a) || a - b);
  for (const index of channels) {
    const surface = read(waterLevel, index);
    const width = 1 + Math.round(read(flow, index) * 2.6);
    const x = index % resolution;
    const z = (index / resolution) | 0;
    for (let dz = -width; dz <= width; dz += 1) {
      const nz = z + dz;
      if (nz < 0 || nz >= resolution) continue;
      for (let dx = -width; dx <= width; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= resolution) continue;
        const distance = Math.hypot(dx, dz);
        if (distance > width) continue;
        const neighbour = nz * resolution + nx;
        // Water only spreads onto ground the channel could actually reach.
        if (read(height, neighbour) > surface + 0.012) continue;
        level[neighbour] = surface;
        coverage[neighbour] = Math.max(coverage[neighbour] ?? 0, 1 - (distance / (width + 0.85)) ** 2);
      }
    }
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const vertexOf = new Int32Array(count).fill(-1);
  const shallow = new THREE.Color('#4f8f92');
  const deep = new THREE.Color('#245f6d');
  const colour = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    const surface = read(level, index);
    if (surface < 0) continue;
    const x = index % resolution;
    const z = (index / resolution) | 0;
    const lift = lake[index] ? 0.04 : 0.06;
    vertexOf[index] = positions.length / 3;
    positions.push(originX + x * step, elevationToY(surface, seaLevel) + lift, originZ + z * step);
    colour.copy(shallow).lerp(deep, clamp01(lake[index] ? 0.75 : read(flow, index) * 0.8));
    const alpha = 0.28 + clamp01(coverage[index] ?? 0) * 0.6;
    colors.push(colour.r, colour.g, colour.b, alpha);
  }

  for (let z = 0; z < resolution - 1; z += 1) {
    for (let x = 0; x < resolution - 1; x += 1) {
      const a = vertexOf[z * resolution + x] ?? -1;
      const b = vertexOf[z * resolution + x + 1] ?? -1;
      const c = vertexOf[(z + 1) * resolution + x] ?? -1;
      const d = vertexOf[(z + 1) * resolution + x + 1] ?? -1;
      if (a >= 0 && b >= 0 && c >= 0) indices.push(a, c, b);
      if (b >= 0 && c >= 0 && d >= 0) indices.push(b, c, d);
    }
  }
  if (indices.length === 0) return undefined;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.24,
    metalness: 0.04,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'inland-water';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
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
