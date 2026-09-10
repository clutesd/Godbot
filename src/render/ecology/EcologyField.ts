import * as THREE from 'three';
import { stableHash } from '../../sim/prng';
import { clamp01, smoothstep } from '../../sim/terrain/noise';
import type { Biome, Settlement, WeatherCellState, WorldCell, WorldState } from '../../sim/types';

/** Renderer-only budgets. Zero disables a layer without changing world generation/history. */
export interface EcologyQuality {
  bioluminescenceDensity: number;
  particleDensity: number;
  waterComplexity: 0 | 1 | 2;
  bloomQuality: 0 | 1 | 2;
}
export const DEFAULT_ECOLOGY_QUALITY: Readonly<EcologyQuality> = {
  bioluminescenceDensity: 1, particleDensity: 1, waterComplexity: 2, bloomQuality: 1,
};

export const BIOME_LIFE: Record<Biome, { flora: number; water: number; colour: string }> = {
  forest: { flora: 0.72, water: 0.64, colour: '#4acdcc' },
  wetland: { flora: 0.95, water: 0.98, colour: '#529bff' },
  grassland: { flora: 0.32, water: 0.48, colour: '#b292e6' },
  dryland: { flora: 0.07, water: 0.18, colour: '#dfba6e' },
  highland: { flora: 0.24, water: 0.3, colour: '#9684ee' },
  mountain: { flora: 0.05, water: 0.12, colour: '#80bed4' },
  water: { flora: 0, water: 0.72, colour: '#43bce9' },
};

export function ecologicalNight(daylight: number): number {
  return 1 - smoothstep(0.025, 0.55, daylight);
}

/** A stable regional habitat trait, never a periodic random event. About 2% of regions qualify. */
export function luminousRefuge(seed: string, x: number, z: number): number {
  return stableHash(`${seed}:luminous-refuge`, Math.floor(x / 5), Math.floor(z / 5)) > 0.98 ? 1 : 0;
}

export function ecologicalVitality(cell: WorldCell, weather: WeatherCellState | undefined, month: number, pollution = 0, pressure = 0) {
  const temperature = weather?.temperature ?? cell.temperature;
  const warmth = smoothstep(0.32, 0.51, temperature);
  const moisture = smoothstep(0.12, 0.48, cell.moisture);
  const survival = (1 - clamp01(weather?.treeDamage ?? 0)) * (1 - clamp01(pollution))
    * (1 - clamp01(pressure)) * (1 - smoothstep(0.01, 0.2, weather?.snowpack ?? 0));
  const season = ((month % 12) + 12) % 12;
  const growth = 0.35 + 0.65 * smoothstep(0.7, 3.5, season) * (1 - smoothstep(7.5, 10.7, season));
  const habitat = BIOME_LIFE[cell.biome];
  return {
    flora: habitat.flora * warmth * moisture * survival * growth * smoothstep(0.015, 0.38, cell.wood),
    water: habitat.water * warmth * survival * (0.35 + moisture * 0.65) * (0.65 + growth * 0.35),
    motes: warmth * moisture * survival * growth * (1 - clamp01(weather?.wind ?? 0) * 0.88)
      * (1 - (weather?.precipitation !== 'none' ? clamp01(weather?.intensity ?? 0) * 0.9 : 0)),
  };
}

/** Small cell-resolution RGBA habitat atlas shared by plants, particles and water. Updated at
 * structural cadence, never per fragment on the CPU and never written into simulation state. */
export class EcologyField {
  readonly texture: THREE.DataTexture;
  readonly bounds: THREE.Vector4;
  readonly night = { value: 0 };
  readonly stress = { value: 0 };
  readonly time = { value: 0 };
  readonly wind = { value: new THREE.Vector2() };
  readonly seedPhase: number;
  private readonly data: Uint8Array;
  private readonly refuges: Float32Array;
  private readonly strains: Float32Array;

  constructor(readonly world: WorldState, seed: string) {
    this.seedPhase = stableHash(`${seed}:microbial-current`, 0, 0) * 100;
    this.data = new Uint8Array(world.size * world.size * 4);
    this.refuges = new Float32Array(world.cells.length);
    this.strains = new Float32Array(world.cells.length);
    world.cells.forEach((cell, i) => {
      this.refuges[i] = luminousRefuge(seed, cell.x, cell.z);
      this.strains[i] = 0.18 + stableHash(`${seed}:plankton-strain`, Math.floor(cell.x / 3), Math.floor(cell.z / 3)) * 0.82;
    });
    this.texture = new THREE.DataTexture(this.data, world.size, world.size);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    const span = world.size * world.cellSize;
    // Cell centers sit at (index - size/2)*cellSize; include the half-texel border.
    this.bounds = new THREE.Vector4(-span / 2 - world.cellSize / 2, -span / 2 - world.cellSize / 2, span, span);
    this.sync([], world.weather?.month ?? 0);
  }

  sync(settlements: readonly Settlement[], month: number, pressure = 0): void {
    const fires = settlements.flatMap(s => (s.structurePlots ?? []).filter(p => p.fire || (p.scorch ?? 0) > 0.05));
    for (let i = 0; i < this.world.cells.length; i++) {
      const cell = this.world.cells[i]!;
      let pollution = 0;
      for (const town of settlements) {
        const distance = Math.hypot(cell.worldX - town.position.x, cell.worldZ - town.position.z);
        pollution = Math.max(pollution, town.pollution * (1 - smoothstep(3, 12 + town.urbanization * 18, distance)));
      }
      for (const plot of fires) {
        const distance = Math.hypot(cell.worldX - plot.worldX, cell.worldZ - plot.worldZ);
        pollution = Math.max(pollution, Math.max(plot.fire?.intensity ?? 0, plot.scorch ?? 0)
          * (1 - smoothstep(plot.radius, plot.radius + this.world.cellSize * 1.5, distance)));
      }
      const life = ecologicalVitality(cell, this.world.weather?.cells[i], month, pollution, pressure);
      this.data[i * 4] = Math.round(clamp01(life.flora) * 255);
      this.data[i * 4 + 1] = Math.round(clamp01(life.water * this.strains[i]!) * 255);
      this.data[i * 4 + 2] = this.refuges[i]! * 255;
      this.data[i * 4 + 3] = Math.round(clamp01(life.motes) * 255);
    }
    this.texture.needsUpdate = true;
  }

  animate(elapsed: number, daylight: number): void {
    this.time.value = elapsed;
    this.night.value = ecologicalNight(daylight);
    const weather = this.world.weather;
    this.wind.value.set((weather?.windX ?? 0) * (weather?.wind ?? 0), (weather?.windZ ?? 0) * (weather?.wind ?? 0));
  }

  vitalityAt(x: number, z: number): number {
    const cx = Math.round(x / this.world.cellSize + this.world.size / 2);
    const cz = Math.round(z / this.world.cellSize + this.world.size / 2);
    if (cx < 0 || cz < 0 || cx >= this.world.size || cz >= this.world.size) return 0;
    return this.data[(cz * this.world.size + cx) * 4]! / 255;
  }

  dispose(): void { this.texture.dispose(); }
}

export const ECOLOGY_GLSL = `
uniform sampler2D ecologyMap;
uniform vec4 ecologyBounds;
uniform float ecologyNight;
uniform float ecologyTime;
uniform float ecologyStress;
uniform vec2 ecologyWind;
vec4 habitatAt(vec2 p) {
  vec2 uv = (p - ecologyBounds.xy) / ecologyBounds.zw;
  vec4 habitat = texture2D(ecologyMap, clamp(uv, 0.0, 1.0));
  habitat.rga *= 1.0 - ecologyStress;
  return habitat;
}
`;

export function ecologyUniforms(field: EcologyField) {
  return { ecologyMap: { value: field.texture }, ecologyBounds: { value: field.bounds },
    ecologyNight: field.night, ecologyTime: field.time, ecologyWind: field.wind, ecologyStress: field.stress };
}
