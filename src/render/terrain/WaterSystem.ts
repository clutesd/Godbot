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

interface WaterClock { value: number }

const read = (values: Float32Array, index: number): number => values[index] ?? 0;
const WATER_TIME_KEY = 'godboxWaterTime';

/**
 * Everything wet. Hydrology remains authoritative; this layer only turns that truth into a
 * coherent, animated surface. Inland water never widens beyond the canonical wet footprint.
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

    const oceanMaterial = createOceanMaterial();
    // Enough vertices for broad swell to bend the surface without becoming a heavy simulation mesh.
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(span, span, 96, 96), oceanMaterial);
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

  /** Presentation-only motion; no visual animation feeds back into hydrology or placement. */
  update(elapsedSeconds: number): void {
    this.ocean.position.y = this.oceanY + Math.sin(elapsedSeconds * 0.42) * 0.0016;
    setWaterTime(this.ocean, elapsedSeconds);
    setWaterTime(this.inland, elapsedSeconds);
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

function waterClock(material: THREE.Material): WaterClock | undefined {
  return material.userData[WATER_TIME_KEY] as WaterClock | undefined;
}

function setWaterTime(mesh: THREE.Mesh | undefined, elapsedSeconds: number): void {
  if (!mesh) return;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    const clock = waterClock(material);
    if (clock) clock.value = elapsedSeconds;
  }
}

/** Broad ocean swell plus crossed micro-ripples. The plane stays opaque so terrain occlusion is stable. */
function createOceanMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#2b6d78',
    roughness: 0.2,
    metalness: 0.01,
    depthWrite: true,
    clearcoat: 0.78,
    clearcoatRoughness: 0.18,
  });
  const clock: WaterClock = { value: 0 };
  material.userData[WATER_TIME_KEY] = clock;
  material.onBeforeCompile = shader => {
    shader.uniforms['waterTime'] = clock;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform float waterTime;
varying vec2 vWaterLocal;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vWaterLocal = position.xy;
float oceanWaveA = sin(position.x * 0.025 + waterTime * 0.34);
float oceanWaveB = sin(position.y * 0.031 - waterTime * 0.27 + position.x * 0.009);
float oceanWaveC = sin((position.x - position.y) * 0.052 + waterTime * 0.19);
transformed.z += oceanWaveA * 0.020 + oceanWaveB * 0.013 + oceanWaveC * 0.006;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float waterTime;
varying vec2 vWaterLocal;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float oceanCrossA = sin(vWaterLocal.x * 0.12 + vWaterLocal.y * 0.045 + waterTime * 0.55);
float oceanCrossB = sin(vWaterLocal.y * 0.14 - vWaterLocal.x * 0.035 - waterTime * 0.43);
float oceanRipple = (oceanCrossA + oceanCrossB) * 0.5;
float oceanGlint = smoothstep(0.72, 0.98, oceanRipple) * 0.11;
diffuseColor.rgb *= 1.0 + oceanRipple * 0.025;
diffuseColor.rgb += vec3(0.12, 0.18, 0.19) * oceanGlint;`);
  };
  material.customProgramCacheKey = () => 'godbox-ocean-water-v1';
  return material;
}

/**
 * Depth-aware inland material. Waves are damped to zero at the bank, so the geometric shoreline
 * remains the authoritative wet/dry boundary while the interior gains life and specular variation.
 */
function createInlandMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.26,
    metalness: 0.01,
    depthWrite: true,
    clearcoat: 0.58,
    clearcoatRoughness: 0.22,
  });
  const clock: WaterClock = { value: 0 };
  material.userData[WATER_TIME_KEY] = clock;
  material.onBeforeCompile = shader => {
    shader.uniforms['waterTime'] = clock;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform float waterTime;
attribute float waterDepth;
attribute float waterFlow;
varying float vWaterDepth;
varying float vWaterFlow;
varying vec3 vWaterPosition;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vWaterDepth = waterDepth;
vWaterFlow = waterFlow;
float waterShoreDamping = smoothstep(0.012, 0.11, waterDepth);
float waterRippleA = sin(position.x * 1.35 + position.z * 0.52 + waterTime * (0.62 + waterFlow * 0.34));
float waterRippleB = sin(position.z * 1.18 - position.x * 0.41 - waterTime * (0.47 + waterFlow * 0.25));
transformed.y += (waterRippleA * 0.0034 + waterRippleB * 0.0022) * waterShoreDamping;
vWaterPosition = transformed;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float waterTime;
varying float vWaterDepth;
varying float vWaterFlow;
varying vec3 vWaterPosition;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float waterShallow = 1.0 - smoothstep(0.025, 0.20, vWaterDepth);
float waterDeep = smoothstep(0.16, 0.82, vWaterDepth);
float waterBank = 1.0 - smoothstep(0.008, 0.060, vWaterDepth);
vec3 waterShallowTint = vec3(0.39, 0.64, 0.61);
vec3 waterDeepTint = vec3(0.075, 0.25, 0.31);
diffuseColor.rgb = mix(diffuseColor.rgb, waterShallowTint, waterShallow * 0.18);
diffuseColor.rgb = mix(diffuseColor.rgb, waterDeepTint, waterDeep * 0.24);
float waterCrossA = sin(vWaterPosition.x * 1.70 + vWaterPosition.z * 0.63 + waterTime * (0.72 + vWaterFlow * 0.42));
float waterCrossB = sin(vWaterPosition.z * 1.43 - vWaterPosition.x * 0.48 - waterTime * (0.55 + vWaterFlow * 0.34));
float waterRipple = (waterCrossA + waterCrossB) * 0.5;
float waterGlint = smoothstep(0.78, 0.98, waterRipple) * smoothstep(0.025, 0.12, vWaterDepth);
diffuseColor.rgb *= 1.0 + waterRipple * 0.018;
diffuseColor.rgb += vec3(0.10, 0.15, 0.15) * waterGlint * 0.12;
diffuseColor.rgb += vec3(0.08, 0.13, 0.11) * waterBank;`);
  };
  material.customProgramCacheKey = () => 'godbox-inland-water-v1';
  return material;
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
  const depths: number[] = [];
  const flows: number[] = [];
  const bank = new THREE.Color('#75aaa1');
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
    const currentFlow = flow[index] ?? 0;
    const vertex = (dx: number, dz: number): Vertex => ({ x: x + dx * step, z: z + dz * step,
      depth: y - surfaceHeightAt(world, x + dx * step, z + dz * step) });
    const center = vertex(0, 0);
    const corners = [vertex(-0.5, -0.5), vertex(-0.5, 0.5), vertex(0.5, 0.5), vertex(0.5, -0.5)];
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
          const depth = Math.max(0, p.depth);
          const bankToShallow = clamp01(depth / 0.16);
          const shallowToDeep = clamp01(depth * 0.72 + currentFlow * 0.22);
          colour.copy(bank).lerp(shallow, bankToShallow).lerp(deep, shallowToDeep);
          positions.push(p.x, y, p.z);
          colors.push(colour.r, colour.g, colour.b);
          depths.push(depth);
          flows.push(currentFlow);
        }
      }
    }
  }
  if (!positions.length) return undefined;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('waterDepth', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setAttribute('waterFlow', new THREE.Float32BufferAttribute(flows, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, createInlandMaterial());
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
