import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Simulation } from '../sim/Simulation';
import { FoundingPodRenderer } from '../render/founding/FoundingPodRenderer';

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
camera.position.set(3.8, 2.9, -5.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.15, 0); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight('#e0edfa', '#756b55', 2.2));
const key = new THREE.DirectionalLight('#fff0d7', 3.5); key.position.set(-3, 7, -5);
key.castShadow = true; key.shadow.mapSize.set(2048, 2048); scene.add(key);
const rim = new THREE.DirectionalLight('#96c5e9', 2); rim.position.set(3, 4, 3); scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 80), new THREE.MeshStandardMaterial({ color: '#475452', roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const pods = new FoundingPodRenderer(sim.state); scene.add(pods.root); pods.update(camera);
const hulls = pods.root.children.filter(o => o.userData['podId']);
hulls.forEach((h, i) => {
  h.position.set(0, 1.1, 0); h.visible = i === 0;
  const button = document.createElement('button'); button.textContent = sim.state.arrival!.pods[i]!.name;
  button.onclick = () => hulls.forEach(other => { other.visible = other === h; });
  document.querySelector('#profiles')!.append(button);
});
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
