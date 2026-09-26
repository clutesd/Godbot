import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { societyFixture } from '../../tests/fixtures/settlementDevelopment';
import { rememberMortality } from '../sim/development/Remembrance';
import { developmentContext, responseForNeed } from '../sim/development/SettlementDevelopmentSystem';
import { createMemorialSiteLandscape } from '../render/settlement/MemorialSitePresentation';
if (!import.meta.env.DEV) throw new Error('Development review only');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setClearColor('#242824');
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#fff1dc', '#667566', 2));
const sun = new THREE.DirectionalLight('#ffe3ba', 3.2);
sun.position.set(-5, 12, 7); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 10, bottom: -10 });
sun.shadow.normalBias = 0.025; scene.add(sun);
const floor = new THREE.Mesh(new THREE.BoxGeometry(28, 0.1, 13), new THREE.MeshStandardMaterial({ color: '#646955', roughness: 1 }));
floor.position.y = -0.06; floor.receiveShadow = true; scene.add(floor);
const forms = ['earth-mounds', 'ancestor-posts', 'stone-cairns', 'stelae'] as const;
for (const [i, form] of forms.entries()) {
  const { state, settlements } = societyFixture();
  const town = settlements[0]!;
  rememberMortality(state, town, 120);
  const response = responseForNeed(developmentContext(state, town), 'memory')!;
  response.memorial!.form = form; response.memorial!.ageBand = 1;
  const plot = town.structurePlots![0]!;
  plot.radius = 2.8; plot.worldX = town.position.x; plot.worldZ = town.position.z;
  plot.development = { ...response, status: 'active', origin: { month: 0, action: 'founded', name: response.name,
    need: response.need, cultureId: response.cultureId, reasons: [...response.reasons], form: response.form,
    level: response.level, material: response.material }, history: [], transitionCount: 0, lastUsedMonth: 0 };
  const landscape = createMemorialSiteLandscape(state, town, 0, () => 0);
  landscape.position.x = (i - 1.5) * 6.3;
  scene.add(landscape);
}
const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
camera.position.set(12, 16, 22);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0); controls.update();
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
