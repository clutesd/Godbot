import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VegetationRenderer } from '../src/render/vegetation/VegetationRenderer';
import { vegetationFixture, disposeVegetation, instanceMeshes } from './fixtures/vegetation';

describe('camera-soft vegetation', () => {
  it('updates only colour-pass corridor uniforms, preserving instances, shadows and ecology', () => {
    const { world, surface, camera } = vegetationFixture();
    const renderer = new VegetationRenderer(world, surface, 'soft-camera', 120);
    renderer.updateLod(camera);
    const meshes = instanceMeshes(renderer.group).filter(mesh =>
      (mesh.material as THREE.Material).userData['cameraSoftDistance']);
    expect(meshes.length).toBeGreaterThan(0);
    const before = JSON.stringify(world);
    const matrices = meshes.map(mesh => Array.from(mesh.instanceMatrix.array));
    const target = new THREE.Vector3(0, 0.3, 0);
    renderer.softenCameraCorridor(camera, target);
    for (const [index, mesh] of meshes.entries()) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.userData['cameraSoftDistance'].value).toBeCloseTo(camera.distanceTo(target));
      expect(Array.from(mesh.instanceMatrix.array)).toEqual(matrices[index]);
      const compile = (m: THREE.Material, shaderId: 'standard' | 'depth') => {
        const source = THREE.ShaderLib[shaderId];
        const shader = { uniforms: {}, vertexShader: source.vertexShader, fragmentShader: source.fragmentShader };
        m.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
        return shader;
      };
      expect(compile(material, 'standard').uniforms).toHaveProperty('cameraSoftDistance');
      expect(compile(mesh.customDepthMaterial!, 'depth').fragmentShader).not.toContain('cameraSoftDistance');
    }
    expect(JSON.stringify(world)).toBe(before);
    renderer.softenCameraCorridor(camera, camera);
    expect((meshes[0]!.material as THREE.Material).userData['cameraSoftDistance'].value).toBe(0);
    disposeVegetation(renderer.group);
  });
});
