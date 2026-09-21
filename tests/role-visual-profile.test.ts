import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cosmicRoleFor, COSMIC_ROLES } from '../src/render/people/CosmicPeople';
import { roleVisualFamilyFor } from '../src/render/people/RoleVisualProfile';

describe('occupational role visual language', () => {
  it('keeps specific jobs in learnable families, separating healing from scholarship', () => {
    for (const [role, family] of Object.entries({ farmer: 'earth', fisher: 'water', builder: 'labor', merchant: 'trade', soldier: 'guard', priest: 'ritual', manager: 'civic', researcher: 'knowledge', engineer: 'industry', child: 'ordinary', elder: 'elder', healer: 'healing' })) {
      expect(roleVisualFamilyFor(role)).toBe(family);
    }
  });

  it('keeps the major family accents distinct in display space without HDR colours', () => {
    const colors = Object.values(COSMIC_ROLES).map(style => new THREE.Color(style.color).convertLinearToSRGB());
    for (let a = 0; a < colors.length; a++) {
      const color = colors[a]!;
      expect(Math.max(color.r, color.g, color.b)).toBeLessThanOrEqual(1);
      expect(color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722).toBeGreaterThan(0.48);
      for (let b = a + 1; b < colors.length; b++) {
        const other = colors[b]!;
        expect(Math.hypot(color.r - other.r, color.g - other.g, color.b - other.b)).toBeGreaterThan(0.1);
      }
    }
  });

  it('combines redundant shape and silhouette cues with hue', () => {
    expect(cosmicRoleFor('builder').symbol).toBe('diamond');
    expect(cosmicRoleFor('farmer').symbol).toBe('seed');
    expect(cosmicRoleFor('guard').shoulders).toBeGreaterThan(cosmicRoleFor('farmer').shoulders);
    expect(cosmicRoleFor('scholar').mantle).toBe(1);
    expect(cosmicRoleFor('elder').halo).toBe(1);
    expect(cosmicRoleFor('child').halo).toBe(0);
  });
});
