/** Offline QA of actual vegetation geometry and instance colors; no browser or simulation writes. */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildTreeLibrary, TREE_LOD_NEAR } from '../src/render/vegetation/TreeLibrary';
import { resolveTreePhenology, treeFoliageColour } from '../src/render/vegetation/TreePhenology';
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

const library = buildTreeLibrary('botanical-preview', 3, TREE_LOD_NEAR);
const camera = new THREE.OrthographicCamera(-7, 7, 5.4, -2.6, 0.1, 100);
camera.position.set(5, 6.5, 16); camera.lookAt(0, 2.5, 0);
const climate = { temperature: 0.46, moisture: 0.6 };
for (const [title, description, month] of [
  ['Spring / blossom', 'Cherry petals, emerging broadleaf, evergreen canopy', 2.2],
  ['Summer / full leaf', 'Cherry foliage returns to green', 5],
  ['Autumn / warm canopy', 'Gold and rust, with species-specific leaf fall', 9],
  ['Winter / branch structure', 'Bare deciduous crowns; evergreens persist', 11],
] as const) {
  const group = new THREE.Group();
  for (const [index, family] of (['cherry', 'broadleaf', 'conifer'] as const).entries()) {
    const source = library.get(family)![0]!;
    const bark = new THREE.Mesh(source.bark, new THREE.MeshStandardMaterial({ vertexColors: true }));
    const phase = resolveTreePhenology(month, climate, { temperature: month === 11 ? 0.2 : 0.6 }, family);
    const foliage = new THREE.Mesh(source.foliage, new THREE.MeshStandardMaterial({ vertexColors: true,
      color: treeFoliageColour(family, phase, 0.5, new THREE.Color()) }));
    bark.position.x = (index - 1) * 4;
    bark.scale.setScalar(2.5);
    foliage.position.copy(bark.position);
    const size = Math.cbrt(phase.canopy);
    foliage.position.y = 2.5 * (1 - size) * 0.6;
    foliage.scale.setScalar(2.5 * size);
    group.add(bark);
    if (size > 0) group.add(foliage);
  }
  panels.push({ title, description, triangles: project(group, camera) });
}

const { world, surface } = vegetationFixture();
// A small meadow keeps the real planner dense enough to inspect each flower form.
const extent = 3;
world.terrain = { ...world.terrain, originX: -extent, originZ: -extent,
  step: extent * 2 / (world.terrain.resolution - 1) };
for (const cell of world.cells) { cell.worldX *= 0.12; cell.worldZ *= 0.12; }
const flowers = new FlowerField(world, surface, 'flower-closeup', 100, []);
const close = new THREE.OrthographicCamera(-1.5, 1.5, 1.1, -0.65, 0.01, 100);
const ground = surface.heightAt(0, 0);
close.position.set(1, ground + 2, 3); close.lookAt(0, ground + 0.08, 0);
for (const [title, description, month] of [
  ['Meadow / summer flowers', 'Cupped petals, pollen centers and paired leaves', 5],
  ['Meadow / autumn seed heads', 'Petals fade; ochre seed heads remain', 9.3],
] as const) {
  flowers.update(close.position, month, []);
  panels.push({ title, description, triangles: project(flowers.group, close) });
}
disposeVegetation(flowers.group);
mkdirSync('node_modules/.tmp', { recursive: true });
writeFileSync('node_modules/.tmp/vegetation-preview.json', JSON.stringify(panels));
console.log(`Exported ${panels.length} vegetation geometry panels.`);
