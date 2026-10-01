import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Simulation } from '../sim/Simulation';
import { FoundingPodRenderer } from '../render/founding/FoundingPodRenderer';
import { ARRIVAL_HATCH } from '../render/founding/ArrivalChoreography';
import { createCosmicReflectionEnvironment } from '../render/people/CosmicPeople';

const sim = new Simulation({ seed: 'arrival-bronze-runes', startMode: 'arrival' });
sim.advanceArrival(80);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.append(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#26353d');
const camera = new THREE.PerspectiveCamera(37, 1, 0.05, 60);
camera.position.set(3.2, 2.35, -4.8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.15, 0); controls.enableDamping = true;
const ambient = new THREE.HemisphereLight('#e0edfa', '#756b55', 2.2); scene.add(ambient);
const key = new THREE.DirectionalLight('#fff0d7', 3.5); key.position.set(-3, 7, -5);
key.castShadow = true; key.shadow.mapSize.set(2048, 2048); scene.add(key);
key.shadow.camera.left = key.shadow.camera.bottom = -3;
key.shadow.camera.right = key.shadow.camera.top = 3;
key.shadow.normalBias = 0.015;
const rim = new THREE.DirectionalLight('#96c5e9', 2); rim.position.set(3, 4, 3); scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 80), new THREE.MeshStandardMaterial({ color: '#475452', roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const pods = new FoundingPodRenderer(sim.state); scene.add(pods.root); pods.update(camera);
const reflections = createCosmicReflectionEnvironment(renderer);
pods.setReflectionEnvironment(reflections.texture);
const hulls = pods.root.children.filter(o => o.userData['podId']);
hulls.forEach((h, i) => {
  h.position.set(0, 1.1, 0); h.visible = i === 0;
  const button = document.createElement('button'); button.textContent = sim.state.arrival!.pods[i]!.name;
  button.setAttribute('aria-pressed', String(i === 0));
  button.onclick = () => {
    hulls.forEach(other => { other.visible = other === h; });
    document.querySelectorAll('#profiles button').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  };
  document.querySelector('#profiles')!.append(button);
});
const hatchControl = document.querySelector<HTMLInputElement>('#hatch')!;
hatchControl.addEventListener('input', () => {
  const open = Number(hatchControl.value) / 100;
  hulls.forEach(h => { h.getObjectByName('articulated-hatch')!.rotation.x = -open * ARRIVAL_HATCH.angle; });
  document.querySelector('#hatch-value')!.textContent = `${Math.round(open * 100)}%`;
});
document.querySelector('#front')!.addEventListener('click', () => { camera.position.set(0, 1.28, -5.3); controls.target.set(0, 1.1, 0); });
document.querySelector('#hero')!.addEventListener('click', () => { camera.position.set(3.2, 2.35, -4.8); controls.target.set(0, 1.15, 0); });
document.querySelector('#rear')!.addEventListener('click', () => { camera.position.set(-3, 2.4, 4.6); controls.target.set(0, 1.15, 0); });
const orbit = document.querySelector<HTMLButtonElement>('#orbit')!;
orbit.onclick = () => { controls.autoRotate = !controls.autoRotate; orbit.setAttribute('aria-pressed', String(controls.autoRotate)); };
const night = document.querySelector<HTMLButtonElement>('#night')!;
night.onclick = () => {
  const dark = night.getAttribute('aria-pressed') !== 'true'; night.setAttribute('aria-pressed', String(dark));
  ambient.intensity = dark ? 0.3 : 2.2; key.intensity = dark ? 0.4 : 3.5; rim.intensity = dark ? 1.1 : 2;
  scene.background = new THREE.Color(dark ? '#080f19' : '#26353d');
};
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const stats = document.querySelector('#stats')!;
renderer.setAnimationLoop(() => {
  controls.update(); renderer.render(scene, camera);
  stats.textContent = `${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles`;
});
addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null); controls.dispose(); pods.dispose(); reflections.dispose();
  floor.geometry.dispose(); floor.material.dispose(); renderer.dispose();
}, { once: true });
