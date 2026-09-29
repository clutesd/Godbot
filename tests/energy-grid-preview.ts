/** Offline inspection of the actual read-only electrical renderer using controlled persistent state. */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { EnergyRenderer } from '../src/render/energy/EnergyRenderer';
import { electricalFixture } from './fixtures/electricalInfrastructure';

const panels = [];
for (const stage of ['Early local equipment', 'Organized substation', 'Regional and local hierarchy', 'Construction and damage']) {
  const { state, world } = electricalFixture(stage.includes('Regional'), !stage.startsWith('Early'));
  for (const item of [...world.nodes!, ...world.lines]) { item.progress = 1; item.condition = 1; }
  if (stage.startsWith('Construction')) {
    world.nodes!.find(n => n.kind === 'substation')!.progress = 0.45;
    world.nodes!.find(n => n.kind === 'transformer')!.condition = 0.2;
    world.lines.forEach((line, i) => { if (i % 2 === 0) line.progress = 0.4; else line.condition = 0.2; });
  }
  const renderer = new EnergyRenderer();
  renderer.update(state, 0, () => 0);
  let center = new THREE.Vector3(-17, 0, -17), span = 18;
  if (stage.startsWith('Organized') || stage.startsWith('Early')) {
    const node = world.nodes!.find(n => n.kind === 'substation')!;
    center = new THREE.Vector3(node.position.x, 0.45, node.position.z); span = 5.0;
  } else if (stage.startsWith('Regional')) { center = new THREE.Vector3(-1, 0, -16); span = 43; }
  const camera = new THREE.OrthographicCamera(-span / 2, span / 2, span * 0.34, -span * 0.34, 0.1, 200);
  camera.position.copy(center).add(new THREE.Vector3(16, 22, 25)); camera.lookAt(center); camera.updateMatrixWorld();
  renderer.group.updateMatrixWorld(true);
  const shapes: { xy: number[]; z: number; color: string; line?: boolean }[] = [];
  const light = new THREE.Vector3(-0.5, 1, 0.8).normalize();
  renderer.group.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    const geometry = object.geometry, attribute = geometry.getAttribute('position');
    const material = object.material as THREE.MeshStandardMaterial;
    const isLine = object instanceof THREE.Line;
    const stride = isLine ? 1 : 3;
    for (let i = 0; i < (geometry.index?.count ?? attribute.count) - (isLine ? 1 : 0); i += stride) {
      const ids = Array.from({ length: isLine ? 2 : 3 }, (_, j) => geometry.index ? geometry.index.getX(i + j) : i + j);
      const points = ids.map(j => new THREE.Vector3().fromBufferAttribute(attribute, j).applyMatrix4(object.matrixWorld));
      const color = material.color.clone();
      if (!isLine) {
        const normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).normalize();
        color.multiplyScalar(0.65 + Math.max(0, normal.dot(light)) * 0.45);
      }
      const projected = points.map(p => p.project(camera));
      if (projected.some(p => Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2)) continue;
      shapes.push({ xy: projected.flatMap(p => [(p.x + 1) * 290, (1 - p.y) * 197]),
        z: projected.reduce((sum, p) => sum + p.z, 0) / projected.length, color: `#${color.getHexString()}`, line: isLine });
    }
  });
  shapes.sort((a, b) => b.z - a.z);
  panels.push({ title: stage, shapes });
  renderer.dispose();
}
mkdirSync('node_modules/.tmp', { recursive: true });
writeFileSync('node_modules/.tmp/energy-grid-preview.json', JSON.stringify(panels));
