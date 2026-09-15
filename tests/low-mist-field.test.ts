import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import type { WeatherCellState, WorldCell } from '../src/sim/types';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import {
  LOW_MIST_MAX_HEIGHT,
  LOW_MIST_MIN_HEIGHT,
  LowMistField,
  decodeLowMistAnchor,
  lowMistDiurnalStrength,
  lowMistLayerHeightForCell,
  lowMistSourceForCell,
  lowMistWindRetention,
} from '../src/render/atmosphere/LowMistField';
import {
  AERIAL_PERSPECTIVE_SHADER,
  LOW_MIST_MAX_OPACITY,
  LOW_MIST_OPTICAL_DENSITY,
  resolveLowMistOpacity,
} from '../src/render/atmosphere/AerialPerspective';

const cell = (overrides: Partial<WorldCell> = {}): WorldCell => ({
  x: 0,
  z: 0,
  worldX: 0,
  worldZ: 0,
  elevation: 0.4,
  moisture: 0.5,
  temperature: 0.5,
  fertility: 0.5,
  wood: 0.4,
  minerals: 0.2,
  habitability: 0.5,
  movementCost: 1,
  water: false,
  coast: false,
  river: false,
  lake: false,
  slope: 0.15,
  relief: 0.3,
  flow: 0.05,
  rockiness: 0.2,
  landform: 'lowland',
  biome: 'forest',
  ...overrides,
});

const rainy = {
  precipitation: 'rain',
  intensity: 0.9,
  runoff: 0.65,
  floodRisk: 0.45,
} as WeatherCellState;

describe('spatial low mist field', () => {
  it('strongly prefers wet valleys and waterways over dry exposed ridges', () => {
    const wetValley = cell({
      river: true,
      moisture: 0.92,
      flow: 0.8,
      slope: 0.08,
      landform: 'valley',
      biome: 'wetland',
    });
    const dryRidge = cell({
      moisture: 0.16,
      flow: 0,
      slope: 0.78,
      landform: 'ridge',
      biome: 'dryland',
    });

    expect(lowMistSourceForCell(wetValley)).toBeGreaterThan(0.8);
    expect(lowMistSourceForCell(dryRidge)).toBeLessThan(0.08);
    expect(lowMistLayerHeightForCell(wetValley)).toBeGreaterThan(lowMistLayerHeightForCell(dryRidge));
  });

  it('lets recent wet weather strengthen a plausible lowland source without creating universal fog', () => {
    const lowland = cell({ moisture: 0.48, flow: 0.08, landform: 'lowland', slope: 0.1 });
    const clear = lowMistSourceForCell(lowland);
    const wet = lowMistSourceForCell(lowland, rainy);

    expect(wet).toBeGreaterThan(clear);
    expect(wet).toBeLessThan(1);
  });

  it('peaks around dawn and burns back under a high clear sun', () => {
    const predawn = lowMistDiurnalStrength(-0.04, 0.08, 0);
    const dawn = lowMistDiurnalStrength(0.06, 0.42, 0);
    const clearNoon = lowMistDiurnalStrength(0.82, 1, 0);
    const cloudyNoon = lowMistDiurnalStrength(0.82, 1, 0.8);

    expect(dawn).toBeGreaterThan(clearNoon * 2);
    expect(predawn).toBeGreaterThan(clearNoon);
    expect(cloudyNoon).toBeGreaterThan(clearNoon);
    expect(clearNoon).toBeLessThan(0.4);
  });

  it('disperses shallow mist under strong wind while retaining calm banks', () => {
    const calm = lowMistWindRetention(0.12);
    const gale = lowMistWindRetention(0.95);
    expect(calm).toBeGreaterThan(0.95);
    expect(gale).toBeLessThan(0.65);
  });

  it('keeps a representative high-camera mist bank visibly above a perceptual floor', () => {
    // Representative of the supplied documentary screenshots after seasonal/diurnal attenuation:
    // only a small fraction of the camera ray intersects the shallow bank, but legitimate mist must
    // still alter the image enough to be seen without restoring screen-wide fog.
    const documentary = resolveLowMistOpacity(120, 0.08, 0.12, 0);
    const strongBank = resolveLowMistOpacity(120, 0.18, 0.6, 0);

    expect(LOW_MIST_OPTICAL_DENSITY).toBeGreaterThanOrEqual(0.08);
    expect(documentary).toBeGreaterThan(0.085);
    expect(documentary).toBeLessThan(0.16);
    expect(strongBank).toBeGreaterThanOrEqual(0.3);
    expect(strongBank).toBeLessThanOrEqual(LOW_MIST_MAX_OPACITY);
    expect(resolveLowMistOpacity(120, 0, 1, 0)).toBe(0);
  });

  it('builds a bounded selective field with interpolation-safe height and flow channels', () => {
    const world = generateWorld(configWith({ seed: 'low-mist-field-contract', world: { size: 18 } }));
    const surface = new TerrainSurface(world);
    const field = new LowMistField(world, surface, 'low-mist-field-contract');
    const densities: number[] = [];
    const spillStrengths: number[] = [];

    for (let index = 0; index < world.cells.length; index += 1) {
      const offset = index * 4;
      densities.push(field.pixels[offset] ?? 0);
      spillStrengths.push(field.flowPixels[offset + 2] ?? 0);
      const anchor = decodeLowMistAnchor(
        field.pixels[offset + 1] ?? 0,
        field.minAnchorY,
        field.maxAnchorY,
      );
      expect(anchor).toBeGreaterThanOrEqual(field.minAnchorY - 0.001);
      expect(anchor).toBeLessThanOrEqual(field.maxAnchorY + 0.001);
      expect(field.pixels[offset + 2]).toBeGreaterThanOrEqual(0);
      expect(field.pixels[offset + 2]).toBeLessThanOrEqual(255);
      expect(field.pixels[offset + 3]).toBe(255);
      expect(field.flowPixels[offset]).toBeGreaterThanOrEqual(0);
      expect(field.flowPixels[offset]).toBeLessThanOrEqual(255);
      expect(field.flowPixels[offset + 1]).toBeGreaterThanOrEqual(0);
      expect(field.flowPixels[offset + 1]).toBeLessThanOrEqual(255);
      expect(field.flowPixels[offset + 3]).toBe(255);
    }

    const active = densities.filter((value) => value > 8).length;
    expect(Math.max(...densities)).toBeGreaterThan(80);
    expect(Math.max(...spillStrengths)).toBeGreaterThan(20);
    expect(active).toBeGreaterThan(0);
    expect(active).toBeLessThan(world.cells.length * 0.9);
    expect(field.texture.image.width).toBe(world.size);
    expect(field.texture.image.height).toBe(world.size);
    expect(field.flowTexture.image.width).toBe(world.size);
    expect(field.minAnchorY).toBeLessThan(field.maxAnchorY);

    field.setSeasonalStrength(0.62);
    expect(field.sample().seasonalStrength).toBeCloseTo(0.62, 6);
    field.dispose();
  });

  it('advects bank presentation with wind without moving the geographic source texture', () => {
    const world = generateWorld(configWith({ seed: 'low-mist-motion-contract', world: { size: 12 } }));
    const surface = new TerrainSurface(world);
    const field = new LowMistField(world, surface, 'low-mist-motion-contract');
    const textureBefore = Array.from(field.pixels);
    const before = field.sample();

    field.update(0.25, 10);
    const after = field.sample();

    expect(after.driftX).toBeGreaterThan(before.driftX);
    expect(after.motionTime).toBeCloseTo(10, 6);
    expect(Array.from(field.pixels)).toEqual(textureBefore);
    field.dispose();
  });

  it('keeps mist shallow and integrates rolling banks, downhill flow and light response in one pass', () => {
    expect(LOW_MIST_MIN_HEIGHT).toBeGreaterThan(2);
    expect(LOW_MIST_MAX_HEIGHT).toBeLessThan(9);
    expect(LOW_MIST_MAX_HEIGHT).toBeGreaterThan(LOW_MIST_MIN_HEIGHT);
    expect(AERIAL_PERSPECTIVE_SHADER.fragmentShader).toContain('integratedLowMist');
    expect(AERIAL_PERSPECTIVE_SHADER.fragmentShader).toContain('uLowMistFlowMap');
    expect(AERIAL_PERSPECTIVE_SHADER.fragmentShader).toContain('mistBankPattern');
    expect(AERIAL_PERSPECTIVE_SHADER.fragmentShader).toContain('uMistLayerScale');
    expect(AERIAL_PERSPECTIVE_SHADER.fragmentShader).toContain('uMistSunGlow');
    expect(AERIAL_PERSPECTIVE_SHADER.fragmentShader).toContain('uMistMoonGlow');
    expect(AERIAL_PERSPECTIVE_SHADER.fragmentShader).toContain(LOW_MIST_OPTICAL_DENSITY.toFixed(3));
  });
});