import * as THREE from 'three';
import { stableHash } from '../../sim/prng';
import { clamp01, smoothstep } from '../../sim/terrain/noise';
import type { WeatherCellState, WorldCell, WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';

/** GPU-facing description of the low-mist density field. */
export interface LowMistFieldSample {
  texture: THREE.DataTexture;
  flowTexture: THREE.DataTexture;
  originX: number;
  originZ: number;
  span: number;
  minAnchorY: number;
  maxAnchorY: number;
  seasonalStrength: number;
  driftX: number;
  driftZ: number;
  motionTime: number;
  windStrength: number;
}

const CHANNELS = 4;
export const LOW_MIST_MIN_HEIGHT = 2.8;
export const LOW_MIST_MAX_HEIGHT = 7.6;

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
  return THREE.MathUtils.lerp(LOW_MIST_MIN_HEIGHT, LOW_MIST_MAX_HEIGHT, amount);
}

/**
 * Low mist is most persistent overnight and around dawn, then burns back hard under a high clear
 * sun. Dense cloud/weather reduces solar burn-off instead of making every wet day uniformly foggy.
 */
export function lowMistDiurnalStrength(solarElevation: number, daylight: number, obscuration: number): number {
  const day = clamp01(daylight);
  const cloud = clamp01(obscuration);
  const dawnRise = smoothstep(-0.12, 0.04, solarElevation);
  const dawnFall = 1 - smoothstep(0.16, 0.42, solarElevation);
  const dawnPulse = dawnRise * dawnFall;
  const highSun = smoothstep(0.16, 0.68, Math.max(0, solarElevation));
  const burnOff = highSun * day * (1 - cloud * 0.68);
  const nightPersistence = (1 - day) * 0.46;
  return THREE.MathUtils.clamp(
    0.34 + nightPersistence + dawnPulse * 0.34 - burnOff * 0.32 + cloud * 0.1,
    0.22,
    1.05,
  );
}

/** Strong wind tears shallow fog apart even though the remaining banks move faster. */
export function lowMistWindRetention(wind: number): number {
  const dispersal = smoothstep(0.34, 0.92, clamp01(wind));
  return THREE.MathUtils.lerp(1, 0.56, dispersal);
}

/** Decode helper for tests/diagnostics. One-channel encoding stays interpolation-safe on the GPU. */
export function decodeLowMistAnchor(encoded: number, minY: number, maxY: number): number {
  return THREE.MathUtils.lerp(minY, maxY, (encoded & 255) / 255);
}

/**
 * Low-resolution world-space mist field.
 *
 * Density texture:
 * R = spatial source strength
 * G = normalized terrain/water anchor height
 * B = local layer-height fraction
 * A = reserved (opaque for interpolation stability)
 *
 * Flow texture:
 * R/G = interpolatable downhill X/Z direction encoded from -1..1 to 0..1
 * B = local slope/spill strength
 * A = opaque
 *
 * The textures are intentionally tiny (one texel per simulation cell). Geography stays fixed while
 * the presentation layer animates bank structure through wind and the downhill vector; the mist is
 * never allowed to become a free-scrolling screen texture detached from valleys and water.
 */
export class LowMistField {
  readonly texture: THREE.DataTexture;
  readonly flowTexture: THREE.DataTexture;
  readonly originX: number;
  readonly originZ: number;
  readonly span: number;
  readonly pixels: Uint8Array;
  readonly flowPixels: Uint8Array;
  minAnchorY = 0;
  maxAnchorY = 1;
  seasonalStrength = 0.3;

  private revision = '';
  private driftX = 0;
  private driftZ = 0;
  private motionTime = 0;
  private windStrength = 0.12;

  constructor(private readonly world: WorldState, private readonly surface: TerrainSurface, private readonly seed: string) {
    this.originX = -world.size * world.cellSize * 0.5;
    this.originZ = -world.size * world.cellSize * 0.5;
    this.span = world.size * world.cellSize;
    this.pixels = new Uint8Array(world.size * world.size * CHANNELS);
    this.flowPixels = new Uint8Array(world.size * world.size * CHANNELS);
    this.texture = new THREE.DataTexture(this.pixels, world.size, world.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.flowTexture = new THREE.DataTexture(this.flowPixels, world.size, world.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const texture of [this.texture, this.flowTexture]) {
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.generateMipmaps = false;
    }
    this.rebuild();
  }

  setSeasonalStrength(strength: number): void {
    this.seasonalStrength = THREE.MathUtils.clamp(strength, 0, 1);
  }

  /**
   * Update structural weather only when its revision changes, but animate the banks every frame.
   * Presentation drift is deliberately slow and bounded so resuming a background tab cannot throw
   * the mist across the world in one frame.
   */
  update(deltaSeconds = 0, elapsedSeconds = 0): void {
    const revision = `${this.world.weather?.month ?? -1}:${this.world.environmentRevision ?? 0}`;
    if (revision !== this.revision) this.rebuild();

    const weather = this.world.weather;
    this.windStrength = clamp01(weather?.wind ?? 0.12);
    const windX = weather?.windX ?? 1;
    const windZ = weather?.windZ ?? 0;
    const windLength = Math.max(0.0001, Math.hypot(windX, windZ));
    const dt = THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.25);
    const driftSpeed = 0.018 + this.windStrength * 0.14;
    this.driftX += windX / windLength * driftSpeed * dt;
    this.driftZ += windZ / windLength * driftSpeed * dt;

    // Keep the values numerically small over multi-day browser sessions; the bank pattern is
    // periodic, so wrapping by world span is visually continuous.
    if (this.span > 0) {
      this.driftX = ((this.driftX % this.span) + this.span) % this.span;
      this.driftZ = ((this.driftZ % this.span) + this.span) % this.span;
    }
    this.motionTime = Number.isFinite(elapsedSeconds) ? elapsedSeconds % 4096 : this.motionTime + dt;
  }

  sample(): LowMistFieldSample {
    return {
      texture: this.texture,
      flowTexture: this.flowTexture,
      originX: this.originX,
      originZ: this.originZ,
      span: this.span,
      minAnchorY: this.minAnchorY,
      maxAnchorY: this.maxAnchorY,
      seasonalStrength: this.seasonalStrength,
      driftX: this.driftX,
      driftZ: this.driftZ,
      motionTime: this.motionTime,
      windStrength: this.windStrength,
    };
  }

  dispose(): void {
    this.texture.dispose();
    this.flowTexture.dispose();
  }

  private rebuild(): void {
    const count = this.world.size * this.world.size;
    const raw = new Float32Array(count);
    const anchor = new Float32Array(count);
    const height = new Float32Array(count);
    let minAnchor = Number.POSITIVE_INFINITY;
    let maxAnchor = Number.NEGATIVE_INFINITY;
    const flowStep = Math.max(this.world.cellSize, this.world.terrain.step * 2);

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

      // Downhill flow is presentation-only terrain information. It gives moving bank structure a
      // gravity bias on slopes without altering hydrology or moving the authoritative source field.
      const east = this.surface.heightAt(cell.worldX + flowStep, cell.worldZ);
      const west = this.surface.heightAt(cell.worldX - flowStep, cell.worldZ);
      const south = this.surface.heightAt(cell.worldX, cell.worldZ + flowStep);
      const north = this.surface.heightAt(cell.worldX, cell.worldZ - flowStep);
      let downhillX = west - east;
      let downhillZ = north - south;
      const downhillLength = Math.hypot(downhillX, downhillZ);
      if (downhillLength > 0.0001) {
        downhillX /= downhillLength;
        downhillZ /= downhillLength;
      } else {
        downhillX = 0;
        downhillZ = 0;
      }
      const spill = clamp01(cell.slope * 1.18 + cell.relief * 0.12);
      const flowOffset = index * CHANNELS;
      this.flowPixels[flowOffset] = Math.round((downhillX * 0.5 + 0.5) * 255);
      this.flowPixels[flowOffset + 1] = Math.round((downhillZ * 0.5 + 0.5) * 255);
      this.flowPixels[flowOffset + 2] = Math.round(spill * 255);
      this.flowPixels[flowOffset + 3] = 255;
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
      const encodedAnchor = Math.round(clamp01((anchor[index]! - this.minAnchorY) / heightRange) * 255);
      const layerFraction = clamp01((height[index]! - LOW_MIST_MIN_HEIGHT) / (LOW_MIST_MAX_HEIGHT - LOW_MIST_MIN_HEIGHT));
      const offset = index * CHANNELS;
      this.pixels[offset] = Math.round(smoothed[index]! * 255);
      this.pixels[offset + 1] = encodedAnchor;
      this.pixels[offset + 2] = Math.round(layerFraction * 255);
      this.pixels[offset + 3] = 255;
    }

    this.texture.needsUpdate = true;
    this.flowTexture.needsUpdate = true;
    this.revision = `${this.world.weather?.month ?? -1}:${this.world.environmentRevision ?? 0}`;
  }
}
