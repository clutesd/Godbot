/** Offline visual QA of actual placed, paid structures; does not alter the simulation. */
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { createSurvivalStructure } from '../src/render/founding/SurvivalStructure';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import { shelterCapacity } from '../src/sim/development/Shelter';

const sim = new Simulation({ seed: 'founding-loop-audit', startMode: 'arrival', world: { size: 64 } });
sim.advanceArrival(60);
const s = sim.state.settlements[1]!;
const camera = new THREE.OrthographicCamera(-9, 9, 8, -8, 0.1, 100);
camera.position.set(12, 17, 20); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
const panels = [];
for (const month of [0, 1, 2, 3, 10, 24]) {
  sim.step(month - sim.state.month);
  const triangles: { xy: number[]; z: number; color: string }[] = [];
  for (const plot of s.structurePlots ?? []) {
    const project = s.development?.project?.plotId === plot.id ? s.development.project : undefined;
    const response = project?.response ?? plot.development;
    if (!response?.adaptation) continue;
    const palette = new MaterialPalette({ culture: response.style, era: 'primitive' });
    const mesh = createSurvivalStructure(response, project?.progress ?? 1, plot.width, plot.depth, palette);
    mesh.position.set(plot.worldX - s.position.x, 0, plot.worldZ - s.position.z);
    mesh.rotation.y = Math.atan2(s.position.x - plot.worldX, s.position.z - plot.worldZ);
    mesh.scale.y = plot.condition;
    mesh.updateMatrixWorld(true);
    mesh.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const position = object.geometry.getAttribute('position'), indices = object.geometry.index;
      for (let i = 0; i < (indices?.count ?? position.count); i += 3) {
        const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, indices ? indices.getX(i + j) : i + j).applyMatrix4(object.matrixWorld));
        const normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).normalize();
        const light = Math.max(0, normal.dot(new THREE.Vector3(-0.4, 1, 0.6).normalize()));
        const color = (object.material as THREE.MeshStandardMaterial).color.clone().multiplyScalar(0.65 + light * 0.6).getHexString();
        const projected = points.map(p => p.project(camera));
        triangles.push({ xy: projected.flatMap(p => [(p.x + 1) * 270, (1 - p.y) * 200]), z: projected.reduce((n, p) => n + p.z, 0), color: `#${color}` });
      }
      object.geometry.dispose();
    });
    palette.dispose();
  }
  const population = sim.state.people.filter(p => p.homeId === s.id && p.alive).length;
  panels.push({ month, population, capacity: shelterCapacity(s, sim.state).capacity,
    project: s.development?.project?.response.name ?? 'No active project', progress: s.constructionProgress,
    triangles: triangles.sort((a, b) => b.z - a.z) });
}
writeFileSync('output/founding-preview.json', JSON.stringify(panels));
