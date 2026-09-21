import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { COSMIC_ROLES, COSMIC_FAMILIES, CosmicRoleAccents, bindCosmicVariation, cosmicAppearanceFor, cosmicRoleFor, createCosmicBodyGeometry, createCosmicBodyMaterial, updateCosmicBodyMaterial } from '../src/render/people/CosmicPeople';
import { ROLE_FAMILIES, roleVisualFamilyFor } from '../src/render/people/RoleVisualProfile';

describe('cosmic people presentation', () => {
  it('covers every existing role with a distinguishable family symbol and safe fallback', () => {
    expect(Object.keys(ROLE_FAMILIES)).toHaveLength(34);
    for (const role of Object.keys(ROLE_FAMILIES)) expect(COSMIC_ROLES[roleVisualFamilyFor(role)]).toBeDefined();
    expect(new Set(Object.values(COSMIC_ROLES).map(style => style.symbol)).size).toBe(COSMIC_FAMILIES.length);
    for (const role of [undefined, '', 'future-role', '__proto__', 'constructor']) expect(cosmicRoleFor(role)).toBe(COSMIC_ROLES.ordinary);
    expect(roleVisualFamilyFor('healer')).toBe('healing');
    expect(roleVisualFamilyFor('elder')).toBe('elder');
  });

  it('keeps identity stable through reload/order/role changes and proportions tightly bounded', () => {
    const appearances = Array.from({ length: 1000 }, (_, i) => cosmicAppearanceFor(`person-${i}`));
    expect(new Set(appearances.map(a => a.seed)).size).toBe(1000);
    for (let i = 999; i >= 0; i--) {
      const a = cosmicAppearanceFor(`person-${i}`);
      expect(a).toEqual(appearances[i]);
      expect(a.height).toBeGreaterThanOrEqual(0.975);
      expect(a.height).toBeLessThanOrEqual(1.025);
      expect(a.build).toBeGreaterThanOrEqual(0.96);
      expect(a.build).toBeLessThanOrEqual(1.04);
      expect(a.brightness).toBeLessThanOrEqual(1);
    }
  });

  it('uses one bounded accent batch across roles, follows the torso matrix, and excludes decoration from picking', () => {
    const batch = new CosmicRoleAccents(384);
    const matrix = new THREE.Matrix4().makeRotationX(0.7).setPosition(3, 2, 1);
    batch.set(0, 'builder', matrix, 0.9);
    batch.set(1, 'healer', matrix, 1);
    const actual = new THREE.Matrix4(); batch.mesh.getMatrixAt(0, actual);
    actual.elements.forEach((value, i) => expect(value).toBeCloseTo(matrix.elements[i]!, 6));
    expect(batch.mesh.geometry.getAttribute('cosmicStyle').count).toBe(384);
    expect(batch.mesh.geometry.index!.count / 3).toBeLessThan(160);
    expect(batch.material.transparent).toBe(false);
    expect(batch.material.depthTest).toBe(true);
    expect(batch.material.vertexColors).toBe(false);
    const hits: THREE.Intersection[] = []; batch.mesh.raycast(new THREE.Raycaster(), hits); expect(hits).toEqual([]);
    batch.updateDaylight(0); expect(batch.material.color.r).toBeCloseTo(0.58);
    batch.updateDaylight(1); expect(batch.material.color.r).toBeCloseTo(0.88);
    batch.mesh.dispose(); batch.mesh.geometry.dispose(); batch.material.dispose();
  });

  it('shares opaque body materials and bounded per-instance seeds with no per-person textures', () => {
    const material = createCosmicBodyMaterial();
    const mesh = new THREE.InstancedMesh(createCosmicBodyGeometry(), material, 384);
    const variation = bindCosmicVariation(mesh);
    expect(variation.count).toBe(384);
    expect(mesh.geometry.index!.count / 3).toBeLessThan(100);
    expect(material.map).toBeNull();
    expect(material.emissiveMap).toBeNull();
    expect(material.transparent).toBe(false);
    updateCosmicBodyMaterial(material, -1); expect(material.userData['daylight'].value).toBe(0);
    updateCosmicBodyMaterial(material, 5); expect(material.userData['daylight'].value).toBe(1);
    mesh.dispose(); mesh.geometry.dispose(); material.dispose();
  });
});
