import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { COSMIC_ROLES, COSMIC_FAMILIES, CosmicRoleAccents, bindCosmicVariation, cosmicAppearanceFor, cosmicRoleFor, createCosmicBodyGeometry, createCosmicHeadGeometry, createCosmicArmGeometry, createCosmicLegGeometry, createCosmicWorkLimbGeometry, COSMIC_CROWN_HEIGHT, createCosmicBodyMaterial, updateCosmicBodyMaterial } from '../src/render/people/CosmicPeople';
import { ROLE_FAMILIES, roleVisualFamilyFor } from '../src/render/people/RoleVisualProfile';
import { ResourceWorkerRenderer } from '../src/render/resources/ResourceWorkerRenderer';
import { createResourceWorkMotion } from '../src/render/animation/ResourceWorkMotion';

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
    expect(batch.mesh.geometry.index!.count / 3).toBeLessThan(1100);
    expect(batch.material.transparent).toBe(false);
    expect(batch.material.depthTest).toBe(true);
    expect(batch.material.vertexColors).toBe(false);
    const hits: THREE.Intersection[] = []; batch.mesh.raycast(new THREE.Raycaster(), hits); expect(hits).toEqual([]);
    batch.updateDaylight(0);
    expect(batch.material.userData['daylight'].value).toBe(0);
    expect(batch.material.color.r).toBeCloseTo(1);
    batch.updateDaylight(1);
    expect(batch.material.userData['daylight'].value).toBe(1);
    expect(batch.material.color.r).toBeCloseTo(1);
    batch.mesh.dispose(); batch.mesh.geometry.dispose(); batch.material.dispose();
  });

  it('keeps the sculpted body watertight, finite and bounded for population instancing', () => {
    const body = createCosmicBodyGeometry(), head = createCosmicHeadGeometry();
    const arm = createCosmicArmGeometry(), leg = createCosmicLegGeometry(), work = createCosmicWorkLimbGeometry();
    for (const geometry of [body, head, arm, leg, work]) {
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      expect(Number.isFinite(geometry.boundingSphere!.radius)).toBe(true);
      for (const attribute of ['position', 'normal']) {
        expect(Array.from(geometry.getAttribute(attribute).array).every(Number.isFinite)).toBe(true);
      }
      // Each indexed edge is shared by two triangles, including the closed end caps.
      const edges = new Map<string, number>();
      const index = geometry.index!;
      for (let i = 0; i < index.count; i += 3) for (let j = 0; j < 3; j++) {
        const a = index.getX(i + j), b = index.getX(i + (j + 1) % 3);
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
      expect([...edges.values()].every(count => count === 2)).toBe(true);
    }
    // Presentation anchors are still in adult crown/foot space; no simulation scale change.
    expect(0.44 + 0.425 + head.boundingBox!.max.y).toBeCloseTo(COSMIC_CROWN_HEIGHT, 5);
    expect(0.45 + leg.boundingBox!.min.y).toBeCloseTo(0, 5);
    expect(body.boundingBox!.max.y).toBeGreaterThan(0.425 + head.boundingBox!.min.y);
    expect(head.boundingBox!.max.y - head.boundingBox!.min.y).toBeGreaterThan(head.boundingBox!.max.x * 2);
    expect(new Set(Array.from(head.getAttribute('cosmicSurface').array))).toEqual(new Set([1]));
    const triangles = (body.index!.count + head.index!.count + 2 * arm.index!.count + 2 * leg.index!.count) / 3;
    expect(triangles).toBeLessThan(4000);
    for (const geometry of [body, head, arm, leg, work]) geometry.dispose();
  });

  it('shares opaque body materials and bounded per-instance seeds with no per-person textures', () => {
    const material = createCosmicBodyMaterial();
    const mesh = new THREE.InstancedMesh(createCosmicBodyGeometry(), material, 384);
    const variation = bindCosmicVariation(mesh);
    expect(variation.count).toBe(384);
    expect(mesh.geometry.index!.count / 3).toBeLessThan(800);
    expect(material.map).toBeNull();
    expect(material.emissiveMap).toBeNull();
    expect(material.transparent).toBe(false);
    expect(material.roughness).toBeCloseTo(0.26);
    expect(material.metalness).toBeCloseTo(0.12);
    updateCosmicBodyMaterial(material, -1); expect(material.userData['daylight'].value).toBe(0);
    updateCosmicBodyMaterial(material, 5); expect(material.userData['daylight'].value).toBe(1);
    mesh.dispose(); mesh.geometry.dispose(); material.dispose();
  });

  it('attaches work shoulders to the posed torso and keeps soles in the existing limb batch', () => {
    const rig = new ResourceWorkerRenderer();
    const limbs = rig.group.getObjectByName('Resource worker joints') as THREE.InstancedMesh;
    const body = new THREE.Object3D();
    const motion = createResourceWorkMotion();
    motion.handY = 0.45; motion.handZ = 0.23; motion.toolAngle = 1.9;
    const matrix = new THREE.Matrix4();
    for (const lean of [-0.1, 0.26, 0.5]) {
      body.position.set(3, 2.44, 1); body.rotation.set(lean, 0.6, 0); body.scale.set(0.96, 1, 0.96); body.updateMatrix();
      rig.beginFrame(); rig.setBodyTransform(body.matrix);
      rig.drawPhysical(motion, { x: 3, z: 1.2 }, 'pick', undefined, '#999999', 1, 3, 2, 1, 1, 0.4, new THREE.Color('white'), false, false);
      rig.endFrame();
      expect(limbs.count).toBe(10);
      for (let side = 0; side < 2; side++) {
        limbs.getMatrixAt(side * 2, matrix);
        const shoulder = new THREE.Vector3(0, -0.5, 0).applyMatrix4(matrix);
        const expected = new THREE.Vector3((side ? 1 : -1) * 0.12, 0.27, 0).applyMatrix4(body.matrix);
        expect(shoulder.distanceTo(expected)).toBeLessThan(0.000001);
        limbs.getMatrixAt(8 + side, matrix);
        expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeCloseTo(2.019, 5);
      }
    }
    rig.group.traverse(object => {
      if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); }
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
  });
});
