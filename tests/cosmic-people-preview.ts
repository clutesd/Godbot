/** Manual WebGL acceptance fixture. Production assets, animation clips and real camera distances.
 * npm run dev -> /tests/cosmic-people-preview.html. Never imported by the application. */
import * as THREE from 'three';
import { CosmicRoleAccents, COSMIC_HEIGHT_MULTIPLIER, COSMIC_BUILD_MULTIPLIER, cosmicAppearanceFor, cosmicRoleFor, createCosmicBodyGeometry, createCosmicHeadGeometry, createCosmicArmGeometry, createCosmicLegGeometry, createCosmicBodyMaterial, createCosmicReflectionEnvironment, bindCosmicVariation, updateCosmicBodyMaterial } from '../src/render/people/CosmicPeople';
import { AnimationController, type AnimationState } from '../src/render/animation/AnimationController';
import { ResourceWorkerRenderer } from '../src/render/resources/ResourceWorkerRenderer';
import { createResourceWorkMotion, sampleResourceWorkMotion } from '../src/render/animation/ResourceWorkMotion';
import { resourceWorkProfile, resourceWorkerVariation } from '../src/sim/resources/ResourceWorkPresentation';
import { EcologyPostProcessing } from '../src/render/atmosphere/EcologyPostProcessing';
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
const reflections = createCosmicReflectionEnvironment(renderer);
material.envMap = reflections.texture;
const roles: PersonRole[] = ['farmer', 'fisher', 'builder', 'merchant', 'guard', 'priest', 'administrator', 'scholar', 'engineer', 'healer', 'elder', 'child'];
const population = Math.floor(THREE.MathUtils.clamp(Number(new URLSearchParams(location.search).get('population')) || 12, 12, 1536));
const bodies = new THREE.InstancedMesh(createCosmicBodyGeometry(), material, population);
const heads = new THREE.InstancedMesh(createCosmicHeadGeometry(), material, population);
const arms = new THREE.InstancedMesh(createCosmicArmGeometry(), material, population * 2);
const legs = new THREE.InstancedMesh(createCosmicLegGeometry(), material, population * 2);
const meshes = [bodies, heads, arms, legs];
const accents = new CosmicRoleAccents(population); accents.mesh.count = population; scene.add(accents.mesh);
const props = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), new THREE.MeshStandardMaterial({ color: '#94744a' }), population); scene.add(props);
const variation = meshes.map(bindCosmicVariation);
meshes.forEach(mesh => { mesh.frustumCulled = false; mesh.castShadow = true; scene.add(mesh); });
const rigs = new ResourceWorkerRenderer(); rigs.setReflectionEnvironment(reflections.texture); scene.add(rigs.group);
const motion = createResourceWorkMotion();
const profiles = ['timber', 'stone', 'plant-fiber'].map(resourceId => resourceWorkProfile({
  month: 0, source: 'world-resource', settlementId: 'study', siteId: 'study', resourceId,
  worldPosition: { x: 0, z: 0 }, gatherOccupations: ['forager'], labourByOccupation: { forager: 12 }, amountExtracted: 12, labourUsed: 12,
}));
const post = new EcologyPostProcessing(renderer, scene, camera, 1);
let previousWidth = 0, previousHeight = 0;
const animations = new AnimationController('cosmic-review');
const object = new THREE.Object3D(); const color = new THREE.Color();
const headAnchor = new THREE.Vector3();
const torsoMatrix = new THREE.Matrix4();
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
const roleSelect = document.querySelector<HTMLSelectElement>('#role')!;
for (const role of roles) { const option = new Option(role, role); roleSelect.add(option); }
roleSelect.value = 'builder';
let paused = false, seconds = 0, previous = performance.now();
document.querySelector('#pause')!.addEventListener('click', () => { paused = !paused; });
document.querySelector('#step')!.addEventListener('click', () => { seconds += 0.25; });
function part(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, size: number, rx = 0, ry = 0) {
  object.position.set(x, y, z); object.rotation.set(rx, ry, 0); object.scale.setScalar(size); object.updateMatrix(); mesh.setMatrixAt(i, object.matrix);
}
function frame(now: number) {
  const dt = paused ? 0 : Math.min(0.04, (now - previous) / 1000); previous = now; seconds += dt;
  const light = { day: 1, overcast: 0.7, twilight: 0.25, moonlight: 0.08, night: 0 }[lightSelect.value] ?? 1;
  const day = light > 0.5;
  scene.background = new THREE.Color(day ? '#a4b6c1' : '#0e1628');
  sun.intensity = lightSelect.value === 'overcast' ? 0.6 : 0.18 + light * 3.12; fill.intensity = 0.24 + light * 1.26;
  floorMaterial.color.set(terrainSelect.value === 'snow' ? '#d1d2c9' : terrainSelect.value === 'dark' ? '#222c28' : '#727d4b');
  rigs.beginFrame(); rigs.updateDaylight(light);
  updateCosmicBodyMaterial(material, light); accents.updateDaylight(light);
  material.userData['interior'].value = document.querySelector<HTMLInputElement>('#interior')!.checked ? 1 : 0;
  const view = cameraSelect.value;
  const study = ['portrait', 'turnaround'].includes(view);
  camera.position.set(view === 'close' ? -0.3 : 0, view === 'close' ? 0.8 : view === 'normal' ? 6 : 19, view === 'close' ? 1.85 : view === 'normal' ? 9 : 25);
  camera.lookAt(view === 'close' ? -0.36 : 0, 0.13, view === 'close' ? 0.45 : 0);
  if (study) { camera.position.set(0, view === 'portrait' ? 0.24 : 0.17, view === 'portrait' ? 0.39 : 0.88); camera.lookAt(0, view === 'portrait' ? 0.24 : 0.15, 0); }
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (width !== previousWidth || height !== previousHeight) { renderer.setSize(width, height, false); post.resize(width, height); previousWidth = width; previousHeight = height; }
  camera.aspect = width / height; camera.updateProjectionMatrix();
  const count = view === 'portrait' ? 1 : study ? 3 : population;
  bodies.count = heads.count = accents.mesh.count = count; arms.count = legs.count = count * 2; props.count = count;
  individuals.slice(0, count).forEach(({ id, appearance, size: s, x: originalX, z: originalZ, role }, i) => {
    const x = study ? (view === 'portrait' ? 0 : (i - 1) * 0.22) : originalX;
    const z = study ? 0 : originalZ;
    const build = COSMIC_BUILD_MULTIPLIER * appearance.build;
    const workIndex = ['timber', 'stone', 'plant-fiber'].indexOf(activitySelect.value);
    const physical = workIndex >= 0;
    const activity = (physical ? 'idle' : activitySelect.value) as AnimationState;
    const selectedRole = study ? roleSelect.value : role;
    color.set(cosmicRoleFor(selectedRole).color);
    bodies.setColorAt(i, color); heads.setColorAt(i, color);
    for (let side = 0; side < 2; side++) { arms.setColorAt(i * 2 + side, color); legs.setColorAt(i * 2 + side, color); }
    animations.updateCharacterAnimation(id, dt, 'rest', activity, activity === 'walk' || activity === 'carry' ? 0.3 : 0, 360, activity === 'carry');
    let pose = animations.getCurrentPose(id)!;
    if (physical) {
      sampleResourceWorkMotion(profiles[workIndex]!, resourceWorkerVariation('cosmic-review', id, 'study'), seconds, motion);
      pose = animations.resourcePose(pose, motion, 1);
    }
    const lift = Math.max(-0.4, Math.min(0.1, pose.positionOffset.y)) * (physical ? 1 : 0.35) * s;
    const yaw = study ? i * Math.PI / 2 : 0.22 * Math.sin(i * 1.7);
    part(bodies, i, x, (0.44 + (physical ? 0.03 : 0)) * s + lift, z, s, pose.spineRotation, yaw + pose.pelvisRotation);
    object.scale.set(s * build, s, s * build); object.updateMatrix(); bodies.setMatrixAt(i, object.matrix);
    torsoMatrix.copy(object.matrix);
    accents.set(i, selectedRole, torsoMatrix, appearance.brightness);
    headAnchor.set(0, 0.425, 0).applyMatrix4(torsoMatrix);
    part(heads, i, headAnchor.x, headAnchor.y, headAnchor.z, s, pose.spineRotation, yaw + pose.headRotation);
    for (let side = 0; side < 2; side++) {
      const sign = side ? 1 : -1;
      headAnchor.set(sign * 0.12, 0.27, 0).applyMatrix4(torsoMatrix);
      part(arms, i * 2 + side, headAnchor.x, headAnchor.y, headAnchor.z, physical ? 0 : s,
        pose.spineRotation + (side ? pose.rightShoulderRotation : pose.leftShoulderRotation), yaw + pose.pelvisRotation);
      object.rotation.z = sign * 0.025; object.updateMatrix(); arms.setMatrixAt(i * 2 + side, object.matrix);
      part(legs, i * 2 + side, x + Math.cos(yaw) * sign * 0.049 * build * s, 0.45 * s, z - Math.sin(yaw) * sign * 0.049 * build * s, physical ? 0 : s, side ? pose.rightHipRotation : pose.leftHipRotation, yaw);
    }
    if (physical) {
      rigs.setBodyTransform(torsoMatrix);
      rigs.drawPhysical(motion, { x: x + Math.sin(yaw) * s * 0.45, z: z + Math.cos(yaw) * s * 0.45 },
        profiles[workIndex]!.tool, workIndex === 2 && motion.held ? 'crop' : undefined,
        profiles[workIndex]!.materialColour, 1, x, 0, z, s, yaw, color, workIndex === 2, false);
    }
    part(props, i, x, 0.45 * s + lift, z + 0.16 * s, activity === 'carry' ? s : 0);
  });
  meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }); props.instanceMatrix.needsUpdate = true; accents.endFrame();
  rigs.endFrame();
  const bloom = document.querySelector<HTMLInputElement>('#bloom')!.checked;
  if (bloom) post.render(1 - light); else renderer.render(scene, camera);
  document.querySelector('#status')!.textContent = `${count} people · ${view} · ${lightSelect.value} · ${renderer.info.render.calls} scene draws · ${renderer.info.render.triangles} triangles · t=${seconds.toFixed(1)}s. ${bloom ? 'Production postprocessing' : 'Raw render'} | interior ${material.userData['interior'].value ? 'on' : 'off'}.`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
