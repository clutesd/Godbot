import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CarriedMaterialRenderer, carriedGeometry, carriedShape } from '../src/render/people/CarriedMaterialRenderer';
import { ResourceWorkerRenderer } from '../src/render/resources/ResourceWorkerRenderer';
import { createResourceWorkMotion } from '../src/render/animation/ResourceWorkMotion';

describe('carried material presentation', () => {
  it('distinguishes raw materials, containers and finished goods', () => {
    expect(['timber', 'iron-ore', 'metal', 'ceramic', 'crop', 'earth', 'basket', 'ledger'].map(carriedShape))
      .toEqual(['timber', 'masonry', 'metal', 'ceramic', 'crop', 'bag', 'basket', 'ledger']);
    for (const kind of ['timber', 'masonry', 'metal', 'ceramic', 'crop', 'bag', 'basket', 'ledger'] as const) {
      const geometry = carriedGeometry(kind);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.isEmpty()).toBe(false);
      expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
      expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      geometry.dispose();
    }
  });
  it('clears previous cargo and bounds the instance pools', () => {
    const renderer = new CarriedMaterialRenderer(1);
    renderer.beginFrame();
    renderer.draw('timber', 1, 2, 3, 1, 0);
    renderer.draw('timber', 4, 5, 6, 1, 0);
    renderer.endFrame();
    const logs = renderer.group.children.find(c => c.name === 'Carried timber') as THREE.InstancedMesh;
    expect(logs.count).toBe(1);
    renderer.beginFrame(); renderer.endFrame(); expect(logs.count).toBe(0);
  });
  it('keeps an acquired load visible during articulation blends and removes it on release', () => {
    const renderer = new ResourceWorkerRenderer();
    const motion = createResourceWorkMotion();
    const draw = (load?: string) => renderer.drawPhysical(motion, { x: 0, z: 0 }, 'none', load, '#ffffff', 0.4, 0, 0, 0, 1, 0, new THREE.Color());
    renderer.beginFrame(); draw('timber'); renderer.endFrame();
    const logs = renderer.group.getObjectByName('Carried timber') as THREE.InstancedMesh;
    expect(logs.count).toBe(1);
    const matrix = new THREE.Matrix4(); logs.getMatrixAt(0, matrix); expect(matrix.determinant()).toBeGreaterThan(0);
    renderer.beginFrame(); draw(); renderer.endFrame(); expect(logs.count).toBe(0);
  });
});
