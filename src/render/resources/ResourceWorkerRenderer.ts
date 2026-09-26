import { CarriedMaterialRenderer } from '../people/CarriedMaterialRenderer';
import * as THREE from 'three';
import type { Vec2 } from '../../sim/types';
import type { ResourceWorkMotion } from '../animation/ResourceWorkMotion';
import type { PhysicalContactEffectKind } from '../people/PhysicalActionPresentation';

type ContactEffectMode = PhysicalContactEffectKind | 'generic' | 'none';
import type { ResourceWorkerVisual } from './ResourceWorkScene';
import { MAX_ACTIVE_WORK_SITES } from './ResourceWorkScene';
import { createResourceWorkMotion, sampleResourceWorkMotion } from '../animation/ResourceWorkMotion';
import { resourceToolHeadGeometry } from './ResourceWorkGeometry';
import { createCosmicBodyMaterial, createCosmicWorkLimbGeometry, updateCosmicBodyMaterial } from '../people/CosmicPeople';

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
  private readonly loads = new CarriedMaterialRenderer(CAPACITY);
  private readonly baskets: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly bodyTransform = new THREE.Matrix4();
  private hasBodyTransform = false;
  private readonly shoulder = new THREE.Vector3();
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
    this.group.add(this.loads.group);
    this.baskets = this.pool('Worker baskets', new THREE.CylinderGeometry(0.12, 0.09, 0.16, 7, 1, true), '#8b6840', CAPACITY);
    this.limbs = this.pool('Resource worker joints', createCosmicWorkLimbGeometry(), '#ffffff', CAPACITY * 10);
    (this.limbs.material as THREE.Material).dispose();
    this.limbs.material = createCosmicBodyMaterial(false);
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

  beginFrame(): void { this.loads.beginFrame(); this.count = 0; this.chipCount = 0; this.sparkCount = 0; }

  setBodyTransform(matrix: THREE.Matrix4): void {
    this.bodyTransform.copy(matrix); this.hasBodyTransform = true;
  }

  setReflectionEnvironment(texture: THREE.Texture): void {
    (this.limbs.material as THREE.MeshStandardMaterial).envMap = texture;
  }

  updateDaylight(daylight: number): void {
    updateCosmicBodyMaterial(this.limbs.material as THREE.MeshStandardMaterial, daylight);
  }

  draw(worker: ResourceWorkerVisual, x: number, y: number, z: number, size: number, facing: number, colour: THREE.Color, effects = true): void {
    this.drawPhysical(this.motion, worker.station.target, this.motion.held > 0 ? 'none' : worker.site.profile.tool,
      this.motion.held > 0 ? worker.site.profile.kind === 'plant' ? 'crop'
        : worker.site.profile.kind === 'timber' ? 'timber' : 'masonry' : undefined,
      worker.site.profile.materialColour, worker.blend, x, y, z, size, facing, colour,
      worker.site.profile.kind === 'plant', effects, false,
      worker.site.profile.kind === 'timber' ? 'timber-chip' : worker.site.profile.kind === 'mineral'
        ? worker.site.profile.emphasis > 0 && worker.site.assignment.resourceId.includes('ore') ? 'metal-spark' : 'mineral-dust' : 'generic',
      undefined, worker.site.profile.toolColour);
  }

  /** Shared instanced limbs/props, not a shared action state machine. All phases come from callers. */
  drawPhysical(m: ResourceWorkMotion, target: Readonly<Vec2>, tool: string, load: string | undefined,
    materialColour: string, blend: number, x: number, y: number, z: number, size: number, facing: number,
    colour: THREE.Color, basket = false, effects = true, walking = false,
    contactEffect: ContactEffectMode = 'generic', surfaceY?: number, toolColour = '#8b877c'): void {
    if (this.count >= CAPACITY) return;
    const index = this.count++;
    this.baseX = x; this.baseY = y; this.baseZ = z; this.size = size;
    this.sin = Math.sin(facing); this.cos = Math.cos(facing);
    const crouch = m.crouch * blend;
    const plant = tool === 'basket' || tool === 'none';
    let handY = 0.4 + (m.handY - 0.4) * blend;
    let handZ = 0.12 + (m.handZ - 0.12) * blend;
    const toolAngle = 1.9 + (m.toolAngle - 1.9) * blend;
    const shaftY = Math.cos(toolAngle);
    const shaftZ = Math.sin(toolAngle);
    if (surfaceY !== undefined && !walking && blend > 0.95) {
      const reach = Math.hypot(target.x - x, target.z - z) / size;
      const toolLength = plant ? 0 : 0.32;
      // Both tool tip and evidence share the exact surface. The lift is anticipation/recovery.
      handY = (surfaceY - y) / size - shaftY * toolLength + (1 - Math.min(1, m.impact * 2)) * 0.14;
      handZ = reach - shaftZ * toolLength;
    }
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const grip = plant ? 0 : side * 0.12;
      const hx = load ? sign * (load === 'timber' || load === 'metal' ? 0.2 : 0.1) : plant ? sign * 0.075 + m.basket * 0.32 * blend : 0;
      const hy = handY - shaftY * grip;
      const hz = handZ - shaftZ * grip - (plant ? m.basket * 0.15 * blend : 0);
      let shoulderX = sign * 0.12, shoulderY = 0.71 - crouch, shoulderZ = 0;
      if (this.hasBodyTransform) {
        this.shoulder.set(sign * 0.12, 0.27, 0).applyMatrix4(this.bodyTransform);
        const dx = (this.shoulder.x - x) / size, dz = (this.shoulder.z - z) / size;
        shoulderX = dx * this.cos - dz * this.sin;
        shoulderY = (this.shoulder.y - y) / size;
        shoulderZ = dz * this.cos + dx * this.sin;
      }
      const elbowX = sign * (0.17 + (1 - blend) * 0.06);
      const elbowY = (shoulderY + hy) * 0.5 - 0.075;
      const elbowZ = hz * 0.5 + 0.015;
      this.segment(this.limbs, index * 10 + side * 2, shoulderX, shoulderY, shoulderZ, elbowX, elbowY, elbowZ, 1);
      this.segment(this.limbs, index * 10 + side * 2 + 1, elbowX, elbowY, elbowZ, hx, hy, hz, 0.85);
      this.segment(this.limbs, index * 10 + 4 + side * 2, sign * 0.049, 0.43 - crouch, 0, sign * 0.052, 0.22 - crouch * 0.25, crouch * 0.65, walking ? 0 : 1.13);
      this.segment(this.limbs, index * 10 + 5 + side * 2, sign * 0.052, 0.22 - crouch * 0.25, crouch * 0.65, sign * 0.049, 0.02, sign * 0.035, walking ? 0 : 1.02);
    }
    // Small integrated soles reuse the same opaque batch; the contact solver and targets stay intact.
    for (let side = 0; side < 2; side++) {
      const sign = side ? 1 : -1;
      this.segment(this.limbs, index * 10 + 8 + side, sign * 0.049, 0.019, sign * 0.035 - 0.012,
        sign * 0.049, 0.019, sign * 0.035 + 0.055, walking ? 0 : 0.72);
    }
    for (let limb = 0; limb < 10; limb++) this.limbs.setColorAt(index * 10 + limb, colour);
    const toolSize = plant ? 0 : 1;
    const tipY = handY + shaftY * 0.32;
    const tipZ = handZ + shaftZ * 0.32;
    this.segment(this.handles, index, 0, handY - shaftY * 0.18, handZ - shaftZ * 0.18, 0, tipY, tipZ, toolSize);
    this.position.set(x + tipZ * this.sin * size, y + tipY * size, z + tipZ * this.cos * size);
    this.scale.set((tool === 'axe' || tool === 'hammer' ? 0.2 : 0.3) * size * toolSize,
      (tool === 'axe' || tool === 'hammer' ? 0.13 : 0.055) * size * toolSize, 0.075 * size * toolSize);
    this.matrix.compose(this.position, this.rotation, this.scale);
    this.heads.setMatrixAt(index, this.matrix);
    this.colour.set(toolColour);
    this.heads.setColorAt(index, this.colour);
    // Three tiny analytic chips, only at actual contact.
    // No particle history, spawned objects, or per-frame site geometry rebuilds.
    const receive = m.basket * blend;
    const loadX = plant ? receive * 0.32 : 0;
    const loadZ = handZ - (plant ? receive * 0.15 : 0);
    this.position.set(x + (loadX * this.cos + loadZ * this.sin) * size,
      y + handY * size, z + (loadZ * this.cos - loadX * this.sin) * size);
    const visible = load ? size : 0;
    this.rotation.setFromAxisAngle(this.up, facing);
    if (load) this.loads.draw(load, this.position.x, this.position.y, this.position.z, size, facing);
    if (load === 'earth') this.position.y -= 0.02 * size;
    else this.position.set(x + 0.32 * this.cos * size, y + (0.35 - crouch * 0.3) * size, z - 0.32 * this.sin * size);
    this.scale.setScalar(load === 'earth' ? visible * 1.4 : basket ? size : 0); this.matrix.compose(this.position, this.rotation, this.scale);
    this.baskets.setMatrixAt(index, this.matrix);
    if (effects && contactEffect !== 'none' && m.impact > 0 && blend > 0.95) {
      const contactY = surfaceY ?? (y + Math.max(0.05, handY * size * 0.82));
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
    this.limbs.count = this.count * 10;
    this.handles.count = this.count;
    this.heads.count = this.count;
    this.chips.count = this.chipCount;
    this.sparks.count = this.sparkCount;
    this.loads.endFrame();
    this.baskets.count = this.count;
    for (const mesh of [this.limbs, this.handles, this.heads, this.chips, this.sparks, this.baskets]) {
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
