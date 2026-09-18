import * as THREE from 'three';
import type { Vec2 } from '../../sim/types';
import type { ResourceWorkMotion } from '../animation/ResourceWorkMotion';
import type { PhysicalContactEffectKind } from '../people/PhysicalActionPresentation';

type ContactEffectMode = PhysicalContactEffectKind | 'generic' | 'none';
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
  private readonly sparks: THREE.InstancedMesh;
  private readonly loads: THREE.InstancedMesh;
  private readonly baskets: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly direction = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly colour = new THREE.Color();
  private count = 0;
  private chipCount = 0;
  private sparkCount = 0;
  private baseX = 0;
  private baseY = 0;
  private baseZ = 0;
  private size = 1;
  private sin = 0;
  private cos = 1;

  constructor() {
    this.group.name = 'Articulated resource workers';
    this.loads = this.pool('Contact acquired material', new THREE.BoxGeometry(1, 1, 1), '#ffffff', CAPACITY);
    this.baskets = this.pool('Worker baskets', new THREE.CylinderGeometry(0.12, 0.09, 0.16, 7, 1, true), '#8b6840', CAPACITY);
    this.limbs = this.pool('Resource worker joints', new THREE.CylinderGeometry(0.028, 0.033, 1, 5), '#ffffff', CAPACITY * 8);
    this.handles = this.pool('Resource worker tool shafts', new THREE.CylinderGeometry(0.018, 0.023, 1, 6), '#765235', CAPACITY);
    this.heads = this.pool('Resource worker axe and pick heads', resourceToolHeadGeometry(), '#ffffff', CAPACITY);
    this.chips = this.pool('Resource and construction contact fragments', new THREE.TetrahedronGeometry(1), '#ffffff', CAPACITY * 3);
    this.sparks = this.sparkPool('Construction contact sparks', CAPACITY * 2);
  }

  sample(worker: ResourceWorkerVisual, seconds: number, delta: number, ready: boolean): void {
    worker.blend = Math.min(1, Math.max(0, worker.blend + (ready ? 1 : -1) * Math.max(0, delta) / 0.35));
    sampleResourceWorkMotion(worker.site.profile, worker.variation, seconds, this.motion);
    if (!ready || this.motion.held === 0 && this.motion.impact === 0 && this.motion.basket === 0) worker.contacted = false;
    if (ready && worker.blend > 0.95 && this.motion.impact > 0) worker.contacted = true;
    if (!worker.contacted) this.motion.held = 0;
    if (!ready) this.motion.impact = 0;
  }

  beginFrame(): void { this.count = 0; this.chipCount = 0; this.sparkCount = 0; }

  draw(worker: ResourceWorkerVisual, x: number, y: number, z: number, size: number, facing: number, colour: THREE.Color, effects = true): void {
    this.drawPhysical(this.motion, worker.station.target, worker.site.profile.tool,
      worker.site.profile.kind === 'plant' && this.motion.held > 0 ? 'crop' : undefined,
      worker.site.profile.materialColour, worker.blend, x, y, z, size, facing, colour,
      worker.site.profile.kind === 'plant', effects);
  }

  /** Shared instanced limbs/props, not a shared action state machine. All phases come from callers. */
  drawPhysical(m: ResourceWorkMotion, target: Readonly<Vec2>, tool: string, load: string | undefined,
    materialColour: string, blend: number, x: number, y: number, z: number, size: number, facing: number,
    colour: THREE.Color, basket = false, effects = true, walking = false,
    contactEffect: ContactEffectMode = 'generic'): void {
    if (this.count >= CAPACITY) return;
    const index = this.count++;
    this.baseX = x; this.baseY = y; this.baseZ = z; this.size = size;
    this.sin = Math.sin(facing); this.cos = Math.cos(facing);
    const crouch = m.crouch * blend;
    const plant = tool === 'basket' || tool === 'none';
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
      this.segment(this.limbs, index * 8 + 4 + side * 2, sign * 0.075, 0.35 - crouch, 0, sign * 0.085, 0.18 - crouch * 0.25, crouch * 0.65, walking ? 0 : 1.13);
      this.segment(this.limbs, index * 8 + 5 + side * 2, sign * 0.085, 0.18 - crouch * 0.25, crouch * 0.65, sign * 0.085, 0.02, sign * 0.035, walking ? 0 : 1.02);
    }
    for (let limb = 0; limb < 8; limb++) this.limbs.setColorAt(index * 8 + limb, colour);
    const toolSize = plant ? 0 : 1;
    const tipY = handY + shaftY * 0.32;
    const tipZ = handZ + shaftZ * 0.32;
    this.segment(this.handles, index, 0, handY - shaftY * 0.18, handZ - shaftZ * 0.18, 0, tipY, tipZ, toolSize);
    this.position.set(x + tipZ * this.sin * size, y + tipY * size, z + tipZ * this.cos * size);
    this.scale.set((tool === 'axe' || tool === 'hammer' ? 0.2 : 0.3) * size * toolSize,
      (tool === 'axe' || tool === 'hammer' ? 0.13 : 0.055) * size * toolSize, 0.075 * size * toolSize);
    this.matrix.compose(this.position, this.rotation, this.scale);
    this.heads.setMatrixAt(index, this.matrix);
    this.colour.set('#8b877c');
    this.heads.setColorAt(index, this.colour);
    // Three tiny analytic chips, only at actual contact.
    // No particle history, spawned objects, or per-frame site geometry rebuilds.
    const receive = m.basket * blend;
    const loadX = plant ? receive * 0.32 : 0;
    const loadZ = handZ - (plant ? receive * 0.15 : 0);
    this.position.set(x + (loadX * this.cos + loadZ * this.sin) * size,
      y + handY * size, z + (loadZ * this.cos - loadX * this.sin) * size);
    const visible = load && blend > 0.95 ? size : 0;
    const loadShape = load === 'timber' ? [0.65, 0.1, 0.12] as const
      : load === 'metal' ? [0.48, 0.075, 0.09] as const
        : load === 'masonry' ? [0.2, 0.16, 0.18] as const
          : load === 'ceramic' ? [0.24, 0.095, 0.15] as const
            : load === 'earth' ? [0.24, 0.14, 0.2] as const
              : [0.16, 0.1, 0.12] as const;
    this.scale.set(visible * loadShape[0], visible * loadShape[1], visible * loadShape[2]);
    this.rotation.setFromAxisAngle(this.up, facing);
    this.matrix.compose(this.position, this.rotation, this.scale); this.loads.setMatrixAt(index, this.matrix);
    this.colour.set(materialColour); this.loads.setColorAt(index, this.colour);
    this.position.set(x + 0.32 * this.cos * size, y + (0.35 - crouch * 0.3) * size, z - 0.32 * this.sin * size);
    this.scale.setScalar(basket ? size : 0); this.matrix.compose(this.position, this.rotation, this.scale);
    this.baskets.setMatrixAt(index, this.matrix);
    if (effects && contactEffect !== 'none' && m.impact > 0 && blend > 0.95) {
      const contactY = contactEffect ? y + Math.max(0.05, handY * size * 0.82)
        : y + 0.04 + Math.sin(m.impact * Math.PI / 2) * 0.025;
      if (contactEffect === 'metal-spark') {
        for (let spark = 0; spark < 2; spark++) {
          const sign = spark === 0 ? -1 : 1;
          const spread = sign * 0.018 * (0.45 + m.impact);
          this.position.set(target.x + spread * this.cos, contactY + (0.018 + spark * 0.014) * m.impact,
            target.z - spread * this.sin);
          this.scale.set(0.0018 * size, (0.008 + 0.01 * m.impact) * size, 0.0018 * size);
          this.rotation.setFromAxisAngle(this.up, facing + sign * 0.55);
          this.matrix.compose(this.position, this.rotation, this.scale);
          this.sparks.setMatrixAt(this.sparkCount++, this.matrix);
        }
      } else {
        this.colour.set(materialColour);
        const count = contactEffect === 'metal-fragment' ? 2 : 3;
        for (let chip = 0; chip < count; chip++) {
          const spread = (chip - (count - 1) * 0.5) * 0.025 * m.impact;
          this.position.set(target.x + spread * this.cos,
            contactY + (contactEffect === 'mineral-dust' ? chip * 0.006 : chip * 0.003) * m.impact,
            target.z - spread * this.sin);
          if (contactEffect === 'timber-chip') {
            this.scale.set(0.009 * size, 0.0028 * size, 0.0035 * size);
          } else if (contactEffect === 'mineral-dust') {
            const radius = (0.0045 + chip * 0.001) * size * (0.75 + m.impact * 0.25);
            this.scale.setScalar(radius);
          } else if (contactEffect === 'earth-crumb') {
            const radius = (0.0055 + chip * 0.0012) * size;
            this.scale.set(radius, radius * 0.72, radius * 1.12);
          } else if (contactEffect === 'metal-fragment') {
            this.scale.set(0.006 * size, 0.0022 * size, 0.0028 * size);
          } else {
            const radius = (plant ? 0.006 : 0.004) * (1 - m.impact * 0.5);
            this.scale.setScalar(radius);
          }
          this.rotation.setFromAxisAngle(this.up, facing + (chip - 1) * 0.28);
          this.matrix.compose(this.position, this.rotation, this.scale);
          this.chips.setMatrixAt(this.chipCount, this.matrix);
          this.chips.setColorAt(this.chipCount++, this.colour);
        }
      }
    }
  }

  endFrame(): void {
    this.limbs.count = this.count * 8;
    this.handles.count = this.count;
    this.heads.count = this.count;
    this.chips.count = this.chipCount;
    this.sparks.count = this.sparkCount;
    this.loads.count = this.baskets.count = this.count;
    for (const mesh of [this.limbs, this.handles, this.heads, this.chips, this.sparks, this.loads, this.baskets]) {
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

  private sparkPool(name: string, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffd27a' }),
      capacity,
    );
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    return mesh;
  }

  private pool(name: string, geometry: THREE.BufferGeometry, colour: string, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 }), capacity);
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    return mesh;
  }
}
