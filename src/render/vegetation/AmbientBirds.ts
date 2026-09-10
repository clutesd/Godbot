import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRandom } from '../../sim/prng';
import type { TreePlacement } from './ForestPlanner';
import { resolveTreeLifecycle } from './ForestPlanner';
import type { TreeFamily } from './TreeLibrary';

export type BirdPerch = 'from' | 'to';

export interface BirdJourney {
  flying: boolean;
  reverse: boolean;
  progress: number;
  perch: BirdPerch;
}

export interface BirdPoint {
  x: number;
  y: number;
  z: number;
}

export interface BirdReport {
  habitats: number;
  visible: number;
  flying: number;
  drawCalls: number;
  triangles: number;
}

export interface BirdDisturbanceZone {
  x: number;
  z: number;
  radius: number;
}

interface BirdRoute {
  from: TreePlacement;
  to: TreePlacement;
  cycleSeconds: number;
  offset: number;
  scale: number;
  arc: number;
  colour: number;
  fromAngle: number;
  toAngle: number;
  flapPhase: number;
}

const MAX_VISIBLE_BIRDS = 5;
const BIRD_VIEW_RANGE = 58;
const STRONG_WIND_THRESHOLD = 0.82;
const FORWARD = new THREE.Vector3(0, 0, 1);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);

const BIRD_COLOURS = [
  new THREE.Color('#3f668a'),
  new THREE.Color('#b9563f'),
  new THREE.Color('#d0a53c'),
  new THREE.Color('#725d46'),
  new THREE.Color('#46505d'),
  new THREE.Color('#8a7356'),
] as const;

const FAMILY_HEIGHT: Record<TreeFamily, number> = {
  cherry: 0.92,
  broadleaf: 1.02,
  conifer: 1.55,
  dry: 0.98,
  riverbank: 1.08,
  alpine: 1.18,
  ancient: 1.26,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ease(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/**
 * Most of a bird's cycle is deliberately quiet. Short outbound and return windows make flights
 * noticeable without turning a forest into a constant flock animation.
 */
export function resolveBirdJourney(cyclePhase: number): BirdJourney {
  const phase = ((cyclePhase % 1) + 1) % 1;
  if (phase < 0.42) return { flying: false, reverse: false, progress: 0, perch: 'from' };
  if (phase < 0.52) return { flying: true, reverse: false, progress: ease((phase - 0.42) / 0.1), perch: 'from' };
  if (phase < 0.91) return { flying: false, reverse: false, progress: 1, perch: 'to' };
  return { flying: true, reverse: true, progress: ease((phase - 0.91) / 0.09), perch: 'to' };
}

/** A soft tree-to-tree arc: low enough to read against the canopy, high enough to clear it. */
export function birdFlightPoint(from: BirdPoint, to: BirdPoint, progress: number, arc: number): BirdPoint {
  const t = clamp01(progress);
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t + Math.sin(Math.PI * t) * Math.max(0, arc),
    z: from.z + (to.z - from.z) * t,
  };
}

/** Number of potential local bird routes distributed across the forest, not simultaneous birds. */
export function birdHabitatCount(treeCount: number): number {
  if (treeCount < 24) return 0;
  return Math.min(36, Math.max(10, Math.round(treeCount / 85)));
}

/**
 * A tiny ambient wildlife layer. Routes are tied to real tree placements, while only the routes
 * nearest the documentary camera are rendered. The result is occasional life rather than a flock
 * simulation, and the entire system remains three instanced draw calls.
 */
export class AmbientBirds {
  readonly group = new THREE.Group();
  private readonly routes: BirdRoute[];
  private readonly bodies: THREE.InstancedMesh;
  private readonly leftWings: THREE.InstancedMesh;
  private readonly rightWings: THREE.InstancedMesh;
  private readonly camera = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly nextPosition = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly bodyQuaternion = new THREE.Quaternion();
  private readonly wingQuaternion = new THREE.Quaternion();
  private readonly localWingQuaternion = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private ecologyYear = 0;
  private visibleCount = 0;
  private flyingCount = 0;

  constructor(seed: string, trees: readonly TreePlacement[]) {
    this.group.name = 'ambient-forest-birds';
    this.routes = planBirdRoutes(seed, trees);
    const capacity = Math.max(1, Math.min(MAX_VISIBLE_BIRDS, this.routes.length));

    this.bodies = this.createMesh('bird-bodies', buildBirdBodyGeometry(), capacity, false);
    this.leftWings = this.createMesh('bird-left-wings', buildWingGeometry(1), capacity, true);
    this.rightWings = this.createMesh('bird-right-wings', buildWingGeometry(-1), capacity, true);
    this.group.add(this.bodies, this.leftWings, this.rightWings);
  }

  get report(): BirdReport {
    return {
      habitats: this.routes.length,
      visible: this.visibleCount,
      flying: this.flyingCount,
      drawCalls: [this.bodies, this.leftWings, this.rightWings].filter((mesh) => mesh.count > 0).length,
      triangles: [this.bodies, this.leftWings, this.rightWings].reduce((sum, mesh) =>
        sum + mesh.count * (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3, 0),
    };
  }

  setCamera(camera: THREE.Vector3): void {
    this.camera.copy(camera);
  }

  setEcologyYear(year: number): void {
    this.ecologyYear = year;
  }

  update(elapsed: number, wind: number, disturbance: readonly BirdDisturbanceZone[]): void {
    const nearby = this.routes
      .map((route) => ({ route, distance: routeDistanceToCamera(route, this.camera) }))
      .filter(({ distance }) => distance < BIRD_VIEW_RANGE)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, MAX_VISIBLE_BIRDS);

    let count = 0;
    let flying = 0;
    for (const { route } of nearby) {
      const fromLifecycle = resolveTreeLifecycle(route.from, this.ecologyYear);
      const toLifecycle = resolveTreeLifecycle(route.to, this.ecologyYear);
      if (!fromLifecycle.foliageVisible || !toLifecycle.foliageVisible) continue;
      if (isDisturbed(route.from, disturbance) || isDisturbed(route.to, disturbance)) continue;

      const from = perchPoint(route.from, fromLifecycle.scale, route.fromAngle);
      const to = perchPoint(route.to, toLifecycle.scale, route.toAngle);
      const phase = (elapsed / route.cycleSeconds + route.offset) % 1;
      let journey = resolveBirdJourney(phase);
      // Strong regional wind keeps birds tucked into the canopy rather than flying unrealistically.
      if (wind >= STRONG_WIND_THRESHOLD && journey.flying) {
        journey = phase < 0.72
          ? { flying: false, reverse: false, progress: 0, perch: 'from' }
          : { flying: false, reverse: false, progress: 1, perch: 'to' };
      }

      const current = this.resolvePosition(journey, from, to, route.arc);
      this.position.set(current.x, current.y, current.z);
      this.resolveOrientation(journey, from, to, route.arc, route);

      const birdScale = route.scale * (journey.flying ? 1 : 0.92);
      this.scale.setScalar(birdScale);
      this.matrix.compose(this.position, this.bodyQuaternion, this.scale);
      this.bodies.setMatrixAt(count, this.matrix);
      const baseColour = BIRD_COLOURS[route.colour] ?? BIRD_COLOURS[0];
      this.bodies.setColorAt(count, baseColour);

      const flap = journey.flying ? Math.sin(elapsed * 18 + route.flapPhase) * 0.72 : 0;
      const folded = journey.flying ? 1 : 0.42;
      this.writeWing(this.leftWings, count, birdScale, folded, flap, baseColour);
      this.writeWing(this.rightWings, count, birdScale, folded, -flap, baseColour);
      if (journey.flying) flying += 1;
      count += 1;
    }

    this.visibleCount = count;
    this.flyingCount = flying;
    for (const mesh of [this.bodies, this.leftWings, this.rightWings]) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private resolvePosition(journey: BirdJourney, from: BirdPoint, to: BirdPoint, arc: number): BirdPoint {
    if (!journey.flying) return journey.perch === 'from' ? from : to;
    return journey.reverse
      ? birdFlightPoint(to, from, journey.progress, arc)
      : birdFlightPoint(from, to, journey.progress, arc);
  }

  private resolveOrientation(journey: BirdJourney, from: BirdPoint, to: BirdPoint, arc: number, route: BirdRoute): void {
    if (journey.flying) {
      const start = journey.reverse ? to : from;
      const end = journey.reverse ? from : to;
      const sample = birdFlightPoint(start, end, Math.min(1, journey.progress + 0.025), arc);
      this.nextPosition.set(sample.x, sample.y, sample.z);
      this.direction.subVectors(this.nextPosition, this.position);
      if (this.direction.lengthSq() > 1e-6) {
        this.direction.normalize();
        this.bodyQuaternion.setFromUnitVectors(FORWARD, this.direction);
        return;
      }
    }
    const yaw = Math.atan2(to.x - from.x, to.z - from.z) + (journey.perch === 'to' ? Math.PI : 0) + route.flapPhase * 0.03;
    this.bodyQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  }

  private writeWing(
    mesh: THREE.InstancedMesh,
    index: number,
    birdScale: number,
    folded: number,
    flap: number,
    baseColour: THREE.Color,
  ): void {
    this.localWingQuaternion.setFromAxisAngle(LOCAL_FORWARD, flap);
    this.wingQuaternion.copy(this.bodyQuaternion).multiply(this.localWingQuaternion);
    this.scale.set(birdScale * folded, birdScale, birdScale);
    this.matrix.compose(this.position, this.wingQuaternion, this.scale);
    mesh.setMatrixAt(index, this.matrix);
    this.colour.copy(baseColour).multiplyScalar(0.72);
    mesh.setColorAt(index, this.colour);
  }

  private createMesh(name: string, geometry: THREE.BufferGeometry, capacity: number, doubleSided: boolean): THREE.InstancedMesh {
    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.92,
      metalness: 0,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }
}

function routeDistanceToCamera(route: BirdRoute, camera: THREE.Vector3): number {
  const midpointX = (route.from.worldX + route.to.worldX) * 0.5;
  const midpointZ = (route.from.worldZ + route.to.worldZ) * 0.5;
  return Math.hypot(midpointX - camera.x, midpointZ - camera.z);
}

function isDisturbed(tree: TreePlacement, disturbance: readonly BirdDisturbanceZone[]): boolean {
  return disturbance.some((zone) => Math.hypot(tree.worldX - zone.x, tree.worldZ - zone.z) < zone.radius);
}

function perchPoint(tree: TreePlacement, lifecycleScale: number, angle: number): BirdPoint {
  const heightFactor = FAMILY_HEIGHT[tree.family];
  const crownHeight = lifecycleScale * heightFactor;
  const radius = Math.min(0.34, lifecycleScale * 0.08);
  return {
    x: tree.worldX + Math.cos(angle) * radius,
    y: tree.y + crownHeight * 0.78,
    z: tree.worldZ + Math.sin(angle) * radius,
  };
}

function planBirdRoutes(seed: string, trees: readonly TreePlacement[]): BirdRoute[] {
  const eligible = trees.filter((tree) => !tree.managedBy && tree.family !== 'alpine');
  const target = birdHabitatCount(eligible.length);
  if (target === 0 || eligible.length < 2) return [];

  const random = new SeededRandom(`${seed}:ambient-birds`);
  const routes: BirdRoute[] = [];
  const offset = random.int(0, eligible.length);
  for (let routeIndex = 0; routeIndex < target; routeIndex += 1) {
    const from = eligible[(offset + routeIndex * 17) % eligible.length];
    if (!from) continue;
    let to: TreePlacement | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = random.pick(eligible);
      if (candidate === from) continue;
      const distance = Math.hypot(candidate.worldX - from.worldX, candidate.worldZ - from.worldZ);
      if (distance < 5 || distance > 26) continue;
      to = candidate;
      break;
    }
    if (!to) continue;
    const distance = Math.hypot(to.worldX - from.worldX, to.worldZ - from.worldZ);
    routes.push({
      from,
      to,
      cycleSeconds: random.range(34, 58),
      offset: random.float(),
      scale: random.range(0.72, 1.08),
      arc: random.range(0.55, 1.05) + distance * 0.035,
      colour: random.int(0, BIRD_COLOURS.length),
      fromAngle: random.range(0, Math.PI * 2),
      toAngle: random.range(0, Math.PI * 2),
      flapPhase: random.range(0, Math.PI * 2),
    });
  }
  return routes;
}

function buildBirdBodyGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(1, 6, 4).scale(0.065, 0.052, 0.12);
  const head = new THREE.SphereGeometry(1, 5, 3).scale(0.047, 0.044, 0.05).translate(0, 0.018, 0.105);
  const tail = new THREE.ConeGeometry(0.042, 0.14, 4).rotateX(-Math.PI / 2).translate(0, -0.008, -0.14);
  const geometry = mergeGeometries([body, head, tail]);
  body.dispose();
  head.dispose();
  tail.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

function buildWingGeometry(side: 1 | -1): THREE.BufferGeometry {
  const positions = [
    0, 0.005, 0.02,
    side * 0.2, 0, -0.045,
    side * 0.075, 0, 0.105,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
