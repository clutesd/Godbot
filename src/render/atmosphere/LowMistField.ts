import * as THREE from 'three';
import { stableHash } from '../../sim/prng';
import { clamp01, smoothstep } from '../../sim/terrain/noise';
import type { WeatherCellState, WorldCell, WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';

/** GPU-facing description of the low-mist density field. */
export interface LowMistFieldSample {
  texture: THREE.DataTexture;
  originX: number;
  originZ: number;
  span: number;
  minAnchorY: number;
  maxAnchorY: number;
  seasonalStrength: number;
}

const CHANNELS = 4;
const MIN_LAYER_HEIGHT = 2.8;
const MAX_LAYER_HEIGHT = 7.6;

const LANDFORM_MIST: Readonly<Record<WorldCell['landform'], number>> = {
  ocean: 0.28,
  shore: 0.62,
  lowland: 0.52,
  basin: 1,
  valley: 0.94,
  hill: 0.2,
  plateau: 0.12,
  ridge: 0.03,
  peak: 0,
  canyon: 0.58,
};

/**
 * Pure source-strength resolver used both by the field builder and regression tests.
 *
 * This deliberately describes where mist wants to exist, not whether the whole frame should be
 * foggy. Valleys, wetland, rivers, lakes and recently wet weather contribute; steep exposed ridges
 * and dry/high terrain suppress it. The result is then spatially smoothed before reaching the GPU.
 */
export function lowMistSourceForCell(cell: WorldCell, weather?: WeatherCellState): number {
  const waterSignal = cell.lake ? 1
    : cell.river ? 0.95
      : cell.coast ? 0.68
        : cell.water ? 0.38
          : clamp01(cell.flow) * 0.42;
  const landform = LANDFORM_MIST[cell.landform];
  const wetland = cell.biome === 'wetland' ? 1 : 0;
  const moisture = clamp01(cell.moisture);
  const flow = clamp01(cell.flow);
  const precipitation = weather && weather.precipitation !== 'none' ? clamp01(weather.intensity) : 0;
  const weatherWetness = clamp01(
    precipitation * 0.62
      + (weather?.runoff ?? 0) * 0.22
      + (weather?.floodRisk ?? 0) * 0.16,
  );
  const dryPenalty = cell.biome === 'dryland' ? 0.28
    : cell.biome === 'mountain' ? 0.2
      : cell.biome === 'highland' ? 0.1
        : 0;

  const raw = waterSignal * 0.46
    + landform * 0.3
    + wetland * 0.18
    + moisture * 0.14
    + flow * 0.1
    + weatherWetness * 0.2
    - clamp01(cell.slope) * 0.24
    - dryPenalty;
  return smoothstep(0.2, 0.78, raw);
}

/** Taller banks belong over broad wet basins and water; exposed ridges stay very shallow. */
export function lowMistLayerHeightForCell(cell: WorldCell): number {
  const waterSignal = cell.lake || cell.river ? 1 : cell.coast ? 0.78 : cell.water ? 0.62 : clamp01(cell.flow) * 0.5;
  const basinSignal = Math.max(LANDFORM_MIST[cell.landform], cell.biome === 'wetland' ? 0.9 : 0);
  const opennessPenalty = clamp01(cell.slope) * 0.32 + (cell.landform === 'ridge' || cell.landform === 'peak' ? 0.22 : 0);
  const amount = clamp01(Math.max(waterSignal, basinSignal) - opennessPenalty);
  return THREE.MathUtils.lerp(MIN_LAYER_HEIGHT, MAX_LAYER_HEIGHT, amount);
}

/** Decode helper for tests/diagnostics. */
export function decodeLowMistAnchor(high: number, low: number, minY: number, maxY: number): number {
  const normalized = ((high & 255) * 256 + (low & 255)) / 65535;
  return THREE.MathUtils.lerp(minY, maxY, normalized);
}

/**
 * Low-resolution world-space mist field.
 *
 * R = spatial source strength
 * G/B = 16-bit encoded terrain/water anchor height
 * A = local layer-height fraction
 *
 * The texture is intentionally tiny (one texel per simulation cell) and linearly filtered. The
 * expensive-looking result comes from integrating this field in the existing aerial-perspective
 * pass, not from adding particle volumes or a second full-screen fog renderer.
 */
export class LowMistField {
  readonly texture: THREE.DataTexture;
  readonly originX: number;
  readonly originZ: number;
  readonly span: number;
  readonly pixels: Uint8Array;
  minAnchorY = 0;
  maxAnchorY = 1;
  seasonalStrength = 0.3;

  private revision = '';

  constructor(private readonly world: WorldState, private readonly surface: TerrainSurface, private readonly seed: string) {
    this.originX = -world.size * world.cellSize * 0.5;
    this.originZ = -world.size * world.cellSize * 0.5;
    this.span = world.size * world.cellSize;
    this.pixels = new Uint8Array(world.size * world.size * CHANNELS);
    this.texture = new THREE.DataTexture(this.pixels, world.size, world.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.rebuild();
  }

  setSeasonalStrength(strength: number): void {
    this.seasonalStrength = THREE.MathUtils.clamp(strength, 0, 1);
  }

  /** Rebuild only when simulation weather/hydrology revision changes. */
  update(): void {
    const revision = `${this.world.weather?.month ?? -1}:${this.world.environmentRevision ?? 0}`;
    if (revision !== this.revision) this.rebuild();
  }

  sample(): LowMistFieldSample {
    return {
      texture: this.texture,
      originX: this.originX,
      originZ: this.originZ,
      span: this.span,
      minAnchorY: this.minAnchorY,
      maxAnchorY: this.maxAnchorY,
      seasonalStrength: this.seasonalStrength,
    };
  }

  dispose(): void {
    this.texture.dispose();
  }

  private rebuild(): void {
    const count = this.world.size * this.world.size;
    const raw = new Float32Array(count);
    const anchor = new Float32Array(count);
    const height = new Float32Array(count);
    let minAnchor = Number.POSITIVE_INFINITY;
    let maxAnchor = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < count; index += 1) {
      const cell = this.world.cells[index];
      if (!cell) continue;
      const weather = this.world.weather?.cells[index];
      const waterY = this.surface.waterYAt(cell.worldX, cell.worldZ);
      const anchorY = Number.isFinite(waterY)
        ? Math.max(this.surface.heightAt(cell.worldX, cell.worldZ), waterY)
        : this.surface.heightAt(cell.worldX, cell.worldZ);
      anchor[index] = anchorY;
      minAnchor = Math.min(minAnchor, anchorY);
      maxAnchor = Math.max(maxAnchor, anchorY);

      const patch = 0.76 + stableHash(`${this.seed}:low-mist`, cell.x, cell.z) * 0.42;
      raw[index] = clamp01(lowMistSourceForCell(cell, weather) * patch);
      height[index] = lowMistLayerHeightForCell(cell);
    }

    this.minAnchorY = Number.isFinite(minAnchor) ? minAnchor : 0;
    this.maxAnchorY = Number.isFinite(maxAnchor) ? Math.max(minAnchor + 1, maxAnchor) : 1;

    // One conservative neighbourhood pass removes the simulation-cell grid while keeping the
    // geography legible. The local value retains most of the weight so mist does not leak uphill.
    const smoothed = new Float32Array(count);
    const size = this.world.size;
    for (let z = 0; z < size; z += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = z * size + x;
        let total = 0;
        let samples = 0;
        for (let dz = -1; dz <= 1; dz += 1) {
          const sz = z + dz;
          if (sz < 0 || sz >= size) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const sx = x + dx;
            if (sx < 0 || sx >= size) continue;
            total += raw[sz * size + sx] ?? 0;
            samples += 1;
          }
        }
        const neighbourhood = samples > 0 ? total / samples : 0;
        smoothed[index] = clamp01(raw[index]! * 0.68 + neighbourhood * 0.32);
      }
    }

    const heightRange = Math.max(0.001, this.maxAnchorY - this.minAnchorY);
    for (let index = 0; index < count; index += 1) {
      const encodedAnchor = Math.round(clamp01((anchor[index]! - this.minAnchorY) / heightRange) * 65535);
      const layerFraction = clamp01((height[index]! - MIN_LAYER_HEIGHT) / (MAX_LAYER_HEIGHT - MIN_LAYER_HEIGHT));
      const offset = index * CHANNELS;
      this.pixels[offset] = Math.round(smoothed[index]! * 255);
      this.pixels[offset + 1] = (encodedAnchor >> 8) & 255;
      this.pixels[offset + 2] = encodedAnchor & 255;
      this.pixels[offset + 3] = Math.round(layerFraction * 255);
    }

    this.texture.needsUpdate = true;
    this.revision = `${this.world.weather?.month ?? -1}:${this.world.environmentRevision ?? 0}`;
  }
}
