import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { cellAt } from '../../sim/world';
import { elevationToY } from '../../sim/terrain/SurfaceGeometry';
import type { TornadoState, WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';

const BUDGET = 512;
const RANGE = 18;
const SNOW_COVERAGE_RATE = 45;
/** A few centimetres hide the ground colour; snow need not reach travel-blocking depth. */
export const snowCoverageForDepth = (depth: number): number => 1 - Math.exp(-Math.max(0, depth) * SNOW_COVERAGE_RATE);

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
  private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly snow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly samples: Array<{ x: number; z: number; phase: number }>;
  private readonly rainSites: Array<{ x: number; z: number; floor: number; phase: number; windX: number; windZ: number; blizzard: number }> = [];
  private readonly snowSites: typeof this.rainSites = [];
  private blizzardTarget = 0;
  private blizzardDisplay = 0;
  private readonly direction = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private revision = -1;
  private accumulator = 1;
  private readonly bound = new WeakSet<THREE.Material>();
  private readonly funnels: THREE.Mesh[] = [];
  private readonly funnelStarts = new Map<string, number>();
  private readonly funnelEvents = new Map<string, TornadoState>();
  private readonly funnelDust: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = [];

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
    this.samples = Array.from({ length: BUDGET }, () => ({ x: random.range(-RANGE, RANGE), z: random.range(-RANGE, RANGE), phase: random.float() }));
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BUDGET * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: '#c4dce2', transparent: true, opacity: 0.48, depthWrite: false }));
    const snowGeometry = new THREE.BufferGeometry();
    snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BUDGET * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.snow = new THREE.Points(snowGeometry, new THREE.PointsMaterial({ color: '#f0f4f4', size: 0.13, transparent: true, opacity: 0.85, depthWrite: false }));
    this.snow.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_particle_fragment>',
        '#include <map_particle_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(0.15, 0.5, length(gl_PointCoord - vec2(0.5)));');
    };
    this.rain.frustumCulled = false;
    this.snow.frustumCulled = false;
    this.rain.geometry.setDrawRange(0, 0);
    this.snow.geometry.setDrawRange(0, 0);
    this.group.add(this.rain, this.snow);
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
    for (let index = 0; index < this.waterPixels.length; index++) {
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
    this.accumulator += delta;
    const changed = this.revision !== (this.world.environmentRevision ?? 0);
    if (changed) this.syncTexture();
    let snowChanged = false;
    const blend = 1 - Math.exp(-Math.min(1, delta) * 1.5);
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
    if (changed || this.accumulator >= 0.25) {
      this.accumulator = 0;
      this.rainSites.length = 0;
      this.snowSites.length = 0;
      camera.getWorldDirection(this.direction);
      const distance = Math.max(5, Math.min(90, (camera.position.y - 4) / Math.max(0.1, -this.direction.y)));
      this.center.copy(camera.position).addScaledVector(this.direction, distance);
      const focusCell = cellAt(this.world, this.center.x, this.center.z);
      this.blizzardTarget = focusCell ? this.world.weather?.cells[focusCell.z * this.world.size + focusCell.x]?.blizzard ?? 0 : 0;
      camera.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      for (const sample of this.samples) {
        const x = this.center.x + sample.x;
        const z = this.center.z + sample.z;
        const cell = cellAt(this.world, x, z);
        if (!cell) continue;
        const weather = this.world.weather?.cells[cell.z * this.world.size + cell.x];
        if (!weather || weather.precipitation === 'none') continue;
        const density = weather.intensity * (weather.precipitation === 'snow' ? 0.55 + weather.blizzard * 0.45 : 1);
        if (sample.phase > density) continue;
        const floor = Math.max(this.surface.heightAt(x, z), this.surface.waterYAt(x, z));
        if (!this.frustum.intersectsSphere(new THREE.Sphere(this.point.set(x, floor + 7, z), 8))) continue;
        const sites = weather.precipitation === 'snow' ? this.snowSites : this.rainSites;
        sites.push({ x, z, floor, phase: sample.phase, windX: weather.windX * weather.wind, windZ: weather.windZ * weather.wind, blizzard: weather.blizzard });
      }
      this.rain.geometry.setDrawRange(0, this.rainSites.length * 2);
      this.snow.geometry.setDrawRange(0, this.snowSites.length);
      this.rain.visible = this.rainSites.length > 0;
      this.snow.visible = this.snowSites.length > 0;
    }
    this.blizzardDisplay += (this.blizzardTarget - this.blizzardDisplay) * blend;
    this.snow.material.size = 0.13 + this.blizzardDisplay * 0.09;
    const rainPositions = this.rain.geometry.getAttribute('position');
    for (let index = 0; index < this.rainSites.length; index += 1) {
      const site = this.rainSites[index]!;
      const height = 0.5 + (1 - (elapsed * 0.9 + site.phase) % 1) * 14;
      const x = site.x - height * site.windX * 0.15;
      const z = site.z - height * site.windZ * 0.15;
      rainPositions.setXYZ(index * 2, x, site.floor + height, z);
      rainPositions.setXYZ(index * 2 + 1, x - site.windX * 0.15, site.floor + height + 0.7, z - site.windZ * 0.15);
    }
    if (this.rainSites.length) rainPositions.needsUpdate = true;
    const snowPositions = this.snow.geometry.getAttribute('position');
    for (let index = 0; index < this.snowSites.length; index += 1) {
      const site = this.snowSites[index]!;
      const height = 0.3 + (1 - (elapsed * (0.13 + site.blizzard * 0.12) + site.phase) % 1) * 14;
      const drift = 0.4 + site.blizzard * 0.9;
      snowPositions.setXYZ(index, site.x - height * site.windX * drift + Math.sin(elapsed + site.phase * 7) * 0.3,
        site.floor + height, site.z - height * site.windZ * drift);
    }
    if (this.snowSites.length) snowPositions.needsUpdate = true;
  }

  get report(): { rain: number; snow: number; budget: number; blizzard: number } {
    return { rain: this.rainSites.length, snow: this.snowSites.length, budget: BUDGET, blizzard: this.blizzardDisplay };
  }

  dispose(): void {
    this.texture.dispose();
    this.waterTexture.dispose();
    for (const object of [this.rain, this.snow, ...this.funnels, ...this.funnelDust]) {
      object.geometry.dispose();
      if (!Array.isArray(object.material)) object.material.dispose();
    }
  }
}