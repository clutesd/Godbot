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
  rapidSites: number;
}

interface WaterClock { value: number }
interface RapidFoam { points: THREE.Points; base: Float32Array; sites: number }

const read = (values: Float32Array, index: number): number => values[index] ?? 0;
const WATER_TIME_KEY = 'godboxWaterTime';
const WATER_LAKE = 0;
const WATER_RIVER = 1;
const WATER_FLOOD = 2;

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
  private rapids: THREE.Points | undefined;
  private rapidBase = new Float32Array(0);
  private revision = -1;

  constructor(private readonly world: WorldState, surface: TerrainSurface, private readonly seed: string) {
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

    this.inland = buildInlandWater(world);
    if (this.inland) this.group.add(this.inland);

    const rapidFoam = buildRapidFoam(world, new SeededRandom(`${seed}:rapids`));
    this.rapids = rapidFoam?.points;
    this.rapidBase = rapidFoam?.base ?? new Float32Array(0);
    if (this.rapids) this.group.add(this.rapids);

    const falls = collectFalls(world);
    const waterfallRandom = new SeededRandom(`${seed}:waterfalls`);
    const foam = buildFoam(falls, world, waterfallRandom);
    this.foam = foam?.points;
    this.foamBase = foam?.base ?? new Float32Array(0);
    if (foam) this.group.add(foam.points);
    this.mist = buildMist(falls, world, waterfallRandom);
    if (this.mist) this.group.add(this.mist);

    this.report = {
      lakeSurfaces: countChannel(world.terrain.lake),
      riverSamples: countChannel(world.terrain.river),
      waterfalls: falls.length,
      rapidSites: rapidFoam?.sites ?? 0,
    };
  }

  /** Presentation-only motion; no visual animation feeds back into hydrology or placement. */
  update(elapsedSeconds: number): void {
    this.ocean.position.y = this.oceanY + Math.sin(elapsedSeconds * 0.42) * 0.0016;
    setWaterTime(this.ocean, elapsedSeconds);
    setWaterTime(this.inland, elapsedSeconds);
    this.updateRapidFoam(elapsedSeconds);
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
      disposeObject(this.inland);
    }
    this.inland = buildInlandWater(this.world);
    if (this.inland) this.group.add(this.inland);

    if (this.rapids) {
      this.group.remove(this.rapids);
      disposeObject(this.rapids);
    }
    const rapidFoam = buildRapidFoam(this.world, new SeededRandom(`${this.seed}:rapids`));
    this.rapids = rapidFoam?.points;
    this.rapidBase = rapidFoam?.base ?? new Float32Array(0);
    if (this.rapids) this.group.add(this.rapids);
  }

  setSeasonalTint(colour: THREE.Color): void {
    const material = this.ocean.material;
    if (material instanceof THREE.MeshPhysicalMaterial) material.color.copy(colour);
  }

  private updateRapidFoam(elapsedSeconds: number): void {
    if (!this.rapids) return;
    const positions = this.rapids.geometry.getAttribute('position') as THREE.BufferAttribute;
    const stride = 8;
    for (let index = 0; index < positions.count; index += 1) {
      const base = index * stride;
      const x = this.rapidBase[base] ?? 0;
      const y = this.rapidBase[base + 1] ?? 0;
      const z = this.rapidBase[base + 2] ?? 0;
      const dirX = this.rapidBase[base + 3] ?? 0;
      const dirZ = this.rapidBase[base + 4] ?? 0;
      const phase = this.rapidBase[base + 5] ?? 0;
      const travel = this.rapidBase[base + 6] ?? 0;
      const speed = this.rapidBase[base + 7] ?? 1;
      const progress = ((elapsedSeconds * speed + phase) % 1) - 0.5;
      positions.setXYZ(index, x + dirX * progress * travel, y + Math.sin((progress + phase) * Math.PI * 2) * 0.006, z + dirZ * progress * travel);
    }
    positions.needsUpdate = true;
  }
}

function countChannel(values: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) if (values[index]) total += 1;
  return total;
}

function disposeObject(object: THREE.Object3D): void {
  if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  }
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
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float waterTime;\nvarying vec2 vWaterLocal;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvWaterLocal = position.xy;\nfloat oceanWaveA = sin(position.x * 0.025 + waterTime * 0.34);\nfloat oceanWaveB = sin(position.y * 0.031 - waterTime * 0.27 + position.x * 0.009);\nfloat oceanWaveC = sin((position.x - position.y) * 0.052 + waterTime * 0.19);\ntransformed.z += oceanWaveA * 0.020 + oceanWaveB * 0.013 + oceanWaveC * 0.006;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform float waterTime;\nvarying vec2 vWaterLocal;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\nfloat oceanCrossA = sin(vWaterLocal.x * 0.12 + vWaterLocal.y * 0.045 + waterTime * 0.55);\nfloat oceanCrossB = sin(vWaterLocal.y * 0.14 - vWaterLocal.x * 0.035 - waterTime * 0.43);\nfloat oceanRipple = (oceanCrossA + oceanCrossB) * 0.5;\nfloat oceanGlint = smoothstep(0.72, 0.98, oceanRipple) * 0.11;\ndiffuseColor.rgb *= 1.0 + oceanRipple * 0.025;\ndiffuseColor.rgb += vec3(0.12, 0.18, 0.19) * oceanGlint;`);
  };
  material.customProgramCacheKey = () => 'godbox-ocean-water-v1';
  return material;
}

/**
 * Geographic inland material. Every river vertex knows its downstream vector, discharge hierarchy,
 * rapid intensity and water kind. Lakes breathe, rivers travel downstream and floodwater stays heavy.
 */
function createInlandMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.25,
    metalness: 0.01,
    depthWrite: true,
    clearcoat: 0.62,
    clearcoatRoughness: 0.2,
  });
  const clock: WaterClock = { value: 0 };
  material.userData[WATER_TIME_KEY] = clock;
  material.onBeforeCompile = shader => {
    shader.uniforms['waterTime'] = clock;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float waterTime;\nattribute float waterDepth;\nattribute float waterFlow;\nattribute vec2 waterFlowDirection;\nattribute float waterKind;\nattribute float waterHierarchy;\nattribute float waterRapid;\nvarying float vWaterDepth;\nvarying float vWaterFlow;\nvarying vec2 vWaterFlowDirection;\nvarying float vWaterKind;\nvarying float vWaterHierarchy;\nvarying float vWaterRapid;\nvarying vec3 vWaterPosition;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvWaterDepth = waterDepth;\nvWaterFlow = waterFlow;\nvWaterFlowDirection = waterFlowDirection;\nvWaterKind = waterKind;\nvWaterHierarchy = waterHierarchy;\nvWaterRapid = waterRapid;\nfloat waterRiver = 1.0 - step(0.49, abs(waterKind - 1.0));\nfloat waterLake = 1.0 - step(0.49, abs(waterKind));\nfloat waterFlood = max(0.0, 1.0 - waterRiver - waterLake);\nfloat waterShoreDamping = smoothstep(0.012, 0.11, waterDepth);\nvec2 waterDirection = length(waterFlowDirection) > 0.01 ? normalize(waterFlowDirection) : vec2(0.7071, 0.7071);\nvec2 waterAcross = vec2(-waterDirection.y, waterDirection.x);\nfloat waterCurrentCoordinate = dot(position.xz, waterDirection);\nfloat waterAcrossCoordinate = dot(position.xz, waterAcross);\nfloat lakeWave = sin(position.x * 1.06 + waterTime * 0.40) + sin(position.z * 1.22 - waterTime * 0.34);\nfloat riverWave = sin(waterCurrentCoordinate * (1.50 + waterHierarchy * 0.55) - waterTime * (1.05 + waterFlow * 1.8) + sin(waterAcrossCoordinate * 1.9) * 0.35);\nfloat rapidChop = sin(waterCurrentCoordinate * 4.1 - waterTime * (2.6 + waterFlow * 2.2) + waterAcrossCoordinate * 0.7);\nfloat floodWave = sin(position.x * 0.62 + position.z * 0.51 + waterTime * 0.18);\nfloat waterDisplacement = lakeWave * 0.0017 * waterLake + riverWave * (0.0018 + waterFlow * 0.0022) * waterRiver + rapidChop * waterRapid * 0.0032 * waterRiver + floodWave * 0.0007 * waterFlood;\ntransformed.y += waterDisplacement * waterShoreDamping;\nvWaterPosition = transformed;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform float waterTime;\nvarying float vWaterDepth;\nvarying float vWaterFlow;\nvarying vec2 vWaterFlowDirection;\nvarying float vWaterKind;\nvarying float vWaterHierarchy;\nvarying float vWaterRapid;\nvarying vec3 vWaterPosition;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\nfloat waterRiver = 1.0 - step(0.49, abs(vWaterKind - 1.0));\nfloat waterLake = 1.0 - step(0.49, abs(vWaterKind));\nfloat waterFlood = max(0.0, 1.0 - waterRiver - waterLake);\nfloat waterShallow = 1.0 - smoothstep(0.025, 0.20, vWaterDepth);\nfloat waterDeep = smoothstep(0.16, 0.82, vWaterDepth);\nfloat waterBank = 1.0 - smoothstep(0.008, 0.060, vWaterDepth);\nvec3 waterShallowTint = vec3(0.39, 0.64, 0.61);\nvec3 waterDeepTint = vec3(0.075, 0.25, 0.31);\nvec3 waterLakeTint = vec3(0.16, 0.39, 0.43);\nvec3 waterRiverTint = mix(vec3(0.17, 0.42, 0.43), vec3(0.08, 0.31, 0.36), vWaterHierarchy);\nvec3 waterFloodTint = vec3(0.30, 0.34, 0.24);\ndiffuseColor.rgb = mix(diffuseColor.rgb, waterShallowTint, waterShallow * 0.18);\ndiffuseColor.rgb = mix(diffuseColor.rgb, waterDeepTint, waterDeep * 0.24);\ndiffuseColor.rgb = mix(diffuseColor.rgb, waterLakeTint, waterLake * 0.12);\ndiffuseColor.rgb = mix(diffuseColor.rgb, waterRiverTint, waterRiver * (0.12 + vWaterHierarchy * 0.12));\ndiffuseColor.rgb = mix(diffuseColor.rgb, waterFloodTint, waterFlood * 0.34);\nvec2 waterDirection = length(vWaterFlowDirection) > 0.01 ? normalize(vWaterFlowDirection) : vec2(0.7071, 0.7071);\nvec2 waterAcross = vec2(-waterDirection.y, waterDirection.x);\nfloat waterCurrentCoordinate = dot(vWaterPosition.xz, waterDirection);\nfloat waterAcrossCoordinate = dot(vWaterPosition.xz, waterAcross);\nfloat lakeRipple = (sin(vWaterPosition.x * 1.55 + waterTime * 0.48) + sin(vWaterPosition.z * 1.39 - waterTime * 0.39)) * 0.5;\nfloat riverCurrent = sin(waterCurrentCoordinate * (2.3 + vWaterHierarchy) - waterTime * (1.7 + vWaterFlow * 2.7) + sin(waterAcrossCoordinate * 2.1) * 0.45);\nfloat currentLane = pow(max(0.0, 0.5 + 0.5 * riverCurrent), 7.0) * waterRiver;\nfloat rapidCrest = pow(max(0.0, sin(waterCurrentCoordinate * 5.2 - waterTime * (3.5 + vWaterFlow * 3.0) + waterAcrossCoordinate * 0.9)), 9.0) * vWaterRapid * waterRiver;\nfloat waterRipple = lakeRipple * waterLake + riverCurrent * 0.55 * waterRiver + lakeRipple * 0.18 * waterFlood;\nfloat waterGlint = smoothstep(0.76, 0.98, waterRipple) * smoothstep(0.025, 0.12, vWaterDepth);\ndiffuseColor.rgb *= 1.0 + waterRipple * (0.014 + waterRiver * 0.012);\ndiffuseColor.rgb += vec3(0.10, 0.15, 0.15) * waterGlint * 0.12;\ndiffuseColor.rgb += vec3(0.10, 0.16, 0.15) * currentLane * (0.035 + vWaterFlow * 0.045);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.88, 0.86), rapidCrest * 0.52);\ndiffuseColor.rgb += vec3(0.08, 0.13, 0.11) * waterBank;`);
  };
  material.customProgramCacheKey = () => 'godbox-inland-water-v2-geographic-flow';
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

function maxDrainageAccumulation(world: WorldState): number {
  const accumulation = world.terrain.drainage?.accumulation;
  if (!accumulation) return 1;
  let maximum = 1;
  for (let index = 0; index < accumulation.length; index += 1) maximum = Math.max(maximum, accumulation[index] ?? 1);
  return maximum;
}

function waterHierarchyAt(world: WorldState, index: number, maximum: number): number {
  if (!world.terrain.river[index]) return 0;
  const accumulation = world.terrain.drainage?.accumulation[index] ?? 1;
  const normalized = Math.log1p(Math.max(1, accumulation)) / Math.log1p(Math.max(2, maximum));
  return clamp01((normalized - 0.32) / 0.68);
}

function flowDirectionAt(world: WorldState, index: number): readonly [number, number] {
  if (!world.terrain.river[index]) return [0, 0];
  const { resolution } = world.terrain;
  const next = world.terrain.drainage?.downstream[index] ?? -1;
  if (next < 0 || next === index) return [0, 0];
  const dx = next % resolution - index % resolution;
  const dz = Math.floor(next / resolution) - Math.floor(index / resolution);
  const length = Math.hypot(dx, dz);
  return length > 0 ? [dx / length, dz / length] : [0, 0];
}

function rapidIntensityAt(world: WorldState, index: number): number {
  if (!world.terrain.river[index]) return 0;
  const { terrain, seaLevel } = world;
  const next = terrain.drainage?.downstream[index] ?? -1;
  const flow = terrain.flow[index] ?? 0;
  const markedFall = terrain.fall[index] ?? 0;
  let slope = 0;
  if (next >= 0 && terrain.waterLevel[index]! >= 0 && terrain.waterLevel[next]! >= 0) {
    const x0 = index % terrain.resolution;
    const z0 = Math.floor(index / terrain.resolution);
    const x1 = next % terrain.resolution;
    const z1 = Math.floor(next / terrain.resolution);
    const distance = Math.max(terrain.step, Math.hypot(x1 - x0, z1 - z0) * terrain.step);
    const drop = elevationToY(terrain.waterLevel[index]!, seaLevel) - elevationToY(terrain.waterLevel[next]!, seaLevel);
    slope = clamp01(Math.max(0, drop) / distance * 4.5);
  }
  return clamp01(markedFall * 0.9 + slope * 0.78 + clamp01((flow - 0.62) / 0.38) * 0.34);
}

function waterKindAt(world: WorldState, index: number): number {
  if (world.terrain.river[index]) return WATER_RIVER;
  if (world.terrain.lake[index]) return WATER_LAKE;
  return WATER_FLOOD;
}

/**
 * Bilinear wet-only water sampling. Adjacent wet samples meet at the same interpolated elevation,
 * removing the little terraces that made a continuous river read as disconnected puddles.
 */
function waterSurfaceYAt(world: WorldState, worldX: number, worldZ: number, fallbackIndex: number): number {
  const { terrain, seaLevel } = world;
  const fx = Math.min(terrain.resolution - 1, Math.max(0, (worldX - terrain.originX) / terrain.step));
  const fz = Math.min(terrain.resolution - 1, Math.max(0, (worldZ - terrain.originZ) / terrain.step));
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(terrain.resolution - 1, x0 + 1);
  const z1 = Math.min(terrain.resolution - 1, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const samples: Array<readonly [number, number]> = [
    [z0 * terrain.resolution + x0, (1 - tx) * (1 - tz)],
    [z0 * terrain.resolution + x1, tx * (1 - tz)],
    [z1 * terrain.resolution + x0, (1 - tx) * tz],
    [z1 * terrain.resolution + x1, tx * tz],
  ];
  let weighted = 0;
  let weight = 0;
  for (const [index, influence] of samples) {
    const level = terrain.waterLevel[index] ?? -1;
    if (level < 0 || influence <= 0) continue;
    weighted += level * influence;
    weight += influence;
  }
  const fallback = terrain.waterLevel[fallbackIndex] ?? seaLevel;
  return elevationToY(weight > 0 ? weighted / weight : fallback, seaLevel);
}

/** Mesh the canonical fine hydrology cells. No visual-only widening onto dry banks. */
export function buildInlandWater(world: WorldState): THREE.Mesh | undefined {
  const { terrain, seaLevel } = world;
  const { resolution, step, originX, originZ, waterLevel, flow, height } = terrain;
  const positions: number[] = [];
  const colors: number[] = [];
  const depths: number[] = [];
  const flows: number[] = [];
  const directions: number[] = [];
  const kinds: number[] = [];
  const hierarchies: number[] = [];
  const rapids: number[] = [];
  const bank = new THREE.Color('#75aaa1');
  const shallow = new THREE.Color('#4f8f92');
  const deep = new THREE.Color('#245f6d');
  const flood = new THREE.Color('#66765f');
  const colour = new THREE.Color();
  const maximumAccumulation = maxDrainageAccumulation(world);
  type Vertex = { x: number; y: number; z: number; depth: number };

  // A fine sample owns its nearest-sample square, exactly as surfaceWaterAt does.
  for (let index = 0; index < height.length; index++) {
    if (waterLevel[index]! < 0 || height[index]! < seaLevel) continue;
    const x = originX + index % resolution * step;
    const z = originZ + Math.floor(index / resolution) * step;
    const currentFlow = flow[index] ?? 0;
    const direction = flowDirectionAt(world, index);
    const kind = waterKindAt(world, index);
    const hierarchy = waterHierarchyAt(world, index, maximumAccumulation);
    const rapid = rapidIntensityAt(world, index);
    const vertex = (dx: number, dz: number): Vertex => {
      const vx = x + dx * step;
      const vz = z + dz * step;
      const vy = waterSurfaceYAt(world, vx, vz, index);
      return { x: vx, y: vy, z: vz, depth: vy - surfaceHeightAt(world, vx, vz) };
    };
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
          clipped.push({
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t,
            depth: 0,
          });
        }
      }
      for (let i = 1; i < clipped.length - 1; i++) {
        for (const p of [clipped[0]!, clipped[i]!, clipped[i + 1]!]) {
          const depth = Math.max(0, p.depth);
          const bankToShallow = clamp01(depth / 0.16);
          const shallowToDeep = clamp01(depth * 0.72 + currentFlow * 0.18 + hierarchy * 0.12);
          colour.copy(bank).lerp(shallow, bankToShallow).lerp(deep, shallowToDeep);
          if (kind === WATER_FLOOD) colour.lerp(flood, 0.42);
          positions.push(p.x, p.y + 0.002, p.z);
          colors.push(colour.r, colour.g, colour.b);
          depths.push(depth);
          flows.push(currentFlow);
          directions.push(direction[0], direction[1]);
          kinds.push(kind);
          hierarchies.push(hierarchy);
          rapids.push(rapid);
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
  geometry.setAttribute('waterFlowDirection', new THREE.Float32BufferAttribute(directions, 2));
  geometry.setAttribute('waterKind', new THREE.Float32BufferAttribute(kinds, 1));
  geometry.setAttribute('waterHierarchy', new THREE.Float32BufferAttribute(hierarchies, 1));
  geometry.setAttribute('waterRapid', new THREE.Float32BufferAttribute(rapids, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, createInlandMaterial());
  mesh.name = 'inland-water';
  mesh.receiveShadow = true;
  return mesh;
}

/** Sparse moving foam only where discharge, slope or mapped falls make turbulence believable. */
function buildRapidFoam(world: WorldState, random: SeededRandom): RapidFoam | undefined {
  const { terrain, seaLevel } = world;
  const sites: Array<{ index: number; intensity: number; direction: readonly [number, number] }> = [];
  for (let index = 0; index < terrain.height.length; index += 1) {
    if (!terrain.river[index] || terrain.waterLevel[index]! < 0 || terrain.height[index]! < seaLevel) continue;
    const intensity = rapidIntensityAt(world, index);
    const direction = flowDirectionAt(world, index);
    if (intensity < 0.34 || Math.hypot(direction[0], direction[1]) < 0.5) continue;
    sites.push({ index, intensity, direction });
  }
  if (!sites.length) return undefined;
  // Strong sites get a few more flecks, but keep the layer sparse enough to read as whitewater.
  const count = sites.reduce((sum, site) => sum + 2 + Math.round(site.intensity * 4), 0);
  const positions = new Float32Array(count * 3);
  const base = new Float32Array(count * 8);
  let cursor = 0;
  for (const site of sites) {
    const x = terrain.originX + site.index % terrain.resolution * terrain.step;
    const z = terrain.originZ + Math.floor(site.index / terrain.resolution) * terrain.step;
    const y = waterSurfaceYAt(world, x, z, site.index) + 0.015;
    const perSite = 2 + Math.round(site.intensity * 4);
    const acrossX = -site.direction[1];
    const acrossZ = site.direction[0];
    for (let i = 0; i < perSite; i += 1) {
      const across = random.range(-0.16, 0.16) * terrain.step;
      const along = random.range(-0.12, 0.12) * terrain.step;
      const px = x + acrossX * across + site.direction[0] * along;
      const pz = z + acrossZ * across + site.direction[1] * along;
      positions[cursor * 3] = px;
      positions[cursor * 3 + 1] = y;
      positions[cursor * 3 + 2] = pz;
      const offset = cursor * 8;
      base[offset] = px;
      base[offset + 1] = y;
      base[offset + 2] = pz;
      base[offset + 3] = site.direction[0];
      base[offset + 4] = site.direction[1];
      base[offset + 5] = random.float();
      base[offset + 6] = terrain.step * random.range(0.18, 0.36);
      base[offset + 7] = random.range(0.7, 1.35) * (0.75 + site.intensity * 0.8);
      cursor += 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: '#e4f1ed', size: 0.09, map: softPointTexture(), transparent: true, opacity: 0.58, depthWrite: false, sizeAttenuation: true }),
  );
  points.name = 'river-rapid-foam';
  points.frustumCulled = false;
  return { points, base, sites: sites.length };
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
