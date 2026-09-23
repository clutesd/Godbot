import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPottery, potteryStyle, type Vessel } from '../render/assets/Pottery';
import type { CultureStyle } from '../sim/types';

if (!import.meta.env.DEV) throw new Error('Pottery review is a development fixture.');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setClearColor('#242824');
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#fff4dd', '#566352', 2.5));
const sun = new THREE.DirectionalLight('#fff4e4', 3); sun.position.set(3, 6, 4); scene.add(sun);
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
camera.position.set(3.8, 4.6, 6);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0.1, 0); controls.update();
const floor = new THREE.Mesh(new THREE.BoxGeometry(6, 0.04, 4.8), new THREE.MeshStandardMaterial({ color: '#777765' }));
floor.position.y = -0.035; scene.add(floor);
const motifs: CultureStyle['symbol'][] = ['sun-step', 'river-eye', 'woven-moon', 'mountain-knot', 'seed-spiral'];
const patterns: CultureStyle['pattern'][] = ['terrace', 'wave', 'crossweave', 'diamond', 'chevron'];
const colours = ['#b35236', '#367b86', '#77547f', '#496955', '#9a6939'];
let rows: THREE.Group[] = [];
const select = document.getElementById('culture') as HTMLSelectElement;
function update() {
  for (const row of rows) { scene.remove(row); row.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } }); }
  rows = [];
  const i = select.selectedIndex;
  const style: CultureStyle = { primary: colours[i]!, secondary: '#302e37', accent: '#f0d9a0', symbol: motifs[i]!, pattern: patterns[i]!, nameSyllables: [] };
  const identity = potteryStyle(`review-${i}`, style, { ...style, lineageKey: `house-${i}`, lineageMarks: 2 });
  for (const tier of [1, 2, 3]) {
    const vessels: Vessel[] = ['bowl', 'cooking-pot', 'storage-jar', 'jug', 'ritual'];
    const row = createPottery(vessels.filter(v => tier === 3 || v !== 'ritual').map((vessel, index) => ({ vessel, x: (index - 2) * 0.95, z: (tier - 2) * 1.3, rotation: 0 })), identity, tier, () => 0);
    rows.push(row); scene.add(row);
  }
}
select.addEventListener('change', update); update();
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
