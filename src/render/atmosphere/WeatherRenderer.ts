import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { cellAt } from '../../sim/world';
import { elevationToY } from '../../sim/terrain/SurfaceGeometry';
import type { TornadoState, WeatherKind, WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';

const BUDGET = 600;
const RANGE = 20;
const SNOW_COVERAGE_RATE = 45;
const WEATHER_SCAN_INTERVAL = 0.2;
const LIGHTNING_SEGMENTS = 28;
const RAIN_LAYER_OPACITY = [0.66, 0.43, 0.24] as const;
const RAIN_LAYER_SPEED = [1.2, 1, 0.78] as const;
const RAIN_LAYER_LENGTH = [1.3, 0.95, 0.66] as const;
const SNOW_LAYER_SIZE = [0.2, 0.135, 0.085] as const;
const SNOW_LAYER_OPACITY = [0.95, 0.8, 0.58] as const;
const SNOW_LAYER_SPEED = [0.12, 0.15, 0.19] as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

interface WeatherSample {
  x: number;
  z: number;
  phase: number;
  variant: number;
}

interface WeatherSite {
  x: number;
  z: number;
  floor: number;
  phase: number;
  variant: number;
  windX: number;
  windZ: number;
  intensity: number;
  blizzard: number;
  kind: WeatherKind;
}

export interface WeatherPresentationReport {
  rain: number;
  snow: number;
  budget: number;
  blizzard: number;
  storm: number;
  atmosphere: number;
  lightningFlash: number;
}

/** A few centimetres hide the ground colour; snow need not reach travel-blocking depth. */
export const snowCoverageForDepth = (depth: number): number => 1 - Math.exp(-Math.max(0, depth) * SNOW_COVERAGE_RATE);

/**
 * Camera-local weather presentation. The simulation owns weather outcomes; this renderer only
 * interprets them. Precipitation stays bounded, but depth layers, gusts and lighting give the
 * same simulation state much richer visual language than a single flat particle sheet.
 */
export class WeatherRenderer {
  readonly group = new THREE.Group();
  readonly texture: THREE.DataTexture;
  private readonly pixels: Uint8Array;
  private readonly waterTexture: THREE.DataTexture;
  private readonly waterPixels: Float32Array;
  private snowSettled = false;
  private readonly snowTargets: Float32Array;
  private readonly snowDisplay: Float32Array;
  private readonly time = { value: 0 };
  private readonly windTexture: { value: THREE.DataTexture };
  private readonly rain: Array<THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>> = [];
  private readonly snow: Array<THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>> = [];
  private readonly samples: WeatherSample[];
  private readonly rainSites: WeatherSite[][] = [[], [], []];
  private readonly snowSites: WeatherSite[][] = [[], [], []];
  private blizzardTarget = 0;
  private blizzardDisplay = 0;
  private stormTarget = 0;
  private stormDisplay = 0;
  private atmosphereTarget = 0;
  private atmosphereDisplay = 0;
  private readonly direction = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly visibilitySphere = new THREE.Sphere();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private revision = -1;
  private accumulator = WEATHER_SCAN_INTERVAL;
  private readonly bound = new WeakSet<THREE.Material>();
  private readonly funnels: THREE.Mesh[] = [];
  private readonly funnelStarts = new Map<string, number>();
  private readonly funnelEvents = new Map<string, TornadoState>();
  private readonly funnelDust: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = [];
  private readonly lightningRandom: SeededRandom;
  private readonly sheetLight = new THREE.HemisphereLight('#dce9ff', '#78879a', 0);
  private readonly strikeLight = new THREE.PointLight('#eef5ff', 0, 150, 1.5);
  private readonly lightningBolt: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private nextLightningAt = Number.POSITIVE_INFINITY;
  private lightningStartedAt = Number.NEGATIVE_INFINITY;
  private lightningFlash = 0;
  private lightningVisible = false;
  private scene?: THREE.Scene;
  private baseFogDensity = 0.0072;
  private readonly stormFogColor = new THREE.Color('#6f7d85');
  private readonly lightningFogColor = new THREE.Color('#dce8f2');
  private readonly stormSkyColor = new THREE.Color('#52616b');
  private readonly lightningSkyColor = new THREE.Color('#d6e4ef');

  constructor(private readonly world: WorldState, private readonly surface: TerrainSurface, seed: string) {
    this.group.name = 'weather';
    this.pixels = new Uint8Array(world.size * world.size * 4);
    this.snowTargets = new Float32Array(world.size * world.size);
    this.snowDisplay = new Float32Array(world.size * world.size);
    this.texture = new THREE.DataTexture(this.pixels, world.size, world.size, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.windTexture = { value: this.texture };
    const resolution = world.terrain.resolution;
    this.waterPixels = new Float32Array(resolution * resolution);
    this.waterTexture = new THREE.DataTexture(this.waterPixels, resolution, resolution, THREE.RedFormat, THREE.FloatType);

    const random = new SeededRandom(`${seed}:weather-visuals`);
    this.lightningRandom = new SeededRandom(`${seed}:weather-lightning`);
    this.samples = Array.from({ length: BUDGET }, () => ({
      x: random.range(-RANGE, RANGE),
      z: random.range(-RANGE, RANGE),
      phase: random.float(),
      variant: random.float(),
    }));

    for (let layer = 0; layer < 3; layer += 1) {
      const rainGeometry = new THREE.BufferGeometry();
      rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BUDGET * 6), 3).setUsage(THREE.DynamicDrawUsage));
      const rainMaterial = new THREE.LineBasicMaterial({
        color: layer === 0 ? '#d4e8ed' : layer === 1 ? '#c2d9df' : '#aebfc4',
        transparent: true,
        opacity: RAIN_LAYER_OPACITY[layer]!,
        depthWrite: false,
      });
      const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
      rain.name = `rain-layer-${layer}`;
      rain.frustumCulled = false;
      rain.renderOrder = 3 - layer;
      rain.geometry.setDrawRange(0, 0);
      this.rain.push(rain);

      const snowGeometry = new THREE.BufferGeometry();
      snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BUDGET * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const snowMaterial = new THREE.PointsMaterial({
        color: layer === 0 ? '#fbfdff' : layer === 1 ? '#f2f6f8' : '#e3eaed',
        size: SNOW_LAYER_SIZE[layer]!,
        transparent: true,
        opacity: SNOW_LAYER_OPACITY[layer]!,
        depthWrite: false,
        sizeAttenuation: true,
      });
      snowMaterial.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_particle_fragment>',
          '#include <map_particle_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(0.14, 0.5, length(gl_PointCoord - vec2(0.5)));');
      };
      const snow = new THREE.Points(snowGeometry, snowMaterial);
      snow.name = `snow-layer-${layer}`;
      snow.frustumCulled = false;
      snow.renderOrder = 3 - layer;
      snow.geometry.setDrawRange(0, 0);
      this.snow.push(snow);
      this.group.add(rain, snow);
    }

    const boltGeometry = new THREE.BufferGeometry();
    boltGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LIGHTNING_SEGMENTS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    const boltMaterial = new THREE.LineBasicMaterial({
      color: '#f4f8ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.lightningBolt = new THREE.LineSegments(boltGeometry, boltMaterial);
    this.lightningBolt.name = 'lightning-bolt';
    this.lightningBolt.visible = false;
    this.lightningBolt.frustumCulled = false;
    this.lightningBolt.renderOrder = 6;
    this.strikeLight.castShadow = false;
    this.group.add(this.sheetLight, this.strikeLight, this.lightningBolt);

    for (let index = 0; index < 4; index += 1) {
      const funnel = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 0.15, 9, 14, 8, true),
        new THREE.MeshStandardMaterial({ color: '#777a73', transparent: true, opacity: 0.12, side: THREE.DoubleSide, roughness: 1, depthWrite: false }));
      funnel.visible = false;
      funnel.name = 'tornado-funnel';
      this.funnels.push(funnel);
      this.group.add(funnel);
      const dustGeometry = new THREE.BufferGeometry();
      dustGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(192 * 3), 3));
      const dustMaterial = new THREE.PointsMaterial({ color: '#9b9f93', size: 0.9, transparent: true, opacity: 0.4, depthWrite: false });
      dustMaterial.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_particle_fragment>',
          '#include <map_particle_fragment>\ndiffuseColor.a *= smoothstep(0.5, 0.05, length(gl_PointCoord - vec2(0.5)));');
      };
      const dust = new THREE.Points(dustGeometry, dustMaterial);
      dust.visible = false;
      dust.frustumCulled = false;
      this.funnelDust.push(dust);
      this.group.add(dust);
    }
    this.syncTexture();
  }

  bindScene(scene: THREE.Scene): void {
    this.scene = scene;
    if (scene.fog instanceof THREE.FogExp2) this.baseFogDensity = scene.fog.density;
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || (!['terrain', 'weather-foliage'].includes(object.name) && !object.userData['weatherSurface'])) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial) || this.bound.has(material)) continue;
        this.bound.add(material);
        const foliage = object.name === 'weather-foliage';
        material.onBeforeCompile = (shader) => {
          shader.uniforms.weatherMap = this.windTexture;
          shader.uniforms.weatherTime = this.time;
          shader.uniforms.waterMap = { value: this.waterTexture };
          shader.vertexShader = `uniform sampler2D weatherMap; uniform float weatherTime; varying vec4 weatherSample; varying float weatherUp; varying vec3 weatherWorldPosition;\n${shader.vertexShader}`;
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vec4 weatherPosition = vec4(position, 1.0);
            #ifdef USE_INSTANCING
              weatherPosition = instanceMatrix * weatherPosition;
            #endif
            weatherPosition = modelMatrix * weatherPosition;
            weatherWorldPosition = weatherPosition.xyz;
            vec3 snowNormal = objectNormal;
            #ifdef USE_INSTANCING
              snowNormal = mat3(instanceMatrix) * snowNormal;
            #endif
            weatherUp = smoothstep(0.15, 0.7, normalize(mat3(modelMatrix) * snowNormal).y);
            vec2 weatherUv = (weatherPosition.xz / ${this.world.cellSize.toFixed(6)} + ${((this.world.size + 1) / 2).toFixed(6)}) / ${this.world.size.toFixed(6)};
            weatherSample = texture2D(weatherMap, weatherUv);
            ${foliage ? 'transformed.xz += (weatherSample.rg * 2.0 - 1.0) * sin(weatherTime * 2.2 + weatherPosition.x * 0.3 + weatherPosition.z * 0.2) * max(position.y, 0.0) * 0.065;' : ''}
          `);
          shader.fragmentShader = `uniform sampler2D waterMap; varying vec4 weatherSample; varying float weatherUp; varying vec3 weatherWorldPosition;\n${shader.fragmentShader}`;
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
            #include <color_fragment>
            vec2 floodUv = ((weatherWorldPosition.xz - vec2(${this.world.terrain.originX.toFixed(6)}, ${this.world.terrain.originZ.toFixed(6)})) / ${this.world.terrain.step.toFixed(6)} + 0.5) / ${this.world.terrain.resolution.toFixed(6)};
            float localWater = texture2D(waterMap, floodUv).r;
            float immersion = 1.0 - smoothstep(localWater, localWater + 0.06, weatherWorldPosition.y);
            float snowCover = (1.0 - exp(-max(0.0, weatherSample.b) * ${SNOW_COVERAGE_RATE.toFixed(1)})) * weatherUp * (1.0 - immersion);
            diffuseColor.rgb *= 1.0 - max(weatherSample.a * 0.12, immersion * 0.35);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.92, 0.95), snowCover * ${foliage ? '0.86' : '0.98'});
          `);
        };
        material.customProgramCacheKey = () => `weather-snow-flood-${foliage}-${this.world.size}`;
        material.needsUpdate = true;
      }
    });
  }

  private syncTexture(): void {
    const weather = this.world.weather;
    if (!weather) return;
    for (let index = 0; index < weather.cells.length; index += 1) {
      const cell = weather.cells[index]!;
      this.pixels[index * 4] = Math.round((cell.windX * cell.wind * 0.5 + 0.5) * 255);
      this.pixels[index * 4 + 1] = Math.round((cell.windZ * cell.wind * 0.5 + 0.5) * 255);
      this.snowTargets[index] = Math.min(255, cell.snowpack * 255);
      this.pixels[index * 4 + 3] = Math.round(this.world.cells[index]!.moisture * 255);
    }
    for (let index = 0; index < this.waterPixels.length; index += 1) {
      const level = this.world.terrain.waterLevel[index]!;
      this.waterPixels[index] = level < 0 ? -10000 : elevationToY(level, this.world.seaLevel);
    }
    this.waterTexture.needsUpdate = true;
    this.snowSettled = false;
    this.texture.needsUpdate = true;
    this.revision = this.world.environmentRevision ?? 0;
  }

  update(delta: number, elapsed: number, camera: THREE.Camera): void {
    this.time.value = elapsed;
    this.updateTornadoes(elapsed);
    this.accumulator += delta;
    const changed = this.revision !== (this.world.environmentRevision ?? 0);
    if (changed) this.syncTexture();

    const blend = 1 - Math.exp(-Math.min(1, delta) * 1.5);
    let snowChanged = false;
    let settling = false;
    if (!this.snowSettled) for (let index = 0; index < this.snowDisplay.length; index += 1) {
      this.snowDisplay[index] = this.snowDisplay[index]! + (this.snowTargets[index]! - this.snowDisplay[index]!) * blend;
      if (Math.abs(this.snowTargets[index]! - this.snowDisplay[index]!) > 0.1) settling = true;
      else this.snowDisplay[index] = this.snowTargets[index]!;
      const value = Math.round(this.snowDisplay[index]!);
      if (value !== this.pixels[index * 4 + 2]) { this.pixels[index * 4 + 2] = value; snowChanged = true; }
    }
    this.snowSettled = !settling;
    if (snowChanged) this.texture.needsUpdate = true;

    if (changed || this.accumulator >= WEATHER_SCAN_INTERVAL) this.scanWeather(camera, elapsed);

    this.blizzardDisplay += (this.blizzardTarget - this.blizzardDisplay) * blend;
    this.stormDisplay += (this.stormTarget - this.stormDisplay) * blend;
    const atmosphereBlend = 1 - Math.exp(-Math.min(1, delta) * 1.9);
    this.atmosphereDisplay += (this.atmosphereTarget - this.atmosphereDisplay) * atmosphereBlend;
    this.updateRain(elapsed);
    this.updateSnow(elapsed);
    this.updateLightning(elapsed);
    this.applyAtmosphere();
  }

  private scanWeather(camera: THREE.Camera, elapsed: number): void {
    this.accumulator = 0;
    for (const sites of this.rainSites) sites.length = 0;
    for (const sites of this.snowSites) sites.length = 0;

    camera.getWorldDirection(this.direction);
    const distance = Math.max(5, Math.min(90, (camera.position.y - 4) / Math.max(0.1, -this.direction.y)));
    this.center.copy(camera.position).addScaledVector(this.direction, distance);
    const focusCell = cellAt(this.world, this.center.x, this.center.z);
    const focusWeather = focusCell ? this.world.weather?.cells[focusCell.z * this.world.size + focusCell.x] : undefined;
    this.blizzardTarget = focusWeather?.blizzard ?? 0;
    this.stormTarget = focusWeather?.kind === 'thunderstorm' ? focusWeather.intensity : 0;
    const precipitationMood = focusWeather?.precipitation === 'rain' ? (focusWeather.intensity * 0.78)
      : focusWeather?.precipitation === 'snow' ? (focusWeather.intensity * 0.52) : 0;
    this.atmosphereTarget = clamp01(precipitationMood + this.stormTarget * 0.24 + this.blizzardTarget * 0.4);

    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const sample of this.samples) {
      const x = this.center.x + sample.x;
      const z = this.center.z + sample.z;
      const cell = cellAt(this.world, x, z);
      if (!cell) continue;
      const weather = this.world.weather?.cells[cell.z * this.world.size + cell.x];
      if (!weather || weather.precipitation === 'none') continue;
      const baseDensity = weather.intensity * (weather.precipitation === 'snow' ? 0.72 + weather.blizzard * 0.28 : 1);
      const showerPulse = 0.86 + Math.sin(elapsed * 0.42 + sample.variant * 12.7 + sample.phase * 5.3) * 0.14;
      const density = clamp01(baseDensity * showerPulse);
      if (sample.phase > density) continue;
      const floor = Math.max(this.surface.heightAt(x, z), this.surface.waterYAt(x, z));
      this.visibilitySphere.center.copy(this.point.set(x, floor + 7, z));
      this.visibilitySphere.radius = 8;
      if (!this.frustum.intersectsSphere(this.visibilitySphere)) continue;
      const radial = Math.hypot(sample.x, sample.z) / (RANGE * Math.SQRT2);
      const layer = radial < 0.34 ? 0 : radial < 0.68 ? 1 : 2;
      const site: WeatherSite = {
        x, z, floor, phase: sample.phase, variant: sample.variant,
        windX: weather.windX * weather.wind, windZ: weather.windZ * weather.wind,
        intensity: weather.intensity, blizzard: weather.blizzard, kind: weather.kind,
      };
      (weather.precipitation === 'snow' ? this.snowSites[layer]! : this.rainSites[layer]!).push(site);
    }

    for (let layer = 0; layer < 3; layer += 1) {
      this.rain[layer]!.geometry.setDrawRange(0, this.rainSites[layer]!.length * 2);
      this.snow[layer]!.geometry.setDrawRange(0, this.snowSites[layer]!.length);
      this.rain[layer]!.visible = this.rainSites[layer]!.length > 0;
      this.snow[layer]!.visible = this.snowSites[layer]!.length > 0;
    }
  }

  private updateRain(elapsed: number): void {
    for (let layer = 0; layer < 3; layer += 1) {
      const object = this.rain[layer]!;
      const positions = object.geometry.getAttribute('position');
      const sites = this.rainSites[layer]!;
      for (let index = 0; index < sites.length; index += 1) {
        const site = sites[index]!;
        const storm = site.kind === 'thunderstorm' ? 1 : 0;
        const speed = RAIN_LAYER_SPEED[layer]! * (0.72 + site.intensity * 0.82 + storm * 0.16);
        const cycle = (elapsed * speed + site.phase * 1.7) % 1;
        const height = 0.35 + (1 - cycle) * (13.5 + site.variant * 2.5);
        const windStrength = Math.hypot(site.windX, site.windZ);
        const shear = 0.12 + windStrength * 0.23 + storm * 0.05;
        const gust = Math.sin(elapsed * (1.35 + storm * 0.5) + site.phase * 19 + site.variant * 8) * (0.03 + windStrength * 0.11);
        const streak = (0.42 + site.variant * 0.5) * RAIN_LAYER_LENGTH[layer]! * (0.72 + site.intensity * 0.72 + storm * 0.2);
        const x = site.x - height * site.windX * shear + gust;
        const z = site.z - height * site.windZ * shear + gust * 0.45;
        const y = site.floor + height;
        positions.setXYZ(index * 2, x, y, z);
        positions.setXYZ(index * 2 + 1, x - site.windX * streak * 0.28, y + streak, z - site.windZ * streak * 0.28);
      }
      if (sites.length) positions.needsUpdate = true;
      object.material.opacity = RAIN_LAYER_OPACITY[layer]! * (0.76 + this.atmosphereDisplay * 0.24);
    }
  }

  private updateSnow(elapsed: number): void {
    for (let layer = 0; layer < 3; layer += 1) {
      const object = this.snow[layer]!;
      const positions = object.geometry.getAttribute('position');
      const sites = this.snowSites[layer]!;
      for (let index = 0; index < sites.length; index += 1) {
        const site = sites[index]!;
        const fallSpeed = SNOW_LAYER_SPEED[layer]! * (0.82 + site.variant * 0.34 + site.blizzard * 0.7);
        const height = 0.25 + (1 - (elapsed * fallSpeed + site.phase * 1.23) % 1) * 14.5;
        const drift = 0.38 + site.blizzard * 1.18;
        const flutterFrequency = 0.72 + site.variant * 1.4 + site.blizzard * 0.85;
        const flutter = (layer === 0 ? 0.48 : layer === 1 ? 0.31 : 0.18) * (1 + site.blizzard * 0.9);
        const phase = elapsed * flutterFrequency + site.phase * 17 + site.variant * 9;
        const swirlX = Math.sin(phase) * flutter + Math.sin(phase * 0.41 + 2.3) * flutter * 0.34;
        const swirlZ = Math.cos(phase * 0.83) * flutter * 0.65;
        positions.setXYZ(index,
          site.x - height * site.windX * drift + swirlX,
          site.floor + height,
          site.z - height * site.windZ * drift + swirlZ);
      }
      if (sites.length) positions.needsUpdate = true;
      object.material.size = SNOW_LAYER_SIZE[layer]! * (1 + this.blizzardDisplay * (layer === 0 ? 0.42 : 0.24));
      object.material.opacity = SNOW_LAYER_OPACITY[layer]! * (0.82 + this.blizzardDisplay * 0.18);
    }
  }

  private updateLightning(elapsed: number): void {
    if (this.stormDisplay < 0.22) {
      this.nextLightningAt = Number.POSITIVE_INFINITY;
      this.lightningFlash = 0;
      this.lightningVisible = false;
      this.sheetLight.intensity = 0;
      this.strikeLight.intensity = 0;
      this.lightningBolt.visible = false;
      return;
    }

    if (!Number.isFinite(this.nextLightningAt)) {
      this.nextLightningAt = elapsed + this.lightningRandom.range(1.8, 6.5) * (1.12 - this.stormDisplay * 0.32);
    }
    if (elapsed >= this.nextLightningAt) this.triggerLightning(elapsed);

    const age = elapsed - this.lightningStartedAt;
    this.lightningFlash = this.lightningPulse(age);
    this.sheetLight.intensity = this.lightningFlash * (0.9 + this.stormDisplay * 1.8);
    this.strikeLight.intensity = this.lightningVisible ? this.lightningFlash * (5 + this.stormDisplay * 7) : 0;
    this.lightningBolt.material.opacity = this.lightningVisible ? this.lightningFlash * 0.95 : 0;
    this.lightningBolt.visible = this.lightningVisible && age < 0.32 && this.lightningFlash > 0.03;
  }

  private triggerLightning(elapsed: number): void {
    this.lightningStartedAt = elapsed;
    this.lightningVisible = this.lightningRandom.chance(0.16 + this.stormDisplay * 0.2);
    const quietSeconds = this.lightningRandom.range(5.5, 15) * (1.12 - this.stormDisplay * 0.42);
    this.nextLightningAt = elapsed + quietSeconds;
    const strikeX = this.center.x + this.lightningRandom.range(-RANGE * 0.55, RANGE * 0.55);
    const strikeZ = this.center.z + this.lightningRandom.range(-RANGE * 0.55, RANGE * 0.55);
    const floor = Math.max(this.surface.heightAt(strikeX, strikeZ), this.surface.waterYAt(strikeX, strikeZ));
    this.strikeLight.position.set(strikeX, floor + 4.5, strikeZ);
    if (this.lightningVisible) this.buildLightningBolt(strikeX, strikeZ, floor);
  }

  private lightningPulse(age: number): number {
    if (age < 0 || age >= 0.34) return 0;
    if (age < 0.055) return 1 - age * 1.8;
    if (age < 0.105) return 0.08;
    if (age < 0.17) return 0.68 - (age - 0.105) * 2.8;
    if (age < 0.225) return 0.04;
    if (age < 0.285) return 0.34 - (age - 0.225) * 3.8;
    return 0;
  }

  private buildLightningBolt(strikeX: number, strikeZ: number, floor: number): void {
    const positions = this.lightningBolt.geometry.getAttribute('position');
    const top = floor + this.lightningRandom.range(18, 27);
    const steps = 11;
    let segment = 0;
    let previous = new THREE.Vector3(strikeX + this.lightningRandom.range(-1.6, 1.6), top, strikeZ + this.lightningRandom.range(-1.6, 1.6));
    const addSegment = (start: THREE.Vector3, end: THREE.Vector3): void => {
      if (segment >= LIGHTNING_SEGMENTS) return;
      positions.setXYZ(segment * 2, start.x, start.y, start.z);
      positions.setXYZ(segment * 2 + 1, end.x, end.y, end.z);
      segment += 1;
    };

    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps;
      const next = new THREE.Vector3(
        strikeX + (1 - fraction) * this.lightningRandom.range(-2.2, 2.2),
        THREE.MathUtils.lerp(top, floor + 0.08, fraction),
        strikeZ + (1 - fraction) * this.lightningRandom.range(-2.2, 2.2),
      );
      addSegment(previous, next);
      if (step > 2 && step < steps - 1 && step % 3 === 0) {
        let branchStart = next.clone();
        const branchDirectionX = this.lightningRandom.range(-1, 1);
        const branchDirectionZ = this.lightningRandom.range(-1, 1);
        const branchSteps = this.lightningRandom.int(2, 4);
        for (let branch = 0; branch < branchSteps; branch += 1) {
          const branchEnd = new THREE.Vector3(
            branchStart.x + branchDirectionX * this.lightningRandom.range(0.7, 1.8),
            branchStart.y - this.lightningRandom.range(1.2, 2.8),
            branchStart.z + branchDirectionZ * this.lightningRandom.range(0.7, 1.8),
          );
          addSegment(branchStart, branchEnd);
          branchStart = branchEnd;
        }
      }
      previous = next;
    }
    this.lightningBolt.geometry.setDrawRange(0, segment * 2);
    positions.needsUpdate = true;
  }

  private applyAtmosphere(): void {
    if (!this.scene) return;
    if (this.scene.fog instanceof THREE.FogExp2) {
      // Set from the captured baseline every frame. GodboxRenderer may add its blizzard veil
      // afterwards, but it can no longer ratchet fog density upward frame after frame.
      this.scene.fog.density = this.baseFogDensity + this.atmosphereDisplay * 0.011;
      const stormTint = clamp01(this.atmosphereDisplay * 0.28 + this.stormDisplay * 0.12 + this.blizzardDisplay * 0.16);
      this.scene.fog.color.lerp(this.stormFogColor, stormTint);
      if (this.lightningFlash > 0) this.scene.fog.color.lerp(this.lightningFogColor, this.lightningFlash * 0.58);
    }
    if (this.scene.background instanceof THREE.Color) {
      const stormTint = clamp01(this.atmosphereDisplay * 0.1 + this.stormDisplay * 0.09);
      this.scene.background.lerp(this.stormSkyColor, stormTint);
      if (this.lightningFlash > 0) this.scene.background.lerp(this.lightningSkyColor, this.lightningFlash * 0.44);
    }
  }

  private updateTornadoes(elapsed: number): void {
    const events = this.world.weather?.tornadoes ?? [];
    for (const [id, start] of this.funnelStarts) {
      if (elapsed - start >= 8 && !events.some((event) => event.id === id)) { this.funnelStarts.delete(id); this.funnelEvents.delete(id); }
    }
    for (const event of events) {
      if (this.funnelEvents.size >= 4 || this.funnelStarts.has(event.id)) continue;
      this.funnelStarts.set(event.id, elapsed);
      this.funnelEvents.set(event.id, event);
    }
    const presented = [...this.funnelEvents.values()];
    this.funnels.forEach((funnel, index) => {
      const event = presented[index];
      const dust = this.funnelDust[index]!;
      if (!event) { funnel.visible = false; dust.visible = false; return; }
      const progress = Math.min(1, (elapsed - this.funnelStarts.get(event.id)!) / 8);
      funnel.visible = progress < 1;
      const pathIndex = progress * (event.path.length - 1);
      const start = event.path[Math.min(event.path.length - 2, Math.floor(pathIndex))]!;
      const end = event.path[Math.min(event.path.length - 1, Math.floor(pathIndex) + 1)]!;
      const fraction = pathIndex % 1;
      const worldX = start.x + (end.x - start.x) * fraction;
      const worldZ = start.z + (end.z - start.z) * fraction;
      funnel.position.set(worldX, this.surface.heightAt(worldX, worldZ) + 4.5, worldZ);
      funnel.scale.set(event.width, 1, event.width);
      funnel.rotation.y = elapsed * (2 + event.intensity * 4);
      dust.visible = funnel.visible;
      dust.position.copy(funnel.position);
      dust.scale.copy(funnel.scale);
      dust.material.opacity = 0.4 * Math.min(1, progress * 8, (1 - progress) * 8);
      const dustPositions = dust.geometry.getAttribute('position');
      for (let particle = 0; particle < dustPositions.count; particle += 1) {
        const rise = ((particle / dustPositions.count + elapsed * 0.08) % 1);
        const angle = particle * 2.399 + elapsed * (3 + event.intensity * 4) - rise * 8;
        const radius = (0.12 + 2.5 * rise ** 1.6) * (0.72 + Math.sin(particle * 7) * 0.28);
        dustPositions.setXYZ(particle, Math.cos(angle) * radius, rise * 9 - 4.5, Math.sin(angle) * radius);
      }
      dustPositions.needsUpdate = true;
    });
  }

  get report(): WeatherPresentationReport {
    const rain = this.rainSites.reduce((total, sites) => total + sites.length, 0);
    const snow = this.snowSites.reduce((total, sites) => total + sites.length, 0);
    return {
      rain, snow, budget: BUDGET,
      blizzard: this.blizzardDisplay,
      storm: this.stormDisplay,
      atmosphere: this.atmosphereDisplay,
      lightningFlash: this.lightningFlash,
    };
  }

  dispose(): void {
    this.texture.dispose();
    this.waterTexture.dispose();
    for (const object of [...this.rain, ...this.snow, this.lightningBolt, ...this.funnels, ...this.funnelDust]) {
      object.geometry.dispose();
      if (!Array.isArray(object.material)) object.material.dispose();
    }
  }
}
