/** Read-only production WebGL review; all building geometry comes from AssetBuilder. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AssetBuilder } from '../render/assets/AssetBuilder';
import { ARCHITECTURE_FLAGSHIPS } from './architectureFlagshipCases';
import { MillMotionSystem } from '../render/architecture/MillMotion';
const params = new URLSearchParams(location.search);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#b8c8ca');
scene.fog = new THREE.Fog('#b8c8ca', 60, 140);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);
const light = new THREE.DirectionalLight('#fff0d5', 3.1);
light.position.set(-16, 23, 18);
light.castShadow = true;
light.shadow.mapSize.set(2048, 2048);
light.shadow.camera.left = -24;
light.shadow.camera.right = 24;
light.shadow.camera.top = 24;
light.shadow.camera.bottom = -24;
light.shadow.normalBias = .018;
scene.add(light, new THREE.HemisphereLight('#d4e6eb', '#5b5c42', 1.2));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#9c9d7b', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const root = new THREE.Group();
scene.add(root);
const builder = new AssetBuilder('flagship-production-review'), motion = new MillMotionSystem(scene, { fullMotionRange: Infinity });
const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
const clay = new THREE.MeshStandardMaterial({ color: '#c0bbae', roughness: .9 });
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .03, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * .48;
const select = document.getElementById('subject') as HTMLSelectElement;
for (const c of ARCHITECTURE_FLAGSHIPS) {
    const option = document.createElement('option');
    option.value = c.id;
    option.textContent = c.title;
    select.append(option);
}
let neutral = params.has('neutral');
let reviewDistance = 10;
const specs: unknown[] = [];
function build(id: string) {
    root.clear();
    originals.clear();
    specs.length = 0;
    const selected = id === 'all' ? ARCHITECTURE_FLAGSHIPS : ARCHITECTURE_FLAGSHIPS.filter(c => c.id === id);
    selected.forEach((c, i) => {
        const asset = builder.getAsset('building', c.config), object = asset.mesh.clone(true);
        specs.push(object.userData['buildingSpec']);
        object.scale.setScalar(3.6);
        object.position.set(selected.length === 1 ? 0 : (i % 3 - 1) * 10, 0, selected.length === 1 ? 0 : Math.floor(i / 3) * 11 - 5.5);
        object.traverse(o => { if (o instanceof THREE.LOD) {
            o.autoUpdate = false;
            o.levels.forEach((l, j) => l.object.visible = j === 0);
        } if (o instanceof THREE.Mesh) {
            originals.set(o, o.material);
            if (neutral)
                o.material = clay;
        } });
        root.add(object);
        motion.adopt(object);
    });
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const distance = Math.max(size.x, size.z, size.y * 1.3) * 1.8;
    reviewDistance = distance;
    camera.position.copy(center).add(new THREE.Vector3(distance * .62, distance * .58, distance));
    controls.target.copy(center);
    controls.update();
    document.getElementById('description')!.textContent = selected.length === 1 ? `${selected[0]!.title} / ${selected[0]!.period}. Production materials and construction, no showcase geometry.` : 'Production assets across representative periods. Controlled weather drives the real production mill.';
}
select.value = params.get('case') ?? 'all';
build(select.value);
select.addEventListener('change', () => build(select.value));
document.getElementById('neutral')!.addEventListener('click', () => { neutral = !neutral; for (const [mesh, material] of originals)
    mesh.material = neutral ? clay : material; });
document.getElementById('orbit')!.addEventListener('click', () => { controls.autoRotate = !controls.autoRotate; controls.autoRotateSpeed = .18; });
document.getElementById('save')!.addEventListener('click', () => { const link = document.createElement('a'); link.download = `godbox-${select.value}-${neutral ? 'neutral' : 'materials'}.png`; link.href = renderer.domElement.toDataURL('image/png'); link.click(); });
if (params.has('clean'))
    document.querySelector('aside')!.style.display = 'none';
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const errors: string[] = [];
window.addEventListener('error', e => { errors.push(e.message); document.getElementById('errors')!.textContent = errors.join('\n'); });
renderer.debug.onShaderError = () => { errors.push('Production shader compilation failed'); document.getElementById('errors')!.textContent = errors.join('\n'); };
const world = { size: 1, cellSize: 200, cells: [{ river: false, flow: 0 }] }, weather = { wind: .46, windX: .18, windZ: .9, cells: [{ wind: .46, windX: .18, windZ: .9 }] };
let last = performance.now(), elapsed = 0;
function frame(now: number) { const delta = Math.min(.05, (now - last) / 1000); last = now; elapsed += delta; controls.update(); motion.update({ deltaSeconds: delta, elapsedSeconds: elapsed, camera: camera.position, world, weather }); renderer.render(scene, camera); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
/** Only the headless review harness reads this; no production simulation hooks. */
const qa = { stats: () => {
        renderer.info.reset();
        renderer.render(scene, camera);
        return ({ errors: [...errors], drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, rotors: motion.rotorCount, specs,
            rotations: root.children.flatMap(o => { const values: number[] = []; o.traverse(p => { if (p.userData['millRotor'])
                values.push(p.rotation.x, p.rotation.y, p.rotation.z); }); return values; }) });
    },
    advance: (seconds: number) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) {
        elapsed += 1 / 60;
        motion.update({ deltaSeconds: 1 / 60, elapsedSeconds: elapsed, camera: camera.position, world, weather });
    } renderer.render(scene, camera); },
    view: (yaw: number, pitch: number) => { camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(yaw) * reviewDistance * Math.cos(pitch), Math.sin(pitch) * reviewDistance, Math.cos(yaw) * reviewDistance * Math.cos(pitch))); controls.update(); } };
(globalThis as typeof globalThis & {
    godboxFlagshipQa: typeof qa;
}).godboxFlagshipQa = qa;
