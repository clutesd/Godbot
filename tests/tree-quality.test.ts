import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildTreeLibrary, TREE_LOD_FAR, TREE_LOD_NEAR, type TreeFamily } from '../src/render/vegetation/TreeLibrary';
import { bindTreeMaterial } from '../src/render/vegetation/TreeMaterials';
import { WeatherRenderer } from '../src/render/atmosphere/WeatherRenderer';
import { VegetationRenderer } from '../src/render/vegetation/VegetationRenderer';
import { disposeVegetation, instanceMeshes, vegetationFixture } from './fixtures/vegetation';

const families: TreeFamily[] = ['cherry', 'broadleaf', 'birch', 'dry', 'riverbank', 'ancient', 'conifer', 'alpine'];
const anchors = (geometry: THREE.BufferGeometry): Set<string> => {
  const a = geometry.getAttribute('canopyAnchor');
  return new Set(Array.from({ length: a.count }, (_, i) => [a.getX(i), a.getY(i), a.getZ(i)].join(',')));
};
function disposeLibrary(library: ReturnType<typeof buildTreeLibrary>): void {
  for (const variants of library.values()) for (const tree of variants) { tree.bark.dispose(); tree.foliage.dispose(); }
}

describe('Tree quality contracts', () => {
  it('retains exact canopy attachments across LODs, including transformed birch crowns', () => {
    for (const seed of ['attachment-windows', 'botanical-preview', 'northern-lake']) {
      const near = buildTreeLibrary(seed, 3, TREE_LOD_NEAR);
      const far = buildTreeLibrary(seed, 3, TREE_LOD_FAR);
      for (const family of families) for (let variant = 0; variant < 3; variant++) {
        const high = near.get(family)![variant]!;
        const low = far.get(family)![variant]!;
        const highAnchors = anchors(high.foliage);
        const lowAnchors = anchors(low.foliage);
        expect(lowAnchors.size).toBeGreaterThanOrEqual(10);
        for (const anchor of lowAnchors) expect(highAnchors.has(anchor), `${seed}/${family}: shifted LOD anchor`).toBe(true);
        high.foliage.computeBoundingBox(); low.foliage.computeBoundingBox();
        const highBox = high.foliage.boundingBox!; const lowBox = low.foliage.boundingBox!;
        expect(lowBox.max.y / highBox.max.y, family).toBeGreaterThan(0.83);
        expect(lowBox.max.y / highBox.max.y, family).toBeLessThan(1.12);
      }
      disposeLibrary(near); disposeLibrary(far);
    }
  });

  it('produces finite, reproducible meshes with bounded triangles for every family and tier', () => {
    for (const lod of [TREE_LOD_NEAR, TREE_LOD_FAR]) {
      const first = buildTreeLibrary('quality-repeat', 3, lod);
      const replay = buildTreeLibrary('quality-repeat', 3, lod);
      for (const family of families) for (let variant = 0; variant < 3; variant++) {
        const a = first.get(family)![variant]!; const b = replay.get(family)![variant]!;
        const triangles = (a.bark.index!.count + a.foliage.index!.count) / 3;
        expect(triangles, family).toBeLessThanOrEqual(lod === TREE_LOD_NEAR ? 790 : 284);
        for (const kind of ['bark', 'foliage'] as const) {
          expect(a[kind].index!.array).toEqual(b[kind].index!.array);
          for (const name of Object.keys(a[kind].attributes)) {
            const values = a[kind].getAttribute(name).array;
            expect(values).toEqual(b[kind].getAttribute(name).array);
            expect(Array.from(values).every(Number.isFinite), `${family}/${kind}/${name}`).toBe(true);
          }
          const p = a[kind].getAttribute('position');
          const indices = a[kind].index!;
          const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
          for (let index = 0; index < indices.count; index += 3) {
            points.forEach((v, i) => v.fromBufferAttribute(p, indices.getX(index + i)));
            const area = points[1]!.sub(points[0]!).cross(points[2]!.sub(points[0]!)).lengthSq();
            expect(area, `${family}/${kind}: degenerate triangle`).toBeGreaterThan(1e-16);
          }
        }
      }
      disposeLibrary(first); disposeLibrary(replay);
    }
  });

  it('keeps foliage attached through seasons and fully clears winter deciduous foliage', () => {
    const { world, surface, camera } = vegetationFixture();
    const plants = new VegetationRenderer(world, surface, 'season-attachment', 900);
    plants.setSeason(5); plants.updateLod(camera);
    const trees = instanceMeshes(plants.group).filter(m => m.name === 'weather-foliage' && m.count > 0);
    expect(trees.length).toBeGreaterThan(0);
    const summer = trees.map(mesh => ({ mesh, matrices: mesh.instanceMatrix.array.slice(0, mesh.count * 16),
      state: mesh.geometry.getAttribute('treeState').array.slice(0, mesh.count * 4) }));
    for (const cell of world.weather!.cells) cell.temperature = 0.2;
    plants.setSeason(11); plants.updateLod(camera);
    let bare = 0; let evergreen = 0;
    for (const { mesh, matrices, state } of summer) {
      expect(mesh.instanceMatrix.array.slice(0, mesh.count * 16)).toEqual(matrices);
      const winter = mesh.geometry.getAttribute('treeState');
      for (let i = 0; i < mesh.count; i++) {
        if (winter.getX(i) === 0 && state[i * 4]! > 0) bare++;
        if (winter.getX(i) > 0.5) evergreen++;
      }
    }
    expect(bare).toBeGreaterThan(0);
    expect(evergreen).toBeGreaterThan(0);
    disposeVegetation(plants.group);
  });

  it('composes foliage growth with weather and uses matching colour and shadow deformations', () => {
    const { world, surface } = vegetationFixture();
    const source = buildTreeLibrary('material-contract', 1, TREE_LOD_NEAR);
    const weather = new WeatherRenderer(world, surface, 'material-contract');
    for (const kind of ['bark', 'foliage'] as const) {
      const tree = source.get('birch')![0]!;
      const mesh = new THREE.InstancedMesh(tree[kind], new THREE.MeshStandardMaterial({ vertexColors: true }), 1);
      const state = bindTreeMaterial(mesh, kind, 'birch', tree.height);
      state.setXYZW(0, 0.7, 1, 0.5, 0);
      if (kind === 'foliage') mesh.name = 'weather-foliage';
      const scene = new THREE.Scene(); scene.add(mesh); weather.bindScene(scene);
      const materials = [mesh.material, mesh.customDepthMaterial!, mesh.customDistanceMaterial!] as THREE.Material[];
      const compiled = materials.map(material => {
        const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
          fragmentShader: THREE.ShaderLib.standard.fragmentShader };
        material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
        return shader;
      });
      for (const shader of compiled) {
        if (kind === 'foliage') {
          expect(shader.vertexShader).toContain('transformed += (canopyAnchor - position)');
          expect(shader.fragmentShader).toContain('treeCondition.x < 0.001');
        } else {
          expect(shader.fragmentShader).toContain('treeLocal.y > fractureY');
        }
      }
      if (kind === 'foliage') {
        expect(compiled[0]!.vertexShader).toContain('weatherSample');
        expect(compiled[0]!.fragmentShader).toContain('snowCover');
      }
      let disposed = 0;
      mesh.customDepthMaterial!.addEventListener('dispose', () => disposed++);
      mesh.customDistanceMaterial!.addEventListener('dispose', () => disposed++);
      (mesh.material as THREE.Material).dispose();
      expect(disposed).toBe(2);
      mesh.dispose();
    }
    weather.dispose(); disposeLibrary(source);
  });
});
