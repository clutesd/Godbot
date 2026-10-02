import type { PersonVisualState, PersonVisualGround } from './PeopleVisualState';

export const SUPPORT_SHIFT = 0.022;

interface Contact {
  x: number; y: number; z: number; yaw: number; pitch: number;
  fromX: number; fromY: number; fromZ: number; fromYaw: number;
  toX: number; toY: number; toZ: number; toYaw: number;
  progress: number; planted: boolean; duration: number; contactAge: number; releasePitch: number;
}
export interface GroundedStride {
  feet: [Contact, Contact]; next: number; active: number;
  seconds: number; supportTime: number; motion: number; bodyY: number; weight: number; phase: number; headLead: number;
  lean: number; previousSpeed: number; secondary: number;
}
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t: number) => t * t * (3 - 2 * t);

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
        return { x, y, z, yaw: v.facing, pitch: 0, fromX: x, fromY: y, fromZ: z, fromYaw: v.facing,
          toX: x, toY: y, toZ: z, toYaw: v.facing, progress: 1, planted: true, duration: 0.3, contactAge: 1, releasePitch: 0 };
      };
      s = { feet: [foot(-1), foot(1)], next: 0, active: -1, seconds: 0, supportTime: 0, motion: 0, bodyY: -0.018 * legLength,
        weight: 0, phase: 0, headLead: 0, lean: 0, previousSpeed: v.speed, secondary: 0 };
      this.states.set(v.id, s);
    }
    s.seconds += dt;
    s.supportTime = Math.max(0, s.supportTime - dt);
    s.motion += (Math.min(1, v.speed / 0.12) - s.motion) * (1 - Math.exp(-dt * 6));
    for (const f of s.feet) {
      if (!f.planted) continue;
      f.contactAge += dt;
      // Heel accepts load first. The trailing foot then rolls over its toe without sliding.
      const behind = (v.x - f.x) * Math.sin(f.yaw) + (v.z - f.z) * Math.cos(f.yaw);
      const toe = smooth(Math.max(0, Math.min(1, (behind / (scale * legLength) - 0.045) / 0.15)));
      const heel = 1 - smooth(Math.min(1, f.contactAge / 0.09));
      f.pitch = 0.25 * toe * s.motion - 0.14 * heel;
    }
    const turning = angle(v.desiredFacing - v.facing);
    s.headLead += (Math.max(-0.6, Math.min(0.6, turning)) - s.headLead) * (1 - Math.exp(-dt * 10));
    const acceleration = dt > 0 ? (v.speed - s.previousSpeed) / dt : 0;
    s.previousSpeed = v.speed;
    s.lean += (Math.max(-0.045, Math.min(0.075, acceleration * 0.055)) - s.lean) * (1 - Math.exp(-dt * 7));
    const reach = 0.16 * legLength * scale * stride;
    // Only one foot moves at a time; stopped bodies finish the outstanding step then settle.
    if (s.active < 0 && s.supportTime === 0) {
      const side = s.next === 0 ? -1 : 1;
      const f = s.feet[s.next]!;
      const restX = v.x + Math.cos(v.facing) * side * stance * scale;
      const restZ = v.z - Math.sin(v.facing) * side * stance * scale;
      if (Math.hypot(restX - f.x, restZ - f.z) > (v.speed > 0.015 ? reach * 0.52 : scale * 0.035)
        || Math.abs(angle(v.facing - f.yaw)) > 0.30) {
        // Freeze cadence at release, and predict where the BODY will be at touchdown.
        // Half a stance of lead remains after touchdown; the old target was overtaken in flight.
        const duration = Math.max(0.18, Math.min(0.40, 0.060 * legLength * scale / 0.32 * stride / Math.max(0.10, v.speed)));
        const brakingDistance = Math.hypot(v.destinationX - v.x, v.destinationZ - v.z);
        const advance = Math.min(v.speed * duration, brakingDistance);
        const lead = advance + Math.min(reach * 0.60, v.speed * duration * 0.50);

        const x = restX + Math.sin(v.facing) * lead;
        const z = restZ + Math.cos(v.facing) * lead;
        if (ground.isStandable(x, z) && (!ground.safeSegment || ground.safeSegment(v, { x, z }))) {
          Object.assign(f, { fromX: f.x, fromY: f.y, fromZ: f.z, fromYaw: f.yaw,
            toX: x, toY: ground.heightAt(x, z), toZ: z, toYaw: v.facing, progress: 0, planted: false, duration, releasePitch: f.pitch });
          s.active = s.next;
        }
      }
    }
    if (s.active >= 0) {
      const f = s.feet[s.active]!;
      f.progress = Math.min(1, f.progress + dt / f.duration);
      const t = f.progress, u = t * t * t * (10 + t * (-15 + 6 * t));
      f.x = f.fromX + (f.toX - f.fromX) * u;
      f.z = f.fromZ + (f.toZ - f.fromZ) * u;
      f.y = f.fromY + (f.toY - f.fromY) * u + Math.sin(Math.PI * t) ** 2 * scale * 0.040 * legLength;
      f.yaw = f.fromYaw + angle(f.toYaw - f.fromYaw) * u;
      // Continuous release from toe support, then dorsiflex for heel-first contact.
      f.pitch = t < 0.42 ? f.releasePitch * (1 - smooth(t / 0.42))
        : -0.14 * smooth((t - 0.42) / 0.58);
      s.phase = (s.active === 0 ? 0 : Math.PI) + t * Math.PI;
      if (t === 1) { f.x = f.toX; f.y = f.toY; f.z = f.toZ; f.planted = true; f.contactAge = 0; f.pitch = -0.14; s.supportTime = 0.055; s.next = 1 - s.active; s.active = -1; }
    }
    const weight = s.active >= 0
      ? (s.active === 0 ? 1 : -1) * (0.7 + 0.3 * Math.sin(s.feet[s.active]!.progress * Math.PI))
      : s.motion > 0.2 ? (s.next === 0 ? 1 : -1) * 0.7
      : restingWeight * (0.6 + Math.sin(s.seconds * 0.4) * 0.12);
    s.weight += (weight - s.weight) * (1 - Math.exp(-dt * (s.active < 0 ? 1.3 : 8)));
    s.secondary += (s.weight - s.secondary) * (1 - Math.exp(-dt * 4));
    // A conservative reachable hip height, including the farthest held contact and terrain.
    const support = s.active === 0 ? s.feet[1] : s.active === 1 ? s.feet[0]
      : s.feet[s.next === 0 ? 1 : 0];
    const load = Math.sin(Math.min(1, support.contactAge / 0.16) * Math.PI) ** 2 * s.motion;
    let hip = v.footY + (0.447 * legLength - load * 0.004) * scale;
    for (let side = 0; side < 2; side++) {
      const f = s.feet[side]!;
      const lateral = ((side ? 1 : -1) * stance + s.weight * SUPPORT_SHIFT) * scale;
      const horizontal = Math.hypot(f.x - v.x - Math.cos(v.facing) * lateral,
        f.z - v.z + Math.sin(v.facing) * lateral);
      const maxLeg = 0.447 * legLength * scale;
      hip = Math.min(hip, f.y + Math.sqrt(Math.max(maxLeg * maxLeg - horizontal * horizontal, maxLeg * maxLeg * 0.15)));
    }
    const targetY = (hip - v.footY) / scale - 0.45 * legLength;
    // Ease upward out of compression; downward correction must still respect leg reach.
    s.bodyY = Math.min(targetY, s.bodyY + (targetY - s.bodyY) * (1 - Math.exp(-dt * 10)));
    return s;
  }
}
