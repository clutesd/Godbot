/**
 * Manual WebGL acceptance fixture for the living-obsidian species.
 *
 * Production materials, production anatomy, production appearance profile and production adornment
 * atlas, assembled against the same skeleton contract, the same per-limb attachment points and the
 * same resting contrapposto the settlement renderer uses, and driven by the production animation
 * controller wherever a pose is involved. Never imported by the application.
 *
 * npm run dev -> /tests/obsidian-lineup-preview.html
 *   ?view=lineup   four characters standing together in daylight
 *   ?view=talk     two adults in conversation
 *   ?view=pair     an adult and a child
 *   ?view=walk     a character walking
 *   ?view=work     a worker carrying a tool
 *   ?view=closeup | portrait | side   close Historian observation
 *   ?view=crowd    ordinary Historian distance
 *   ?view=night    evening light
 *   &era=primitive|early|village|preIndustrial|industrial|advanced   &culture=a|b
 */
import * as THREE from 'three';
import {
  createCosmicArmGeometry, createCosmicBodyGeometry, createCosmicHeadGeometry,
  createCosmicLegGeometry, createObsidianReflectionEnvironment, updateCosmicBodyMaterial,
} from '../src/render/people/CosmicPeople';
import { HUMAN_SURFACE_MODE, createHumanSurfaceMaterial } from '../src/render/people/HumanSurfaceMaterial';
import { HumanFigureAppearance } from '../src/render/people/HumanFigureAppearance';
import { humanLookFor } from '../src/render/people/HumanAppearanceProfile';
import { createGarmentAtlasGeometry, createHeadAtlasGeometry } from '../src/render/people/HumanWardrobeAtlas';
import { HumanJointRig } from '../src/render/people/HumanJointRig';
import { AnimationController } from '../src/render/animation/AnimationController';
import type { Culture, Person } from '../src/sim/types';
import type { Era } from '../src/render/materials/MaterialPalette';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'lineup';
const era = (params.get('era') ?? 'village') as Era;
const night = view === 'night';
const moving = view === 'walk';

const canvas = document.querySelector('canvas')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? '#0a0c12' : '#8ea8bd');
const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.01, 200);

const sun = new THREE.DirectionalLight('#ffe9c6', night ? 0.12 : 3.3);
sun.position.set(-3.4, 6.2, 3.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.004;
sun.shadow.camera.left = -2.5; sun.shadow.camera.right = 2.5;
sun.shadow.camera.top = 2.5; sun.shadow.camera.bottom = -2.5;
const hemisphere = new THREE.HemisphereLight('#9dbdd6', '#5d4a38', night ? 0.22 : 1.5);
const moon = new THREE.DirectionalLight('#9fb6e0', night ? 0.42 : 0.1);
moon.position.set(4, 5, -4);
scene.add(sun, hemisphere, moon);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: night ? '#2b2f2a' : '#6f7a4e', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const CULTURES: Record<string, Culture> = {
  a: { id: 'culture-a', name: 'Ashfall', style: { primary: '#7a4f3a', secondary: '#3f5a6b', accent: '#d9a748', symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['a'] } } as unknown as Culture,
  b: { id: 'culture-b', name: 'Tidewright', style: { primary: '#3d5f4a', secondary: '#6b4660', accent: '#6fc6d8', symbol: 'river-eye', pattern: 'wave', nameSyllables: ['b'] } } as unknown as Culture,
};
const culture = CULTURES[params.get('culture') ?? 'a']!;

function person(id: string, sex: 'male' | 'female', ageMonths: number,
  extra: Partial<NonNullable<Person['appearance']>> & { role?: string; prestige?: number } = {}): Person {
  const { role, prestige, ...appearance } = extra;
  return {
    id, sex, ageMonths, role: role ?? 'farmer', cultureId: culture.id,
    prestige: prestige ?? 20, alive: true, homeId: 'settlement', activity: 'idle',
    position: { x: 0, z: 0 },
    socialPosition: { householdWealth: 0.5 },
    appearance: {
      heightScale: 1, buildScale: 1, posture: 0, garment: 'simple', headwear: 'none',
      carriedItem: 'none', textilePattern: culture.style.pattern, materialQuality: 0.55,
      ...appearance,
    },
  } as unknown as Person;
}

const MALE = person('godbox-male', 'male', 31 * 12, { role: 'builder', prestige: 45 });
const FEMALE = person('godbox-female', 'female', 29 * 12, { role: 'priest', prestige: 55, garment: 'ceremonial' });
const ADOLESCENT = person('godbox-adolescent', 'female', 13 * 12, { role: 'child' });
const CHILD = person('godbox-child', 'male', 5 * 12, { role: 'child' });

interface Placement { subject: Person; x: number; z: number; yaw: number }

const CAST: Placement[] = view === 'crowd'
  ? Array.from({ length: 12 }, (_, i) => ({
    subject: person(`crowd-${i}`, i % 2 ? 'female' : 'male', (4 + (i * 7) % 56) * 12,
      { role: ['farmer', 'guard', 'priest', 'builder', 'elder', 'merchant'][i % 6]!,
        garment: (['simple', 'workwear', 'ceremonial', 'layered'] as const)[i % 4],
        prestige: (i * 13) % 90 }),
    x: (i % 4 - 1.5) * 0.42, z: -Math.floor(i / 4) * 0.5, yaw: Math.sin(i * 2.3) * 0.9,
  }))
  : view === 'talk'
    ? [{ subject: MALE, x: -0.21, z: 0, yaw: 1.26 }, { subject: FEMALE, x: 0.21, z: 0.05, yaw: -1.32 }]
    : view === 'pair'
      ? [{ subject: FEMALE, x: -0.11, z: 0, yaw: 0.26 }, { subject: CHILD, x: 0.13, z: 0.04, yaw: -0.38 }]
      : view === 'walk' || view === 'work'
        ? [{ subject: MALE, x: 0, z: 0, yaw: 0.42 }]
        : [MALE, FEMALE, ADOLESCENT, CHILD].map((subject, i) => ({
          subject, x: (i - 1.5) * 0.44, z: 0, yaw: 0,
        }));

// ---- the production material family, one program, five modes -----------------------------------
const materials = {
  torso: createHumanSurfaceMaterial(HUMAN_SURFACE_MODE.torso),
  head: createHumanSurfaceMaterial(HUMAN_SURFACE_MODE.head),
  limb: createHumanSurfaceMaterial(HUMAN_SURFACE_MODE.limb),
  garment: createHumanSurfaceMaterial(HUMAN_SURFACE_MODE.garment),
  headgear: createHumanSurfaceMaterial(HUMAN_SURFACE_MODE.headgear),
};
const reflections = createObsidianReflectionEnvironment(renderer);
for (const material of Object.values(materials)) {
  material.envMap = reflections.texture;
  updateCosmicBodyMaterial(material, night ? 0 : 1);
}

const count = CAST.length;
const meshes = {
  torso: new THREE.InstancedMesh(createCosmicBodyGeometry(), materials.torso, count),
  head: new THREE.InstancedMesh(createCosmicHeadGeometry(), materials.head, count),
  upperArms: new THREE.InstancedMesh(createCosmicArmGeometry('upper'), materials.limb, count * 2),
  forearms: new THREE.InstancedMesh(createCosmicArmGeometry('lower'), materials.limb, count * 2),
  thighs: new THREE.InstancedMesh(createCosmicLegGeometry('upper'), materials.limb, count * 2),
  shins: new THREE.InstancedMesh(createCosmicLegGeometry('lower'), materials.limb, count * 2),
  garments: new THREE.InstancedMesh(createGarmentAtlasGeometry(), materials.garment, count),
  headgear: new THREE.InstancedMesh(createHeadAtlasGeometry(), materials.headgear, count),
  mantles: new THREE.InstancedMesh(new THREE.BufferGeometry(), materials.garment, 1),
};
for (const mesh of Object.values(meshes)) {
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  if (mesh !== meshes.mantles) scene.add(mesh);
}
const appearance = new HumanFigureAppearance(meshes);

const tool = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.011, 0.34, 8),
  new THREE.MeshStandardMaterial({ color: '#6b4f31', roughness: 0.9 }), count);
tool.frustumCulled = false; tool.castShadow = true; tool.count = 0;
scene.add(tool);

// ---- placement: the renderer's own skeleton contract and resting stance -------------------------
const HUMAN_WORLD_SCALE = 0.28;
const COSMIC_HEIGHT_MULTIPLIER = 1.14;
const joints = new HumanJointRig();
const object = new THREE.Object3D();
const torsoMatrix = new THREE.Matrix4();
const hipMatrix = new THREE.Matrix4();
const point = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchScale = new THREE.Vector3();

const animations = new AnimationController('obsidian-review');
for (const placement of CAST) animations.getOrCreateCharacterState(placement.subject.id, 'builder');

function compose(target: THREE.Matrix4, x: number, y: number, z: number,
  scale: number, pitch: number, yaw: number, roll: number) {
  scratchPosition.set(x, y, z);
  scratchQuaternion.setFromEuler(scratchEuler.set(pitch, yaw, roll, 'YXZ'));
  target.compose(scratchPosition, scratchQuaternion, scratchScale.setScalar(scale));
}

let seconds = 0;

function layout(delta: number) {
  let tools = 0;
  CAST.forEach((placement, index) => {
    const { subject, x, z, yaw } = placement;
    const look = humanLookFor(subject, { culture, era, prosperity: 0.55, cold: 0.3 });
    const { proportions, posture } = look;
    appearance.apply(index, look, culture.style.pattern);

    if (moving) {
      const state = animations.getOrCreateCharacterState(subject.id, 'builder');
      state.stridePhase = (seconds * 4.4 + index * 1.7) % (Math.PI * 2);
      animations.updateCharacterAnimation(subject.id, delta, 'travel', 'walk', 0.42, subject.ageMonths);
    }
    const pose = moving ? animations.getCurrentPose(subject.id) : undefined;
    const resting = !pose;

    const ageMonths = subject.ageMonths;
    const ageScale = ageMonths < 14 * 12 ? 0.64 + ageMonths / (14 * 12) * 0.08
      : ageMonths > 68 * 12 ? 0.88 : 1;
    const height = HUMAN_WORLD_SCALE * COSMIC_HEIGHT_MULTIPLIER * ageScale;
    const legShortfall = 0.45 * (1 - proportions.legLength);
    const lift = Math.max(-0.4, Math.min(0.1, pose?.positionOffset.y ?? 0)) * height;
    // Idle breath, out of phase per person, so a group never pulses together.
    const idle = resting ? Math.sin(seconds * 1.15 + index * 2.1) * 0.0016 * height : 0;

    const bodyRoll = (pose?.spineRoll ?? 0) - (resting ? posture.pelvisTilt * 0.6 : 0);
    compose(torsoMatrix, x, (0.44 - legShortfall) * height + lift + idle, z,
      height, 0, yaw + (pose?.spineRotation ?? 0) + (pose?.spineTwist ?? 0) * 0.5, bodyRoll);
    meshes.torso.setMatrixAt(index, torsoMatrix);
    meshes.garments.setMatrixAt(index, torsoMatrix);
    appearance.applyGarment(index, look, culture.style.pattern);

    const neckDrop = (1 - proportions.neckScale) * 0.034;
    point.set(0, 0.425 - neckDrop, 0).applyMatrix4(torsoMatrix);
    const headYaw = yaw + posture.headTilt * 0.6 + (view === 'talk' ? -yaw * 0.2 : 0)
      + (pose?.headRotation ?? 0);
    compose(object.matrix, point.x, point.y, point.z, height,
      (pose?.headPitch ?? 0) + (view === 'pair' && index === 0 ? 0.16 : 0), headYaw, posture.headTilt);
    meshes.head.setMatrixAt(index, object.matrix);
    meshes.headgear.setMatrixAt(index, object.matrix);
    appearance.applyHeadgear(index, look);

    const upperArm = 0.19 * proportions.armLength, forearm = 0.18 * proportions.armLength;
    const shoulderX = 0.12 * proportions.shoulderScale;
    for (let side = 0; side < 2; side++) {
      const splay = (side ? 1 : -1) * (0.028 + posture.armRest * 0.55);
      const lead = resting ? (side ? 1 : -1) * posture.armLead : 0;
      joints.compose(torsoMatrix, (side ? 1 : -1) * shoulderX,
        0.27 + (side ? posture.shoulderDrop : -posture.shoulderDrop),
        (side ? pose?.rightShoulderRotation ?? 0 : pose?.leftShoulderRotation ?? 0) + lead,
        (side ? pose?.rightElbowRotation ?? 0.12 : pose?.leftElbowRotation ?? 0.12)
        + Math.abs(lead) * (lead > 0 ? 0.5 : 0.18),
        upperArm, forearm, true, splay);
      meshes.upperArms.setMatrixAt(index * 2 + side, joints.upper);
      meshes.forearms.setMatrixAt(index * 2 + side, joints.lower);
      if (side === 1 && view === 'work') {
        compose(object.matrix, joints.tip.x, joints.tip.y, joints.tip.z, height, 0.68, yaw, 0.15);
        tool.setMatrixAt(tools++, object.matrix);
      }
    }

    const legSegment = 0.225 * proportions.legLength;
    compose(hipMatrix, x, legSegment * 2 * height + lift + idle, z, height,
      0, yaw + (pose?.pelvisRotation ?? 0), resting ? posture.pelvisTilt : 0);
    for (let side = 0; side < 2; side++) {
      const free = resting ? (side ? Math.max(0, -posture.weightShift) : Math.max(0, posture.weightShift)) : 0;
      joints.compose(hipMatrix, (side ? 1 : -1) * posture.stanceWidth, 0,
        (side ? pose?.rightHipRotation ?? 0 : pose?.leftHipRotation ?? 0) - free * 0.14,
        (side ? pose?.rightKneeRotation ?? 0 : pose?.leftKneeRotation ?? 0) + free * 0.3,
        legSegment, legSegment, false);
      meshes.thighs.setMatrixAt(index * 2 + side, joints.upper);
      meshes.shins.setMatrixAt(index * 2 + side, joints.lower);
    }
  });
  tool.count = tools;
  appearance.endFrame();
  for (const mesh of Object.values(meshes)) mesh.instanceMatrix.needsUpdate = true;
  tool.instanceMatrix.needsUpdate = true;
}

const crown = 0.94 * HUMAN_WORLD_SCALE * COSMIC_HEIGHT_MULTIPLIER;
if (view === 'portrait') {
  camera.position.set(-0.52, crown * 0.95, 0.30);
  camera.lookAt(-0.655, crown * 0.925, 0);
} else if (view === 'side') {
  camera.position.set(-1.62, crown * 0.56, 0.0);
  camera.lookAt(-0.66, crown * 0.50, 0);
} else if (view === 'closeup') {
  camera.position.set(-0.40, crown * 0.86, 0.46);
  camera.lookAt(-0.63, crown * 0.74, 0);
} else if (view === 'crowd') {
  camera.position.set(1.5, 0.78, 2.5);
  camera.lookAt(0, 0.34, -0.4);
} else if (view === 'talk' || view === 'pair') {
  camera.position.set(0.26, crown * 0.78, 0.95);
  camera.lookAt(0, crown * 0.54, 0);
} else if (view === 'walk' || view === 'work') {
  camera.position.set(0.58, crown * 0.70, 0.82);
  camera.lookAt(0, crown * 0.48, 0);
} else {
  camera.position.set(0, crown * 0.58, 1.62);
  camera.lookAt(0, crown * 0.50, 0);
}
sun.target.position.set(0, 0.3, 0);
scene.add(sun.target);

function resize() {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width === width && canvas.height === height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const hidden = (params.get('hide') ?? '').split(',');
for (const name of hidden) {
  const mesh = (meshes as Record<string, THREE.InstancedMesh>)[name];
  if (mesh) mesh.visible = false;
}
let previous = performance.now();

function frame() {
  const now = performance.now();
  const delta = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  seconds += delta;
  resize();
  layout(delta);
  renderer.render(scene, camera);
  (window as unknown as { obsidianReady: boolean }).obsidianReady = true;
  requestAnimationFrame(frame);
}
frame();
