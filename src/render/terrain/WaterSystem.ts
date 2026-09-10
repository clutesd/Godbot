import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { clamp01 } from '../../sim/terrain/noise';
import { FREEZING } from '../../sim/weather/Precipitation';
import type { WeatherCellState, WorldState } from '../../sim/types';
import { softPointTexture } from '../atmosphere/sprites';
import { elevationToY, type TerrainSurface } from './TerrainSurface';
import { surfaceHeightAt } from '../../sim/terrain/SurfaceGeometry';

export interface WaterReport {
  lakeSurfaces: number;
  riverSamples: number;
  waterfalls: number;
  rapidSites: number;
  plungePools: number;
}

interface WaterMaterialState {
  time: { value: number };
  transition: { value: number };
  wind: { value: number };
  windX: { value: number };
  windZ: { value: number };
  rain: { value: number };
  storm: { value: number };
}

interface WaterWeatherSummary {
  wind: number;
  windX: number;
  windZ: number;
  rain: number;
  storm: number;
}

interface RapidFoam { points: THREE.Points; base: Float32Array; sites: number }
interface PlungeFoam { points: THREE.Points; base: Float32Array; sites: number }

type WaterKindName = 'lake' | 'river' | 'flood';

const read = (values: Float32Array, index: number): number => values[index] ?? 0;
const WATER_STATE_KEY = 'godboxWaterMaterialState';
const WATER_LAKE = 0;
const WATER_RIVER = 1;
const WATER_FLOOD = 2;
const WATER_TRANSITION_SECONDS = 2.4;
const RECESSION_WET_SECONDS = 10;

/**
 * Everything wet. Hydrology remains authoritative; this layer only turns that truth into a
 * coherent, animated surface. Rendering never widens water beyond the canonical wet footprint.
 */
export class WaterSystem {
  readonly group = new THREE.Group();
  readonly report: WaterReport;
  private readonly ocean: THREE.Mesh;
  private readonly oceanY: number;
  private readonly foam: THREE.Points | undefined;
  private readonly foamBase: Float32Array;
  private readonly mist: THREE.Points | undefined;
  private readonly waterfallSheets: THREE.Mesh | undefined;
  private readonly plungePools: THREE.Points | undefined;
  private readonly plungeBase: Float32Array;
  private inland: THREE.Mesh | undefined;
  private rapids: THREE.Points | undefined;
  private rapidBase = new Float32Array(0);
  private recessionWetness: THREE.Points | undefined;
  private recessionStarted = -100;
  private transitionStarted = -100;
  private lastElapsed = 0;
  private wetMask: Uint8Array;
  private freezeSnapshot: Float32Array;
  private revision = -1;

  constructor(private readonly world: WorldState, surface: TerrainSurface, private readonly seed: string) {
    const span = Math.max(world.size * world.cellSize * 6, 720);
    this.group.name = 'water';

    const oceanMaterial = createOceanMaterial();
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(span, span, 96, 96), oceanMaterial);
    this.ocean.rotation.x = -Math.PI / 2;
    this.oceanY = surface.seaLevelY - 0.02;
    this.ocean.position.y = this.oceanY;
    this.ocean.receiveShadow = true;
    this.group.add(this.ocean);

    this.wetMask = currentInlandWetMask(world);
    this.freezeSnapshot = computeFreezeSnapshot(world);
    this.inland = buildInlandWater(world, this.wetMask, this.freezeSnapshot);
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

    this.waterfallSheets = buildWaterfallSheets(falls, world);
    if (this.waterfallSheets) this.group.add(this.waterfallSheets);

    const plunge = buildPlungePools(falls, world, new SeededRandom(`${seed}:plunge-pools`));
    this.plungePools = plunge?.points;
    this.plungeBase = plunge?.base ?? new Float32Array(0);
    if (this.plungePools) this.group.add(this.plungePools);

    this.report = {
      lakeSurfaces: countChannel(world.terrain.lake),
      riverSamples: countChannel(world.terrain.river),
      waterfalls: falls.length,
      rapidSites: rapidFoam?.sites ?? 0,
      plungePools: plunge?.sites ?? 0,
    };
  }

  /** Presentation-only motion; no visual animation feeds back into hydrology or placement. */
  update(elapsedSeconds: number): void {
    this.lastElapsed = elapsedSeconds;
    const weather = waterWeatherSummary(this.world);
    const transition = clamp01((elapsedSeconds - this.transitionStarted) / WATER_TRANSITION_SECONDS);

    // Preserve the old bounded whole-plane motion for deterministic camera/terrain separation;
    // all stronger weather motion happens inside the subdivided ocean shader.
    this.ocean.position.y = this.oceanY + Math.sin(elapsedSeconds * 0.42) * 0.0016;
    setWaterPresentation(this.ocean, elapsedSeconds, weather, 1);
    setWaterPresentation(this.inland, elapsedSeconds, weather, transition);
    setWaterPresentation(this.waterfallSheets, elapsedSeconds, weather, 1);

    this.updateRapidFoam(elapsedSeconds);
    this.updatePlungePools(elapsedSeconds);
    this.updateWaterfallFoam(elapsedSeconds);
    this.updateRecessionWetness(elapsedSeconds);

    if (this.mist) {
      // Wind carries spray, but the particle cloud remains anchored to the fall itself.
      this.mist.position.x = weather.windX * weather.wind * 0.34;
      this.mist.position.z = weather.windZ * weather.wind * 0.34;
    }
  }

  syncHydrology(): void {
    const revision = this.world.environmentRevision ?? 0;
    if (revision === this.revision) return;
    this.revision = revision;

    const previousWet = this.wetMask;
    const previousFreeze = this.freezeSnapshot;
    const nextWet = currentInlandWetMask(this.world);
    const nextFreeze = computeFreezeSnapshot(this.world);

    if (this.recessionWetness) {
      this.group.remove(this.recessionWetness);
      disposeObject(this.recessionWetness);
      this.recessionWetness = undefined;
    }
    this.recessionWetness = buildRecessionWetness(this.world, previousWet, nextWet);
    if (this.recessionWetness) {
      this.recessionStarted = this.lastElapsed;
      this.group.add(this.recessionWetness);
    }

    if (this.inland) {
      this.group.remove(this.inland);
      disposeObject(this.inland);
    }
    this.inland = buildInlandWater(this.world, previousWet, previousFreeze);
    if (this.inland) this.group.add(this.inland);
    this.transitionStarted = this.lastElapsed;
    this.wetMask = nextWet;
    this.freezeSnapshot = nextFreeze;

    if (this.rapids) {
      this.group.remove(this.rapids);
      disposeObject(this.rapids);
    }
    const rapidFoam = buildRapidFoam(this.world, new SeededRandom(`${this.seed}:rapids`));
    this.rapids = rapidFoam?.points;
    this.rapidBase = rapidFoam?.base ?? new Float32Array(0);
    if (this.rapids) this.group.add(this.rapids);
    this.report.rapidSites = rapidFoam?.sites ?? 0;
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

  private updatePlungePools(elapsedSeconds: number): void {
    if (!this.plungePools) return;
    const positions = this.plungePools.geometry.getAttribute('position') as THREE.BufferAttribute;
    const stride = 8;
    for (let index = 0; index < positions.count; index += 1) {
      const base = index * stride;
      const cx = this.plungeBase[base] ?? 0;
      const y = this.plungeBase[base + 1] ?? 0;
      const cz = this.plungeBase[base + 2] ?? 0;
      const dirX = this.plungeBase[base + 3] ?? 0;
      const dirZ = this.plungeBase[base + 4] ?? 0;
      const phase = this.plungeBase[base + 5] ?? 0;
      const radius = this.plungeBase[base + 6] ?? 0.2;
      const speed = this.plungeBase[base + 7] ?? 0.5;
      const progress = (elapsedSeconds * speed + phase) % 1;
      const angle = phase * Math.PI * 2 + progress * 0.7;
      const radialX = Math.cos(angle) * 0.68 + dirX * 0.42;
      const radialZ = Math.sin(angle) * 0.68 + dirZ * 0.42;
      positions.setXYZ(index, cx + radialX * radius * progress, y + Math.sin(progress * Math.PI) * 0.018, cz + radialZ * radius * progress);
    }
    positions.needsUpdate = true;
  }

  private updateWaterfallFoam(elapsedSeconds: number): void {
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

  private updateRecessionWetness(elapsedSeconds: number): void {
    if (!this.recessionWetness) return;
    const material = this.recessionWetness.material as THREE.PointsMaterial;
    const age = elapsedSeconds - this.recessionStarted;
    const remaining = clamp01(1 - age / RECESSION_WET_SECONDS);
    material.opacity = 0.22 * remaining * remaining;
    if (remaining > 0) return;
    this.group.remove(this.recessionWetness);
    disposeObject(this.recessionWetness);
    this.recessionWetness = undefined;
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

function createMaterialState(): WaterMaterialState {
  return {
    time: { value: 0 },
    transition: { value: 1 },
    wind: { value: 0 },
    windX: { value: 1 },
    windZ: { value: 0 },
    rain: { value: 0 },
    storm: { value: 0 },
  };
}

function materialState(material: THREE.Material): WaterMaterialState | undefined {
  return material.userData[WATER_STATE_KEY] as WaterMaterialState | undefined;
}

function setWaterPresentation(mesh: THREE.Mesh | undefined, elapsedSeconds: number, weather: WaterWeatherSummary, transition: number): void {
  if (!mesh) return;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    const state = materialState(material);
    if (!state) continue;
    state.time.value = elapsedSeconds;
    state.transition.value = transition;
    state.wind.value = weather.wind;
    state.windX.value = weather.windX;
    state.windZ.value = weather.windZ;
    state.rain.value = weather.rain;
    state.storm.value = weather.storm;
  }
}

function stormIntensity(weather: WeatherCellState | undefined): number {
  if (!weather) return 0;
  if (weather.kind === 'hurricane' || weather.kind === 'tornado') return clamp01(weather.intensity);
  if (weather.kind === 'thunderstorm' || weather.kind === 'windstorm') return clamp01(weather.intensity * 0.9);
  if (weather.kind === 'heavy-rain' || weather.kind === 'heavy-snow') return clamp01(weather.intensity * 0.35);
  return 0;
}

function waterWeatherSummary(world: WorldState): WaterWeatherSummary {
  const state = world.weather;
  if (!state) return { wind: 0, windX: 1, windZ: 0, rain: 0, storm: 0 };
  let rain = 0;
  let storm = 0;
  let count = 0;
  for (const cell of state.cells) {
    count += 1;
    if (cell.precipitation === 'rain' || cell.precipitation === 'mixed') rain += cell.intensity;
    storm += stormIntensity(cell);
  }
  const directionLength = Math.hypot(state.windX, state.windZ);
  return {
    wind: clamp01(state.wind),
    windX: directionLength > 0.001 ? state.windX / directionLength : 1,
    windZ: directionLength > 0.001 ? state.windZ / directionLength : 0,
    rain: clamp01(count > 0 ? rain / count * 1.8 : 0),
    storm: clamp01(count > 0 ? storm / count * 2.2 + Math.max(0, state.wind - 0.68) * 0.65 : 0),
  };
}

function weatherAt(world: WorldState, worldX: number, worldZ: number): WeatherCellState | undefined {
  const weather = world.weather;
  if (!weather) return undefined;
  const x = Math.max(0, Math.min(world.size - 1, Math.round(worldX / world.cellSize + world.size / 2)));
  const z = Math.max(0, Math.min(world.size - 1, Math.round(worldZ / world.cellSize + world.size / 2)));
  return weather.cells[z * world.size + x];
}

/**
 * Presentation-only freeze response. Calm standing water freezes readily; strong river current
 * resists ice. Temperatures use Godbox's normalized climate scale, where FREEZING is 0.38.
 */
export function waterFreezeFactor(temperature: number, kind: WaterKindName, flow = 0, snowpack = 0): number {
  const cold = clamp01((FREEZING + 0.035 - temperature) / 0.16);
  if (cold <= 0) return 0;
  const currentResistance = kind === 'river' ? clamp01(1 - flow * 0.88) : kind === 'flood' ? 0.86 : 1;
  const settledSnow = clamp01(snowpack * 8) * 0.12;
  return clamp01((cold + settledSnow) * currentResistance);
}

function kindName(kind: number): WaterKindName {
  return kind === WATER_RIVER ? 'river' : kind === WATER_FLOOD ? 'flood' : 'lake';
}

function currentInlandWetMask(world: WorldState): Uint8Array {
  const { terrain, seaLevel } = world;
  const mask = new Uint8Array(terrain.height.length);
  for (let index = 0; index < terrain.height.length; index += 1) {
    if (terrain.waterLevel[index]! >= 0 && terrain.height[index]! >= seaLevel) mask[index] = 1;
  }
  return mask;
}

function computeFreezeSnapshot(world: WorldState): Float32Array {
  const { terrain, seaLevel } = world;
  const frozen = new Float32Array(terrain.height.length);
  for (let index = 0; index < terrain.height.length; index += 1) {
    if (terrain.waterLevel[index]! < 0 || terrain.height[index]! < seaLevel) continue;
    const x = terrain.originX + index % terrain.resolution * terrain.step;
    const z = terrain.originZ + Math.floor(index / terrain.resolution) * terrain.step;
    const weather = weatherAt(world, x, z);
    if (!weather) continue;
    const kind = waterKindAt(world, index);
    frozen[index] = waterFreezeFactor(weather.temperature, kindName(kind), terrain.flow[index] ?? 0, weather.snowpack);
  }
  return frozen;
}

/** Broad ocean swell plus wind-driven wave trains, storm energy and restrained rain sparkle. */
function createOceanMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#2b6d78',
    roughness: 0.2,
    metalness: 0.01,
    depthWrite: true,
    clearcoat: 0.78,
    clearcoatRoughness: 0.18,
  });
  const state = createMaterialState();
  material.userData[WATER_STATE_KEY] = state;
  material.onBeforeCompile = shader => {
    shader.uniforms['waterTime'] = state.time;
    shader.uniforms['waterWind'] = state.wind;
    shader.uniforms['waterWindX'] = state.windX;
    shader.uniforms['waterWindZ'] = state.windZ;
    shader.uniforms['waterRain'] = state.rain;
    shader.uniforms['waterStorm'] = state.storm;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float waterTime;\nuniform float waterWind;\nuniform float waterWindX;\nuniform float waterWindZ;\nuniform float waterStorm;\nvarying vec2 vWaterLocal;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvWaterLocal = position.xy;\nvec2 oceanWindDirection = normalize(vec2(waterWindX, waterWindZ) + vec2(0.0001));\nvec2 oceanAcross = vec2(-oceanWindDirection.y, oceanWindDirection.x);\nfloat oceanAlong = dot(position.xy, oceanWindDirection);\nfloat oceanCross = dot(position.xy, oceanAcross);\nfloat oceanEnergy = 0.62 + waterWind * 0.9 + waterStorm * 1.35;\nfloat oceanWaveA = sin(oceanAlong * 0.032 - waterTime * (0.28 + waterWind * 0.28));\nfloat oceanWaveB = sin(oceanAlong * 0.055 + oceanCross * 0.018 - waterTime * (0.21 + waterWind * 0.18));\nfloat oceanWaveC = sin(oceanCross * 0.082 + waterTime * 0.17);\ntransformed.z += (oceanWaveA * 0.020 + oceanWaveB * 0.011 + oceanWaveC * 0.004) * oceanEnergy;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform float waterTime;\nuniform float waterWind;\nuniform float waterWindX;\nuniform float waterWindZ;\nuniform float waterRain;\nuniform float waterStorm;\nvarying vec2 vWaterLocal;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\nvec2 oceanWindDirection = normalize(vec2(waterWindX, waterWindZ) + vec2(0.0001));\nfloat oceanAlong = dot(vWaterLocal, oceanWindDirection);\nfloat oceanAcross = dot(vWaterLocal, vec2(-oceanWindDirection.y, oceanWindDirection.x));\nfloat oceanCrossA = sin(oceanAlong * (0.12 + waterWind * 0.05) - waterTime * (0.48 + waterWind * 0.5));\nfloat oceanCrossB = sin(oceanAcross * 0.16 + oceanAlong * 0.035 + waterTime * 0.31);\nfloat oceanRipple = (oceanCrossA + oceanCrossB) * 0.5;\nfloat rainDimple = sin(vWaterLocal.x * 8.1 + waterTime * 8.4) * sin(vWaterLocal.y * 7.3 - waterTime * 7.7);\nfloat oceanGlint = smoothstep(0.70, 0.99, oceanRipple) * (0.08 + waterWind * 0.05);\ndiffuseColor.rgb *= 1.0 + oceanRipple * (0.022 + waterWind * 0.012);\ndiffuseColor.rgb += vec3(0.12, 0.18, 0.19) * oceanGlint;\ndiffuseColor.rgb += vec3(0.11, 0.14, 0.15) * max(0.0, rainDimple) * waterRain * 0.045;\ndiffuseColor.rgb *= 1.0 - waterStorm * 0.07;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + waterStorm * 0.08 + waterRain * 0.04, 0.08, 0.9);`);
  };
  material.customProgramCacheKey = () => 'godbox-ocean-water-v3-weather';
  return material;
}

/**
 * Geographic inland material. Rivers travel downstream, lakes answer the wind, floods stay heavy,
 * rain breaks the surface, and ice grows/thaws from real local temperature and current.
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
  const state = createMaterialState();
  material.userData[WATER_STATE_KEY] = state;
  material.onBeforeCompile = shader => {
    shader.uniforms['waterTime'] = state.time;
    shader.uniforms['waterTransition'] = state.transition;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float waterTime;\nuniform float waterTransition;\nattribute float waterDepth;\nattribute float waterFlow;\nattribute vec2 waterFlowDirection;\nattribute float waterKind;\nattribute float waterHierarchy;\nattribute float waterRapid;\nattribute vec2 waterWindDirection;\nattribute float waterWind;\nattribute float waterRain;\nattribute float waterStorm;\nattribute float waterFreezePrevious;\nattribute float waterFreeze;\nattribute float waterSnow;\nattribute float waterEmergence;\nvarying float vWaterDepth;\nvarying float vWaterFlow;\nvarying vec2 vWaterFlowDirection;\nvarying float vWaterKind;\nvarying float vWaterHierarchy;\nvarying float vWaterRapid;\nvarying float vWaterRain;\nvarying float vWaterWind;\nvarying float vWaterStorm;\nvarying float vWaterIce;\nvarying float vWaterSnow;\nvarying vec3 vWaterPosition;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvWaterDepth = waterDepth;\nvWaterFlow = waterFlow;\nvWaterFlowDirection = waterFlowDirection;\nvWaterKind = waterKind;\nvWaterHierarchy = waterHierarchy;\nvWaterRapid = waterRapid;\nvWaterRain = waterRain;\nvWaterWind = waterWind;\nvWaterStorm = waterStorm;\nvWaterSnow = waterSnow;\nvWaterIce = mix(waterFreezePrevious, waterFreeze, waterTransition);\nfloat waterRiver = 1.0 - step(0.49, abs(waterKind - 1.0));\nfloat waterLake = 1.0 - step(0.49, abs(waterKind));\nfloat waterFlood = max(0.0, 1.0 - waterRiver - waterLake);\nfloat waterShoreDamping = smoothstep(0.012, 0.11, waterDepth);\nvec2 waterDirection = length(waterFlowDirection) > 0.01 ? normalize(waterFlowDirection) : vec2(0.7071, 0.7071);\nvec2 windDirection = length(waterWindDirection) > 0.01 ? normalize(waterWindDirection) : vec2(0.7071, -0.7071);\nvec2 waterAcross = vec2(-waterDirection.y, waterDirection.x);\nfloat waterCurrentCoordinate = dot(position.xz, waterDirection);\nfloat waterAcrossCoordinate = dot(position.xz, waterAcross);\nfloat windCoordinate = dot(position.xz, windDirection);\nfloat weatherEnergy = 0.65 + waterWind * 0.75 + waterStorm * 1.2;\nfloat lakeWave = sin(windCoordinate * (1.0 + waterWind * 0.6) - waterTime * (0.32 + waterWind * 0.72)) + sin(dot(position.xz, vec2(-windDirection.y, windDirection.x)) * 1.32 + waterTime * 0.27);\nfloat riverWave = sin(waterCurrentCoordinate * (1.50 + waterHierarchy * 0.55) - waterTime * (1.05 + waterFlow * 1.8) + sin(waterAcrossCoordinate * 1.9) * 0.35);\nfloat crossWind = sin(windCoordinate * 2.1 - waterTime * (0.45 + waterWind * 0.8)) * waterWind;\nfloat rapidChop = sin(waterCurrentCoordinate * 4.1 - waterTime * (2.6 + waterFlow * 2.2) + waterAcrossCoordinate * 0.7);\nfloat rainMicro = sin(position.x * 8.4 + position.z * 7.1 + waterTime * 8.7) * waterRain;\nfloat floodWave = sin(position.x * 0.62 + position.z * 0.51 + waterTime * 0.18);\nfloat waterDisplacement = lakeWave * 0.0017 * weatherEnergy * waterLake + (riverWave * (0.0018 + waterFlow * 0.0022) + crossWind * 0.0012) * waterRiver + rapidChop * waterRapid * 0.0032 * waterRiver + floodWave * 0.0007 * waterFlood + rainMicro * 0.00075;\nwaterDisplacement *= (1.0 - vWaterIce * 0.96);\ntransformed.y += waterDisplacement * waterShoreDamping;\ntransformed.y -= waterDepth * 0.84 * waterEmergence * (1.0 - waterTransition) * waterFlood;\nvWaterPosition = transformed;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform float waterTime;\nvarying float vWaterDepth;\nvarying float vWaterFlow;\nvarying vec2 vWaterFlowDirection;\nvarying float vWaterKind;\nvarying float vWaterHierarchy;\nvarying float vWaterRapid;\nvarying float vWaterRain;\nvarying float vWaterWind;\nvarying float vWaterStorm;\nvarying float vWaterIce;\nvarying float vWaterSnow;\nvarying vec3 vWaterPosition;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\nfloat waterRiver = 1.0 - step(0.49, abs(vWaterKind - 1.0));\nfloat waterLake = 1.0 - step(0.49, abs(vWaterKind));\nfloat waterFlood = max(0.0, 1.0 - waterRiver - waterLake);\nfloat waterShallow = 1.0 - smoothstep(0.025, 0.20, vWaterDepth);\nfloat waterDeep = smoothstep(0.16, 0.82, vWaterDepth);\nfloat waterBank = 1.0 - smoothstep(0.008, 0.060, vWaterDepth);\nvec3 waterShallowTint = vec3(0.39, 0.64, 0.61);\nvec3 waterDeepTint = vec3(0.075, 0.25, 0.31);\nvec3 waterLakeTint = vec3(0.16, 0.39, 0.43);\nvec3 waterRiverTint = mix(vec3(0.17, 0.42, 0.43), vec3(0.08, 0.31, 0.36), vWaterHierarchy);\nvec3 waterFloodTint = vec3(0.30, 0.34, 0.24);\nvec3 lakeBankTint = vec3(0.25, 0.43, 0.38);\nvec3 riverBankTint = vec3(0.29, 0.32, 0.22);\nvec3 floodBankTint = vec3(0.34, 0.29, 0.18);\nvec3 bankTint = lakeBankTint * waterLake + riverBankTint * waterRiver + floodBankTint * waterFlood;\ndiffuseColor.rgb = mix(diffuseColor.rgb, waterShallowTint, waterShallow * 0.18);\ndiffuseColor.rgb = mix(diffuseColor.rgb, waterDeepTint, waterDeep * 0.24);\ndiffuseColor.rgb = mix(diffuseColor.rgb, waterLakeTint, waterLake * 0.12);\ndiffuseColor.rgb = mix(diffuseColor.rgb, waterRiverTint, waterRiver * (0.12 + vWaterHierarchy * 0.12));\ndiffuseColor.rgb = mix(diffuseColor.rgb, waterFloodTint, waterFlood * 0.38);\ndiffuseColor.rgb = mix(diffuseColor.rgb, bankTint, waterBank * (0.16 + waterFlood * 0.16));\nvec2 waterDirection = length(vWaterFlowDirection) > 0.01 ? normalize(vWaterFlowDirection) : vec2(0.7071, 0.7071);\nvec2 waterAcross = vec2(-waterDirection.y, waterDirection.x);\nfloat waterCurrentCoordinate = dot(vWaterPosition.xz, waterDirection);\nfloat waterAcrossCoordinate = dot(vWaterPosition.xz, waterAcross);\nfloat lakeRipple = (sin(vWaterPosition.x * 1.55 + waterTime * (0.40 + vWaterWind * 0.45)) + sin(vWaterPosition.z * 1.39 - waterTime * 0.39)) * 0.5;\nfloat riverCurrent = sin(waterCurrentCoordinate * (2.3 + vWaterHierarchy) - waterTime * (1.7 + vWaterFlow * 2.7) + sin(waterAcrossCoordinate * 2.1) * 0.45);\nfloat currentLane = pow(max(0.0, 0.5 + 0.5 * riverCurrent), 7.0) * waterRiver;\nfloat rapidCrest = pow(max(0.0, sin(waterCurrentCoordinate * 5.2 - waterTime * (3.5 + vWaterFlow * 3.0) + waterAcrossCoordinate * 0.9)), 9.0) * vWaterRapid * waterRiver;\nfloat rainScatter = max(0.0, sin(vWaterPosition.x * 8.2 + waterTime * 8.6) * sin(vWaterPosition.z * 7.5 - waterTime * 7.9)) * vWaterRain;\nfloat waterRipple = lakeRipple * waterLake + riverCurrent * 0.55 * waterRiver + lakeRipple * 0.18 * waterFlood;\nwaterRipple *= 1.0 - vWaterIce * 0.94;\nfloat waterGlint = smoothstep(0.76, 0.98, waterRipple) * smoothstep(0.025, 0.12, vWaterDepth);\ndiffuseColor.rgb *= 1.0 + waterRipple * (0.014 + waterRiver * 0.012);\ndiffuseColor.rgb += vec3(0.10, 0.15, 0.15) * waterGlint * 0.12;\ndiffuseColor.rgb += vec3(0.10, 0.16, 0.15) * currentLane * (0.035 + vWaterFlow * 0.045) * (1.0 - vWaterIce);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.88, 0.86), rapidCrest * 0.52 * (1.0 - vWaterIce));\ndiffuseColor.rgb += vec3(0.10, 0.13, 0.13) * rainScatter * 0.055 * (1.0 - vWaterIce);\ndiffuseColor.rgb *= 1.0 - vWaterStorm * 0.045;\nvec3 iceTint = mix(vec3(0.43, 0.59, 0.62), vec3(0.62, 0.72, 0.73), waterLake);\ndiffuseColor.rgb = mix(diffuseColor.rgb, iceTint, vWaterIce * 0.74);\nfloat snowOnIce = smoothstep(0.72, 0.96, vWaterIce) * smoothstep(0.008, 0.07, vWaterSnow);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.88, 0.87), snowOnIce * 0.48);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(mix(roughnessFactor, 0.68, vWaterIce * 0.78) + vWaterStorm * 0.035, 0.08, 0.92);`);
  };
  material.customProgramCacheKey = () => 'godbox-inland-water-v3-environment';
  return material;
}

interface FallSite {
  index: number;
  worldX: number;
  worldZ: number;
  topY: number;
  bottomY: number;
  drop: number;
  intensity: number;
  direction: readonly [number, number];
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
      let lowestIndex = index;
      for (const offset of [-1, 1, -resolution, resolution]) {
        const candidate = index + offset;
        if (read(height, candidate) < lowest) {
          lowest = read(height, candidate);
          lowestIndex = candidate;
        }
      }
      const groundDrop = elevationToY(read(height, index), seaLevel) - elevationToY(lowest, seaLevel);
      if (groundDrop < 0.7) continue;
      const level = terrain.waterLevel[index] ?? -1;
      const topY = level >= 0 ? elevationToY(level, seaLevel) : elevationToY(read(height, index), seaLevel);
      const bottomY = elevationToY(lowest, seaLevel) + 0.03;
      let direction = flowDirectionAt(world, index);
      if (Math.hypot(direction[0], direction[1]) < 0.5) {
        const dx = lowestIndex % resolution - x;
        const dz = Math.floor(lowestIndex / resolution) - z;
        const length = Math.hypot(dx, dz);
        direction = length > 0 ? [dx / length, dz / length] : [0, 1];
      }
      sites.push({ index, worldX: originX + x * step, worldZ: originZ + z * step, topY, bottomY, drop: Math.max(0.7, topY - bottomY), intensity, direction });
    }
  }
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

/** Wet-only interpolation removes terraced puddles without allowing a dry sample to become water. */
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
export function buildInlandWater(world: WorldState, previousWet?: Uint8Array, previousFreeze?: Float32Array): THREE.Mesh | undefined {
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
  const windDirections: number[] = [];
  const winds: number[] = [];
  const rains: number[] = [];
  const storms: number[] = [];
  const freezePrevious: number[] = [];
  const freezes: number[] = [];
  const snows: number[] = [];
  const emergences: number[] = [];
  const bank = new THREE.Color('#75aaa1');
  const shallow = new THREE.Color('#4f8f92');
  const deep = new THREE.Color('#245f6d');
  const flood = new THREE.Color('#66765f');
  const colour = new THREE.Color();
  const maximumAccumulation = maxDrainageAccumulation(world);
  const currentFreeze = computeFreezeSnapshot(world);
  type Vertex = { x: number; y: number; z: number; depth: number };

  for (let index = 0; index < height.length; index++) {
    if (waterLevel[index]! < 0 || height[index]! < seaLevel) continue;
    const x = originX + index % resolution * step;
    const z = originZ + Math.floor(index / resolution) * step;
    const currentFlow = flow[index] ?? 0;
    const direction = flowDirectionAt(world, index);
    const kind = waterKindAt(world, index);
    const hierarchy = waterHierarchyAt(world, index, maximumAccumulation);
    const rapid = rapidIntensityAt(world, index);
    const localWeather = weatherAt(world, x, z);
    const windX = localWeather?.windX ?? world.weather?.windX ?? 1;
    const windZ = localWeather?.windZ ?? world.weather?.windZ ?? 0;
    const windLength = Math.hypot(windX, windZ);
    const wind = clamp01(localWeather?.wind ?? world.weather?.wind ?? 0);
    const rain = localWeather && (localWeather.precipitation === 'rain' || localWeather.precipitation === 'mixed') ? clamp01(localWeather.intensity) : 0;
    const storm = stormIntensity(localWeather);
    const frozen = currentFreeze[index] ?? 0;
    const priorFrozen = previousFreeze?.[index] ?? frozen;
    const snow = localWeather?.snowpack ?? 0;
    const emergence = previousWet && !previousWet[index] && kind === WATER_FLOOD ? 1 : 0;

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
          clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, depth: 0 });
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
          windDirections.push(windLength > 0.001 ? windX / windLength : 1, windLength > 0.001 ? windZ / windLength : 0);
          winds.push(wind);
          rains.push(rain);
          storms.push(storm);
          freezePrevious.push(priorFrozen);
          freezes.push(frozen);
          snows.push(snow);
          emergences.push(emergence);
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
  geometry.setAttribute('waterWindDirection', new THREE.Float32BufferAttribute(windDirections, 2));
  geometry.setAttribute('waterWind', new THREE.Float32BufferAttribute(winds, 1));
  geometry.setAttribute('waterRain', new THREE.Float32BufferAttribute(rains, 1));
  geometry.setAttribute('waterStorm', new THREE.Float32BufferAttribute(storms, 1));
  geometry.setAttribute('waterFreezePrevious', new THREE.Float32BufferAttribute(freezePrevious, 1));
  geometry.setAttribute('waterFreeze', new THREE.Float32BufferAttribute(freezes, 1));
  geometry.setAttribute('waterSnow', new THREE.Float32BufferAttribute(snows, 1));
  geometry.setAttribute('waterEmergence', new THREE.Float32BufferAttribute(emergences, 1));
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
      base[offset] = px; base[offset + 1] = y; base[offset + 2] = pz;
      base[offset + 3] = site.direction[0]; base[offset + 4] = site.direction[1];
      base[offset + 5] = random.float();
      base[offset + 6] = terrain.step * random.range(0.18, 0.36);
      base[offset + 7] = random.range(0.7, 1.35) * (0.75 + site.intensity * 0.8);
      cursor += 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#e4f1ed', size: 0.09, map: softPointTexture(), transparent: true, opacity: 0.58, depthWrite: false, sizeAttenuation: true }));
  points.name = 'river-rapid-foam';
  points.frustumCulled = false;
  return { points, base, sites: sites.length };
}

/** Thin curved sheets turn a mapped fall into a readable body of falling water, not just particles. */
function buildWaterfallSheets(falls: FallSite[], world: WorldState): THREE.Mesh | undefined {
  if (!falls.length) return undefined;
  const positions: number[] = [];
  const progress: number[] = [];
  const indices: number[] = [];
  const segments = 9;
  for (const fall of falls) {
    const acrossX = -fall.direction[1];
    const acrossZ = fall.direction[0];
    const start = positions.length / 3;
    for (let segment = 0; segment <= segments; segment += 1) {
      const t = segment / segments;
      const curve = t * t;
      const drift = world.terrain.step * (0.16 + fall.intensity * 0.28) * curve;
      const cx = fall.worldX + fall.direction[0] * drift;
      const cz = fall.worldZ + fall.direction[1] * drift;
      const y = fall.topY + (fall.bottomY - fall.topY) * t;
      const width = world.terrain.step * (0.16 + fall.intensity * 0.22) * (1 - t * 0.32);
      for (const side of [-1, 1]) {
        positions.push(cx + acrossX * width * side, y, cz + acrossZ * width * side);
        progress.push(t);
      }
    }
    for (let segment = 0; segment < segments; segment += 1) {
      const a = start + segment * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('fallProgress', new THREE.Float32BufferAttribute(progress, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = createWaterfallMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'waterfall-sheets';
  mesh.frustumCulled = false;
  return mesh;
}

function createWaterfallMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#b9d9d8',
    roughness: 0.18,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.16,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const state = createMaterialState();
  material.userData[WATER_STATE_KEY] = state;
  material.onBeforeCompile = shader => {
    shader.uniforms['waterTime'] = state.time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float waterTime;\nattribute float fallProgress;\nvarying float vFallProgress;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvFallProgress = fallProgress;\ntransformed.y += sin(fallProgress * 19.0 - waterTime * 6.0) * 0.008 * (0.2 + fallProgress);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform float waterTime;\nvarying float vFallProgress;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\nfloat fallStreak = pow(max(0.0, sin(vFallProgress * 42.0 - waterTime * 9.0)), 6.0);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.95, 0.94), fallStreak * 0.32);\ndiffuseColor.a *= 0.78 + fallStreak * 0.22;`);
  };
  material.customProgramCacheKey = () => 'godbox-waterfall-sheet-v1';
  return material;
}

function buildPlungePools(falls: FallSite[], world: WorldState, random: SeededRandom): PlungeFoam | undefined {
  if (!falls.length) return undefined;
  const perFall = 34;
  const positions = new Float32Array(falls.length * perFall * 3);
  const base = new Float32Array(falls.length * perFall * 8);
  let cursor = 0;
  for (const fall of falls) {
    const centerX = fall.worldX + fall.direction[0] * world.terrain.step * 0.24;
    const centerZ = fall.worldZ + fall.direction[1] * world.terrain.step * 0.24;
    for (let index = 0; index < perFall; index += 1) {
      const phase = random.float();
      const radius = world.terrain.step * random.range(0.18, 0.68) * (0.7 + fall.intensity * 0.5);
      positions[cursor * 3] = centerX;
      positions[cursor * 3 + 1] = fall.bottomY + 0.035;
      positions[cursor * 3 + 2] = centerZ;
      const offset = cursor * 8;
      base[offset] = centerX; base[offset + 1] = fall.bottomY + 0.035; base[offset + 2] = centerZ;
      base[offset + 3] = fall.direction[0]; base[offset + 4] = fall.direction[1];
      base[offset + 5] = phase; base[offset + 6] = radius; base[offset + 7] = random.range(0.28, 0.62) * (0.8 + fall.intensity * 0.5);
      cursor += 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#edf5f0', size: 0.16, map: softPointTexture(), transparent: true, opacity: 0.64, depthWrite: false, sizeAttenuation: true }));
  points.name = 'waterfall-plunge-foam';
  points.frustumCulled = false;
  return { points, base, sites: falls.length };
}

function buildRecessionWetness(world: WorldState, previousWet: Uint8Array, nextWet: Uint8Array): THREE.Points | undefined {
  const { terrain } = world;
  const positions: number[] = [];
  for (let index = 0; index < previousWet.length; index += 1) {
    if (!previousWet[index] || nextWet[index]) continue;
    const x = terrain.originX + index % terrain.resolution * terrain.step;
    const z = terrain.originZ + Math.floor(index / terrain.resolution) * terrain.step;
    positions.push(x, surfaceHeightAt(world, x, z) + 0.012, z);
  }
  if (!positions.length) return undefined;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#3f4633', size: Math.max(0.22, terrain.step * 1.45), map: softPointTexture(), transparent: true, opacity: 0.22, depthWrite: false, sizeAttenuation: true }));
  points.name = 'receded-water-wetness';
  points.frustumCulled = false;
  return points;
}

function buildFoam(falls: FallSite[], world: WorldState, random: SeededRandom): { points: THREE.Points; base: Float32Array } | undefined {
  if (falls.length === 0) return undefined;
  const perFall = 54;
  const count = falls.length * perFall;
  const positions = new Float32Array(count * 3);
  const base = new Float32Array(count * 2);
  let cursor = 0;
  for (const fall of falls) {
    for (let index = 0; index < perFall; index += 1) {
      const spread = world.terrain.step * 0.72;
      positions[cursor * 3] = fall.worldX + random.range(-spread, spread);
      positions[cursor * 3 + 1] = fall.topY - random.range(0, fall.drop);
      positions[cursor * 3 + 2] = fall.worldZ + random.range(-spread, spread);
      base[cursor * 2] = fall.topY + random.range(0, 0.16);
      base[cursor * 2 + 1] = fall.drop + 0.24;
      cursor += 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#e9f4f6', size: 0.24, map: softPointTexture(), transparent: true, opacity: 0.68, depthWrite: false, sizeAttenuation: true }));
  points.name = 'waterfall-foam';
  points.frustumCulled = false;
  return { points, base };
}

/** Soft spray sells scale while the sheet and plunge pool carry the actual waterfall shape. */
function buildMist(falls: FallSite[], world: WorldState, random: SeededRandom): THREE.Points | undefined {
  if (falls.length === 0) return undefined;
  const perFall = 42;
  const positions = new Float32Array(falls.length * perFall * 3);
  let cursor = 0;
  for (const fall of falls) {
    for (let index = 0; index < perFall; index += 1) {
      const spread = world.terrain.step * 2.5;
      positions[cursor * 3] = fall.worldX + fall.direction[0] * world.terrain.step * 0.2 + random.range(-spread, spread);
      positions[cursor * 3 + 1] = fall.bottomY + random.range(-0.05, 1.25);
      positions[cursor * 3 + 2] = fall.worldZ + fall.direction[1] * world.terrain.step * 0.2 + random.range(-spread, spread);
      cursor += 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mist = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#dbe8ea', size: 2.1, map: softPointTexture(), transparent: true, opacity: 0.22, depthWrite: false, sizeAttenuation: true }));
  mist.name = 'waterfall-mist';
  mist.frustumCulled = false;
  return mist;
}
