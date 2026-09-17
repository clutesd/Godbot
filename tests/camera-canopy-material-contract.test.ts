import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildTreeLibrary, TREE_LOD_NEAR } from '../src/render/vegetation/TreeLibrary';
import { bindTreeMaterial, setTreeCanopyDissolveStrength } from '../src/render/vegetation/TreeMaterials';

function compileSource(material: THREE.Material, shaderName: 'standard' | 'depth' | 'distance'): string {
  const source = THREE.ShaderLib[shaderName];
  const shader = {
    uniforms: {},
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  };
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader.fragmentShader;
}

describe('camera canopy material contract', () => {
  it('dissolves only visible foliage while bark and shadow passes remain physical', () => {
    const tree = buildTreeLibrary('camera-canopy-contract', 1, TREE_LOD_NEAR).get('broadleaf')![0]!;

    const foliage = new THREE.InstancedMesh(tree.foliage, new THREE.MeshStandardMaterial({ vertexColors: true }), 1);
    bindTreeMaterial(foliage, 'foliage', 'broadleaf', tree.height);
    const foliageColour = compileSource(foliage.material as THREE.Material, 'standard');
    const foliageDepth = compileSource(foliage.customDepthMaterial!, 'depth');
    const foliageDistance = compileSource(foliage.customDistanceMaterial!, 'distance');

    expect(foliageColour).toContain('canopyViewDistance');
    expect(foliageColour).toContain('canopyDither');
    expect(foliageColour).toContain('cameraCanopyDissolveStrength');
    const dissolveUniform = (foliage.material as THREE.Material).userData['cameraCanopyDissolveUniform'] as { value: number };
    expect(dissolveUniform.value).toBe(0);
    setTreeCanopyDissolveStrength(foliage, 0.63);
    expect(dissolveUniform.value).toBeCloseTo(0.63);
    expect(foliageDepth).not.toContain('canopyViewDistance');
    expect(foliageDistance).not.toContain('canopyViewDistance');

    const bark = new THREE.InstancedMesh(tree.bark, new THREE.MeshStandardMaterial({ vertexColors: true }), 1);
    bindTreeMaterial(bark, 'bark', 'broadleaf', tree.height);
    expect(compileSource(bark.material as THREE.Material, 'standard')).not.toContain('canopyViewDistance');

    foliage.geometry.dispose();
    (foliage.material as THREE.Material).dispose();
    bark.geometry.dispose();
    (bark.material as THREE.Material).dispose();
  });
});
