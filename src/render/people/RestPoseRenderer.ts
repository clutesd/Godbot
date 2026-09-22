import * as THREE from 'three';
import { createCosmicBodyMaterial, createCosmicWorkLimbGeometry, updateCosmicBodyMaterial } from './CosmicPeople';
import type { RestPosture, RestSpotPresentation } from './RestPresentation';

export const REST_SIT_SECONDS = 0.72;
export const REST_STAND_SECONDS = 0.58;
const LIMBS_PER_PERSON = 10;

interface RestPoseState {
  blend: number;
  seen: number;
  spot?: RestSpotPresentation;
}

export interface RestJointPlan {
  blend: number;
  bodyLift: number;
  bodyPitch: number;
  kneeX: number;
  kneeY: number;
  kneeZ: number;
  ankleX: number;
  ankleY: number;
  ankleZ: number;
  elbowX: number;
  elbowY: number;
  elbowZ: number;
  handX: number;
  handY: number;
  handZ: number;
}

export interface RestPoseVisual extends RestJointPlan {
  spot?: RestSpotPresentation;
}

/**
 * Presentation-only articulated rest overlay.
 *
 * The ordinary population mesh stays instanced. While somebody settles into a physical rest spot,
 * this bounded overlay replaces only their rigid ambient arm/leg instances with two-part limbs and
 * grounded soles. No simulation state, navigation or activity timing is written here.
 */
export class RestPoseRenderer {
  readonly group = new THREE.Group();
  private readonly limbs: THREE.InstancedMesh;
  private readonly states = new Map<string, RestPoseState>();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly direction = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly colour = new THREE.Color();
  private frame = 0;
  private count = 0;
  private baseX = 0;
  private baseY = 0;
  private baseZ = 0;
  private size = 1;
  private sin = 0;
  private cos = 1;

  constructor(private readonly capacity: number) {
    this.group.name = 'Articulated resting people';
    const material = createCosmicBodyMaterial(false);
    this.limbs = new THREE.InstancedMesh(createCosmicWorkLimbGeometry(), material, capacity * LIMBS_PER_PERSON);
    this.limbs.name = 'Resting person joints';
    this.limbs.count = 0;
    this.limbs.castShadow = true;
    this.limbs.frustumCulled = false;
    this.limbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.limbs);
  }

  beginFrame(): void {
    this.frame++;
    this.count = 0;
  }

  resolve(personId: string, rest: RestSpotPresentation | undefined, ready: boolean, deltaSeconds: number): RestPoseVisual {
    let state = this.states.get(personId);
    if (!state && !rest) return restJointPlan(undefined, 0);
    if (!state) {
      state = { blend: 0, seen: this.frame };
      this.states.set(personId, state);
    }
    state.seen = this.frame;
    if (rest) state.spot = { ...rest, destination: { ...rest.destination } };

    const target = rest && ready ? 1 : 0;
    const duration = target > state.blend ? REST_SIT_SECONDS : REST_STAND_SECONDS;
    const step = duration <= 0 ? 1 : Math.max(0, deltaSeconds) / duration;
    state.blend = target > state.blend
      ? Math.min(target, state.blend + step)
      : Math.max(target, state.blend - step);
    if (!rest && state.blend <= 0.0001) {
      delete state.spot;
      this.states.delete(personId);
    }

    const eased = smoothstep(state.blend);
    return { ...restJointPlan(state.spot?.posture, eased), spot: state.spot };
  }

  get(personId: string): Readonly<RestPoseState> | undefined {
    return this.states.get(personId);
  }

  draw(visual: RestPoseVisual, x: number, y: number, z: number, size: number, build: number,
    facing: number, bodyPitch: number, colour: THREE.Color): void {
    if (visual.blend <= 0.001 || this.count >= this.capacity) return;
    const index = this.count++;
    this.baseX = x; this.baseY = y; this.baseZ = z; this.size = size;
    this.sin = Math.sin(facing); this.cos = Math.cos(facing);

    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      // Match the torso's attachment point analytically. GodboxRenderer intentionally reuses its
      // transform matrix for later body parts, so the rest rig must not depend on that mutable matrix.
      const shoulderX = sign * 0.12 * build;
      const shoulderY = 0.44 + visual.bodyLift + Math.cos(bodyPitch) * 0.27;
      const shoulderZ = Math.sin(bodyPitch) * 0.27;

      this.segment(index * LIMBS_PER_PERSON + side * 2,
        shoulderX, shoulderY, shoulderZ,
        sign * visual.elbowX, visual.elbowY, visual.elbowZ, 0.94);
      this.segment(index * LIMBS_PER_PERSON + side * 2 + 1,
        sign * visual.elbowX, visual.elbowY, visual.elbowZ,
        sign * visual.handX, visual.handY, visual.handZ, 0.82);

      const hipY = 0.45 + visual.bodyLift;
      this.segment(index * LIMBS_PER_PERSON + 4 + side * 2,
        sign * 0.049, hipY, 0,
        sign * visual.kneeX, visual.kneeY, visual.kneeZ, 1.12);
      this.segment(index * LIMBS_PER_PERSON + 5 + side * 2,
        sign * visual.kneeX, visual.kneeY, visual.kneeZ,
        sign * visual.ankleX, visual.ankleY, visual.ankleZ, 1.0);

      this.segment(index * LIMBS_PER_PERSON + 8 + side,
        sign * visual.ankleX, Math.max(0.018, visual.ankleY), visual.ankleZ - 0.012,
        sign * visual.ankleX, Math.max(0.018, visual.ankleY), visual.ankleZ + 0.058, 0.7);
    }

    this.colour.copy(colour);
    for (let limb = 0; limb < LIMBS_PER_PERSON; limb++) {
      this.limbs.setColorAt(index * LIMBS_PER_PERSON + limb, this.colour);
    }
  }

  endFrame(): void {
    this.limbs.count = this.count * LIMBS_PER_PERSON;
    this.limbs.instanceMatrix.needsUpdate = true;
    if (this.limbs.instanceColor) this.limbs.instanceColor.needsUpdate = true;
    for (const [id, state] of this.states) if (state.seen !== this.frame) this.states.delete(id);
  }

  setReflectionEnvironment(texture: THREE.Texture): void {
    (this.limbs.material as THREE.MeshStandardMaterial).envMap = texture;
  }

  updateDaylight(daylight: number): void {
    updateCosmicBodyMaterial(this.limbs.material as THREE.MeshStandardMaterial, daylight);
  }

  dispose(): void {
    this.states.clear();
    this.limbs.dispose();
    this.limbs.geometry.dispose();
    (this.limbs.material as THREE.Material).dispose();
  }

  private segment(index: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number): void {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const length = Math.hypot(dx, dy, dz);
    this.direction.set(dx * this.cos + dz * this.sin, dy, dz * this.cos - dx * this.sin).normalize();
    this.rotation.setFromUnitVectors(this.up, this.direction);
    const midX = (ax + bx) * 0.5, midZ = (az + bz) * 0.5;
    this.position.set(
      this.baseX + (midX * this.cos + midZ * this.sin) * this.size,
      this.baseY + (ay + by) * 0.5 * this.size,
      this.baseZ + (midZ * this.cos - midX * this.sin) * this.size,
    );
    this.scale.set(width * this.size, length * this.size, width * this.size);
    this.matrix.compose(this.position, this.rotation, this.scale);
    this.limbs.setMatrixAt(index, this.matrix);
  }
}

export function restJointPlan(posture: RestPosture | undefined, blend: number): RestJointPlan {
  const t = THREE.MathUtils.clamp(blend, 0, 1);
  const supported = posture === 'supported-sit';
  const bodyLiftTarget = supported ? -0.225 : -0.255;
  const bodyPitchTarget = supported ? -0.035 : 0.075;

  const kneeXTarget = supported ? 0.064 : 0.13;
  const kneeYTarget = supported ? 0.105 : 0.085;
  const kneeZTarget = supported ? 0.215 : 0.155;
  const ankleXTarget = supported ? 0.056 : 0.095;
  const ankleZTarget = supported ? 0.325 : 0.275;

  const elbowXTarget = supported ? 0.15 : 0.175;
  const elbowYTarget = supported ? 0.315 : 0.30;
  const elbowZTarget = supported ? 0.07 : 0.09;
  const handXTarget = supported ? 0.075 : 0.105;
  const handYTarget = supported ? 0.19 : 0.17;
  const handZTarget = supported ? 0.19 : 0.17;

  return {
    blend: t,
    bodyLift: t === 0 ? 0 : bodyLiftTarget * t,
    bodyPitch: t === 0 ? 0 : bodyPitchTarget * t,
    kneeX: mix(0.052, kneeXTarget, t),
    kneeY: mix(0.235, kneeYTarget, t),
    kneeZ: mix(0.012, kneeZTarget, t),
    ankleX: mix(0.049, ankleXTarget, t),
    ankleY: 0.02,
    ankleZ: mix(0.02, ankleZTarget, t),
    elbowX: mix(0.12, elbowXTarget, t),
    elbowY: mix(0.52, elbowYTarget, t),
    elbowZ: mix(0, elbowZTarget, t),
    handX: mix(0.12, handXTarget, t),
    handY: mix(0.34, handYTarget, t),
    handZ: mix(0, handZTarget, t),
  };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
