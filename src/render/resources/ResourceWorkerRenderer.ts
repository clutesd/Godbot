import * as THREE from 'three';
import type { ResourceWorkerVisual } from './ResourceWorkScene';
import { MAX_ACTIVE_WORK_SITES } from './ResourceWorkScene';
import { createResourceWorkMotion, sampleResourceWorkMotion } from '../animation/ResourceWorkMotion';
import { resourceToolHeadGeometry } from './ResourceWorkGeometry';

const CAPACITY = MAX_ACTIVE_WORK_SITES * 4;

/** A bounded articulated overlay for existing people. No people, cargo, or effects are simulated. */
export class ResourceWorkerRenderer {
  readonly group = new THREE.Group();
  readonly motion = createResourceWorkMotion();
  private readonly limbs: THREE.InstancedMesh;
  private readonly handles: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly chips: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly direction = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly colour = new THREE.Color();
  private count = 0;
  private chipCount = 0;
  private baseX = 0;
  private baseY = 0;
  private baseZ = 0;
  private size = 1;
  private sin = 0;
  private cos = 1;

  constructor() {
    this.group.name = 'Articulated resource workers';
    this.limbs = this.pool('Resource worker joints', new THREE.CylinderGeometry(0.028, 0.033, 1, 5), '#ffffff', CAPACITY * 8);
    this.handles = this.pool('Resource worker tool shafts', new THREE.CylinderGeometry(0.018, 0.023, 1, 6), '#765235', CAPACITY);
    this.heads = this.pool('Resource worker axe and pick heads', resourceToolHeadGeometry(), '#ffffff', CAPACITY);
    this.chips = this.pool('Resource contact chips and leaves', new THREE.TetrahedronGeometry(1), '#ffffff', CAPACITY * 3);
  }

  sample(worker: ResourceWorkerVisual, seconds: number, delta: number, ready: boolean): void {
    worker.blend = Math.min(1, Math.max(0, worker.blend + (ready ? 1 : -1) * Math.max(0, delta) / 0.35));
    sampleResourceWorkMotion(worker.site.profile, worker.variation, seconds, this.motion);
  }

  beginFrame(): void { this.count = 0; this.chipCount = 0; }

  draw(worker: ResourceWorkerVisual, x: number, y: number, z: number, size: number, facing: number, colour: THREE.Color): void {
    if (this.count >= CAPACITY) return;
    const index = this.count++;
    this.baseX = x; this.baseY = y; this.baseZ = z; this.size = size;
    this.sin = Math.sin(facing); this.cos = Math.cos(facing);
    const m = this.motion;
    const blend = worker.blend;
    const crouch = m.crouch * blend;
    const plant = worker.site.profile.tool === 'basket' || worker.site.profile.tool === 'none';
    const handY = 0.4 + (m.handY - 0.4) * blend;
    const handZ = 0.12 + (m.handZ - 0.12) * blend;
    const toolAngle = 1.9 + (m.toolAngle - 1.9) * blend;
    const shaftY = Math.cos(toolAngle);
    const shaftZ = Math.sin(toolAngle);
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const grip = plant ? 0 : side * 0.12;
      const hx = plant ? sign * 0.075 + m.basket * 0.32 * blend : 0;
      const hy = handY - shaftY * grip;
      const hz = handZ - shaftZ * grip - (plant ? m.basket * 0.15 * blend : 0);
      const shoulderY = 0.64 - crouch;
      const elbowX = sign * (0.17 + (1 - blend) * 0.06);
      const elbowY = (shoulderY + hy) * 0.5 - 0.075;
      const elbowZ = hz * 0.5 + 0.015;
      this.segment(this.limbs, index * 8 + side * 2, sign * 0.15, shoulderY, 0, elbowX, elbowY, elbowZ, 1);
      this.segment(this.limbs, index * 8 + side * 2 + 1, elbowX, elbowY, elbowZ, hx, hy, hz, 0.85);
      this.segment(this.limbs, index * 8 + 4 + side * 2, sign * 0.075, 0.35 - crouch, 0, sign * 0.085, 0.18 - crouch * 0.25, crouch * 0.65, 1.13);
      this.segment(this.limbs, index * 8 + 5 + side * 2, sign * 0.085, 0.18 - crouch * 0.25, crouch * 0.65, sign * 0.085, 0.02, sign * 0.035, 1.02);
    }
    for (let limb = 0; limb < 8; limb++) this.limbs.setColorAt(index * 8 + limb, colour);
    const toolSize = plant ? 0 : 1;
    const tipY = handY + shaftY * 0.32;
    const tipZ = handZ + shaftZ * 0.32;
    this.segment(this.handles, index, 0, handY - shaftY * 0.18, handZ - shaftZ * 0.18, 0, tipY, tipZ, toolSize);
    this.position.set(x + tipZ * this.sin * size, y + tipY * size, z + tipZ * this.cos * size);
    this.scale.set((worker.site.profile.tool === 'axe' ? 0.2 : 0.3) * size * toolSize,
      (worker.site.profile.tool === 'axe' ? 0.13 : 0.055) * size * toolSize, 0.075 * size * toolSize);
    this.matrix.compose(this.position, this.rotation, this.scale);
    this.heads.setMatrixAt(index, this.matrix);
    this.colour.set(worker.site.developed ? '#737d7e' : '#8b877c');
    this.heads.setColorAt(index, this.colour);
    // Three tiny analytic chips, only at actual contact.
    // No particle history, spawned objects, or per-frame site geometry rebuilds.
    if (m.impact > 0 && blend > 0.95) {
      const target = worker.station.target;
      this.colour.set(worker.site.profile.materialColour);
      for (let chip = 0; chip < 3; chip++) {
        const spread = (chip - 1) * 0.025 * m.impact;
        this.position.set(target.x + spread * this.cos, y + 0.04 + Math.sin(m.impact * Math.PI / 2) * 0.025, target.z - spread * this.sin);
        const radius = (plant ? 0.006 : 0.004) * (1 - m.impact * 0.5);
        this.scale.setScalar(radius);
        this.matrix.compose(this.position, this.rotation, this.scale);
        this.chips.setMatrixAt(this.chipCount, this.matrix);
        this.chips.setColorAt(this.chipCount++, this.colour);
      }
    }
  }

  endFrame(): void {
    this.limbs.count = this.count * 8;
    this.handles.count = this.count;
    this.heads.count = this.count;
    this.chips.count = this.chipCount;
    for (const mesh of [this.limbs, this.handles, this.heads, this.chips]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private segment(mesh: THREE.InstancedMesh, index: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number): void {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const length = Math.hypot(dx, dy, dz);
    this.direction.set(dx * this.cos + dz * this.sin, dy, dz * this.cos - dx * this.sin).normalize();
    this.rotation.setFromUnitVectors(this.up, this.direction);
    const midX = (ax + bx) * 0.5, midZ = (az + bz) * 0.5;
    this.position.set(this.baseX + (midX * this.cos + midZ * this.sin) * this.size, this.baseY + (ay + by) * 0.5 * this.size, this.baseZ + (midZ * this.cos - midX * this.sin) * this.size);
    this.scale.set(width * this.size, length * this.size * (width > 0 ? 1 : 0), width * this.size);
    this.matrix.compose(this.position, this.rotation, this.scale);
    mesh.setMatrixAt(index, this.matrix);
  }

  private pool(name: string, geometry: THREE.BufferGeometry, colour: string, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 }), capacity);
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    return mesh;
  }
}
