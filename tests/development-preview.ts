/** Offline geometry QA: the same fifty-year scenarios exercised by the acceptance suite. */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { contrastingSocieties, run } from './fixtures/settlementDevelopment';
import { developmentBuildingRole, developmentPresentationEra, resolveBuildingGrammar } from '../src/render/assets/BuildingGrammar';
import { BUILD_STAGE, composeBuilding } from '../src/render/assets/BuildingComposer';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';

const { state, settlements } = contrastingSocieties();
const started = performance.now();
run(state, 600);
const elapsedMs = performance.now() - started;
const labels = ['Agricultural / sacred', 'Trade / civic', 'Militarized frontier', 'Decentralized clans'];
const descriptions = ['Farmsteads, storage and a temple', 'Markets and a council building', 'Watch posts and warrior barracks', 'Households and informal authority'];
const camera = new THREE.OrthographicCamera(-13, 13, 11, -11, 0.1, 200);
camera.position.set(18, 22, 28); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
const light = new THREE.Vector3(-0.4, 1, 0.6).normalize();
const panels = settlements.map((s, index) => {
  const triangles: Array<{ xy: number[]; z: number; color: string }> = [];
  const structures = s.structurePlots!.filter(p => p.development);
  for (const plot of structures) {
    const d = plot.development!;
    const era = developmentPresentationEra(d);
    const palette = new MaterialPalette({ culture: d.style, era });
    const profile = CultureStyleProfileFactory.createFromCulture(d.cultureId, d.style);
    const grammar = resolveBuildingGrammar(profile, era, developmentBuildingRole(d), plot.id, d);
    const composed = composeBuilding(grammar, palette, plot.id, BUILD_STAGE.DETAIL);
    const scale = Math.min(plot.width / composed.extentX, plot.depth / composed.extentZ) * (0.64 + d.level * 0.12);
    composed.group.position.set(plot.worldX - s.position.x, 0, plot.worldZ - s.position.z);
    composed.group.rotation.y = Math.atan2(s.position.x - plot.worldX, s.position.z - plot.worldZ);
    composed.group.scale.set(scale, scale * (0.12 + plot.condition * 0.88), scale);
    composed.group.updateMatrixWorld(true);
    composed.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const attribute = object.geometry.getAttribute('position');
      const indices = object.geometry.index;
      const material = object.material as THREE.MeshStandardMaterial;
      for (let i = 0; i < (indices?.count ?? attribute.count); i += 3) {
        const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(attribute, indices ? indices.getX(i + j) : i + j).applyMatrix4(object.matrixWorld));
        const normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).normalize();
        const color = material.color.clone().multiplyScalar(0.65 + Math.max(0, normal.dot(light)) * 0.6).getHexString();
        const projected = points.map(p => p.project(camera));
        triangles.push({ xy: projected.flatMap(p => [Math.round((p.x + 1) * 290), Math.round((1 - p.y) * 210)]),
          z: projected.reduce((sum, p) => sum + p.z, 0), color: `#${color}` });
      }
      object.geometry.dispose();
    });
    palette.dispose();
  }
  triangles.sort((a, b) => b.z - a.z);
  return { title: labels[index], description: descriptions[index], triangles,
    structures: structures.map(p => ({ id: p.id, name: p.development!.name, form: p.development!.form, need: p.development!.need,
      level: p.development!.level, material: p.development!.material, status: p.development!.status, position: [p.worldX, p.worldZ], history: p.development!.history })) };
});
mkdirSync('node_modules/.tmp', { recursive: true });
writeFileSync('node_modules/.tmp/development-preview.json', JSON.stringify(panels));
writeFileSync('docs/settlement-development-paths.json', JSON.stringify({ scenario: 'Controlled equal-population societies; 600 development months; no world economy or demographic stepping',
  months: state.month, panels: panels.map(({ triangles: _triangles, ...panel }) => panel) }, null, 2));
console.log(`Four societies, 600 development months: ${elapsedMs.toFixed(1)} ms. Geometry and path evidence written.`);
