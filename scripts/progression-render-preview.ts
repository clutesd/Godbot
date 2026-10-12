/** Software projection of actual read-only renderer geometry; controlled paid-build fixtures. */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { EnergyRenderer } from '../src/render/energy/EnergyRenderer';
import { FarmFieldRenderer } from '../src/render/farming/FarmFieldRenderer';
import { advanceEnergy } from '../src/sim/energy/EnergySystem';
import { advanceIrrigationWorks } from '../src/sim/agriculture/IrrigationWorks';
import { createField } from '../src/sim/agriculture/AgricultureSystem';
import { farmGeometries } from '../src/shared/FarmGeometry';
import { learn, societyFixture } from '../tests/fixtures/settlementDevelopment';

const panels = [];
for (const stage of ['Paid waterwheel / shaft service', 'Paid windmill / shaft service', 'Paid irrigation / dry banks', 'Paid irrigation / delivered water']) {
  const { state, settlements } = societyFixture(); const s = settlements[0]!;
  state.settlements = [s]; s.localMaterials = { timber: 100, stone: 100, textile: 20 };
  const plot = s.structurePlots!.find(p => p.development?.status === 'active')!;
  s.structurePlots = [plot]; plot.accessRestricted = false; plot.condition = 1;
  learn(s, 'wheel-axle', 'simple-gearing', 'irrigation');
  Object.assign(state.world.cells[s.cellIndex]!, { river: true, flow: 0.9 });
  Object.assign(state.weather.cells[s.cellIndex]!, { wind: 0.5, temperature: 0.6, snowpack: 0, runoff: 0 });
  let renderer: EnergyRenderer | FarmFieldRenderer;
  let center = new THREE.Vector3(plot.worldX, 0.5, plot.worldZ), span = 2.5;
  if (stage.includes('irrigation')) {
    plot.development!.form = 'field'; plot.development!.need = 'food';
    const geometry = farmGeometries(s)[0]!;
    const field = createField(plot.id, state.world.cells[s.cellIndex]!, s.cellIndex, 0); s.fields = [field];
    s.development!.water = { evaluatedMonth: 0, availability: 1, irrigation: 1, reliability: 1, quality: 1,
      sanitation: 0, droughtStress: 0, floodContamination: 0, surfaceAccess: 1, builtService: 0, droughtMonths: 0 };
    for (let i = 0; i < 100 && field.irrigationWorks?.progress !== 1; i++) { state.month++; advanceIrrigationWorks(state, s, field, geometry); }
    if (field.irrigationWorks?.progress !== 1) throw new Error('Irrigation construction failed');
    field.evaluatedMonth = state.month; field.stage = 'vegetative'; field.biomass = 0.5;
    field.irrigationReceived = stage.includes('delivered') ? 0.1 : 0;
    renderer = new FarmFieldRenderer(); renderer.update(state, () => 0, () => true);
    center = new THREE.Vector3(geometry.center.x, 0, geometry.center.z); span = 4;
  } else {
    plot.development!.need = 'energy'; plot.development!.form = 'workshop';
    s.infrastructure.workshops = 0.6;
    state.world.cells[s.cellIndex]!.river = stage.includes('waterwheel');
    for (let i = 0; i < 36; i++) { state.month++; advanceEnergy(state); }
    renderer = new EnergyRenderer(); renderer.update(state, 1, () => 0);
  }
  const camera = new THREE.OrthographicCamera(-span / 2, span / 2, span * 0.34, -span * 0.34, 0.1, 200);
  camera.position.copy(center).add(new THREE.Vector3(16, 22, 25)); camera.lookAt(center); camera.updateMatrixWorld();
  renderer.group.updateMatrixWorld(true);
  const shapes: { xy: number[]; z: number; color: string }[] = [];
  renderer.group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    const geometry = object.geometry, position = geometry.getAttribute('position');
    const material = (Array.isArray(object.material) ? object.material[0] : object.material) as THREE.MeshStandardMaterial;
    if (!position || !material.color) return;
    for (let i = 0; i < (geometry.index?.count ?? position.count); i += 3) {
      const ids = [0, 1, 2].map(j => geometry.index ? geometry.index.getX(i + j) : i + j);
      if (ids.some(id => id >= position.count)) continue;
      const points = ids.map(id => new THREE.Vector3().fromBufferAttribute(position, id).applyMatrix4(object.matrixWorld));
      const color = material.color.clone(); const vertex = geometry.getAttribute('color');
      if (material.vertexColors && vertex) color.multiply(new THREE.Color(vertex.getX(ids[0]!), vertex.getY(ids[0]!), vertex.getZ(ids[0]!)));
      const normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).normalize();
      color.multiplyScalar(0.65 + Math.abs(normal.dot(new THREE.Vector3(-0.5, 1, 0.8).normalize())) * 0.35);
      const projected = points.map(p => p.project(camera));
      shapes.push({ xy: projected.flatMap(p => [(p.x + 1) * 290, (1 - p.y) * 190]),
        z: projected.reduce((n, p) => n + p.z, 0) / 3, color: `#${color.getHexString()}` });
    }
  });
  shapes.sort((a, b) => b.z - a.z); panels.push({ title: stage, shapes });
  if (renderer instanceof EnergyRenderer) renderer.dispose();
}
mkdirSync('output/progression-repair', { recursive: true });
writeFileSync('output/progression-repair/render-geometry.json', JSON.stringify(panels));
