import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ROLE_GARMENT_DAY_BRIGHTNESS,
  ROLE_GARMENT_NIGHT_BRIGHTNESS,
  createRoleGarmentMaterial,
  roleGarmentBrightnessForDaylight,
  updateRoleGarmentMaterial,
} from '../src/render/people/RoleGarmentPresentation';

describe('role garment presentation', () => {
  it('uses an unlit, tone-mapped, fog-aware material so role colour survives character shading', () => {
    const material = createRoleGarmentMaterial();
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(material.vertexColors).toBe(true);
    expect(material.toneMapped).toBe(true);
    expect(material.fog).toBe(true);
    expect(material.transparent).toBe(false);
    expect(material.userData['roleReadable']).toBe(true);
  });

  it('stays vivid in daylight without becoming a night-time UI glow', () => {
    const night = roleGarmentBrightnessForDaylight(0);
    const twilight = roleGarmentBrightnessForDaylight(0.25);
    const day = roleGarmentBrightnessForDaylight(1);

    expect(night).toBeCloseTo(ROLE_GARMENT_NIGHT_BRIGHTNESS, 6);
    expect(day).toBeCloseTo(ROLE_GARMENT_DAY_BRIGHTNESS, 6);
    expect(twilight).toBeGreaterThan(night);
    expect(twilight).toBeLessThan(day);
    expect(night).toBeLessThan(0.1);
    expect(day).toBeGreaterThan(0.75);
  });

  it('updates one shared material instead of changing every person's instance colour each frame', () => {
    const material = createRoleGarmentMaterial();
    updateRoleGarmentMaterial(material, 0);
    expect(material.color.r).toBeCloseTo(ROLE_GARMENT_NIGHT_BRIGHTNESS, 6);
    updateRoleGarmentMaterial(material, 1);
    expect(material.color.r).toBeCloseTo(ROLE_GARMENT_DAY_BRIGHTNESS, 6);
  });
});
