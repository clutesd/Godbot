import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { resolveEnvironmentFrame } from '../src/render/atmosphere/EnvironmentFrameState';

const base = {
  sourceFogColor: new THREE.Color('#93a5a4'),
  sourceBackground: new THREE.Color('#899b91'),
};

describe('authoritative environment frame', () => {
  it('preserves the coherent daylight rig when no external event is authored', () => {
    const frame = resolveEnvironmentFrame({
      sunElevation: 0.82,
      night: 0,
      fogDensity: 0.0072,
      sourceExposure: 1.12,
      ...base,
    });

    expect(frame.eventDimmer).toBe(0);
    expect(frame.exposure).toBeGreaterThanOrEqual(0.98);
    expect(frame.sunIntensity).toBeGreaterThan(frame.hemisphereIntensity * 3);
    expect(frame.atmosphericObscuration).toBeLessThan(0.1);
  });

  it('carries catastrophe-style authored exposure into the final frame instead of clobbering it', () => {
    const normal = resolveEnvironmentFrame({
      sunElevation: 0.45,
      night: 0,
      fogDensity: 0.0072,
      sourceExposure: 1.12,
      ...base,
    });
    const event = resolveEnvironmentFrame({
      sunElevation: 0.45,
      night: 0,
      fogDensity: 0.024,
      sourceExposure: 0.86,
      sourceFogColor: new THREE.Color('#403f43'),
      sourceBackground: base.sourceBackground,
    });

    expect(event.eventDimmer).toBeGreaterThan(0.2);
    expect(event.exposure).toBeLessThan(normal.exposure);
    expect(event.sunIntensity).toBeLessThan(normal.sunIntensity);
    expect(event.atmosphericObscuration).toBeGreaterThan(normal.atmosphericObscuration);
  });

  it('does not mistake ordinary preview exposure for a catastrophe without confirming fog', () => {
    const preview = resolveEnvironmentFrame({
      sunElevation: 0.6,
      night: 0,
      fogDensity: 0.0072,
      sourceExposure: 1,
      ...base,
    });

    expect(preview.eventDimmer).toBe(0);
    expect(preview.exposure).toBeGreaterThanOrEqual(0.98);
  });

  it('does not mistake severe weather fog for catastrophe when authored exposure stays neutral', () => {
    const storm = resolveEnvironmentFrame({
      sunElevation: 0.55,
      night: 0,
      fogDensity: 0.05,
      sourceExposure: 1.12,
      sourceFogColor: new THREE.Color('#87949a'),
      sourceBackground: base.sourceBackground,
    });

    expect(storm.eventDimmer).toBe(0);
    expect(storm.weatherSoftening).toBeGreaterThan(0.9);
    expect(storm.atmosphericObscuration).toBeGreaterThan(0.9);
  });

  it('keeps final renderer controls bounded even in extreme conditions', () => {
    const frame = resolveEnvironmentFrame({
      sunElevation: 0.05,
      night: 0.3,
      fogDensity: 0.07,
      sourceExposure: 0.72,
      sourceFogColor: new THREE.Color('#2f3136'),
      sourceBackground: new THREE.Color('#3c3540'),
    });

    expect(frame.exposure).toBeGreaterThanOrEqual(0.7);
    expect(frame.exposure).toBeLessThanOrEqual(1.1);
    expect(frame.atmosphericObscuration).toBeGreaterThanOrEqual(0);
    expect(frame.atmosphericObscuration).toBeLessThanOrEqual(1);
    expect(frame.sunIntensity).toBeGreaterThanOrEqual(0);
  });
});
