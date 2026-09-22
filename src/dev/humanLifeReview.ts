import { StructureNavigation } from '../sim/people/StructureNavigation';
import { CameraDirector, type CameraSubjectPresentation } from '../render/CameraDirector';
import { Historian } from '../historian/Historian';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Simulation } from '../sim/Simulation';
import type { Activity, DestinationKind, Occupation, Person, PersonRole, Vec2 } from '../sim/types';
import type { DevelopmentResponse } from '../sim/development/types';
import { AssetBuilder } from '../render/assets/AssetBuilder';
import { MaterialPalette } from '../render/materials/MaterialPalette';
import { TerrainSurface } from '../render/terrain/TerrainSurface';
import { LocalActivityPresentation, clearActivityStructure, type ActivityStructure } from '../render/people/LocalActivityPresentation';
import { PeopleVisualStateStore } from '../render/people/PeopleVisualState';
import { buildSocialGroups, groupKeyFor, placeInGroup, travelAnimationFor } from '../render/people/PeoplePresentation';
import { AnimationController } from '../render/animation/AnimationController';
import { PhysicalWorkScene, type WorkPlacement } from '../render/people/PhysicalWorkScene';
import { facingTarget, workInterruption } from '../render/people/PhysicalActionPresentation';
import { FarmFieldRenderer } from '../render/farming/FarmFieldRenderer';
import { farmAnchor, farmGeometry } from '../shared/FarmGeometry';
import { ResourceWorkScene, resourceWorkerCanPresent } from '../render/resources/ResourceWorkScene';
import { ResourceSiteRenderer } from '../render/resources/ResourceSiteRenderer';
import { ResourceWorkerRenderer } from '../render/resources/ResourceWorkerRenderer';
import { resourceWorkAlternateAnchor } from '../render/animation/ResourceWorkMotion';
import { beginResourceWorkMonth, recordResourceWorkAssignment, resourceWorkAssignmentsForWorld } from '../sim/resources/ResourceWorkAssignments';
import { resourceWorkDestinationId } from '../sim/people/ResourceWorkRouting';
import { ConstructionAssembly } from '../render/construction/ConstructionAssembly';
import { createConstructionWorksite, updateConstructionWorksite } from '../render/construction/ConstructionWorksite';
import { createConstructionScaffold, updateConstructionScaffold } from '../render/construction/ConstructionScaffold';
import { constructionMaterialColour } from '../render/construction/ConstructionChoreography';

if (!import.meta.env.DEV) throw new Error('Human life review is a development fixture.');
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const simulation = new Simulation({ seed: 'human-life-review', startingPopulation: 40, settlementCount: [2, 2], world: { size: 20 } });
const state = simulation.state, world = state.world, settlement = state.settlements[0]!;
// Explicit fixture authority. Nothing below the setup block advances the simulation.
world.terrain.height.fill(world.seaLevel + 0.1); world.terrain.waterLevel.fill(-1); world.terrain.flow.fill(0);
for (const cell of world.cells) Object.assign(cell, { water: false, river: false, lake: false, landform: 'lowland', movementCost: 1, elevation: world.seaLevel + 0.1, slope: 0 });
for (const weather of state.weather.cells) Object.assign(weather, { kind: 'clear', wind: 0, floodDepth: 0, blizzard: 0, snowpack: 0, cropDamage: 0, temperature: 0.6 });
state.month = 6; settlement.alive = true;
state.settlements = [settlement]; settlement.structurePlots = [];
settlement.resources = { food: 20, wood: 20, minerals: 20, goods: 20, wealth: 20 };
settlement.agriculture = { month: 6, labour: 5, yieldPerWorker: 2, production: 10, irrigation: 0.6 };
const surface = new TerrainSurface(world), groundY = surface.heightAt(0, 0);
const navigation = new StructureNavigation();
const ground = { heightAt: () => groundY, isStandable: () => true,
  safeSegment: (a: Vec2, b: Vec2) => navigation.clear(a, b),
  detour: (a: Vec2, b: Vec2) => navigation.detour(a, b, (a, b) => navigation.clear(a, b)) };
const scene = new THREE.Scene(); scene.background = new THREE.Color('#b3bfac');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25; document.body.append(renderer.domElement);
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200), controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight('#eff1dd', '#555d40', 2.4));
const sun = new THREE.DirectionalLight('#ffe6bc', 3.2); sun.position.set(-8, groundY + 16, 5); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = sun.shadow.camera.bottom = -12;
sun.shadow.camera.right = sun.shadow.camera.top = 12; sun.shadow.normalBias = 0.015; scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 30), new THREE.MeshStandardMaterial({ color: '#8a9774', roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = groundY - 0.01; floor.receiveShadow = true; scene.add(floor);
const assets = new AssetBuilder('human-life-review'), culture = state.cultures[0]!.style;
const palette = new MaterialPalette({ culture, era: 'village' });
const locals = new LocalActivityPresentation(), visuals = new PeopleVisualStateStore(), animation = new AnimationController('human-life-review');
const physical = new PhysicalWorkScene(), fields = new FarmFieldRenderer(); scene.add(fields.group);
const resources = new ResourceWorkScene(world, 'human-life-review');
const resourceSites = new ResourceSiteRenderer(world, surface, resources); scene.add(resourceSites.group);
const resourceRigs = new ResourceWorkerRenderer(), physicalRigs = new ResourceWorkerRenderer(); scene.add(resourceRigs.group, physicalRigs.group);
const structures: ActivityStructure[] = [];
type Station = { name: string; kind: DestinationKind; activity: Activity; occupation: Occupation; role: PersonRole; building?: string; x: number; z: number };
const stations: Station[] = [
  ['Home', 'home', 'rest', 'elder', 'elder', 'house'], ['Market', 'market', 'trade', 'carrier', 'merchant', 'market'],
  ['Plaza', 'plaza', 'socialize', 'keeper', 'healer', undefined], ['Field', 'field', 'farm', 'farmer', 'farmer', undefined],
  ['Workshop', 'workshop', 'craft', 'artisan', 'craft-worker', 'workshop'], ['Shrine', 'shrine', 'worship', 'keeper', 'priest', 'shrine'],
  ['Civic', 'civic-building', 'assist', 'keeper', 'administrator', 'hall'], ['Knowledge', 'knowledge-institution', 'study', 'keeper', 'scholar', 'research'],
  ['Industrial', 'industrial-site', 'craft', 'artisan', 'machinist', 'factory'], ['Patrol', 'patrol-route', 'patrol', 'keeper', 'guard', undefined],
  ['Resource', 'field', 'gather', 'forager', 'miner', undefined], ['Construction', 'construction-site', 'construct', 'builder', 'builder', undefined],
].map((values, i) => ({ name: values[0], kind: values[1], activity: values[2], occupation: values[3], role: values[4], building: values[5],
  x: (i % 4 - 1.5) * 3.6, z: (Math.floor(i / 4) - 1) * 3.5 })) as Station[];
const labels: { node: HTMLElement; at: THREE.Vector3 }[] = [];
for (const [i, station] of stations.entries()) {
  const option = document.createElement('option'); option.value = String(i); option.textContent = station.name; element<HTMLSelectElement>('focus').append(option);
  const label = document.createElement('div'); label.className = 'site-label'; label.textContent = station.name; document.body.append(label);
  labels.push({ node: label, at: new THREE.Vector3(station.x, groundY + 0.07, station.z - 0.9) });
  const path = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.7), new THREE.MeshStandardMaterial({ color: i === 3 ? '#806748' : '#a29373', roughness: 1 }));
  path.rotation.x = -Math.PI / 2; path.position.set(station.x, groundY - 0.003, station.z + 0.2); path.receiveShadow = true; scene.add(path);
  if (!station.building) continue;
  const era = station.building === 'factory' || station.building === 'research' ? 'industrial' : 'village';
  const asset = assets.getAsset('building', { seed: `life:${station.name}`, culture, era, variant: `${station.building}#3` }).mesh;
  const scale = 0.9 / Number(asset.userData['footprintWidth'] ?? 1); asset.scale.setScalar(scale);
  asset.position.set(station.x, groundY, station.z); scene.add(asset);
  structures.push({ key: station.name, worldX: station.x, worldZ: station.z, width: 0.9,
    depth: Number(asset.userData['footprintDepth'] ?? 1) * scale, rotationY: 0, role: station.building });
}
const farmStation = stations[3]!, oldField = farmGeometry(settlement)!;
settlement.position.x += farmStation.x - oldField.center.x; settlement.position.z += farmStation.z - oldField.center.z;
fields.update(state, ground.heightAt, ground.isStandable);
const field = fields.fields.get(settlement.id)!;
const resourceStation = stations[10]!;
beginResourceWorkMonth(state);
const assignment = { month: 6, source: 'world-resource' as const, settlementId: settlement.id, siteId: 'review-stone', resourceId: 'stone',
  worldPosition: { x: resourceStation.x, z: resourceStation.z }, gatherOccupations: ['forager' as const], labourByOccupation: { forager: 3 }, amountExtracted: 3, labourUsed: 3 };
recordResourceWorkAssignment(state, assignment); resourceSites.update();
const buildStation = stations[11]!;
const response: DevelopmentResponse = { need: 'housing', form: 'dwelling', name: 'house', level: 2, material: 'timber', cultureId: state.people[0]!.cultureId,
  style: culture, services: { housing: 2 }, reasons: [], capabilities: [], cost: { food: 0, wood: 4, minerals: 0, goods: 0, wealth: 0 }, labor: 4 };
settlement.development = { pressures: {}, unmet: {}, informal: {}, providers: {}, evaluatedMonth: 6, nextAttemptMonth: 12, revision: 1,
  project: { plotId: 'review-construction', response, action: 'founded', startedMonth: 0, progress: 0.3,
    spent: { food: 0, wood: 1.2, minerals: 0, goods: 0, wealth: 0 }, blockedReasons: [] } };
const buildAsset = assets.getAsset('building', { seed: 'life:construction', culture, era: 'village', development: response, variant: 'house#3' }).mesh;
const buildScale = 1.2 / Number(buildAsset.userData['footprintWidth']);
const assembly = new ConstructionAssembly(buildAsset, buildScale, 'review-construction', 'timber'); assembly.update(0.3);
const constructionRoot = new THREE.Group(); constructionRoot.position.set(buildStation.x, groundY, buildStation.z); scene.add(constructionRoot);
const scaffold = createConstructionScaffold(assembly.plan, palette, 'timber');
const dressing = createConstructionWorksite({ width: 1.2, depth: 1, progress: 0.3, response, seedKey: 'review-construction' }, palette);
constructionRoot.add(assembly.group, scaffold, dressing);
const placement: WorkPlacement = { key: 'review-construction', worldX: buildStation.x, worldZ: buildStation.z, width: 1.2,
  depth: Number(buildAsset.userData['footprintDepth']) * buildScale, rotationY: 0, constructionPlan: assembly.plan };
settlement.structurePlots = [{ id: placement.key, worldX: placement.worldX, worldZ: placement.worldZ, width: placement.width,
  depth: placement.depth, height: 1, radius: 1, condition: 1, foundedMonth: 0 }];
const template = structuredClone(state.people[0]!);
const people: Person[] = stations.flatMap((station, index) => Array.from({ length: 3 }, (_, i) => {
  const id = `life-${index}-${i}`;
  const p: Person = { ...structuredClone(template), id, name: `${station.name} ${i + 1}`, alive: true, health: 1, displacedSinceMonth: undefined,
    foundingOrigin: undefined, ageMonths: index === 0 ? i === 0 ? 840 : i === 1 ? 100 : 360 : 360,
    homeId: settlement.id, householdId: `household-${index}`, occupation: station.occupation, role: station.role, activity: station.activity,
    position: { x: station.x + (i - 1) * 0.45, z: station.z + 1 }, target: { x: station.x, z: station.z + 1 },
    navigation: { destinationId: station.name, destinationKind: station.kind, schedulePhase: index === 0 ? 'home' : 'work',
      traveling: false, waypoints: [], waypointIndex: 0, reason: 'frozen-authority developer review' } };
  if (index === 3) { p.position = farmAnchor(field.geometry, id).anchor; p.navigation!.destinationId = field.geometry.id; }
  if (index === 10) { p.navigation!.destinationId = resourceWorkDestinationId(assignment); p.position = { x: station.x + 0.6, z: station.z }; }
  if (index === 11) { p.navigation!.destinationId = placement.key; p.position = { x: station.x + 1.1, z: station.z }; }
  return p;
}));
state.people = people; resources.bindWorkers(people);
state.socialRelationships = stations.map((_, i) => ({ id: `review-tie-${i}`, a: `life-${i}-0`, b: `life-${i}-1`,
  kind: i === 7 ? 'mentor' : i === 0 ? 'family' : i === 4 ? 'colleague' : 'friend',
  strength: 0.85, trust: 0.9, formedMonth: 0, lastContactMonth: 6 }));
navigation.set(structures);
settlement.structurePlots.push(...structures.map(s => ({ id: s.key, worldX: s.worldX, worldZ: s.worldZ,
  width: s.width, depth: s.depth, height: 1, radius: Math.hypot(s.width, s.depth) / 2, condition: 1, foundedMonth: 0 })));
const cameraSubject = (id: string): CameraSubjectPresentation | undefined => {
  const v = visuals.get(id), local = locals.get(id), encounter = local?.encounter;
  if (!v) return undefined;
  return { x: v.x, z: v.z, footY: v.footY,
    ...(local ? { action: { personId: id, actionKind: local.action, authoritativeActivity: peers.get(id)!.activity,
      sourceAuthority: 'review fixture', targetId: local.partnerId ?? id, targetKind: 'local', interactionAnchor: local.focus,
      locomotionTarget: local.destination, phase: local.phase, phaseProgress: 0, activeTool: 'none', contactStrength: 0 } } : {}),
    ...(encounter && locals.get(encounter.partnerId)?.partnerId === id ? { partnerId: encounter.partnerId,
      socialMeaning: encounter.relationshipKind ? 0.9 : 0.3, socialTone: encounter.tone } : {}) };
};
const director = new CameraDirector(camera, simulation.config, new Historian(simulation.config), cameraSubject, () => people.map(p => p.id));
const originalPeople = structuredClone(people), peers = new Map(people.map(p => [p.id, p]));
let groups = buildSocialGroups(people);
const positions = new Map<string, Vec2>();
const matrix = new THREE.Object3D(), colour = new THREE.Color();
const material = new THREE.MeshStandardMaterial({ roughness: 1 });
const instanced = (geometry: THREE.BufferGeometry, count: number) => {
  const mesh = new THREE.InstancedMesh(geometry, material, count); mesh.castShadow = true; mesh.frustumCulled = false; scene.add(mesh); return mesh;
};
const bodies = instanced(new THREE.CapsuleGeometry(0.12, 0.34, 2, 5), people.length);
const heads = instanced(new THREE.IcosahedronGeometry(0.12, 1), people.length);
const arms = instanced(new THREE.CylinderGeometry(0.025, 0.035, 0.34, 5).translate(0, -0.17, 0), people.length * 2);
const legs = instanced(new THREE.CylinderGeometry(0.032, 0.04, 0.36, 5).translate(0, -0.18, 0), people.length * 2);
const targets = instanced(new THREE.SphereGeometry(0.035, 8, 5), people.length); targets.visible = false;
const cargo = instanced(new THREE.BoxGeometry(0.22, 0.2, 0.18), people.length);
const skin = new THREE.Color('#d3a477'), loadColour = new THREE.Color('#8b6840');
const transform = (mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, scale: number, pitch: number, yaw: number) => {
  matrix.position.set(x, y, z); matrix.rotation.set(pitch, yaw, 0); matrix.scale.setScalar(scale); matrix.updateMatrix(); mesh.setMatrixAt(index, matrix.matrix);
};
let calendarSeconds = 0, calendarMonth = 0;
let elapsed = 0, previous = performance.now(), paused = false, frames = 0, emergency = false, holdStarted = performance.now(), contactLatch = false;
const authority = () => JSON.stringify({ people, settlement, relationships: state.socialRelationships, ledger: resourceWorkAssignmentsForWorld(world) });
let heldAuthority = authority();
element('hold').onclick = () => { element<HTMLSelectElement>('rate').value = '0'; holdStarted = performance.now(); heldAuthority = authority(); paused = false; element('pause').textContent = 'Pause presentation'; };
element('pause').onclick = () => { paused = !paused; element('pause').textContent = paused ? 'Resume presentation' : 'Pause presentation'; };
element('emergency').onclick = () => {
  emergency = true;
  for (const p of people) { p.activity = 'flee'; p.navigation!.schedulePhase = 'emergency'; p.navigation!.traveling = true; p.position.z += 0.8; }
  groups = buildSocialGroups(people); heldAuthority = authority(); holdStarted = performance.now();
};
element('restore').onclick = () => {
  emergency = false;
  for (const [i, p] of people.entries()) Object.assign(p, structuredClone(originalPeople[i]!));
  groups = buildSocialGroups(people); resources.bindWorkers(people); heldAuthority = authority(); holdStarted = performance.now();
};
element<HTMLInputElement>('targets').onchange = () => { targets.visible = element<HTMLInputElement>('targets').checked; };
function aimCamera(): void {
  const selected = element<HTMLSelectElement>('focus').value, close = element<HTMLSelectElement>('distance').value === 'close';
  const station = selected === 'all' ? undefined : stations[Number(selected)];
  controls.target.set(station?.x ?? 0, groundY + 0.3, (station?.z ?? 0) + 0.4);
  const distance = !station ? 16 : close ? 2.6 : 8;
  camera.position.set(controls.target.x + distance * 0.55, groundY + distance * 0.65, controls.target.z + distance); controls.update();
}
element('focus').onchange = aimCamera; element('distance').onchange = aimCamera; aimCamera();
const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();
const projection = new THREE.Vector3();
function frame(now: number): void {
  const dt = paused ? 0 : Math.min(0.05, (now - previous) / 1000); previous = now; elapsed += dt;
  const rate = Number(element<HTMLSelectElement>('rate').value);
  calendarSeconds += dt * rate;
  if (Math.floor(calendarSeconds) !== calendarMonth) {
    calendarMonth = Math.floor(calendarSeconds);
    // Curated authority snapshots stress monthly retargeting without destroying the work fixture.
    for (const [i, p] of people.entries()) if (![3, 10, 11].includes(Math.floor(i / 3))) {
      p.position.x = originalPeople[i]!.position.x + Math.sin(calendarMonth * 0.7 + i) * 0.25;
    }
    heldAuthority = authority();
  }
  locals.beginFrame(); visuals.beginFrame(); physical.beginFrame(people, [settlement]); resourceRigs.beginFrame(); physicalRigs.beginFrame();
  for (const p of people) { const v = visuals.get(p.id) ?? p.position; const at = positions.get(p.id);
    if (at) { at.x = v.x; at.z = v.z; } else positions.set(p.id, { x: v.x, z: v.z }); }
  let moving = 0, working = 0;
  for (const [index, person] of people.entries()) {
    const group = groups.get(groupKeyFor(person) ?? '');
    const binding = resources.workers.get(person.id), resource = binding && resourceWorkerCanPresent(person, binding.site.assignment) ? binding : undefined;
    const worker = physical.plan(person, settlement, placement, field, undefined, (a, b) => resources.safeSegment(a, b));
    const grouped = placeInGroup(person, group, person.position);
    let base = grouped;
    for (const structure of structures) base = { ...clearActivityStructure(base, structure, index), restFacing: grouped.restFacing };
    const local = locals.resolve(person, { base, group, visual: visuals.get(person.id), people: peers, visualFor: id => positions.get(id),
      relationshipFor: (a, b) => state.socialRelationships?.find(r => r.a === a && r.b === b || r.a === b && r.b === a),
      structures, revision: 1, safeSegment: (a, b) => resources.safeSegment(a, b), blocked: !!resource || !!worker || !!workInterruption(person) }, dt);
    const destination = resource ? resourceWorkAlternateAnchor(resource.site.profile, resource.variation, elapsed) ? resource.station.alternate : resource.station.anchor
      : worker?.action.locomotionTarget ?? local?.destination ?? base;
    const restFacing = resource ? facingTarget(destination, resource.station.target)
      : worker ? facingTarget(destination, worker.action.interactionAnchor) : local?.restFacing ?? base.restFacing;
    const visual = visuals.resolve(person.id, { destination, restFacing, localMove: !!local && local.action !== 'arrive', smoothTravel: !resource && !worker, arrivalEase: !!resource || !!worker }, dt, ground);
    if (worker) physical.advance(person, worker, visual, dt);
    const standing = !!worker && worker.ready && !visual.traveling && visual.speed < 0.05;
    const resourceStanding = !!resource && !visual.traveling && visual.speed < 0.05;
    const loaded = !!worker?.action.carriedObject, carried = index >= 3 && index < 6;
    const travel = travelAnimationFor(visual.speed, person);
    animation.getOrCreateCharacterState(person.id, person.occupation);
    animation.updateCharacterAnimation(person.id, dt, person.activity, visual.speed >= 0.05 ? loaded || carried ? 'carry' : travel
      : worker || emergency ? 'idle' : local ? local.phase === 'action' || local.phase === 'pause' ? local.animation : 'idle' : travel,
    visual.speed, person.ageMonths, loaded || carried);
    let pose = animation.getCurrentPose(person.id)!;
    if (resource) resourceRigs.sample(resource, elapsed, dt, resourceStanding && Math.cos(visual.facing - restFacing!) > 0.94);
    if (resourceStanding) pose = animation.resourcePose(pose, resourceRigs.motion, resource!.blend);
    if (standing) pose = animation.resourcePose(pose, worker!.motion, worker!.blend);
    const articulated = standing || resourceStanding || loaded;
    const scale = 0.28 * (person.ageMonths < 168 ? 0.7 : person.ageMonths > 816 ? 0.88 : 1);
    const y = visual.footY + (worker?.elevation ?? 0), lift = Math.max(-0.4, Math.min(0.1, pose.positionOffset.y)) * scale * (articulated ? 1 : 0.35);
    colour.set(['#b75436', '#335c78', '#c89d45'][index % 3]!);
    transform(bodies, index, visual.x, y + 0.44 * scale + lift, visual.z, scale, pose.spineRotation, visual.facing + pose.pelvisRotation); bodies.setColorAt(index, colour);
    transform(heads, index, visual.x, y + 0.84 * scale + lift, visual.z, scale, 0, visual.facing + pose.headRotation); heads.setColorAt(index, skin);
    transform(cargo, index, visual.x + Math.sin(visual.facing) * scale * 0.2, y + 0.48 * scale + lift,
      visual.z + Math.cos(visual.facing) * scale * 0.2, carried && !articulated ? scale : 0, 0, visual.facing); cargo.setColorAt(index, loadColour);
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1, c = Math.cos(visual.facing), s = Math.sin(visual.facing);
      transform(arms, index * 2 + side, visual.x + c * sign * 0.15 * scale, y + 0.62 * scale + lift, visual.z - s * sign * 0.15 * scale,
        articulated ? 0 : scale, side === 0 ? pose.leftShoulderRotation : pose.rightShoulderRotation, visual.facing);
      transform(legs, index * 2 + side, visual.x + c * sign * 0.07 * scale, y + 0.36 * scale, visual.z - s * sign * 0.07 * scale,
        articulated && !loaded ? 0 : scale, side === 0 ? pose.leftHipRotation : pose.rightHipRotation, visual.facing);
      arms.setColorAt(index * 2 + side, colour); legs.setColorAt(index * 2 + side, colour);
    }
    if (worker && articulated) physicalRigs.drawPhysical(worker.motion, worker.action.interactionAnchor, standing ? worker.action.activeTool : 'none', worker.action.carriedObject,
      worker.action.carriedObject === 'crop' ? '#b5a159' : constructionMaterialColour(worker.material), loaded ? 1 : worker.blend,
      visual.x, y, visual.z, scale, visual.facing, colour, worker.action.actionKind === 'farm-harvest', true, !standing, worker.action.contactEffect ?? 'none',
      worker.action.contactHeight === undefined ? undefined : groundY + worker.action.contactHeight);
    if (resourceStanding) resourceRigs.draw(resource!, visual.x, y, visual.z, scale, visual.facing, colour);
    transform(targets, index, destination.x, groundY + 0.035, destination.z, 1, 0, 0); targets.setColorAt(index, colour);
    if (visual.speed >= 0.05) moving++; if (standing || resourceStanding || local?.phase === 'action') working++;
  }
  locals.prune(); visuals.prune(id => animation.release(id)); physical.endFrame(); resourceRigs.endFrame(); physicalRigs.endFrame();
  const contact = physical.installationContact(placement.key); assembly.update(0.3, dt, contact === undefined ? undefined : contact && !contactLatch); contactLatch = contact ?? false;
  updateConstructionScaffold(scaffold, assembly.plan, assembly.plan.progress ?? 0.3, dt);
  updateConstructionWorksite(dressing, 0.3, false, physical.materialInTransit(placement.key));
  for (const mesh of [bodies, heads, arms, legs, targets, cargo]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  if (element<HTMLInputElement>('autocamera').checked) director.update(dt, elapsed, state, ground.heightAt);
  else controls.update();
  renderer.render(scene, camera);
  for (const label of labels) { projection.copy(label.at).project(camera); label.node.style.left = `${(projection.x * 0.5 + 0.5) * innerWidth}px`;
    label.node.style.top = `${(-projection.y * 0.5 + 0.5) * innerHeight}px`; label.node.hidden = projection.z > 1; }
  if (frames++ % 20 === 0) {
    const held = (now - holdStarted) / 1000, unchanged = authority() === heldAuthority;
    element('status').textContent = `${held.toFixed(1)} / 60 real seconds${held >= 60 ? ' · hold complete' : ''} · ${unchanged ? 'authority unchanged' : 'AUTHORITY CHANGED'}\n${moving} moving · ${working} acting · ${people.length - moving} stationary · ${renderer.info.render.calls} draws`;
    const selected = element<HTMLSelectElement>('focus').value, tracked = people[(selected === 'all' ? 4 : Number(selected)) * 3]!;
    const action = locals.get(tracked.id), work = physical.inspect(tracked.id);
    const v = visuals.get(tracked.id);
    element('physics').textContent = v ? `speed ${v.speed.toFixed(3)} / ${v.maxPhysicalSpeed.toFixed(2)} u/s ? foot ${v.footY.toFixed(3)} ? ${v.blocked ? 'blocked' : 'clear'} ? waypoint ${v.waypoint}/${v.path.length} ? camera ${director.current()?.id ?? 'manual'}` : '';
    element('action').textContent = `${tracked.name}: ${action ? `${action.action} · ${action.phase}${action.partnerId ? ` · with ${peers.get(action.partnerId)?.name}` : ''}` : work ? `${work.actionKind} · ${work.phase}` : tracked.activity}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
