/** Offline QA of actual vegetation geometry and instance colors; no browser or simulation writes. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import * as THREE from 'three';
import { buildTreeLibrary, TREE_LOD_NEAR, TREE_LOD_FAR, type TreeFamily } from '../src/render/vegetation/TreeLibrary';
import { resolveTreePhenology, treeFoliageColour } from '../src/render/vegetation/TreePhenology';



interface Triangle { xy: number[]; z: number; color: string }
const panels: { title: string; description: string; triangles: Triangle[] }[] = [];
const light = new THREE.Vector3(-0.4, 1, 0.65).normalize();

function project(group: THREE.Group, camera: THREE.Camera): Triangle[] {
  camera.updateMatrixWorld(); group.updateMatrixWorld(true);
  const triangles: Triangle[] = [];
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    const attribute = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color');
    const normals = geometry.getAttribute('normal');
    const material = object.material as THREE.MeshStandardMaterial;
    const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
    for (let instance = 0; instance < instances; instance++) {
      const transform = object.matrixWorld.clone();
      const tint = material.color.clone();
      if (object instanceof THREE.InstancedMesh) {
        const matrix = new THREE.Matrix4(); object.getMatrixAt(instance, matrix); transform.multiply(matrix);
        if (object.instanceColor) { const color = new THREE.Color(); object.getColorAt(instance, color); tint.multiply(color); }
      }
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(transform);
      for (let i = 0; i < (geometry.index?.count ?? attribute.count); i += 3) {
        const indices = [0, 1, 2].map(j => geometry.index ? geometry.index.getX(i + j) : i + j);
        const points = indices.map(j => new THREE.Vector3().fromBufferAttribute(attribute, j).applyMatrix4(transform));
        const normal = new THREE.Vector3();
        for (const j of indices) normal.add(new THREE.Vector3().fromBufferAttribute(normals, j));
        normal.applyNormalMatrix(normalMatrix);
        const color = tint.clone();
        if (colors && material.vertexColors) {
          const average = new THREE.Color(0, 0, 0);
          for (const j of indices) average.add(new THREE.Color().fromBufferAttribute(colors, j));
          color.multiply(average.multiplyScalar(1 / 3));
        }
        color.multiplyScalar(0.68 + Math.max(0, normal.dot(light)) * 0.55);
        const projected = points.map(point => point.project(camera));
        if (projected.every(p => Math.abs(p.x) > 1.3 || Math.abs(p.y) > 1.3)) continue;
        triangles.push({ xy: projected.flatMap(p => [(p.x + 1) * 280, (1 - p.y) * 155]),
          z: projected.reduce((sum, p) => sum + p.z, 0), color: `#${color.getHexString()}` });
      }
    }
  });
  return triangles.sort((a, b) => b.z - a.z);
}

const baseline = process.argv.includes('--baseline');
if (baseline) {
  const ref = process.argv[process.argv.indexOf('--baseline') + 1] ?? 'f0f88a1';
  for (const file of ['src/render/vegetation/TreeLibrary.ts', 'src/render/vegetation/TreeLibraryBase.ts',
    'src/render/vegetation/BirchTree.ts', 'src/sim/prng.ts']) {
    const path = `node_modules/.tmp/tree-baseline/${file}`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, execFileSync('git', ['show', `${ref}:${file}`], { windowsHide: true }));
  }
}
const build = baseline ? (await import('../node_modules/.tmp/tree-baseline/src/render/vegetation/' + 'TreeLibrary.ts')).buildTreeLibrary as typeof buildTreeLibrary : buildTreeLibrary;
const library = build('botanical-preview', 3, TREE_LOD_NEAR);
const farLibrary = build('botanical-preview', 3, TREE_LOD_FAR);
const families: TreeFamily[] = ['cherry', 'broadleaf', 'birch', 'dry', 'riverbank', 'ancient', 'conifer', 'alpine'];
const camera = new THREE.OrthographicCamera(-2.4, 2.4, 1.1, -1.1, 0.01, 100);
camera.position.set(0.2, 1.8, 8); camera.lookAt(0, 0.75, 0);
for (const family of families) {
  const group = new THREE.Group();
  for (let variant = 0; variant < 3; variant++) {
    const tree = library.get(family)![variant]!;
    const bark = new THREE.Mesh(tree.bark, new THREE.MeshStandardMaterial({ vertexColors: true }));
    const foliage = new THREE.Mesh(tree.foliage, new THREE.MeshStandardMaterial({ vertexColors: true,
      color: treeFoliageColour(family, resolveTreePhenology(5, { temperature: 0.46, moisture: 0.6 },
        { temperature: 0.6 }, family), 0.5, new THREE.Color()) }));
    bark.position.x = (variant - 1) * 1.5; foliage.position.copy(bark.position);
    group.add(bark, foliage);
  }
  panels.push({ title: family, description: 'Three seeded variants / actual generated meshes', triangles: project(group, camera) });
}
for (const [label, sourceLibrary] of [['near', library], ['far', farLibrary]] as const) {
  const group = new THREE.Group();
  for (let i = 0; i < 36; i++) {
    const family = families[i % families.length]!;
    const tree = sourceLibrary.get(family)![i % 3]!;
    const tint = treeFoliageColour(family, resolveTreePhenology(5, { temperature: 0.46, moisture: 0.6 },
      { temperature: 0.6 }, family), (i % 7) / 7, new THREE.Color());
    for (const [geometry, color] of [[tree.bark, new THREE.Color('white')], [tree.foliage, tint]] as const) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, color }));
      mesh.position.set((i % 9 - 4) * 0.65, 0, Math.floor(i / 9) * -0.8);
      mesh.rotation.y = i * 2.39996;
      mesh.scale.setScalar(0.7 + (i % 5) * 0.06);
      group.add(mesh);
    }
  }
  const wide = new THREE.OrthographicCamera(-3.5, 3.5, 1.55, -1.55, 0.01, 100);
  wide.position.set(0, 4, 8); wide.lookAt(0, 0.7, -1);
  panels.push({ title: `Mixed stand / ${label}`, description: 'Matched positions, seed, camera and light', triangles: project(group, wide) });
}
mkdirSync('node_modules/.tmp', { recursive: true });
writeFileSync('node_modules/.tmp/tree-quality-preview.json', JSON.stringify(panels));
const budgets = [...library].map(([family, trees]) => ({ family, near: trees.map(t => (t.bark.index!.count + t.foliage.index!.count) / 3), far: farLibrary.get(family)!.map(t => (t.bark.index!.count + t.foliage.index!.count) / 3) }));
writeFileSync(`node_modules/.tmp/tree-budgets-${baseline ? 'before' : 'after'}.json`, JSON.stringify(budgets, null, 2));
for (const map of [library, farLibrary]) for (const variants of map.values()) for (const tree of variants) {
  tree.bark.dispose(); tree.foliage.dispose();
}
console.log(`Exported ${panels.length} tree quality panels.`);
