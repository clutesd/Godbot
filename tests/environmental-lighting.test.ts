import { describe, expect, it } from 'vitest';
import { resolveEnvironmentalLighting } from '../src/render/atmosphere/EnvironmentalLighting';

describe('environmental lighting', () => {
  it('keeps directional sunlight dominant without crushing stylised terrain shadows', () => {
    const midday = resolveEnvironmentalLighting({ sunElevation: 0.82, night: 0, fogDensity: 0.0072 });

    expect(midday.sunIntensity).toBeGreaterThan(midday.hemisphereIntensity * 3);
    expect(midday.sunIntensity).toBeGreaterThan(2.7);
    expect(midday.hemisphereIntensity).toBeGreaterThan(0.75);
    expect(midday.hemisphereIntensity).toBeLessThan(1);
    expect(midday.exposure).toBeLessThanOrEqual(1.04);
  });

  it('warms a low sun without turning golden hour into an orange filter', () => {
    const low = resolveEnvironmentalLighting({ sunElevation: 0.08, night: 0.18, fogDensity: 0.0072 });
    const high = resolveEnvironmentalLighting({ sunElevation: 0.8, night: 0, fogDensity: 0.0072 });

    expect(low.sunColor.r - low.sunColor.b).toBeGreaterThan(high.sunColor.r - high.sunColor.b);
    expect(low.sunColor.g).toBeGreaterThan(0.5);
    expect(low.twilight).toBeGreaterThan(high.twilight);
    expect(low.hemisphereIntensity).toBeGreaterThan(0.65);
  });

  it('softens direct light in severe atmospheric weather without flattening the scene', () => {
    const clear = resolveEnvironmentalLighting({ sunElevation: 0.55, night: 0, fogDensity: 0.0072 });
    const storm = resolveEnvironmentalLighting({ sunElevation: 0.55, night: 0, fogDensity: 0.05 });

    expect(storm.weatherSoftening).toBeGreaterThan(0.9);
    expect(storm.sunIntensity).toBeLessThan(clear.sunIntensity);
    expect(storm.sunIntensity).toBeGreaterThan(storm.hemisphereIntensity * 1.4);
    expect(storm.hemisphereIntensity).toBeGreaterThan(clear.hemisphereIntensity);
  });

  it('hands visual authority to moonlight and cool sky fill at night', () => {
    const night = resolveEnvironmentalLighting({ sunElevation: -0.65, night: 1, fogDensity: 0.0072 });

    expect(night.sunIntensity).toBeLessThan(0.1);
    expect(night.moonIntensity).toBeGreaterThan(night.sunIntensity);
    expect(night.hemisphereIntensity).toBeLessThan(0.22);
    expect(night.exposure).toBeGreaterThanOrEqual(1.07);
  });

  it('keeps exposure in a stable cinematic range across conditions', () => {
    for (const input of [
      { sunElevation: 0.9, night: 0, fogDensity: 0.004 },
      { sunElevation: 0.03, night: 0.45, fogDensity: 0.012 },
      { sunElevation: -0.7, night: 1, fogDensity: 0.008 },
      { sunElevation: 0.4, night: 0.05, fogDensity: 0.06 },
    ]) {
      const state = resolveEnvironmentalLighting(input);
      expect(state.exposure).toBeGreaterThanOrEqual(0.98);
      expect(state.exposure).toBeLessThanOrEqual(1.1);
    }
  });
});
