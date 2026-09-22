import * as THREE from 'three';
import { createCosmicBodyMaterial, createCosmicWorkLimbGeometry, updateCosmicBodyMaterial } from './CosmicPeople';
import type { RestPosture, RestSpotPresentation } from './RestPresentation';
import {
  REST_RISE_SECONDS,
  REST_SETTLE_SECONDS,
  restAttentionWindow,
  restMotionPhase,
  restStyleFor,
  restTransitionSeconds,
  type RestStage,
  type RestStyle,
} from './RestChoreography';

export const REST_SIT_SECONDS = REST_SETTLE_SECONDS;
export const REST_STAND_SECONDS = REST_RISE_SECONDS;
const LIMBS_PER_PERSON = 10;

interface RestPoseState {
  blend: number;
  seen: number;
  settledSeconds: number;
  stage?: RestStage;
  style?: RestStyle;
  spot?: RestSpotPresentation;
}

export interface RestSidePlan {
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

export interface RestJointPlan {
  blend: number;
  bodyLift: number;
  bodyPitch: number;
  bodyYaw: number;
  bodyRoll: number;
  headYaw: number;
  left: RestSidePlan;
  right: RestSidePlan;
}

export interface RestPoseVisual extends RestJointPlan {
  stage?: RestStage;
  style?: RestStyle;
  spot?: RestSpotPresentation;
}

/**
 * Presentation-only articulated rest overlay.
 *
 * Rest owns a real three-beat physical sequence: settle, sustained seated life, and rise. The
 * ordinary population mesh stays instanced; this bounded overlay replaces only the limb silhouette
 * while seated or transitioning. It never mutates simulation state, activity timing or navigation.
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

  resolve(personId: string, rest: RestSpotPresentation | undefined, stage: RestStage | undefined,
    deltaSeconds: number, ageMonths = 30 * 12, attentionYaw = 0): RestPoseVisual {
    let state = this.states.get(personId);
    if (!state && !rest) return { ...restJointPlan(undefined, 0), stage: undefined, style: undefined, spot: undefined };
    if (!state) {
      state = { blend: 0, seen: this.frame, settledSeconds: 0 };
      this.states.set(personId, state);
    }
    state.seen = this.frame;

    if (rest) {
      const changedSpot = state.spot?.key !== rest.key || state.spot?.posture !== rest.posture;
      state.spot = { ...rest, destination: { ...rest.destination } };
      state.stage = stage ?? state.stage ?? 'settling';
      if (changedSpot || !state.style) state.style = restStyleFor(personId, rest.posture);
    } else if (stage) {
      state.stage = stage;
    }

    if (state.stage === 'settled') state.settledSeconds += Math.max(0, deltaSeconds);
    else if (state.stage === 'settling') state.settledSeconds = 0;

    const target = rest && state.stage !== 'rising' ? 1 : 0;
    const transitionStage = target > state.blend ? 'settling' : 'rising';
    const duration = restTransitionSeconds(transitionStage, ageMonths);
    const step = duration <= 0 ? 1 : Math.max(0, deltaSeconds) / duration;
    state.blend = target > state.blend
      ? Math.min(target, state.blend + step)
      : Math.max(target, state.blend - step);

    const eased = smoothstep(state.blend);
    const transitionProgress = state.stage === 'rising' ? 1 - state.blend : state.blend;
    const transitionPulse = state.stage === 'settled' ? 0 : Math.sin(THREE.MathUtils.clamp(transitionProgress, 0, 1) * Math.PI);
    const phase = restMotionPhase(personId, state.settledSeconds);
    const breathing = state.stage === 'settled' ? Math.sin(phase) * 0.0035 : 0;
    const attention = state.stage === 'settled'
      ? restAttentionWindow(personId, state.settledSeconds) * THREE.MathUtils.clamp(attentionYaw, -0.62, 0.62)
      : 0;
    const ageLean = ageMonths >= 68 * 12 ? 0.018 : ageMonths < 14 * 12 ? -0.008 : 0;
    const plan = restJointPlan(state.spot?.posture, eased, state.style, state.stage, transitionPulse, breathing, attention, ageLean);

    if (!rest && state.blend <= 0.0001) {
      this.states.delete(personId);
      return { ...plan, stage: undefined, style: undefined, spot: undefined };
    }
    return { ...plan, stage: state.stage, style: state.style, spot: state.spot };
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
      const limb = side === 0 ? visual.left : visual.right;
      // Match the torso attachment analytically. The production renderer reuses a scratch transform
      // for later body parts, so rest must remain independent of mutable shared matrices.
      const shoulderX = sign * 0.12 * build;
      const shoulderY = 0.44 + visual.bodyLift + Math.cos(bodyPitch) * 0.27;
      const shoulderZ = Math.sin(bodyPitch) * 0.27;

      this.segment(index * LIMBS_PER_PERSON + side * 2,
        shoulderX, shoulderY, shoulderZ,
        sign * limb.elbowX, limb.elbowY, limb.elbowZ, 0.94);
      this.segment(index * LIMBS_PER_PERSON + side * 2 + 1,
        sign * limb.elbowX, limb.elbowY, limb.elbowZ,
        sign * limb.handX, limb.handY, limb.handZ, 0.82);

      const hipY = 0.45 + visual.bodyLift;
      this.segment(index * LIMBS_PER_PERSON + 4 + side * 2,
        sign * 0.049, hipY, 0,
        sign * limb.kneeX, limb.kneeY, limb.kneeZ, 1.12);
      this.segment(index * LIMBS_PER_PERSON + 5 + side * 2,
        sign * limb.kneeX, limb.kneeY, limb.kneeZ,
        sign * limb.ankleX, limb.ankleY, limb.ankleZ, 1.0);

      this.segment(index * LIMBS_PER_PERSON + 8 + side,
        sign * limb.ankleX, Math.max(0.018, limb.ankleY), limb.ankleZ - 0.012,
        sign * limb.ankleX, Math.max(0.018, limb.ankleY), limb.ankleZ + 0.058, 0.7);
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

export function restJointPlan(posture: RestPosture | undefined, blend: number,
  style?: RestStyle, stage: RestStage = 'settled', transitionPulse = 0,
  breathing = 0, attentionYaw = 0, ageLean = 0): RestJointPlan {
  const t = THREE.MathUtils.clamp(blend, 0, 1);
  const supported = posture === 'supported-sit';
  const resolvedStyle = style ?? (supported ? 'supported-knees' : 'ground-open');
  const bodyLiftTarget = supported ? -0.225 : -0.255;
  const bodyPitchTarget = supported ? -0.035 : 0.075;

  const supportedSide = (): RestSidePlan => ({
    kneeX: 0.064, kneeY: 0.105, kneeZ: 0.215,
    ankleX: 0.056, ankleY: 0.02, ankleZ: 0.325,
    elbowX: 0.15, elbowY: 0.315, elbowZ: 0.07,
    handX: 0.075, handY: 0.19, handZ: 0.19,
  });
  const groundSide = (): RestSidePlan => ({
    kneeX: 0.13, kneeY: 0.085, kneeZ: 0.155,
    ankleX: 0.095, ankleY: 0.02, ankleZ: 0.275,
    elbowX: 0.175, elbowY: 0.30, elbowZ: 0.09,
    handX: 0.105, handY: 0.17, handZ: 0.17,
  });
  const left = supported ? supportedSide() : groundSide();
  const right = supported ? supportedSide() : groundSide();

  if (resolvedStyle === 'supported-brace-left') {
    Object.assign(left, { elbowX: 0.20, elbowY: 0.245, elbowZ: -0.015, handX: 0.205, handY: 0.105, handZ: -0.045 });
    Object.assign(right, { handX: 0.07, handY: 0.175, handZ: 0.205 });
  } else if (resolvedStyle === 'supported-brace-right') {
    Object.assign(right, { elbowX: 0.20, elbowY: 0.245, elbowZ: -0.015, handX: 0.205, handY: 0.105, handZ: -0.045 });
    Object.assign(left, { handX: 0.07, handY: 0.175, handZ: 0.205 });
  } else if (resolvedStyle === 'supported-knees') {
    left.handY = right.handY = 0.17;
    left.handZ = right.handZ = 0.205;
  } else if (resolvedStyle === 'ground-side-left') {
    Object.assign(left, { kneeX: 0.17, kneeY: 0.09, kneeZ: 0.105, ankleX: 0.145, ankleZ: 0.235, handX: 0.145, handY: 0.145, handZ: 0.11 });
    Object.assign(right, { kneeX: 0.095, kneeZ: 0.19, ankleX: 0.075, ankleZ: 0.29, handX: 0.085, handY: 0.17, handZ: 0.19 });
  } else if (resolvedStyle === 'ground-side-right') {
    Object.assign(right, { kneeX: 0.17, kneeY: 0.09, kneeZ: 0.105, ankleX: 0.145, ankleZ: 0.235, handX: 0.145, handY: 0.145, handZ: 0.11 });
    Object.assign(left, { kneeX: 0.095, kneeZ: 0.19, ankleX: 0.075, ankleZ: 0.29, handX: 0.085, handY: 0.17, handZ: 0.19 });
  } else if (resolvedStyle === 'ground-open') {
    left.kneeX = right.kneeX = 0.15;
    left.handX = right.handX = 0.115;
    left.handY = right.handY = 0.155;
  }

  const standing: RestSidePlan = {
    kneeX: 0.052, kneeY: 0.235, kneeZ: 0.012,
    ankleX: 0.049, ankleY: 0.02, ankleZ: 0.02,
    elbowX: 0.12, elbowY: 0.52, elbowZ: 0,
    handX: 0.12, handY: 0.34, handZ: 0,
  };
  const leftPlan = mixSide(standing, left, t);
  const rightPlan = mixSide(standing, right, t);

  // Settling reaches toward support; rising shifts both hands onto the knees/ground before the push.
  if (stage === 'settling' && transitionPulse > 0) {
    const braceLeft = resolvedStyle === 'supported-brace-left' || resolvedStyle === 'ground-side-left';
    const braceRight = resolvedStyle === 'supported-brace-right' || resolvedStyle === 'ground-side-right';
    if (braceLeft) leftPlan.handY -= 0.055 * transitionPulse;
    if (braceRight) rightPlan.handY -= 0.055 * transitionPulse;
  }
  if (stage === 'rising' && transitionPulse > 0) {
    for (const side of [leftPlan, rightPlan]) {
      side.handY -= 0.045 * transitionPulse;
      side.handZ += 0.035 * transitionPulse;
      side.elbowY -= 0.02 * transitionPulse;
    }
  }

  const breathingLift = breathing * t;
  const transitionLean = stage === 'settling' ? 0.075 * transitionPulse
    : stage === 'rising' ? 0.14 * transitionPulse : 0;
  const quietRoll = stage === 'settled' ? Math.sin(attentionYaw * 2.4) * 0.008 * t : 0;

  return {
    blend: t,
    bodyLift: t === 0 ? 0 : bodyLiftTarget * t + breathingLift,
    bodyPitch: t === 0 ? 0 : bodyPitchTarget * t + transitionLean + ageLean * t,
    bodyYaw: attentionYaw * 0.11 * t,
    bodyRoll: quietRoll,
    headYaw: attentionYaw * 0.78 * t,
    left: leftPlan,
    right: rightPlan,
  };
}

function mixSide(standing: RestSidePlan, target: RestSidePlan, t: number): RestSidePlan {
  return {
    kneeX: mix(standing.kneeX, target.kneeX, t),
    kneeY: mix(standing.kneeY, target.kneeY, t),
    kneeZ: mix(standing.kneeZ, target.kneeZ, t),
    ankleX: mix(standing.ankleX, target.ankleX, t),
    ankleY: mix(standing.ankleY, target.ankleY, t),
    ankleZ: mix(standing.ankleZ, target.ankleZ, t),
    elbowX: mix(standing.elbowX, target.elbowX, t),
    elbowY: mix(standing.elbowY, target.elbowY, t),
    elbowZ: mix(standing.elbowZ, target.elbowZ, t),
    handX: mix(standing.handX, target.handX, t),
    handY: mix(standing.handY, target.handY, t),
    handZ: mix(standing.handZ, target.handZ, t),
  };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
