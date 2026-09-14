import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { integratedHeightDensity } from '../src/render/atmosphere/AerialPerspective';
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
  it('gives low sun materially stronger forward scattering and warm horizon than midday', () => {
    const golden = resolveAtmosphericScattering(frame(0.08, 0.12));
    const midday = resolveAtmosphericScattering(frame(0.82, 0));

    expect(golden.mieStrength).toBeGreaterThan(midday.mieStrength);
    expect(golden.sunHaloStrength).toBeGreaterThan(midday.sunHaloStrength);
    expect(golden.horizonStrength).toBeGreaterThan(midday.horizonStrength);
    expect(golden.warmHorizonStrength).toBeGreaterThan(midday.warmHorizonStrength);
    expect(golden.aerialForwardScatter).toBeGreaterThan(midday.aerialForwardScatter);
  });

  it('keeps a visible but restrained solar disc in clear daylight', () => {
    const clear = resolveAtmosphericScattering(frame(0.55, 0));

    expect(clear.sunDiskStrength).toBeGreaterThan(0.8);
    expect(clear.sunDiskStrength).toBeLessThanOrEqual(1);
    expect(clear.mieG).toBeGreaterThanOrEqual(0.71);
    expect(clear.mieG).toBeLessThanOrEqual(0.815);
  });

  it('adds meaningful aerial perspective beyond a larger crisp foreground envelope', () => {
    const clear = resolveAtmosphericScattering(frame(0.55, 0));

    expect(clear.aerialDensity).toBeGreaterThan(0.004);
    expect(clear.aerialDensity).toBeLessThan(0.008);
    expect(clear.aerialStrength).toBeGreaterThan(0.45);
    expect(clear.aerialStrength).toBeLessThanOrEqual(0.62);
    expect(clear.aerialStartDistance).toBeGreaterThanOrEqual(20);
    expect(clear.aerialStartDistance).toBeLessThanOrEqual(24);
  });

  it('integrates height so elevated cameras traverse much less dense air than low cameras', () => {
    const lowCameraToValley = integratedHeightDensity(15, 0);
    const highCameraToValley = integratedHeightDensity(80, 0);
    const highCameraToRidge = integratedHeightDensity(80, 50);

    expect(lowCameraToValley).toBeGreaterThan(0.65);
    expect(highCameraToValley).toBeLessThan(0.35);
    expect(highCameraToValley).toBeLessThan(lowCameraToValley * 0.5);
    expect(highCameraToRidge).toBeLessThan(highCameraToValley * 0.35);
  });

  it('suppresses direct solar structure while deepening and advancing atmosphere under dense weather', () => {
    const clear = resolveAtmosphericScattering(frame(0.45, 0, 0.0072));
    const storm = resolveAtmosphericScattering(frame(0.45, 0, 0.05));

    expect(storm.obscuration).toBeGreaterThan(0.9);
    expect(storm.sunDiskStrength).toBeLessThan(clear.sunDiskStrength);
    expect(storm.mieStrength).toBeLessThan(clear.mieStrength);
    expect(storm.aerialDensity).toBeGreaterThan(clear.aerialDensity);
    expect(storm.aerialStartDistance).toBeLessThan(clear.aerialStartDistance);
    expect(storm.aerialForwardScatter).toBeLessThan(clear.aerialForwardScatter);
  });

  it('removes direct solar presentation at night while preserving bounded cool aerial depth', () => {
    const night = resolveAtmosphericScattering(frame(-0.65, 1));

    expect(night.sunDiskStrength).toBe(0);
    expect(night.nightBlend).toBeGreaterThan(0.95);
    expect(night.rayleighStrength).toBeGreaterThanOrEqual(0.045);
    expect(night.rayleighStrength).toBeLessThan(0.12);
    expect(night.aerialStrength).toBeGreaterThanOrEqual(0.16);
    expect(night.aerialStrength).toBeLessThan(0.3);
    expect(night.aerialStartDistance).toBeGreaterThanOrEqual(26);
    expect(night.aerialStartDistance).toBeLessThanOrEqual(28);
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
