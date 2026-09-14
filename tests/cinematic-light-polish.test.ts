import { describe, expect, it } from 'vitest';
import { resolveEnvironmentalLighting } from '../src/render/atmosphere/EnvironmentalLighting';
import { resolveCinematicLightPolish } from '../src/render/atmosphere/CinematicLightPolish';

const lighting = (sunElevation: number, night: number, fogDensity = 0.0072) =>
  resolveEnvironmentalLighting({ sunElevation, night, fogDensity });

describe('cinematic light polish', () => {
  it('lifts and cools long shadows more than neutral midday without washing the scene out', () => {
    const midday = resolveCinematicLightPolish(lighting(0.82, 0));
    const golden = resolveCinematicLightPolish(lighting(0.08, 0.18));

    expect(golden.shadowLift).toBeGreaterThan(midday.shadowLift);
    expect(golden.coolShadow).toBeGreaterThan(midday.coolShadow);
    expect(golden.warmRestraint).toBeGreaterThan(0.2);
    expect(golden.shadowLift).toBeLessThan(0.07);
  });

  it('keeps daylight bloom selective while allowing emissive night detail to breathe', () => {
    const day = resolveCinematicLightPolish(lighting(0.82, 0));
    const night = resolveCinematicLightPolish(lighting(-0.65, 1));

    expect(day.bloomThreshold).toBeGreaterThan(night.bloomThreshold);
    expect(day.bloomStrength).toBeLessThan(night.bloomStrength);
    expect(day.bloomStrength).toBeLessThan(0.1);
    expect(night.bloomStrength).toBeLessThan(0.3);
  });

  it('keeps AO at contact scale instead of broad terrain-darkening scale', () => {
    for (const state of [
      resolveCinematicLightPolish(lighting(0.82, 0)),
      resolveCinematicLightPolish(lighting(0.08, 0.18)),
      resolveCinematicLightPolish(lighting(-0.65, 1)),
    ]) {
      expect(state.aoKernelRadius).toBeGreaterThanOrEqual(1.6);
      expect(state.aoKernelRadius).toBeLessThanOrEqual(2.3);
      expect(state.aoMaxDistance).toBeLessThanOrEqual(0.045);
    }
  });

  it('responds to severe atmosphere with quieter colour and rougher water instead of more contrast', () => {
    const clear = resolveCinematicLightPolish(lighting(0.55, 0, 0.0072));
    const storm = resolveCinematicLightPolish(lighting(0.55, 0, 0.05));

    expect(storm.saturation).toBeLessThan(clear.saturation);
    expect(storm.waterRoughnessBias).toBeGreaterThan(clear.waterRoughnessBias);
    expect(storm.cloudOpacity).toBeGreaterThan(clear.cloudOpacity);
  });

  it('keeps every final-grade control inside restrained production bounds', () => {
    for (const input of [
      lighting(0.9, 0, 0.004),
      lighting(0.05, 0.35, 0.012),
      lighting(-0.7, 1, 0.008),
      lighting(0.4, 0.05, 0.06),
    ]) {
      const state = resolveCinematicLightPolish(input);
      expect(state.shadowLift).toBeGreaterThanOrEqual(0.01);
      expect(state.shadowLift).toBeLessThan(0.075);
      expect(state.saturation).toBeGreaterThanOrEqual(0.94);
      expect(state.saturation).toBeLessThanOrEqual(1.05);
      expect(state.bloomThreshold).toBeGreaterThan(0.95);
      expect(state.cloudOpacity).toBeLessThanOrEqual(0.42);
    }
  });
});
