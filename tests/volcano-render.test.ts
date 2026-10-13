import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { VolcanoRenderer } from '../src/render/geology/VolcanoRenderer';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';

describe('Volcano presentation', () => {
  it('keeps simulation state unchanged across phase changes and uses finite terrain geometry', () => {
    const { state } = new Simulation({ seed: 'volcano-cone', world: { size: 24 }, startingPopulation: 20, settlementCount: [2, 2] });
    const presentation = new VolcanoRenderer(state, new TerrainSurface(state.world));
    const camera = new THREE.PerspectiveCamera();
    const parent = new THREE.Group(); parent.rotation.y = 0.7; parent.add(camera); parent.updateMatrixWorld(true);
    for (const phase of ['dormant', 'unrest', 'erupting', 'cooling'] as const) {
      state.volcano!.phase = phase;
      state.volcano!.activity = phase === 'erupting' ? 1 : 0.16;
      const before = structuredClone(state);
      for (let frame = 0; frame < 60; frame++) presentation.update(1 / 60, frame / 60, camera);
      expect(state).toEqual(before);
      expect(presentation.group.visible).toBe(true);
      presentation.group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        expect(Array.from(object.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
        if (object instanceof THREE.InstancedMesh) {
          expect(Array.from(object.instanceMatrix.array).every(Number.isFinite)).toBe(true);
          expect(object.count).toBeLessThanOrEqual(object.instanceMatrix.count);
        }
      });
    }
    presentation.dispose();
  });

  it('releases all shared materials and geometries exactly once on teardown', () => {
    const { state } = new Simulation({ seed: 'volcano-cone', world: { size: 24 }, startingPopulation: 20, settlementCount: [2, 2] });
    const presentation = new VolcanoRenderer(state, new TerrainSurface(state.world));
    const resources = new Set<THREE.Material | THREE.BufferGeometry>();
    presentation.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material);
    });
    const spies = [...resources].map(resource => vi.spyOn(resource, 'dispose'));
    presentation.dispose();
    expect(presentation.group.children).toHaveLength(0);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
