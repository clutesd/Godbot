import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { resolveAtmosphericScattering } from '../src/render/atmosphere/AtmosphericScattering';
import { resolveEnvironmentFrame } from '../src/render/atmosphere/EnvironmentFrameState';

const frame = (sunElevation: number, night: number, fogDensity = 0.0072, sourceExposure = 1.12) =>
  resolveEnvironmentFrame({
    sunElevation,
    sunDirection: new THREE.Vector3(0.55, sunElevation, 0.42).normalize(),
    night,
    fogDensity,
    sourceExposure,
    sourceFogColor: new THREE.Color('#93a5a4'),
    sourceBackground: new THREE.Color('#899b91'),
  });

describe('directional atmospheric scattering', () => {
  it('gives low sun materially stronger forward scattering than midday', () => {
    const golden = resolveAtmosphericScattering(frame(0.08, 0.12));
    const midday = resolveAtmosphericScattering(frame(0.82, 0));

    expect(golden.mieStrength).toBeGreaterThan(midday.mieStrength);
    expect(golden.sunHaloStrength).toBeGreaterThan(midday.sunHaloStrength);
    expect(golden.horizonStrength).toBeGreaterThan(midday.horizonStrength);
  });

  it('keeps a visible but restrained solar disc in clear daylight', () => {
    const clear = resolveAtmosphericScattering(frame(0.55, 0));

    expect(clear.sunDiskStrength).toBeGreaterThan(0.8);
    expect(clear.sunDiskStrength).toBeLessThanOrEqual(1);
    expect(clear.mieG).toBeGreaterThanOrEqual(0.7);
    expect(clear.mieG).toBeLessThanOrEqual(0.84);
  });

  it('suppresses the solar disc and forward scattering under dense weather', () => {
    const clear = resolveAtmosphericScattering(frame(0.45, 0, 0.0072));
    const storm = resolveAtmosphericScattering(frame(0.45, 0, 0.05));

    expect(storm.obscuration).toBeGreaterThan(0.9);
    expect(storm.sunDiskStrength).toBeLessThan(clear.sunDiskStrength);
    expect(storm.mieStrength).toBeLessThan(clear.mieStrength);
  });

  it('removes direct solar presentation at night while preserving a bounded atmosphere', () => {
    const night = resolveAtmosphericScattering(frame(-0.65, 1));

    expect(night.sunDiskStrength).toBe(0);
    expect(night.nightBlend).toBeGreaterThan(0.95);
    expect(night.rayleighStrength).toBeGreaterThanOrEqual(0.18);
    expect(night.rayleighStrength).toBeLessThanOrEqual(0.72);
  });

  it('normalizes the authoritative sun direction in the final environment frame', () => {
    const resolved = resolveEnvironmentFrame({
      sunElevation: 0.4,
      sunDirection: new THREE.Vector3(9, 6, -3),
      night: 0,
      fogDensity: 0.0072,
      sourceExposure: 1.12,
      sourceFogColor: new THREE.Color('#93a5a4'),
      sourceBackground: new THREE.Color('#899b91'),
    });

    expect(resolved.sunDirection.length()).toBeCloseTo(1, 6);
    expect(resolved.sunDirection.x).toBeGreaterThan(0);
    expect(resolved.sunDirection.z).toBeLessThan(0);
  });
});
