/** Interactive QA fixture using production site geometry, work profiles and articulated rigs.
 * Open /tests/resource-work-preview.html with npm run dev. Never imported by the application. */
import * as THREE from 'three';
import { vegetationFixture } from './fixtures/vegetation';
import { ResourceWorkScene } from '../src/render/resources/ResourceWorkScene';
import { ResourceSiteRenderer } from '../src/render/resources/ResourceSiteRenderer';
import { ResourceWorkerRenderer } from '../src/render/resources/ResourceWorkerRenderer';
import { beginResourceWorkMonth, recordResourceWorkAssignment, type ResourceWorkAssignment } from '../src/sim/resources/ResourceWorkAssignments';
import { resourceWorkDestinationId } from '../src/sim/people/ResourceWorkRouting';
import { resourceWorkAlternateAnchor } from '../src/render/animation/ResourceWorkMotion';
import type { Person } from '../src/sim/types';

const { simulation, world, surface } = vegetationFixture('resource-work-study');
for (const cell of world.cells) { cell.landform = 'lowland'; cell.movementCost = 1; }
const scene = new THREE.Scene(); scene.background = new THREE.Color('#a9b2a0');
const canvas = document.querySelector('canvas')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 200);
const groundY = surface.heightAt(0, 0);
const light = new THREE.DirectionalLight('#ffe7bd', 3.2); light.position.set(-2, groundY + 5, 3);
light.target.position.set(0, groundY, 0); light.castShadow = true; light.shadow.mapSize.set(2048, 2048);
light.shadow.camera.left = -2; light.shadow.camera.right = 2; light.shadow.camera.top = 2; light.shadow.camera.bottom = -2;
light.shadow.normalBias = 0.005;
scene.add(light, light.target, new THREE.HemisphereLight('#dce7d5', '#5f543c', 2));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: '#8b966e', roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = groundY - 0.004; floor.receiveShadow = true; scene.add(floor);
const work = new ResourceWorkScene(world, 'resource-work-study');
const sites = new ResourceSiteRenderer(world, surface, work);
const rigs = new ResourceWorkerRenderer(); scene.add(sites.group, rigs.group);
const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.12, 0.34, 2, 5), new THREE.MeshStandardMaterial({ color: '#b88a61', roughness: 1 }), 4);
const heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12, 1), new THREE.MeshStandardMaterial({ color: '#d6b180', roughness: 1 }), 4);
body.castShadow = true; heads.castShadow = true; body.frustumCulled = false; heads.frustumCulled = false; scene.add(body, heads);
const marker = new THREE.Object3D(); const colour = new THREE.Color('#af8157');
let seconds = 0, paused = false, medium = false, previous = performance.now();
let people: Person[] = [];
const select = document.querySelector('select')!;
function setCamera() { camera.position.set(medium ? 3.8 : 1.3, groundY + (medium ? 2.9 : 1.05), medium ? 5.5 : 1.9); camera.lookAt(0.12, groundY + 0.12, 0); }
function setWork() {
  simulation.state.month++; beginResourceWorkMonth(simulation.state);
  const assignment: ResourceWorkAssignment = { month: simulation.state.month, source: 'world-resource', settlementId: simulation.state.settlements[0]!.id,
    siteId: 'study-site', resourceId: select.value, worldPosition: { x: 0, z: 0 }, gatherOccupations: ['forager'], labourByOccupation: { forager: 12 }, amountExtracted: 12, labourUsed: 12 };
  recordResourceWorkAssignment(simulation.state, assignment); sites.update();
  const site = [...work.sites.values()][0]!;
  people = simulation.state.people.slice(0, 4).map((person, i) => ({ ...person, homeId: assignment.settlementId, alive: true, role: 'gatherer', occupation: 'forager', activity: 'gather', health: 1,
    displacedSinceMonth: undefined, position: { ...site.stations[i]!.anchor },
    navigation: { ...person.navigation!, destinationId: resourceWorkDestinationId(assignment), traveling: false, schedulePhase: 'work' } }));
  work.bindWorkers(people);
}
select.addEventListener('change', setWork);
document.querySelector('#pause')!.addEventListener('click', e => { paused = !paused; (e.target as HTMLElement).textContent = paused ? 'Play' : 'Pause'; });
document.querySelector('#step')!.addEventListener('click', () => { paused = true; seconds += 0.25; document.querySelector('#pause')!.textContent = 'Play'; });
document.querySelector('#camera')!.addEventListener('click', e => { medium = !medium; setCamera(); (e.target as HTMLElement).textContent = medium ? 'Close view' : 'Medium view'; });
document.querySelector('#clear')!.addEventListener('click', () => { simulation.state.month++; beginResourceWorkMonth(simulation.state); sites.update(); });
setWork(); setCamera();
function frame(now: number) {
  const delta = Math.min(0.05, (now - previous) / 1000); previous = now; if (!paused) seconds += delta;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  rigs.beginFrame(); let index = 0;
  for (const person of people) {
    const worker = work.workers.get(person.id); if (!worker) continue;
    const point = resourceWorkAlternateAnchor(worker.site.profile, worker.variation, seconds) ? worker.station.alternate : worker.station.anchor;
    const facing = Math.atan2(worker.station.target.x - point.x, worker.station.target.z - point.z);
    rigs.sample(worker, seconds, delta, true);
    const motion = rigs.motion;
    marker.position.set(point.x, groundY + (0.44 + (0.03 - motion.crouch) * worker.blend) * 0.28, point.z);
    marker.rotation.set(motion.lean * worker.blend, facing + motion.twist * worker.blend, 0); marker.scale.setScalar(0.28); marker.updateMatrix(); body.setMatrixAt(index, marker.matrix);
    marker.position.y = groundY + (0.84 - motion.crouch * worker.blend) * 0.28; marker.rotation.set(0, facing, 0); marker.updateMatrix(); heads.setMatrixAt(index++, marker.matrix);
    rigs.draw(worker, point.x, groundY, point.z, 0.28, facing, colour);
  }
  body.count = index; heads.count = index; body.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
  rigs.endFrame(); renderer.render(scene, camera);
  document.querySelector('#status')!.textContent = `${index} fixture residents · ${select.selectedOptions[0]!.text} · ${seconds.toFixed(2)}s · ${renderer.info.render.calls} draw calls · ${renderer.info.memory.geometries} geometries · work stays gather · current ledger only`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
