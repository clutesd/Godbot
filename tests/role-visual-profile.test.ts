import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ROLE_VISUAL_PROFILES, roleVisualColor, roleVisualFamilyFor } from '../src/render/people/RoleVisualProfile';
import type { PersonRole } from '../src/sim/types';

const hslFor = (color: THREE.Color) => {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return hsl;
};

const distance = (a: THREE.Color, b: THREE.Color): number => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const displayLuma = (color: THREE.Color): number => {
  const display = color.clone().convertLinearToSRGB();
  return display.r * 0.2126 + display.g * 0.7152 + display.b * 0.0722;
};

describe('occupational role visual language', () => {
  it('reduces specific jobs into stable, learnable visual families', () => {
    expect(roleVisualFamilyFor('farmer')).toBe('earth');
    expect(roleVisualFamilyFor('fisher')).toBe('water');
    expect(roleVisualFamilyFor('builder')).toBe('labor');
    expect(roleVisualFamilyFor('merchant')).toBe('trade');
    expect(roleVisualFamilyFor('soldier')).toBe('guard');
    expect(roleVisualFamilyFor('priest')).toBe('ritual');
    expect(roleVisualFamilyFor('manager')).toBe('civic');
    expect(roleVisualFamilyFor('researcher')).toBe('knowledge');
    expect(roleVisualFamilyFor('engineer')).toBe('industry');
    expect(roleVisualFamilyFor('child')).toBe('ordinary');
  });

  it('keeps every occupational family above its darkness and saturation readability floor', () => {
    const roles: PersonRole[] = [
      'farmer', 'fisher', 'builder', 'merchant', 'soldier', 'priest', 'manager', 'researcher', 'engineer', 'child',
    ];
    const darkCulture = '#11131a';
    for (const role of roles) {
      const family = roleVisualFamilyFor(role);
      const profile = ROLE_VISUAL_PROFILES[family];
      const color = roleVisualColor(role, darkCulture, { materialQuality: 0 });
      const hsl = hslFor(color);
      expect(hsl.l).toBeGreaterThanOrEqual(profile.minLightness - 0.0001);
      expect(hsl.s).toBeGreaterThanOrEqual(profile.minSaturation - 0.0001);
      // Test the perceptual display value as well as the internal linear/HSL contract. Step 1's
      // first version passed HSL tests while still looking too dark on screen.
      expect(displayLuma(color)).toBeGreaterThan(0.52);
    }
  });

  it('lets role dominate clothing while preserving a visible cultural tint', () => {
    const warmCulture = new THREE.Color('#c94f45');
    const coolCulture = new THREE.Color('#366fc2');
    const roleCue = new THREE.Color(ROLE_VISUAL_PROFILES.earth.cue);
    const warmFarmer = roleVisualColor('farmer', warmCulture);
    const coolFarmer = roleVisualColor('farmer', coolCulture);

    expect(distance(warmFarmer, roleCue)).toBeLessThan(distance(warmCulture, roleCue));
    expect(distance(coolFarmer, roleCue)).toBeLessThan(distance(coolCulture, roleCue));
    expect(distance(warmFarmer, coolFarmer)).toBeGreaterThan(0.015);
  });

  it('keeps major job families materially distinct under one culture', () => {
    const culture = '#75645a';
    const roles: PersonRole[] = ['farmer', 'fisher', 'builder', 'merchant', 'soldier', 'priest', 'manager', 'researcher'];
    const colors = roles.map(role => roleVisualColor(role, culture));

    for (let left = 0; left < colors.length; left += 1) {
      for (let right = left + 1; right < colors.length; right += 1) {
        expect(distance(colors[left]!, colors[right]!)).toBeGreaterThan(0.09);
      }
    }
  });
});
