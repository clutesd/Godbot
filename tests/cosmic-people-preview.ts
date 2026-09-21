/** Manual WebGL acceptance fixture. Production assets, animation clips and real camera distances.
 * npm run dev -> /tests/cosmic-people-preview.html. Never imported by the application. */
import * as THREE from 'three';
import { CosmicRoleAccents, COSMIC_HEIGHT_MULTIPLIER, cosmicAppearanceFor, cosmicRoleFor, createCosmicBodyGeometry, createCosmicHeadGeometry, createCosmicBodyMaterial, bindCosmicVariation, updateCosmicBodyMaterial } from '../src/render/people/CosmicPeople';
import { AnimationController, type AnimationState } from '../src/render/animation/AnimationController';
import type { PersonRole } from '../src/sim/types';

const canvas = document.querySelector('canvas')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15; renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
const sun = new THREE.DirectionalLight('#ffe2b5', 3.3); sun.position.set(-3, 6, 4); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = 0.004;
const fill = new THREE.HemisphereLight('#91b6ca', '#5c392e', 1.5); scene.add(sun, fill);
const floorMaterial = new THREE.MeshStandardMaterial({ color: '#727d4b', roughness: 1 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), floorMaterial); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const material = createCosmicBodyMaterial();
const roles: PersonRole[] = ['farmer', 'fisher', 'builder', 'merchant', 'guard', 'priest', 'administrator', 'scholar', 'engineer', 'healer', 'elder', 'child'];
const population = Math.floor(THREE.MathUtils.clamp(Number(new URLSearchParams(location.search).get('population')) || 12, 12, 1536));
const bodies = new THREE.InstancedMesh(createCosmicBodyGeometry(), material, population);
const heads = new THREE.InstancedMesh(createCosmicHeadGeometry(), material, population);
const arms = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.035, 0.34, 5).translate(0, -0.17, 0), material, population * 2);
const legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.032, 0.04, 0.36, 5).translate(0, -0.18, 0), material, population * 2);
const meshes = [bodies, heads, arms, legs];
const accents = new CosmicRoleAccents(population); accents.mesh.count = population; scene.add(accents.mesh);
const props = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), new THREE.MeshStandardMaterial({ color: '#94744a' }), population); scene.add(props);
const variation = meshes.map(bindCosmicVariation);
meshes.forEach(mesh => { mesh.frustumCulled = false; mesh.castShadow = true; scene.add(mesh); });
const animations = new AnimationController('cosmic-review');
const object = new THREE.Object3D(); const color = new THREE.Color();
const headAnchor = new THREE.Vector3();
const individuals = Array.from({ length: population }, (_, i) => {
  const role = roles[i % roles.length]!;
  const id = `cosmic-${i}`, appearance = cosmicAppearanceFor(id);
  animations.getOrCreateCharacterState(id, 'builder');
  const size = 0.28 * COSMIC_HEIGHT_MULTIPLIER * appearance.height * (role === 'child' ? 0.69 : 1);
  const columns = population === 12 ? 6 : Math.ceil(Math.sqrt(population));
  const x = (i % columns - (columns - 1) / 2) * 0.72, z = 0.45 - Math.floor(i / columns) * (population === 12 ? 1.35 : 0.6);
  color.set(cosmicRoleFor(role).color);
  for (let part = 0; part < 4; part++) for (let side = 0; side < (part > 1 ? 2 : 1); side++) {
    const index = part > 1 ? i * 2 + side : i;
    variation[part]!.setXYZ(index, appearance.seed, appearance.nebula, appearance.brightness);
    meshes[part]!.setColorAt(index, color);
  }
  return { id, appearance, size, x, z, role };
});
const cameraSelect = document.querySelector<HTMLSelectElement>('#camera')!;
const lightSelect = document.querySelector<HTMLSelectElement>('#lighting')!;
const terrainSelect = document.querySelector<HTMLSelectElement>('#terrain')!;
const activitySelect = document.querySelector<HTMLSelectElement>('#activity')!;
let paused = false, seconds = 0, previous = performance.now();
document.querySelector('#pause')!.addEventListener('click', () => { paused = !paused; });
function part(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, size: number, rx = 0, ry = 0) {
  object.position.set(x, y, z); object.rotation.set(rx, ry, 0); object.scale.setScalar(size); object.updateMatrix(); mesh.setMatrixAt(i, object.matrix);
}
function frame(now: number) {
  const dt = paused ? 0 : Math.min(0.04, (now - previous) / 1000); previous = now; seconds += dt;
  const day = lightSelect.value === 'day';
  scene.background = new THREE.Color(day ? '#a4b6c1' : '#0e1628');
  sun.intensity = day ? 3.3 : 0.25; fill.intensity = day ? 1.5 : 0.24;
  floorMaterial.color.set(terrainSelect.value === 'snow' ? '#d1d2c9' : terrainSelect.value === 'dark' ? '#222c28' : '#727d4b');
  updateCosmicBodyMaterial(material, day ? 1 : 0); accents.updateDaylight(day ? 1 : 0);
  const view = cameraSelect.value;
  camera.position.set(view === 'close' ? -0.3 : 0, view === 'close' ? 0.8 : view === 'normal' ? 6 : 19, view === 'close' ? 1.85 : view === 'normal' ? 9 : 25);
  camera.lookAt(view === 'close' ? -0.36 : 0, 0.13, view === 'close' ? 0.45 : 0);
  const width = canvas.clientWidth, height = canvas.clientHeight;
  renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  individuals.forEach(({ id, appearance, size: s, x, z, role }, i) => {
    const activity = activitySelect.value as AnimationState;
    animations.updateCharacterAnimation(id, dt, 'rest', activity, activity === 'walk' || activity === 'carry' ? 0.3 : 0, 360, activity === 'carry');
    const pose = animations.getCurrentPose(id)!;
    const lift = Math.max(-0.4, Math.min(0.1, pose.positionOffset.y)) * 0.35 * s;
    const yaw = 0.22 * Math.sin(i * 1.7);
    part(bodies, i, x, 0.44 * s + lift, z, s, pose.spineRotation, yaw + pose.pelvisRotation);
    accents.set(i, role, object.matrix, appearance.brightness);
    headAnchor.set(0, 0.4, 0).applyMatrix4(object.matrix);
    part(heads, i, headAnchor.x, headAnchor.y, headAnchor.z, s, pose.spineRotation, yaw + pose.headRotation);
    for (let side = 0; side < 2; side++) {
      const sign = side ? 1 : -1;
      part(arms, i * 2 + side, x + Math.cos(yaw) * sign * 0.15 * s, 0.62 * s + lift, z - Math.sin(yaw) * sign * 0.15 * s, s, side ? pose.rightShoulderRotation : pose.leftShoulderRotation, yaw);
      part(legs, i * 2 + side, x + Math.cos(yaw) * sign * 0.07 * s, 0.36 * s, z - Math.sin(yaw) * sign * 0.07 * s, s, side ? pose.rightHipRotation : pose.leftHipRotation, yaw);
    }
    part(props, i, x, 0.45 * s + lift, z + 0.16 * s, activity === 'carry' ? s : 0);
  });
  meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; }); props.instanceMatrix.needsUpdate = true; accents.endFrame();
  renderer.render(scene, camera);
  document.querySelector('#status')!.textContent = `${population} people · ${view} · ${day ? 'day' : 'night'} · ${renderer.info.render.calls} scene draws · ${renderer.info.render.triangles} triangles · t=${seconds.toFixed(1)}s. No bloom, no floating in-world labels.`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
