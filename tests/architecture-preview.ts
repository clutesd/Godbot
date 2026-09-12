/**
 * Developer architecture gallery. Renders the same CI validation cases through the production
 * AssetBuilder, so what appears here is exactly what a settlement draws — shared materials,
 * merged surfaces and the real LOD root. No simulation or user data is touched.
 *
 * `?view=gallery|street` frames the whole row or one structure at eye level.
 * `?era=` picks the presentation era, `?case=` picks one gallery case, `?report` shows metrics.
 */
import * as THREE from 'three';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import {
  ARCHITECTURE_GALLERY_CASES,
  buildArchitectureGalleryScene,
} from '../src/render/assets/StructureVisualValidation';
import type { CultureStyle } from '../src/sim/types';

const params = new URLSearchParams(location.search);
const street = (params.get('view') ?? 'gallery') === 'street';
const focus = params.get('case') ?? ARCHITECTURE_GALLERY_CASES[0]!.id;
const CULTURE: CultureStyle = {
  primary: params.get('primary') ?? '#c36557',
  secondary: params.get('secondary') ?? '#313550',
  accent: params.get('accent') ?? '#d9a748',
  symbol: 'sun-step',
  pattern: 'chevron',
  nameSyllables: ['go', 'do'],
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#adb9b4');
const builder = new AssetBuilder('architecture-preview');
const spacing = 7;
const gallery = buildArchitectureGalleryScene(builder, 'preview-culture', CULTURE, spacing);
scene.add(gallery);

const groundMaterial = new THREE.MeshStandardMaterial({ color: '#7d7a67', roughness: 0.98 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const sun = new THREE.DirectionalLight('#fff3db', 3.1);
sun.position.set(-14, 26, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
scene.add(sun, new THREE.HemisphereLight('#cfe0e4', '#4a3b30', 0.85));

const bounds = new THREE.Box3().setFromObject(gallery);
const centre = bounds.getCenter(new THREE.Vector3());
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 600);
if (street) {
  const target = gallery.children.find(child => child.userData['architectureGalleryCase'] === focus) ?? gallery.children[0]!;
  const box = new THREE.Box3().setFromObject(target);
  const size = box.getSize(new THREE.Vector3());
  const at = box.getCenter(new THREE.Vector3());
  const distance = Math.max(size.x, size.y, size.z) * 1.75 + 4;
  camera.position.set(at.x + distance * 0.45, Math.max(2.2, size.y * 0.5), at.z + distance);
  camera.lookAt(at.x, size.y * 0.42, at.z);
} else {
  const span = bounds.getSize(new THREE.Vector3());
  camera.position.set(centre.x - span.x * 0.22, span.y * 1.5 + 5, centre.z + span.z * 0.7 + 15);
  camera.lookAt(centre.x, span.y * 0.3, centre.z);
}

if (params.has('full')) {
  // The renderer drives LOD automatically; pin level 0 so the gallery shows full procedural detail.
  gallery.traverse(object => {
    if (!(object instanceof THREE.LOD)) return;
    object.autoUpdate = false;
    object.levels.forEach((level, index) => { level.object.visible = index === 0; });
  });
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = false;
const errors: string[] = [];
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  errors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n'));
};
document.body.style.cssText = 'margin:0;background:#adb9b4;color:#1d2422;font:13px system-ui;overflow:hidden';
document.body.append(renderer.domElement);

const caption = document.createElement('div');
caption.style.cssText = 'position:fixed;left:28px;top:20px;letter-spacing:3px;text-shadow:0 1px 6px #fff8';
caption.innerHTML = `<div style="font:30px Georgia;letter-spacing:6px">GODBOX</div><p>ARCHITECTURE GALLERY · ${street ? `STREET · ${focus.toUpperCase()}` : 'ALL PURPOSES'}</p>`;
document.body.append(caption);

const links = document.createElement('div');
links.style.cssText = 'position:fixed;left:28px;bottom:20px;display:flex;flex-wrap:wrap;gap:14px;max-width:70vw';
for (const definition of ARCHITECTURE_GALLERY_CASES) {
  const link = document.createElement('a');
  const query = new URLSearchParams(params);
  query.set('view', 'street');
  query.set('case', definition.id);
  link.href = `?${query}`;
  link.textContent = definition.id;
  link.style.color = '#26312e';
  links.append(link);
}
document.body.append(links);

const report = document.createElement('pre');
report.id = 'webgl-result';
report.style.cssText = 'display:none;position:fixed;right:20px;bottom:18px;max-width:44vw;background:#ffffffdd;padding:10px;font-size:11px';
document.body.append(report);

let frame = 0;
function render(): void {
  renderer.info.reset();
  renderer.render(scene, camera);
  frame += 1;
  report.textContent = JSON.stringify({
    complete: frame >= 6,
    frame,
    errors,
    glError: renderer.getContext().getError(),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    programs: renderer.info.programs?.length,
    cache: builder.getCacheStats(),
  }, null, 1);
  if (errors.length || params.has('report')) report.style.display = 'block';
  if (frame < 6) requestAnimationFrame(render);
}
render();
