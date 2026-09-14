import { describe, expect, it } from 'vitest';
import { resolveEnvironmentalDepth } from '../src/render/atmosphere/EnvironmentalDepth';

describe('environmental depth presentation', () => {
  it('keeps clear daylight genuinely light while retaining a small near-air floor', () => {
    const state = resolveEnvironmentalDepth({
      daylight: 1,
      twilight: 0,
      atmosphericObscuration: 0,
      baseFogDensity: 0.0072,
      cameraHeight: 28,
    });
    expect(state.fogDensity).toBeGreaterThan(0.001);
    expect(state.fogDensity).toBeLessThan(0.0018);
    expect(state.fogSkyBlend).toBeLessThan(0.22);
  });

  it('does not make an elevated documentary camera globally foggier in clear weather', () => {
    const low = resolveEnvironmentalDepth({ daylight: 1, twilight: 0, atmosphericObscuration: 0, baseFogDensity: 0.0072, cameraHeight: 8 });
    const high = resolveEnvironmentalDepth({ daylight: 1, twilight: 0, atmosphericObscuration: 0, baseFogDensity: 0.0072, cameraHeight: 120 });
    expect(high.fogDensity).toBeCloseTo(low.fogDensity, 8);
  });

  it('deepens atmosphere and valley mist under severe obscuration without exploding density', () => {
    const clear = resolveEnvironmentalDepth({ daylight: 1, twilight: 0, atmosphericObscuration: 0, baseFogDensity: 0.0072, cameraHeight: 25 });
    const storm = resolveEnvironmentalDepth({ daylight: 0.45, twilight: 0.2, atmosphericObscuration: 1, baseFogDensity: 0.04, cameraHeight: 25 });
    expect(storm.fogDensity).toBeGreaterThan(clear.fogDensity * 10);
    expect(storm.fogDensity).toBeLessThanOrEqual(0.055);
    expect(storm.valleyMistMultiplier).toBeGreaterThan(clear.valleyMistMultiplier);
  });

  it('keeps ordinary valley mist restrained until the spatial mist-field pass', () => {
    const clear = resolveEnvironmentalDepth({ daylight: 1, twilight: 0, atmosphericObscuration: 0, baseFogDensity: 0.0072, cameraHeight: 25 });
    expect(clear.valleyMistMultiplier).toBeGreaterThanOrEqual(0.45);
    expect(clear.valleyMistMultiplier).toBeLessThanOrEqual(0.55);
  });

  it('tightens shadow coverage materially below the old fixed 75-unit half span', () => {
    const close = resolveEnvironmentalDepth({ daylight: 1, twilight: 0, atmosphericObscuration: 0, baseFogDensity: 0.0072, cameraHeight: 18 });
    const wide = resolveEnvironmentalDepth({ daylight: 1, twilight: 0, atmosphericObscuration: 0, baseFogDensity: 0.0072, cameraHeight: 90 });
    expect(close.shadowHalfSpan).toBeGreaterThanOrEqual(42);
    expect(close.shadowHalfSpan).toBeLessThan(50);
    expect(wide.shadowHalfSpan).toBeGreaterThan(close.shadowHalfSpan);
    expect(wide.shadowHalfSpan).toBeLessThanOrEqual(64);
  });

  it('uses conservative contact-safe bias values', () => {
    const state = resolveEnvironmentalDepth({ daylight: 0.6, twilight: 0.4, atmosphericObscuration: 0.3, baseFogDensity: 0.01, cameraHeight: 35 });
    expect(state.shadowBias).toBeLessThan(0);
    expect(state.shadowBias).toBeGreaterThan(-0.001);
    expect(state.shadowNormalBias).toBeGreaterThan(0);
    expect(state.shadowNormalBias).toBeLessThan(0.04);
    expect(state.shadowFar).toBeGreaterThan(150);
  });
});
