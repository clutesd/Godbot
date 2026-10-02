import type { PersonVisualState, PersonVisualGround } from './PeopleVisualState';

export const SUPPORT_SHIFT = 0.024;

interface Contact {
  x: number; y: number; z: number; yaw: number; pitch: number;
  fromX: number; fromY: number; fromZ: number; fromYaw: number;
  toX: number; toY: number; toZ: number; toYaw: number;
  progress: number; planted: boolean; duration: number; contactAge: number; releasePitch: number;
}

export interface GroundedStride {
  feet: [Contact, Contact];
  next: number;
  active: number;
  seconds: number;
  supportTime: number;
  motion: number;
  bodyY: number;
  weight: number;
  phase: number;
  headLead: number;
  lean: number;
  previousSpeed: number;
  secondary: number;
  /** Signed change in travel heading that the next step is anticipating. */
  turn: number;
  /** 0..1 response used to make starts decisive and stops settle rather than shuffle. */
  locomotionBlend: number;
}

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const smoother = (t: number) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function stableParity(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash & 1;
}

/**
 * Human swing clearance is not a symmetric ballistic arc. The foot leaves the toe slowly, gains
 * clearance while the knee folds, then extends toward heel strike with only a small late hover.
 */
function swingClearance(t: number): number {
  if (t < 0.18) return mix(0, 0.34, smooth(t / 0.18));
  if (t < 0.52) return mix(0.34, 1, smoother((t - 0.18) / 0.34));
  if (t < 0.80) return mix(1, 0.24, smooth((t - 0.52) / 0.28));
  return mix(0.24, 0, smoother((t - 0.80) / 0.20));
}

/**
 * Toe-off is deliberately slower than mid-swing, while the final part decelerates into heel
 * contact. This removes the equal-speed pendulum look of a single smoothstep trajectory.
 */
function swingTravel(t: number): number {
  if (t < 0.18) return 0.10 * smoother(t / 0.18);
  if (t < 0.72) return 0.10 + 0.75 * smoother((t - 0.18) / 0.54);
  return 0.85 + 0.15 * smoother((t - 0.72) / 0.28);
}

/** World-space contacts are held until toe-off. Rendering only: never writes navigation or people. */
export class GroundedLocomotion {
  private readonly states = new Map<string, GroundedStride>();

  clear(): void { this.states.clear(); }
  forget(id: string): void { this.states.delete(id); }

  update(v: PersonVisualState, dt: number, scale: number, legLength: number, stance: number,
    stride: number, ground: PersonVisualGround, restingWeight = 0): GroundedStride {
    dt = Math.min(0.1, Math.max(0, dt));
    let s = this.states.get(v.id);
    if (!s || v.snapped) {
      const foot = (side: number): Contact => {
        const x = v.x + Math.cos(v.facing) * side * stance * scale;
        const z = v.z - Math.sin(v.facing) * side * stance * scale;
        const y = ground.heightAt(x, z);
        return {
          x, y, z, yaw: v.facing, pitch: 0,
          fromX: x, fromY: y, fromZ: z, fromYaw: v.facing,
          toX: x, toY: y, toZ: z, toYaw: v.facing,
          progress: 1, planted: true, duration: 0.3, contactAge: 1, releasePitch: 0,
        };
      };
      s = {
        feet: [foot(-1), foot(1)],
        next: stableParity(v.id),
        active: -1,
        seconds: 0,
        supportTime: 0,
        motion: 0,
        bodyY: -0.012 * legLength,
        weight: 0,
        phase: 0,
        headLead: 0,
        lean: 0,
        previousSpeed: v.speed,
        secondary: 0,
        turn: 0,
        locomotionBlend: 0,
      };
      this.states.set(v.id, s);
    }

    s.seconds += dt;
    s.supportTime = Math.max(0, s.supportTime - dt);

    const moving = v.speed > 0.018;
    const wasMoving = s.previousSpeed > 0.018;
    const starting = moving && !wasMoving;
    const stopping = !moving && wasMoving;
    const desiredMotion = Math.min(1, v.speed / 0.14);
    const motionRate = desiredMotion > s.motion ? 9 : 5;
    s.motion += (desiredMotion - s.motion) * (1 - Math.exp(-dt * motionRate));
    s.locomotionBlend += ((moving ? 1 : 0) - s.locomotionBlend)
      * (1 - Math.exp(-dt * (moving ? 8 : 4.5)));

    const rawTurn = angle(v.desiredFacing - v.facing);
    s.turn += (Math.max(-0.85, Math.min(0.85, rawTurn)) - s.turn) * (1 - Math.exp(-dt * 9));
    s.headLead += (Math.max(-0.55, Math.min(0.55, rawTurn * 1.15)) - s.headLead)
      * (1 - Math.exp(-dt * 11));

    const acceleration = dt > 0 ? (v.speed - s.previousSpeed) / dt : 0;
    s.previousSpeed = v.speed;
    s.lean += (Math.max(-0.04, Math.min(0.07, acceleration * 0.05)) - s.lean)
      * (1 - Math.exp(-dt * 7));

    for (const f of s.feet) {
      if (!f.planted) continue;
      f.contactAge += dt;
      // Heel accepts the load, then the same planted foot rolls toward the toe without translating.
      const behind = (v.x - f.x) * Math.sin(f.yaw) + (v.z - f.z) * Math.cos(f.yaw);
      const toe = smooth((behind / (scale * legLength) - 0.035) / 0.145);
      const heel = 1 - smooth(f.contactAge / 0.095);
      f.pitch = 0.27 * toe * s.motion - 0.145 * heel;
    }

    const reach = 0.16 * legLength * scale * stride;
    const stepThreshold = reach * (starting ? 0.22 : moving ? 0.58 : 0.72);

    // Only one foot moves at a time. A first step begins immediately; a final settling step is
    // allowed after braking, but idle characters do not keep shuffling toward a mathematically
    // perfect stance.
    if (s.active < 0 && s.supportTime === 0) {
      const side = s.next === 0 ? -1 : 1;
      const f = s.feet[s.next]!;
      const turnAhead = Math.max(-0.62, Math.min(0.62, s.turn));
      const anticipation = moving ? 0.55 + 0.20 * s.motion : 0.75;
      const stepFacing = v.facing + turnAhead * anticipation;
      const restX = v.x + Math.cos(stepFacing) * side * stance * scale;
      const restZ = v.z - Math.sin(stepFacing) * side * stance * scale;
      const restError = Math.hypot(restX - f.x, restZ - f.z);
      const yawError = Math.abs(angle(stepFacing - f.yaw));
      const needsTurnStep = yawError > (moving ? 0.18 : 0.22);
      const needsTranslationStep = restError > (moving ? stepThreshold : scale * 0.040);
      const shouldStep = starting || needsTurnStep || needsTranslationStep;

      if (shouldStep && (moving || restError > scale * 0.052 || yawError > 0.24 || stopping)) {
        // The committed swing owns its timing. Speed changes after toe-off must not stretch or
        // compress the leg in mid-air.
        const nominal = 0.30 + (1 - s.motion) * 0.055;
        const duration = Math.max(0.23, Math.min(0.40, nominal / Math.max(0.88, stride)));
        const brakingDistance = Math.hypot(v.destinationX - v.x, v.destinationZ - v.z);
        const advance = moving ? Math.min(v.speed * duration, brakingDistance) : 0;
        const firstStepScale = starting ? 0.72 : 1;
        const lead = (advance + Math.min(reach * 0.58, v.speed * duration * 0.52)) * firstStepScale;

        // Place the next foot along the upcoming travel arc, not merely under the body's current
        // heading. A small turn-dependent widening gives the centre of mass somewhere to go.
        const turnWidth = Math.min(0.018 * scale, Math.abs(turnAhead) * 0.018 * scale);
        const lateral = side * (stance * scale + turnWidth);
        const x = v.x + Math.cos(stepFacing) * lateral + Math.sin(stepFacing) * lead;
        const z = v.z - Math.sin(stepFacing) * lateral + Math.cos(stepFacing) * lead;
        if (ground.isStandable(x, z) && (!ground.safeSegment || ground.safeSegment(v, { x, z }))) {
          Object.assign(f, {
            fromX: f.x, fromY: f.y, fromZ: f.z, fromYaw: f.yaw,
            toX: x, toY: ground.heightAt(x, z), toZ: z, toYaw: stepFacing,
            progress: 0, planted: false, duration, releasePitch: f.pitch,
          });
          s.active = s.next;
        }
      }
    }

    if (s.active >= 0) {
      const f = s.feet[s.active]!;
      f.progress = Math.min(1, f.progress + dt / f.duration);
      const t = f.progress;
      const u = swingTravel(t);
      f.x = mix(f.fromX, f.toX, u);
      f.z = mix(f.fromZ, f.toZ, u);
      const baseline = mix(f.fromY, f.toY, u);
      const clearance = scale * legLength * (0.035 + 0.009 * s.motion) * swingClearance(t);
      f.y = baseline + clearance;
      f.yaw = f.fromYaw + angle(f.toYaw - f.fromYaw) * smoother(t);

      // Leave from the planted toe, dorsiflex during extension, and present the heel before landing.
      if (t < 0.18) f.pitch = mix(f.releasePitch, 0.08, smooth(t / 0.18));
      else if (t < 0.62) f.pitch = mix(0.08, -0.075, smooth((t - 0.18) / 0.44));
      else f.pitch = mix(-0.075, -0.145, smoother((t - 0.62) / 0.38));

      s.phase = (s.active === 0 ? 0 : Math.PI) + t * Math.PI;
      if (t >= 1) {
        f.x = f.toX; f.y = f.toY; f.z = f.toZ; f.yaw = f.toYaw;
        f.planted = true; f.contactAge = 0; f.pitch = -0.145;
        s.supportTime = moving ? 0.065 : 0.10;
        s.next = 1 - s.active;
        s.active = -1;
      }
    }

    // Centre of mass commits to the support leg early, then begins transferring only as the swing
    // foot is ready to accept weight. This is the visual difference between stepping and gliding.
    let weightTarget: number;
    if (s.active >= 0) {
      const supportSign = s.active === 0 ? 1 : -1;
      const t = s.feet[s.active]!.progress;
      const transfer = smooth((t - 0.72) / 0.28);
      weightTarget = mix(supportSign * (0.82 + 0.12 * Math.sin(t * Math.PI)), -supportSign * 0.28, transfer);
    } else if (s.motion > 0.12) {
      weightTarget = (s.next === 0 ? 1 : -1) * 0.72;
    } else {
      weightTarget = restingWeight * (0.62 + Math.sin(s.seconds * 0.37) * 0.10);
    }
    s.weight += (weightTarget - s.weight) * (1 - Math.exp(-dt * (s.active < 0 ? 3.2 : 9.5)));
    s.secondary += (s.weight - s.secondary) * (1 - Math.exp(-dt * 3.6));

    // Reach safety sets the ceiling for the pelvis. On top of that ceiling we only add downward
    // load response: compression after heel strike, recovery through midstance, and a tiny transfer
    // dip. The result rises naturally because compression is released, never because the legs
    // stretch to manufacture a bounce.
    const support = s.active === 0 ? s.feet[1] : s.active === 1 ? s.feet[0]
      : s.feet[s.next === 0 ? 1 : 0];
    let hip = v.footY + 0.447 * legLength * scale;
    for (let side = 0; side < 2; side++) {
      const f = s.feet[side]!;
      const lateral = ((side ? 1 : -1) * stance + s.weight * SUPPORT_SHIFT) * scale;
      const horizontal = Math.hypot(
        f.x - v.x - Math.cos(v.facing) * lateral,
        f.z - v.z + Math.sin(v.facing) * lateral,
      );
      const maxLeg = 0.447 * legLength * scale;
      hip = Math.min(hip,
        f.y + Math.sqrt(Math.max(maxLeg * maxLeg - horizontal * horizontal, maxLeg * maxLeg * 0.15)));
    }

    const contactLoad = support.planted
      ? Math.sin(Math.min(1, support.contactAge / 0.18) * Math.PI) ** 2 * s.motion
      : 0;
    const transferDip = s.active >= 0
      ? Math.sin(s.feet[s.active]!.progress * Math.PI) ** 4 * 0.0025 * legLength
      : 0;
    const reachY = (hip - v.footY) / scale - 0.45 * legLength;
    const desiredY = reachY - contactLoad * 0.0055 * legLength - transferDip;
    const response = desiredY < s.bodyY ? 16 : 8;
    s.bodyY += (desiredY - s.bodyY) * (1 - Math.exp(-dt * response));
    // Never rise above the reachable ceiling, even for one frame on uneven ground.
    s.bodyY = Math.min(s.bodyY, reachY);

    return s;
  }
}
