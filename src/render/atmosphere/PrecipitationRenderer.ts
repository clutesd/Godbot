import * as THREE from 'three';
import { SeededRandom } from '../../sim/prng';
import { cellAt } from '../../sim/world';
import { precipitationPhase } from '../../sim/weather/Precipitation';
import type { WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';

export const PRECIPITATION_BUDGET = 2400;
const RANGE = 34;
const HEIGHT = 22;
const wrap = (v: number, span: number) => ((v % span) + span) % span;
interface Drop { x: number; z: number; phase: number; size: number; speed: number; choice: number; density: number; alpha: number; snow: number; floor: number; windX: number; windZ: number; storm: number; target: number }
/** Stable world-space columns; relocation occurs only at the faded edge of the camera volume. */
export class PrecipitationRenderer {
  readonly group = new THREE.Group();
  private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly snow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly drops: Drop[];
  private readonly center = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private accumulator = 1;
  private rainCount = 0;
  private snowCount = 0;
  private severity = 0;
  private cloud = 0;
  private wet = 0;
  private thunder = 0;
  constructor(private readonly world: WorldState, private readonly surface: TerrainSurface, seed: string) {
    const random = new SeededRandom(`${seed}:precipitation`);
    this.drops = Array.from({ length: PRECIPITATION_BUDGET }, () => ({ x: random.range(-RANGE, RANGE), z: random.range(-RANGE, RANGE),
      phase: random.float(), size: random.float(), speed: random.float(), choice: random.float(), density: random.float(), alpha: 0, snow: 0, floor: 0, windX: 0, windZ: 0, storm: 0, target: 0 }));
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRECIPITATION_BUDGET * 6), 3).setUsage(THREE.DynamicDrawUsage));
    rainGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PRECIPITATION_BUDGET * 8), 4).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: '#afcbd5', vertexColors: true, transparent: true, depthWrite: false }));
    const snowGeometry = new THREE.BufferGeometry();
    snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRECIPITATION_BUDGET * 3), 3).setUsage(THREE.DynamicDrawUsage));
    snowGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PRECIPITATION_BUDGET * 4), 4).setUsage(THREE.DynamicDrawUsage));
    snowGeometry.setAttribute('flakeSize', new THREE.BufferAttribute(new Float32Array(PRECIPITATION_BUDGET), 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.PointsMaterial({ color: '#e8f0f4', size: 0.12, vertexColors: true, transparent: true, depthWrite: false });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float flakeSize;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('gl_PointSize = size;', 'gl_PointSize = size * flakeSize;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_particle_fragment>', `#include <map_particle_fragment>
        vec2 flake = abs(gl_PointCoord - 0.5);
        diffuseColor.a *= 1.0 - smoothstep(0.24, 0.5, flake.x + flake.y * 0.8);`);
    };
    this.snow = new THREE.Points(snowGeometry, material);
    this.rain.name = 'rain'; this.snow.name = 'snow';
    for (const object of [this.rain, this.snow]) { object.frustumCulled = false; object.geometry.setDrawRange(0, 0); }
    this.group.add(this.rain, this.snow);
  }
  update(delta: number, elapsed: number, camera: THREE.Camera): void {
    const blend = 1 - Math.exp(-Math.min(1, delta) * 1.5);
    camera.getWorldDirection(this.direction);
    const distance = Math.max(5, Math.min(90, (camera.position.y - 4) / Math.max(0.15, -this.direction.y)));
    this.center.copy(camera.position).addScaledVector(this.direction, distance);
    const focus = cellAt(this.world, this.center.x, this.center.z);
    const local = focus && this.world.weather?.cells[focus.z * this.world.size + focus.x];
    this.severity += ((local?.blizzard ?? 0) - this.severity) * blend;
    this.cloud += ((local ? local.kind === 'clear' ? 0 : local.intensity : 0) - this.cloud) * blend;
    this.wet += ((local && local.precipitation !== 'none' ? local.intensity : 0) - this.wet) * blend;
    this.thunder = local?.kind === 'thunderstorm' ? local.intensity : 0;
    this.accumulator += delta;
    const sampleWeather = this.accumulator >= 0.15;
    if (sampleWeather) this.accumulator = 0;
    const rp = this.rain.geometry.getAttribute('position'), rc = this.rain.geometry.getAttribute('color');
    const sp = this.snow.geometry.getAttribute('position'), sc = this.snow.geometry.getAttribute('color'), ss = this.snow.geometry.getAttribute('flakeSize');
    let rain = 0, snow = 0;
    for (const drop of this.drops) {
      const x = this.center.x + wrap(drop.x - this.center.x + RANGE, RANGE * 2) - RANGE;
      const z = this.center.z + wrap(drop.z - this.center.z + RANGE, RANGE * 2) - RANGE;
      const relocated = Math.abs(drop.x - x) > 1 || Math.abs(drop.z - z) > 1;
      if (relocated) { drop.x = x; drop.z = z; drop.alpha = 0; }
      if (sampleWeather || relocated) {
        const cell = cellAt(this.world, x, z);
        const weather = cell && this.world.weather?.cells[cell.z * this.world.size + cell.x];
        const fraction = weather ? precipitationPhase(weather.temperature).snowFraction : 0;
        drop.snow += (fraction - drop.snow) * Math.min(1, delta + 0.2);
        const density = weather && weather.precipitation !== 'none' ? weather.intensity * (0.58 + (weather.blizzard ?? 0) * 0.42) : 0;
        // Spatial modulation prevents a uniform curtain. Smooth density gates avoid popping.
        const patch = 0.87 + Math.sin(x * 0.19 + z * 0.13 + elapsed * 0.23) * 0.13;
        drop.target = THREE.MathUtils.smoothstep(density * patch - drop.density, -0.08, 0.08);
        if (!weather || weather.precipitation === 'none') drop.target = 0;
        drop.floor = Math.max(this.surface.heightAt(x, z), this.surface.waterYAt(x, z));
        drop.windX = (weather?.windX ?? 0) * (weather?.wind ?? 0);
        drop.windZ = (weather?.windZ ?? 0) * (weather?.wind ?? 0);
        drop.storm = weather?.blizzard ?? 0;
        if (!cell) { drop.alpha = 0; drop.target = 0; }
      }
      drop.alpha += (drop.target - drop.alpha) * blend;
      if (drop.alpha < 0.005) continue;
      const flake = drop.choice < drop.snow;
      const speed = flake ? 0.55 + drop.speed * 0.8 + drop.storm * 1.3 : 12 + drop.speed * 9;
      const height = (1 - wrap(elapsed * speed / HEIGHT + drop.phase, 1)) * HEIGHT;
      const gust = 0.8 + Math.sin(elapsed * 0.8 + x * 0.05) * 0.16 + Math.sin(elapsed * 2.1 + z * 0.13) * 0.09;
      const drift = flake ? (HEIGHT - height) * (0.26 + drop.storm * 0.42) : (HEIGHT - height) * 0.14;
      const px = x + drop.windX * drift * gust + (flake ? Math.sin(elapsed * 0.9 + drop.phase * 31 + height * 0.6) * (0.18 + drop.size * 0.35) : 0);
      const pz = z + drop.windZ * drift * gust + (flake ? Math.cos(elapsed * 0.65 + drop.phase * 19) * 0.3 : 0);
      const edge = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(px - this.center.x), Math.abs(pz - this.center.z)), RANGE * 0.62, RANGE);
      const fade = Math.min(1, height / 1.5, (HEIGHT - height) / 2) * edge;
      const near = THREE.MathUtils.smoothstep(Math.hypot(px - camera.position.x, drop.floor + height - camera.position.y, pz - camera.position.z), 1.5, 4);
      const alpha = drop.alpha * fade * near;
      if (flake) {
        sp.setXYZ(snow, px, drop.floor + height, pz);
        sc.setXYZW(snow, 1, 1, 1, alpha * (0.48 + drop.size * 0.42));
        ss.setX(snow, 0.55 + drop.size * 1.35 + (drop.size > 0.94 ? 0.5 : 0));
        snow++;
      } else {
        const length = 0.12 + drop.size * 0.28;
        rp.setXYZ(rain * 2, px, drop.floor + height, pz);
        rp.setXYZ(rain * 2 + 1, px - drop.windX * length * 0.28 * gust, drop.floor + height + length, pz - drop.windZ * length * 0.28 * gust);
        rc.setXYZW(rain * 2, 1, 1, 1, alpha * (0.16 + drop.size * 0.2));
        rc.setXYZW(rain * 2 + 1, 1, 1, 1, alpha * 0.025);
        rain++;
      }
    }
    this.rainCount = rain; this.snowCount = snow;
    this.rain.geometry.setDrawRange(0, rain * 2); this.snow.geometry.setDrawRange(0, snow);
    for (const attribute of [rp, rc, sp, sc, ss]) attribute.needsUpdate = true;
  }
  get report() { return { rain: this.rainCount, snow: this.snowCount, budget: PRECIPITATION_BUDGET, blizzard: this.severity, cloud: this.cloud, intensity: this.wet, thunder: this.thunder }; }
  dispose(): void { for (const object of [this.rain, this.snow]) { object.geometry.dispose(); object.material.dispose(); } }
}
