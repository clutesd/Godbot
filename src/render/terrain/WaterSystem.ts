import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { clamp01 } from '../../sim/terrain/noise';
import { FREEZING } from '../../sim/weather/Precipitation';
import type { WeatherCellState, WorldState } from '../../sim/types';
import { softPointTexture } from '../atmosphere/sprites';
import { elevationToY, type TerrainSurface } from './TerrainSurface';
import { WaterReconstruction, WATER_CLEARANCE, type WaterVertex } from './WaterReconstruction';
import type { EcologyField } from '../ecology/EcologyField';
import { WaterEcology } from './WaterEcology';
import { packInlandAttributes, packInlandShader, smoothInlandWaterNormals, weldWaterVertices } from './WaterAttributes';
import { renderedGroundSampler, renderedGroundColorSampler } from './WaterGround';
import { animateWaterParticles, updateWaterParticles } from './WaterParticles';
import { WATER_OPTICS_GLSL, WATER_SKY_REFLECTION_GLSL, INLAND_WATER_COLOR_GLSL, INLAND_WATER_NORMAL_GLSL } from './WaterOptics';

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

interface RapidFoam { points: THREE.Points; sites: number }
interface PlungeFoam { points: THREE.Points; sites: number }

type WaterKindName = 'lake' | 'river' | 'flood';

const read = (values: Float32Array, index: number): number => values[index] ?? 0;
const WATER_STATE_KEY = 'godboxWaterMaterialState';
const WATER_LAKE = 0;
const WATER_RIVER = 1;
const WATER_FLOOD = 2;
const WATER_TRANSITION_SECONDS = 2.4;
const RECESSION_WET_SECONDS = 10;
const WATER_COVERAGE_THRESHOLD = 0.5;
const SHORELINE_RENDER_DEPTH = WATER_CLEARANCE;
const WATER_CASCADE_SLOPE = 0.3;
const reconstruction = new WeakMap<WorldState, WaterReconstruction>();
function reconstructed(world: WorldState): WaterReconstruction {
  let field = reconstruction.get(world);
  if (!field) { field = new WaterReconstruction(world); reconstruction.set(world, field); }
  return field;
}

/**
 * Everything wet. Hydrology remains authoritative; this layer only turns that truth into a
 * coherent, animated surface. Rendering never widens water beyond the canonical wet footprint.
 */
export class WaterSystem {
  readonly group = new THREE.Group();
  readonly report: WaterReport;
  private readonly ocean: THREE.Mesh;
  private readonly oceanY = 0;
  private foam: THREE.Points | undefined;
  private mist: THREE.Points | undefined;
  private plungePools: THREE.Points | undefined;
  private inland: THREE.Mesh | undefined;
  private rapids: THREE.Points | undefined;
  private recessionWetness: THREE.Mesh | undefined;
  private recessionStarted = -100;
  private transitionStarted = -100;
  private lastElapsed = 0;
  private wetMask: Uint8Array;
  private freezeSnapshot: Float32Array;
  private revision = -1;
  private readonly ecology?: WaterEcology;

  constructor(private readonly world: WorldState, private readonly surface: TerrainSurface, private readonly seed: string, ecology?: EcologyField, waterComplexity: 0 | 1 | 2 = 2) {
    const span = Math.max(world.size * world.cellSize * 6, 720);
    this.group.name = 'water';
    this.group.userData['materialRevision'] = 0;

    const oceanMaterial = createOceanMaterial();
    reconstruction.set(world, new WaterReconstruction(world));
    this.ocean = new THREE.Mesh(buildOceanGeometry(reconstructed(world), span), oceanMaterial);
    this.ocean.name = 'ocean-water';
    this.ocean.receiveShadow = true;
    this.group.add(this.ocean);

    this.wetMask = currentInlandWetMask(world);
    this.freezeSnapshot = computeFreezeSnapshot(world);
    this.inland = buildInlandWater(world, this.wetMask, this.freezeSnapshot, renderedGroundColorSampler(world, surface, seed));
    if (this.inland) this.group.add(this.inland);
    if (ecology) {
      this.ecology = new WaterEcology(world, ecology, waterComplexity);
      this.ecology.bind(this.ocean, true);
      this.ecology.bind(this.inland, false);
    }

    const rapidFoam = buildRapidFoam(world, new SeededRandom(`${seed}:rapids`));
    this.rapids = rapidFoam?.points;
    if (this.rapids) this.group.add(this.rapids);

    const falls = collectFalls(world);
    const waterfallRandom = new SeededRandom(`${seed}:waterfalls`);
    const foam = buildFoam(falls, waterfallRandom);
    this.foam = foam?.points;
    if (foam) this.group.add(foam.points);

    this.mist = buildMist(falls, waterfallRandom);
    if (this.mist) this.group.add(this.mist);

    this.revision = world.environmentRevision ?? 0;

    const plunge = buildPlungePools(falls, new SeededRandom(`${seed}:plunge-pools`));
    this.plungePools = plunge?.points;
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

    // The coast shares exact geometry edges; wave motion changes normals, never the seam height.
    this.ocean.position.y = this.oceanY;
    setWaterPresentation(this.ocean, elapsedSeconds, weather, 1);
    setWaterPresentation(this.inland, elapsedSeconds, weather, transition);
    // Cascades share the inland material and its transition state.

    updateWaterParticles(this.rapids, elapsedSeconds);
    updateWaterParticles(this.plungePools, elapsedSeconds);
    updateWaterParticles(this.foam, elapsedSeconds);
    this.updateRecessionWetness(elapsedSeconds);

    if (this.mist) {
      // Wind carries spray, but the particle cloud remains anchored to the fall itself.
      const spray = this.mist.material as THREE.PointsMaterial;
      const sprayTime = spray.userData['sprayTime'] as { value: number };
      sprayTime.value = elapsedSeconds;
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
    this.inland = buildInlandWater(this.world, previousWet, previousFreeze, renderedGroundColorSampler(this.world, this.surface, this.seed));
    this.ocean.geometry.dispose();
    this.ocean.geometry = buildOceanGeometry(reconstructed(this.world), Math.max(this.world.size * this.world.cellSize * 6, 720));
    this.ecology?.refreshTerrain();
    this.ecology?.bind(this.inland, false);
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
    if (this.rapids) this.group.add(this.rapids);
    this.report.rapidSites = rapidFoam?.sites ?? 0;
    // Falls belong to current hydrology too: retired channels must not keep pouring onto dry land.
    for (const object of [this.foam, this.mist, this.plungePools]) {
      if (object) { this.group.remove(object); disposeObject(object); }
    }
    const falls = collectFalls(this.world);
    const random = new SeededRandom(`${this.seed}:waterfalls`);
    const foam = buildFoam(falls, random);
    this.foam = foam?.points;
    this.mist = buildMist(falls, random);
    const plunge = buildPlungePools(falls, new SeededRandom(`${this.seed}:plunge-pools`));
    this.plungePools = plunge?.points;
    for (const object of [this.foam, this.mist, this.plungePools]) {
      if (object) this.group.add(object);
    }
    this.report.waterfalls = falls.length;
    this.report.plungePools = plunge?.sites ?? 0;
    this.report.lakeSurfaces = countChannel(this.world.terrain.lake);
    this.report.riverSamples = countChannel(this.world.terrain.river);
    this.group.userData['materialRevision'] = (this.group.userData['materialRevision'] as number ?? 0) + 1;
  }

  setSeasonalTint(colour: THREE.Color): void {
    const material = this.ocean.material;
    if (material instanceof THREE.MeshPhysicalMaterial) material.color.copy(colour);
  }

  /** Geometry/materials are disposed by the renderer's scene traversal. */
  dispose(): void { this.ecology?.dispose(); }

  private updateRecessionWetness(elapsedSeconds: number): void {
    if (!this.recessionWetness) return;
    const material = this.recessionWetness.material as THREE.MeshStandardMaterial;
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
  for (const child of object.children) disposeObject(child);
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
    metalness: 0,
    ior: 1.333,
    depthWrite: true,
    clearcoat: 0.08,
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
    // Keep the ocean geometry physically smooth. Wave shape belongs in the fragment normal; vertex
    // displacement on the very large plane exposes its triangles as long diagonal facets at low angles.
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvWaterLocal = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float waterTime;
      uniform float waterWind;
      uniform float waterWindX;
      uniform float waterWindZ;
      uniform float waterRain;
      uniform float waterStorm;
      varying vec2 vWaterLocal;
      ${WATER_OPTICS_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float waterOpen = 1.0;
      vec2 oceanWindDirection = vec2(waterWindX, waterWindZ);
      vec3 oceanCurrent = waterAdvectedField(vWaterLocal,oceanWindDirection*0.18,waterTime,0.32);
      diffuseColor.rgb *= 0.88+oceanCurrent.x*0.16;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      vec2 oceanGradient = waterWindSlope(vWaterLocal,oceanWindDirection,waterTime,waterWind,waterStorm);
      normal = normalize(normal+(viewMatrix*vec4(-oceanGradient.x,0,-oceanGradient.y,0)).xyz);
      nonPerturbedNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor+waterWind*0.055+waterStorm*0.10+waterRain*0.045
        +waterDetailRoughness(vWaterLocal,3.4)*0.26,0.16,0.72);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
${WATER_SKY_REFLECTION_GLSL}`);
  };
  material.customProgramCacheKey = () => 'godbox-ocean-water-v8-distance-roughness';
  return material;
}

/**
 * Geographic inland material. Rivers travel downstream, lakes answer the wind, floods stay heavy,
 * rain breaks the surface, and ice grows/thaws from real local temperature and current.
 */
function createInlandMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    // Reuse the colour buffer as the submerged terrain palette. The shader applies depth
    // absorption explicitly instead of multiplying terrain colour across deep water.
    vertexColors: false,
    roughness: 0.22,
    metalness: 0,
    ior: 1.333,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    clearcoat: 0.08,
    clearcoatRoughness: 0.2,
  });
  const state = createMaterialState();
  material.userData[WATER_STATE_KEY] = state;
  material.onBeforeCompile = shader => {
    shader.uniforms['waterTime'] = state.time;
    shader.uniforms['waterTransition'] = state.transition;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float waterTime;\nuniform float waterTransition;\nattribute vec3 waterBedColour;\nvarying vec3 vWaterBedColour;\nattribute float waterDepth;\nattribute float waterFlow;\nattribute vec2 waterFlowDirection;\nattribute float waterKind;\nattribute float waterHierarchy;\nattribute float waterRapid;\nattribute vec2 waterWindDirection;\nattribute float waterWind;\nattribute float waterRain;\nattribute float waterStorm;\nattribute float waterFreezePrevious;\nattribute float waterFreeze;\nattribute float waterSnow;\nattribute float waterEmergence;\nvarying float vWaterDepth;\nvarying float vWaterFlow;\nvarying vec2 vWaterFlowDirection;\nvarying vec2 vWaterWindDirection;\nvarying float vWaterKind;\nvarying float vWaterHierarchy;\nvarying float vWaterRapid;\nvarying float vWaterRain;\nvarying float vWaterWind;\nvarying float vWaterStorm;\nvarying float vWaterIce;\nvarying float vWaterSnow;\nvarying vec3 vWaterPosition;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvWaterBedColour = waterBedColour;\nvWaterDepth = waterDepth;\nvWaterFlow = waterFlow;\nvWaterFlowDirection = waterFlowDirection;\nvWaterWindDirection = waterWindDirection;\nvWaterKind = waterKind;\nvWaterHierarchy = waterHierarchy;\nvWaterRapid = waterRapid;\nvWaterRain = waterRain;\nvWaterWind = waterWind;\nvWaterStorm = waterStorm;\nvWaterSnow = waterSnow;\nvWaterIce = mix(waterFreezePrevious, waterFreeze, waterTransition);\n// Keep shared vertices fixed; moving normals carry the waves without opening cracks.\nvWaterPosition = transformed;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float waterTime;
      varying vec3 vWaterBedColour;
      varying float vWaterDepth;
      varying float vWaterFlow;
      varying vec2 vWaterFlowDirection;
      varying vec2 vWaterWindDirection;
      varying float vWaterKind;
      varying float vWaterHierarchy;
      varying float vWaterRapid;
      varying float vWaterRain;
      varying float vWaterWind;
      varying float vWaterStorm;
      varying float vWaterIce;
      varying float vWaterSnow;
      varying vec3 vWaterPosition;
      ${WATER_OPTICS_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
${INLAND_WATER_COLOR_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
${INLAND_WATER_NORMAL_GLSL}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor+vWaterWind*0.025+vWaterStorm*0.07+vWaterRain*0.035
        +waterFoam*0.32+waterFlood*0.10+(waterCurrent.x-0.5)*0.035
        +waterDetailRoughness(vWaterPosition.xz,1.9)*0.24,0.16,0.8);
      roughnessFactor = mix(roughnessFactor,0.38+snowOnIce*0.42,vWaterIce);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
${WATER_SKY_REFLECTION_GLSL}`);
  };
  const compile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.vertexShader = packInlandShader(shader.vertexShader);
  };
  material.customProgramCacheKey = () => 'godbox-inland-water-v11-distance-roughness';
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
  endX: number;
  endZ: number;
  halfWidth: number;
}

function collectFalls(world: WorldState): FallSite[] {
  const { terrain, seaLevel } = world;
  const { resolution, step, originX, originZ, fall } = terrain;
  const sites: FallSite[] = [];
  const groundAt = renderedGroundSampler(world);
  for (let index = 0; index < fall.length; index++) {
    const intensity = read(fall, index);
    if (intensity < 0.22 || terrain.waterLevel[index]! < 0 || !terrain.river[index]) continue;
    // Only the mapped drainage edge can own a fall. A nearby low hillside is not an outlet.
    const next = terrain.drainage?.downstream[index] ?? -1;
    if (next < 0 || next >= fall.length || next === index || terrain.waterLevel[next]! < 0) continue;
    const direction = flowDirectionAt(world,index);
    const topY = elevationToY(terrain.waterLevel[index]!,seaLevel);
    const bottomY = elevationToY(terrain.waterLevel[next]!,seaLevel);
    const drop = topY-bottomY;
    if (drop < 0.12) continue;
    const x = originX+(index%resolution)*step;
    const z = originZ+Math.floor(index/resolution)*step;
    const endX = originX+(next%resolution)*step;
    const endZ = originZ+Math.floor(next/resolution)*step;
    // The canonical nearest-sample discontinuity lies midway along the routed edge.
    const worldX = x;
    const worldZ = z;
    let halfWidth = step*(0.12+clamp01(terrain.flow[index]!)*0.16);
    // Keep both lip and impact inside wet terrain; spectacle never expands the channel.
    for (let attempt=0; attempt<8; attempt++) {
      const supported = [-1,1].every(side => [[worldX,worldZ,topY],[endX,endZ,bottomY]].every(([cx,cz,y]) => {
        const px = cx! - direction[1]*halfWidth*side;
        const pz = cz! + direction[0]*halfWidth*side;
        return inlandWetCoverageAt(world,px,pz)>=WATER_COVERAGE_THRESHOLD && groundAt(px,pz)<y!;
      }));
      if (supported) break;
      halfWidth *= 0.7;
    }
    sites.push({index,worldX,worldZ,topY,bottomY,drop,intensity,direction,endX,endZ,halfWidth});
  }
  return sites;
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

function inlandWetCoverageAt(world: WorldState, x: number, z: number): number {
  return reconstructed(world).sample(x, z).depth > WATER_CLEARANCE ? 1 : 0;
}
function waterSurfaceYAt(world: WorldState, x: number, z: number): number {
  return reconstructed(world).sample(x, z).y;
}
type InlandVertex = WaterVertex;

/** The ocean owns only ocean faces. Mixed coast faces belong to the inland skin and meet this
 * mesh at identical sea-level edges. There is no second plane beneath the mouth to depth-fight. */
function buildOceanGeometry(field: WaterReconstruction, span: number): THREE.BufferGeometry {
  const positions: number[] = [];
  field.forEachFace((face, ocean) => { if (ocean) for (const p of face) positions.push(p.x, p.y, p.z); });
  const t = field.world.terrain;
  const x0 = t.originX, z0 = t.originZ, x1 = x0 + (t.resolution - 1) * t.step, z1 = z0 + (t.resolution - 1) * t.step;
  const r = span / 2;
  const rect = (ax: number, az: number, bx: number, bz: number): void => {
    for (const [x, z] of [[ax, az], [ax, bz], [bx, az], [bx, az], [ax, bz], [bx, bz]]) positions.push(x!, WATER_CLEARANCE, z!);
  };
  rect(-r, -r, r, z0); rect(-r, z1, r, r); rect(-r, z0, x0, z1); rect(x1, z0, r, z1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

/**
 * Build a single contoured inland-water skin from authoritative hydrology.
 *
 * The old renderer drew a literal square around every wet sample and then collapsed steep
 * triangles to zero area. That made hydrology resolution visible as square chunks, diagonal mesh
 * lines and real holes. This contour pass keeps the exact simulation samples as authority but
 * presents their union as one continuous surface with shared positions and no deleted faces.
 */
export function buildInlandWater(world: WorldState, previousWet?: Uint8Array, previousFreeze?: Float32Array, groundColorAt?: (x: number, z: number, target: THREE.Color) => THREE.Color): THREE.Mesh | undefined {
  const { terrain } = world;
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
  const field = new WaterReconstruction(world);
  reconstruction.set(world, field);
  const ordinary: number[] = [], cascades: number[] = [];

  /**
   * Everything a vertex inherits from its hydrology sample rather than its own position. Tens of
   * thousands of vertices share a few thousand samples, so each sample is resolved once.
   */
  const sampleCount = terrain.height.length;
  const resolved = new Uint8Array(sampleCount);
  const perSample = {
    flow: new Float32Array(sampleCount), directionX: new Float32Array(sampleCount), directionZ: new Float32Array(sampleCount),
    kind: new Float32Array(sampleCount), hierarchy: new Float32Array(sampleCount), rapid: new Float32Array(sampleCount),
    windX: new Float32Array(sampleCount), windZ: new Float32Array(sampleCount), wind: new Float32Array(sampleCount),
    rain: new Float32Array(sampleCount), storm: new Float32Array(sampleCount), freeze: new Float32Array(sampleCount),
    freezePrevious: new Float32Array(sampleCount), snow: new Float32Array(sampleCount), emergence: new Float32Array(sampleCount),
  };
  const resolveSample = (source: number): void => {
    if (resolved[source]) return;
    resolved[source] = 1;
    const direction = flowDirectionAt(world, source);
    const kind = waterKindAt(world, source);
    const x = terrain.originX + source % terrain.resolution * terrain.step;
    const z = terrain.originZ + Math.floor(source / terrain.resolution) * terrain.step;
    const localWeather = weatherAt(world, x, z);
    const windX = localWeather?.windX ?? world.weather?.windX ?? 1;
    const windZ = localWeather?.windZ ?? world.weather?.windZ ?? 0;
    const windLength = Math.hypot(windX, windZ);
    const frozen = currentFreeze[source] ?? 0;
    perSample.flow[source] = terrain.flow[source] ?? 0;
    perSample.directionX[source] = direction[0];
    perSample.directionZ[source] = direction[1];
    perSample.kind[source] = kind;
    perSample.hierarchy[source] = waterHierarchyAt(world, source, maximumAccumulation);
    perSample.rapid[source] = rapidIntensityAt(world, source);
    perSample.windX[source] = windLength > 0.001 ? windX / windLength : 1;
    perSample.windZ[source] = windLength > 0.001 ? windZ / windLength : 0;
    perSample.wind[source] = clamp01(localWeather?.wind ?? world.weather?.wind ?? 0);
    perSample.rain[source] = localWeather && (localWeather.precipitation === 'rain' || localWeather.precipitation === 'mixed')
      ? clamp01(localWeather.intensity) : 0;
    perSample.storm[source] = stormIntensity(localWeather);
    perSample.freeze[source] = frozen;
    perSample.freezePrevious[source] = previousFreeze?.[source] ?? frozen;
    perSample.snow[source] = localWeather?.snowpack ?? 0;
    perSample.emergence[source] = previousWet && !previousWet[source] && kind === WATER_FLOOD ? 1 : 0;
  };

  const emit = (point: InlandVertex): void => {
    const source = point.source;
    if (source < 0) return;
    resolveSample(source);
    const currentFlow = perSample.flow[source]!;
    const kind = perSample.kind[source]!;
    const hierarchy = perSample.hierarchy[source]!;
    const depth = Math.max(SHORELINE_RENDER_DEPTH, point.depth);
    const bankToShallow = clamp01(depth / 0.16);
    const shallowToDeep = clamp01(depth * 0.72 + currentFlow * 0.18 + hierarchy * 0.12);
    colour.copy(bank).lerp(shallow, bankToShallow).lerp(deep, shallowToDeep);
    if (kind === WATER_FLOOD) colour.lerp(flood, 0.42);

    groundColorAt?.(point.x, point.z, colour);
    positions.push(point.x, point.y, point.z);
    colors.push(colour.r, colour.g, colour.b);
    depths.push(depth);
    flows.push(currentFlow);
    directions.push(perSample.directionX[source]!, perSample.directionZ[source]!);
    kinds.push(kind);
    hierarchies.push(hierarchy);
    rapids.push(perSample.rapid[source]!);
    windDirections.push(perSample.windX[source]!, perSample.windZ[source]!);
    winds.push(perSample.wind[source]!);
    rains.push(perSample.rain[source]!);
    storms.push(perSample.storm[source]!);
    freezePrevious.push(perSample.freezePrevious[source]!);
    freezes.push(perSample.freeze[source]!);
    snows.push(perSample.snow[source]!);
    emergences.push(perSample.emergence[source]!);
  };

  field.forEachFace((face, ocean, cascade) => {
    if (ocean) return;
    const destination = cascade ? cascades : ordinary;
    for (const point of face) { destination.push(positions.length / 3); emit(point); }
  });

  if (!positions.length) return undefined;
  const vertexCount = positions.length / 3;
  const welded = weldWaterVertices(positions, vertexCount);
  // Steep water is white water wherever it occurs: cascades into the sea, lake overflow and steep
  // reaches alike. Take the steepest face touching each physical point so the foam has no facets.
  const steepestSlope = new Float32Array(vertexCount);
  const steepestFall = new Float32Array(vertexCount * 2);
  /** Rise over run of a face, with the horizontal direction the water runs down it. */
  const faceFall = (first: number): { slope: number; dx: number; dz: number } => {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2].flatMap(k => [positions[(first + k) * 3]!, positions[(first + k) * 3 + 1]!, positions[(first + k) * 3 + 2]!]) as number[];
    let nx = (by! - ay!) * (cz! - az!) - (bz! - az!) * (cy! - ay!);
    let ny = (bz! - az!) * (cx! - ax!) - (bx! - ax!) * (cz! - az!);
    let nz = (bx! - ax!) * (cy! - ay!) - (by! - ay!) * (cx! - ax!);
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const run = Math.hypot(nx, nz);
    return ny > 1e-12 && run > 1e-12 ? { slope: run / ny, dx: nx / run, dz: nz / run } : { slope: 0, dx: 0, dz: 0 };
  };
  for (let first = 0; first + 2 < vertexCount; first += 3) {
    const fall = faceFall(first);
    if (fall.slope < WATER_CASCADE_SLOPE) continue;
    for (let k = 0; k < 3; k += 1) {
      const id = welded[first + k]!;
      if (fall.slope <= steepestSlope[id]!) continue;
      steepestSlope[id] = fall.slope;
      steepestFall[id * 2] = fall.dx;
      steepestFall[id * 2 + 1] = fall.dz;
    }
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const id = welded[vertex]!;
    const slope = steepestSlope[id]!;
    if (slope <= 0) continue;
    rapids[vertex] = Math.max(rapids[vertex]!, clamp01((slope - WATER_CASCADE_SLOPE) / 0.9));
    // Standing water that spills gets a current of its own, running down the surface it spills over.
    if (Math.hypot(directions[vertex * 2]!, directions[vertex * 2 + 1]!) < 0.01) {
      directions[vertex * 2] = steepestFall[id * 2]!;
      directions[vertex * 2 + 1] = steepestFall[id * 2 + 1]!;
    }
  }
  const channels: Array<readonly [string, number[], number]> = [
    ['position', positions, 3], ['color', colors, 3], ['waterDepth', depths, 1], ['waterFlow', flows, 1],
    ['waterFlowDirection', directions, 2], ['waterKind', kinds, 1], ['waterHierarchy', hierarchies, 1],
    ['waterRapid', rapids, 1], ['waterWindDirection', windDirections, 2], ['waterWind', winds, 1],
    ['waterRain', rains, 1], ['waterStorm', storms, 1], ['waterFreezePrevious', freezePrevious, 1],
    ['waterFreeze', freezes, 1], ['waterSnow', snows, 1], ['waterEmergence', emergences, 1],
  ];
  const assemble = (vertices: readonly number[] | undefined): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, values, stride] of channels) {
      const data = vertices ? vertices.flatMap(vertex => values.slice(vertex * stride, vertex * stride + stride)) : values;
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, stride));
    }
    geometry.setAttribute('waterBedColour', geometry.getAttribute('color'));
    geometry.userData['waterReconstruction'] = 'signed-depth-on-shared-terrain-triangles';
    return geometry;
  };

  const all = assemble(undefined);
  smoothInlandWaterNormals(all, welded);
  const normal = all.getAttribute('normal');
  const part = (vertices: number[]): THREE.BufferGeometry => {
    const g = assemble(vertices);
    g.setAttribute('normal', new THREE.Float32BufferAttribute(vertices.flatMap(i => [normal.getX(i), normal.getY(i), normal.getZ(i)]), 3));
    packInlandAttributes(g); g.computeBoundingSphere();
    return g;
  };
  const material = createInlandMaterial();
  const mesh = new THREE.Mesh(part(ordinary), material);
  mesh.name = 'inland-water'; mesh.receiveShadow = true;
  if (cascades.length) {
    const falls = new THREE.Mesh(part(cascades), material);
    falls.name = 'waterfall-sheets'; falls.receiveShadow = true;
    mesh.add(falls);
  }
  all.dispose();
  return mesh;
}

/** Sparse moving foam only where discharge, slope or mapped falls make turbulence believable. */
function buildRapidFoam(world: WorldState, random: SeededRandom): RapidFoam | undefined {
  const { terrain, seaLevel } = world;
  const groundAt = renderedGroundSampler(world);
  const sites: Array<{ index: number; intensity: number; direction: readonly [number, number] }> = [];
  for (let index = 0; index < terrain.height.length; index += 1) {
    if (!terrain.river[index] || terrain.waterLevel[index]! < 0 || terrain.height[index]! < seaLevel) continue;
    const x = terrain.originX + index % terrain.resolution * terrain.step;
    const z = terrain.originZ + Math.floor(index / terrain.resolution) * terrain.step;
    const weather = weatherAt(world, x, z);
    const ice = weather ? waterFreezeFactor(weather.temperature, 'river', terrain.flow[index], weather.snowpack) : 0;
    const intensity = rapidIntensityAt(world, index) * (1 - ice);
    const direction = flowDirectionAt(world, index);
    if (intensity < 0.34 || Math.hypot(direction[0], direction[1]) < 0.5) continue;
    sites.push({ index, intensity, direction });
  }
  // The surface shader carries all rapids; reserve sprites for a bounded set of energetic reaches.
  sites.sort((a, b) => b.intensity - a.intensity || a.index - b.index);
  sites.length = Math.min(sites.length, 1024);
  if (!sites.length) return undefined;
  const count = sites.reduce((sum, site) => sum + 2 + Math.round(site.intensity * 4), 0);
  const positions = new Float32Array(count * 3);
  const base = new Float32Array(count * 8);
  const rises = new Float32Array(count);
  let cursor = 0;
  for (const site of sites) {
    const x = terrain.originX + site.index % terrain.resolution * terrain.step;
    const z = terrain.originZ + Math.floor(site.index / terrain.resolution) * terrain.step;
    const perSite = 2 + Math.round(site.intensity * 4);
    const acrossX = -site.direction[1];
    const acrossZ = site.direction[0];
    for (let i = 0; i < perSite; i += 1) {
      let across = random.range(-0.16, 0.16) * terrain.step;
      let along = random.range(-0.12, 0.12) * terrain.step;
      let travel = terrain.step * random.range(0.18, 0.36);
      let px = x, pz = z, y0 = 0, y1 = 0, supported = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        px = x + acrossX * across + site.direction[0] * along;
        pz = z + acrossZ * across + site.direction[1] * along;
        y0 = waterSurfaceYAt(world, px - site.direction[0] * travel * 0.5, pz - site.direction[1] * travel * 0.5);
        y1 = waterSurfaceYAt(world, px + site.direction[0] * travel * 0.5, pz + site.direction[1] * travel * 0.5);
        supported = [0, 0.25, 0.5, 0.75, 1].every(t => {
          const qx = px + site.direction[0] * travel * (t - 0.5);
          const qz = pz + site.direction[1] * travel * (t - 0.5);
          const level = waterSurfaceYAt(world, qx, qz);
          return inlandWetCoverageAt(world, qx, qz) > 0.55 && level - groundAt(qx, qz) > 0.025
            && Math.abs(level - (y0 + (y1 - y0) * t)) < 0.02;
        });
        if (supported) break;
        across *= 0.5; along *= 0.5; travel *= 0.5;
      }
      if (!supported) continue;
      const y = (y0 + y1) * 0.5 + 0.008;
      positions.set([px, y, pz], cursor * 3);
      rises[cursor] = y1 - y0;
      const offset = cursor * 8;
      base[offset] = px; base[offset + 1] = y; base[offset + 2] = pz;
      base[offset + 3] = site.direction[0]; base[offset + 4] = site.direction[1];
      base[offset + 5] = random.float();
      base[offset + 6] = travel;
      base[offset + 7] = random.range(0.7, 1.35) * (0.75 + site.intensity * 0.8);
      cursor += 1;
    }
  }
  if (!cursor) return undefined;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, cursor * 3), 3));
  geometry.setAttribute('waterParticleRise', new THREE.BufferAttribute(rises.slice(0, cursor), 1));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#e4f1ed', size: 0.07, map: softPointTexture(), transparent: true, opacity: 0.58, depthWrite: false, sizeAttenuation: true }));
  points.name = 'river-rapid-foam';
  animateWaterParticles(points, base.slice(0, cursor * 8), 'rapid');
  return { points, sites: sites.length };
}

function buildPlungePools(falls: FallSite[], random: SeededRandom): PlungeFoam | undefined {
  if (!falls.length) return undefined;
  const perFall = 34;
  const positions = new Float32Array(falls.length * perFall * 3);
  const base = new Float32Array(falls.length * perFall * 8);
  let cursor = 0;
  for (const fall of falls) {
    const centerX = fall.endX;
    const centerZ = fall.endZ;
    for (let index = 0; index < perFall; index += 1) {
      const phase = random.float();
      const radius = fall.halfWidth * random.range(0.25, 0.9);
      positions[cursor * 3] = centerX;
      positions[cursor * 3 + 1] = fall.bottomY + 0.018;
      positions[cursor * 3 + 2] = centerZ;
      const offset = cursor * 8;
      base[offset] = centerX; base[offset + 1] = fall.bottomY + 0.018; base[offset + 2] = centerZ;
      base[offset + 3] = fall.direction[0]; base[offset + 4] = fall.direction[1];
      base[offset + 5] = phase; base[offset + 6] = radius; base[offset + 7] = random.range(0.28, 0.62) * (0.8 + fall.intensity * 0.5);
      cursor += 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#edf5f0', size: 0.16, map: softPointTexture(), transparent: true, opacity: 0.64, depthWrite: false, sizeAttenuation: true }));
  points.name = 'waterfall-plunge-foam';
  animateWaterParticles(points, base, 'plunge');
  return { points, sites: falls.length };
}

function buildRecessionWetness(world: WorldState, previousWet: Uint8Array, nextWet: Uint8Array): THREE.Mesh | undefined {
  const { terrain } = world;
  const ground = renderedGroundSampler(world);
  const positions: number[] = [], uvs: number[] = [];
  // A ground-conforming veil instead of camera-facing dark sprites standing above the shore.
  const divisions = 4;
  for (let index=0; index<previousWet.length; index++) {
    if (!previousWet[index] || nextWet[index]) continue;
    const cx=terrain.originX+index%terrain.resolution*terrain.step;
    const cz=terrain.originZ+Math.floor(index/terrain.resolution)*terrain.step;
    for (let iz=0; iz<divisions; iz++) for (let ix=0; ix<divisions; ix++) {
      const x=cx+(ix/divisions-0.5)*terrain.step;
      const z=cz+(iz/divisions-0.5)*terrain.step;
      const delta=terrain.step/divisions;
      const gx=Math.floor((x-terrain.originX)/terrain.step+1e-9);
      const gz=Math.floor((z-terrain.originZ)/terrain.step+1e-9);
      const corners=[[x,z],[x+delta,z],[x,z+delta],[x+delta,z+delta]];
      const order=((gx+gz)&1)===0 ? [0,2,1,1,2,3] : [0,2,3,0,3,1];
      for (const corner of order) {
        const [px,pz]=corners[corner]!;
        positions.push(px!,ground(px!,pz!)+0.0003,pz!);
        uvs.push((px!-cx)/terrain.step+0.5,(pz!-cz)/terrain.step+0.5);
      }
    }
  }
  if (!positions.length) return undefined;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({color:'#353b29',roughness:0.42,transparent:true,
    opacity:0.22,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  material.onBeforeCompile=shader => {
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vWetUV;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvWetUV=uv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vWetUV;')
      .replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a *= 1.0-smoothstep(0.2,0.5,length(vWetUV-0.5));');
  };
  material.customProgramCacheKey=()=> 'godbox-receded-ground-v1';
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='receded-water-wetness';
  return mesh;
}

function buildFoam(falls: FallSite[], random: SeededRandom): { points: THREE.Points } | undefined {
  if (falls.length === 0) return undefined;
  const counts = falls.map(fall => Math.round(12+42*fall.intensity*clamp01(fall.drop/2)));
  const count = counts.reduce((a,b)=>a+b,0);
  const positions = new Float32Array(count*3);
  const base = new Float32Array(count*8);
  let cursor = 0;
  for (const [fi,fall] of falls.entries()) {
    for (let index=0; index<counts[fi]!; index++) {
      const across = random.range(-0.9,0.9)*fall.halfWidth;
      const px = fall.worldX-fall.direction[1]*across;
      const pz = fall.worldZ+fall.direction[0]*across;
      positions.set([px,fall.topY,pz],cursor*3);
      base.set([px,fall.topY,pz,fall.endX-fall.worldX,fall.endZ-fall.worldZ,
        random.float(),fall.drop,Math.sqrt(1.8/Math.max(0.12,fall.drop))],cursor*8);
      cursor++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#e9f4f6', size: 0.075, map: softPointTexture(), transparent: true, opacity: 0.68, depthWrite: false, sizeAttenuation: true }));
  points.name = 'waterfall-foam';
  animateWaterParticles(points, base, 'fall');
  return { points };
}

/** Soft spray sells scale while the sheet and plunge pool carry the actual waterfall shape. */
function buildMist(falls: FallSite[], random: SeededRandom): THREE.Points | undefined {
  if (falls.length === 0) return undefined;
  const counts = falls.map(fall => Math.round(6 + 36 * fall.intensity * clamp01(fall.drop / 2)));
  const count = counts.reduce((sum, value) => sum + value, 0);
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  let cursor = 0;
  for (const [fi, fall] of falls.entries()) {
    const scale = Math.min(1.5, Math.max(0.12, Math.sqrt(fall.drop) * (0.25 + fall.intensity * 0.55)));
    for (let index = 0; index < counts[fi]!; index += 1) {
      const spread = Math.min(0.8, fall.halfWidth * (0.6 + fall.intensity * 0.7));
      positions[cursor * 3] = fall.endX + random.range(-spread, spread);
      positions[cursor * 3 + 1] = fall.bottomY + random.range(0.02, Math.max(0.02, Math.min(0.65, fall.drop * 0.35)));
      positions[cursor * 3 + 2] = fall.endZ + random.range(-spread, spread);
      scales[cursor] = scale;
      cursor += 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('sprayScale', new THREE.BufferAttribute(scales, 1));
  const mist = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#dbe8ea', size: 0.32, map: softPointTexture(), transparent: true, opacity: 0.22, depthWrite: false, sizeAttenuation: true }));
  const material = mist.material as THREE.PointsMaterial;
  const sprayTime = { value: 0 };
  material.userData['sprayTime'] = sprayTime;
  material.onBeforeCompile = shader => {
    shader.uniforms['sprayTime'] = sprayTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform float sprayTime;
      attribute float sprayScale;
      varying float vSprayLife;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float phase = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
      float age = fract(sprayTime * (0.16 + phase * 0.12) + phase);
      vSprayLife = sin(age * 3.14159265);
      transformed.y += age * 0.8 * sprayScale;
      transformed.x += sin(age * 4.0 + phase * 6.28) * age * 0.3 * sprayScale;
      transformed.z += cos(age * 3.0 + phase * 6.28) * age * 0.3 * sprayScale;`);
    shader.vertexShader = shader.vertexShader.replace('gl_PointSize = size;', 'gl_PointSize = size * sprayScale;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSprayLife;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vSprayLife * vSprayLife;');
  };
  material.customProgramCacheKey = () => 'godbox-waterfall-living-spray-v2-scaled';
  mist.name = 'waterfall-mist';
  mist.frustumCulled = false;
  return mist;
}
