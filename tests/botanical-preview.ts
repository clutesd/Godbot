/** Offline QA of actual vegetation geometry and instance colors; no browser or simulation writes. */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { FlowerField } from '../src/render/vegetation/FlowerField';
import { vegetationFixture, disposeVegetation } from './fixtures/vegetation';

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
    const material = object.material as THREE.MeshStandardMaterial;
    const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
    for (let instance = 0; instance < instances; instance++) {
      const transform = object.matrixWorld.clone();
      const tint = material.color.clone();
      if (object instanceof THREE.InstancedMesh) {
        const matrix = new THREE.Matrix4(); object.getMatrixAt(instance, matrix); transform.multiply(matrix);
        if (object.instanceColor) { const color = new THREE.Color(); object.getColorAt(instance, color); tint.multiply(color); }
      }
      for (let i = 0; i < (geometry.index?.count ?? attribute.count); i += 3) {
        const indices = [0, 1, 2].map(j => geometry.index ? geometry.index.getX(i + j) : i + j);
        const points = indices.map(j => new THREE.Vector3().fromBufferAttribute(attribute, j).applyMatrix4(transform));
        const normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).normalize();
        const color = tint.clone();
        if (colors && material.vertexColors) color.multiply(new THREE.Color().fromBufferAttribute(colors, indices[0]!));
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

const { world, surface, camera } = vegetationFixture();
const flowers = new FlowerField(world, surface, 'botanical-specimens', 500, []);
flowers.update(camera, 5, []);
for (const [title, description, names, extent] of [
  ['Fern / feathered fronds', 'Paired leaflets follow eight arching stems', ['understory-ferns'], 0.7],
  ['Shrub / open leaf sprays', 'Folded blades and space between foliage', ['understory-shrubs'], 0.7],
  ['Bush / layered crown', 'Pointed silhouettes and pale midribs', ['understory-bushes'], 0.9],
  ['Flower / folded petals', 'Five cupped petals with soft colour gradients', ['seasonal-flower-stems', 'seasonal-flower-blooms', 'seasonal-flower-seed-heads'], 0.25],
] as const) {
  const group = new THREE.Group();
  for (const name of names) {
    const source = flowers.group.getObjectByName(name) as THREE.InstancedMesh;
    const material = (source.material as THREE.MeshStandardMaterial).clone();
    if (source.count) source.getColorAt(0, material.color);
    const mesh = new THREE.Mesh(source.geometry, material);
    if (name.includes('blooms') || name.includes('heads')) mesh.position.y = 0.18;
    group.add(mesh);
  }
  const view = new THREE.OrthographicCamera(-extent, extent, extent * 0.554, -extent * 0.554, 0.01, 100);
  view.position.set(1.4, 1.5, 2.5); view.lookAt(0, extent * 0.42, 0);
  panels.push({ title, description, triangles: project(group, view) });
  group.children.forEach(mesh => ((mesh as THREE.Mesh).material as THREE.Material).dispose());
}
disposeVegetation(flowers.group);
mkdirSync('node_modules/.tmp', { recursive: true });
writeFileSync('node_modules/.tmp/botanical-preview.json', JSON.stringify(panels));
console.log(`Exported ${panels.length} botanical specimens.`);
