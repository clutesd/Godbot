/** Repeatable tree-only acceptance scene. Uses production geometry, materials and biology. */
import * as THREE from 'three';
import { buildTreeLibrary, TREE_LOD_FAR, TREE_LOD_NEAR, type TreeFamily } from '../src/render/vegetation/TreeLibrary';
import { bindTreeMaterial } from '../src/render/vegetation/TreeMaterials';
import { resolveTreeMorphology, resolveTreePhenotype } from '../src/render/vegetation/TreeMorphology';
import { resolveTreePhenology, treeFoliageColour } from '../src/render/vegetation/TreePhenology';
import type { ResolvedTreeLifecycle } from '../src/render/vegetation/ForestPlanner';
import { VegetationRenderer } from '../src/render/vegetation/VegetationRenderer';
import { WeatherRenderer } from '../src/render/atmosphere/WeatherRenderer';
import { vegetationFixture } from './fixtures/vegetation';

const query = new URLSearchParams(location.search);
const families: TreeFamily[] = ['cherry', 'broadleaf', 'birch', 'dry', 'riverbank', 'ancient', 'conifer', 'alpine'];
const conditions = ['summer', 'spring', 'autumn', 'winter', 'veteran', 'declining', 'dead', 'fallen', 'snapped', 'uprooted'];
const forest = query.get('family') === 'forest';
const family = families.find(f => f === query.get('family')) ?? 'broadleaf';
const availableConditions = forest ? conditions.slice(0, 4) : conditions;
const condition = availableConditions.find(c => c === query.get('condition')) ?? 'summer';
const far = query.get('lod') === 'far';
const month = condition === 'winter' ? 11 : condition === 'autumn' ? 9 : condition === 'spring' ? 2.2 : 5;
const { world, surface } = vegetationFixture();
for (const cell of world.weather!.cells) cell.temperature = month === 11 ? 0.2 : 0.6;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#bdc9c6');
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const sun = new THREE.DirectionalLight('#fff0dc', 2.5); sun.position.set(-3, 6, 4); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -7; sun.shadow.camera.right = 7;
sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7;
scene.add(sun, new THREE.HemisphereLight('#bfd1df', '#625449', 1.7));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#778568', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
if (forest) {
  const vegetation = new VegetationRenderer(world, surface, 'tree-acceptance', 1200);
  vegetation.setSeason(month); scene.add(vegetation.group);
  ground.position.y = surface.heightAt(0, 0) - 0.01;
  camera.position.set(12, ground.position.y + 10, 18); camera.lookAt(0, ground.position.y + 1, 0);
  vegetation.updateLod(far ? new THREE.Vector3(200, 50, 200) : camera.position);
} else {
  const library = buildTreeLibrary('botanical-preview', 3, far ? TREE_LOD_FAR : TREE_LOD_NEAR);
  for (let i = 0; i < 3; i++) {
    const tree = library.get(family)![i]!;
    const phenotype = { ...resolveTreePhenotype('tree-acceptance', { family, worldX: i, worldZ: 0 }),
      breakage: 1, uprooting: condition === 'uprooted' ? 1 : 0 };
    const fallen = ['fallen', 'snapped', 'uprooted'].includes(condition);
    const stage = fallen ? 'fallen' : condition === 'dead' ? 'dead-standing' : condition === 'declining' ? 'declining'
      : condition === 'veteran' ? 'old' : 'mature';
    const ageYears = condition === 'dead' ? 152 : condition === 'fallen' ? 168 : fallen ? 140
      : stage === 'declining' ? 136 : stage === 'old' ? 108 : 50;
    const lifecycle: ResolvedTreeLifecycle = { stage, fallen, foliageVisible: !fallen && stage !== 'dead-standing',
      scale: 1, maturity: Math.min(1, ageYears / 140), ageYears, mortalityAge: 140, veteranAge: 90 };
    const form = resolveTreeMorphology(phenotype, lifecycle);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(form.leanZ, i * 0.5, -form.leanX));
    if (fallen) rotation.setFromEuler(new THREE.Euler(0, i * 0.5, form.fallAngle));
    const origin = new THREE.Vector3((i - 1) * 1.9, fallen ? 0.06 : 0, 0);
    if (condition === 'uprooted') {
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.38, 0.18, 8, 1),
        new THREE.MeshStandardMaterial({ color: '#514131', roughness: 0.98 }));
      root.rotation.z = Math.PI / 2; root.position.copy(origin).add(new THREE.Vector3(0, 0.16, 0));
      root.scale.set(0.48, phenotype.girth * 0.86, phenotype.girth * 0.8); root.castShadow = true; scene.add(root);
    }
    for (const kind of ['bark', 'foliage'] as const) {
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: kind === 'bark' ? 0.94 : 0.9 });
      const mesh = new THREE.InstancedMesh(tree[kind], material, 1);
      const state = bindTreeMaterial(mesh, kind, family, tree.height);
      const position = origin.clone();
      const scale = new THREE.Vector3(form.trunkRadiusX, form.trunkHeight, form.trunkRadiusZ);
      if (kind === 'bark') state.setXYZW(0, form.barkBreakFraction, form.barkWeathering, phenotype.pigment * Math.PI * 2, 0);
      else {
        const phase = resolveTreePhenology(month, { temperature: 0.46, moisture: 0.6 }, { temperature: month === 11 ? 0.2 : 0.6 }, family, phenotype.phenology);
        state.setXYZW(0, lifecycle.foliageVisible ? Math.cbrt(phase.canopy * form.foliageDensity) : 0, 0, 0, 0);
        position.add(new THREE.Vector3(form.crownOffsetX, form.crownLift, form.crownOffsetZ));
        scale.set(form.crownWidthX, form.crownHeight, form.crownWidthZ);
        mesh.setColorAt(0, treeFoliageColour(family, phase, phenotype.pigment, new THREE.Color()));
        mesh.name = 'weather-foliage';
      }
      mesh.setMatrixAt(0, new THREE.Matrix4().compose(position, rotation, scale));
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; scene.add(mesh);
    }
  }
  // Unselected families are not attached to the scene and do not need GPU resources.
  for (const [otherFamily, variants] of library) if (otherFamily !== family) for (const tree of variants) {
    tree.bark.dispose(); tree.foliage.dispose();
  }
  camera.position.set(0.5, 2.2, 7.5); camera.lookAt(0, 0.65, 0);
}
const weather = new WeatherRenderer(world, surface, 'tree-acceptance'); weather.bindScene(scene);
const errors: string[] = [];
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  errors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n'));
};
document.body.style.cssText = 'margin:0;overflow:hidden;font:14px system-ui;color:#20362f';
document.body.append(renderer.domElement);
const controls = document.createElement('header');
controls.style.cssText = 'position:fixed;top:18px;left:20px;display:flex;gap:12px;align-items:center;background:#ffffffdc;padding:12px;border-radius:6px';
controls.textContent = 'GODBOX / tree acceptance';
for (const [key, choices, value] of [['family', [...families, 'forest'], forest ? 'forest' : family],
  ['condition', availableConditions, condition], ['lod', ['near', 'far'], far ? 'far' : 'near']] as const) {
  const select = document.createElement('select'); select.ariaLabel = key;
  for (const choice of choices) { const option = new Option(choice, choice); option.selected = choice === value; select.add(option); }
  select.onchange = () => { query.set(key, select.value); location.search = query.toString(); }; controls.append(select);
}
document.body.append(controls);
const result = document.createElement('pre'); result.id = 'tree-webgl-result';
result.style.cssText = 'position:fixed;bottom:14px;left:20px;background:#ffffffdc;padding:12px;max-width:85vw;white-space:pre-wrap';
document.body.append(result);
let frame = 0;
function render() {
  renderer.render(scene, camera); frame++;
  result.textContent = JSON.stringify({ frame, family: forest ? 'forest' : family, condition, lod: far ? 'far' : 'near', errors,
    glError: renderer.getContext().getError(), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
  if (frame < 3) requestAnimationFrame(render);
}
render();
