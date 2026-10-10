import { podTouchdown, type FoundingPod } from '../../sim/founding/FoundingArrival';
import type { Person, Vec2 } from '../../sim/types';
import type { PersonVisualGround } from '../people/PeopleVisualState';

/** All measurements here describe presentation geometry, never simulation destinations. */
export const ARRIVAL_FOOTPRINT_RADIUS = 3.2;
export const ARRIVAL_HATCH = { z: -0.87, sill: 0.36, length: 0.9, angle: 1.98 } as const;
export const ARRIVAL_WALK_SPEED = 0.32;
export const arrivalRampEnd = { z: ARRIVAL_HATCH.z - Math.sin(ARRIVAL_HATCH.angle) * ARRIVAL_HATCH.length,
  height: ARRIVAL_HATCH.sill + Math.cos(ARRIVAL_HATCH.angle) * ARRIVAL_HATCH.length };

export interface ArrivalRamp { angle: number; z: number; height: number }

/** The physical door reaches the local terrain, including landing sites on a hillside. */
export function arrivalRampFor(pod: FoundingPod, heightAt: (x: number, z: number) => number): ArrivalRamp {
  let low = 1.1, high = 2.65;
  for (let i = 0; i < 16; i++) {
    const angle = (low + high) / 2;
    const z = pod.position.z + ARRIVAL_HATCH.z - Math.sin(angle) * ARRIVAL_HATCH.length;
    const y = pod.groundY + ARRIVAL_HATCH.sill + Math.cos(angle) * ARRIVAL_HATCH.length;
    if (y > heightAt(pod.position.x, z)) low = angle;
    else high = angle;
  }
  const angle = (low + high) / 2;
  return { angle, z: ARRIVAL_HATCH.z - Math.sin(angle) * ARRIVAL_HATCH.length,
    height: ARRIVAL_HATCH.sill + Math.cos(angle) * ARRIVAL_HATCH.length };
}

export interface ArrivalGround extends PersonVisualGround { ramp: ArrivalRamp }

function rampHeightAt(pod: FoundingPod, ramp: ArrivalRamp, heightAt: (x: number, z: number) => number,
  x: number, z: number): number {
  const terrain = heightAt(x, z);
  if (Math.abs(x - pod.position.x) > 0.265 || z < pod.position.z + ramp.z || z > pod.position.z - 0.50) return terrain;
  const t = Math.max(0, Math.min(1, (z - pod.position.z - ARRIVAL_HATCH.z) / (ramp.z - ARRIVAL_HATCH.z)));
  return Math.max(terrain, pod.groundY + ARRIVAL_HATCH.sill + (ramp.height - ARRIVAL_HATCH.sill) * t);
}

/** A narrow portal exemption, shared by root motion, sole normals and footfall planning.
 * Outside the hatch corridor the ordinary terrain and obstacle checks remain authoritative. */
export function arrivalGroundFor(pod: FoundingPod, ground: PersonVisualGround): ArrivalGround {
  const ramp = arrivalRampFor(pod, ground.heightAt);
  const onRamp = (x: number, z: number) => Math.abs(x - pod.position.x) <= 0.265
    && z >= pod.position.z + ramp.z && z <= pod.position.z - 0.50;
  return {
    ramp,
    heightAt: (x, z) => rampHeightAt(pod, ramp, ground.heightAt, x, z),
    isStandable: (x, z) => onRamp(x, z) || ground.isStandable(x, z),
    safeSegment: (a, b) => {
      if (onRamp(a.x, a.z) && onRamp(b.x, b.z)) return true;
      // The only exempt boundary crossing is the foot of the ramp, never the hull's sides.
      const rampPoint = onRamp(a.x, a.z) ? a : onRamp(b.x, b.z) ? b : undefined;
      if (rampPoint) {
        const outside = rampPoint === a ? b : a;
        if (outside.z > pod.position.z + ramp.z || Math.abs(outside.x - pod.position.x) > 0.265) return false;
        return !ground.safeSegment || ground.safeSegment({ x: rampPoint.x, z: pod.position.z + ramp.z }, outside);
      }
      return !ground.safeSegment || ground.safeSegment(a, b);
    },
  };
}

/** The exhaust clears the physical landing/egress footprint just before hull contact. */
export function arrivalClearingRadius(pod: FoundingPod, seconds: number): number {
  const progress = Math.max(0, Math.min(1, (seconds - podTouchdown(pod) + 1.2) / 1.2));
  return ARRIVAL_FOOTPRINT_RADIUS * progress;
}

export interface ArrivalFounderPose extends Vec2 { footY: number; facing: number; speed: number; complete: boolean }

/** Two narrow lanes share the hatch, then fan toward the existing authoritative gathering places. */
export function arrivalFounderPose(person: Person, pod: FoundingPod, seconds: number,
  heightAt: (x: number, z: number) => number, deployedRamp = arrivalRampFor(pod, heightAt)): ArrivalFounderPose | undefined {
  const origin = person.foundingOrigin;
  if (!origin || origin.podId !== pod.id || seconds < origin.emergedSeconds) return undefined;
  const lane = (Math.max(0, pod.personIds.indexOf(person.id)) % 2 ? 1 : -1) * 0.095;
  const start = { x: pod.position.x + lane, z: pod.position.z - 0.64, y: pod.groundY + ARRIVAL_HATCH.sill };
  const sill = { x: start.x, z: pod.position.z + ARRIVAL_HATCH.z, y: start.y };
  const ramp = { x: start.x, z: pod.position.z + deployedRamp.z, y: pod.groundY + deployedRamp.height };
  const surface = (x: number, z: number) => rampHeightAt(pod, deployedRamp, heightAt, x, z);
  const end = { ...person.target, y: surface(person.target.x, person.target.z) };
  // Clear the toe of the ramp before turning toward the gathering arc. Direct diagonal exits
  // cut back through its edge rails for people whose gathering place is beside the vessel.
  const apron = { x: start.x, z: ramp.z - 0.20, y: surface(start.x, ramp.z - 0.20) };
  const outsideX = pod.position.x + Math.sign(end.x - pod.position.x || lane) * Math.max(0.40, Math.abs(end.x - pod.position.x));
  const fan = { x: outsideX, z: apron.z, y: surface(outsideX, apron.z) };
  const path = end.z > ramp.z && Math.abs(end.x - pod.position.x) > 0.265
    ? [start, sill, ramp, apron, fan, end] : [start, sill, ramp, apron, end];
  let lengthTotal = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    lengthTotal += Math.hypot(b.x - a.x, b.z - a.z, b.y - a.y);
  }
  const age = Math.max(0, seconds - origin.emergedSeconds);
  const startSeconds = 0.24, stopSeconds = 0.38;
  const duration = lengthTotal / ARRIVAL_WALK_SPEED + (startSeconds + stopSeconds) / 2;
  let distance = ARRIVAL_WALK_SPEED * (age - startSeconds / 2);
  let pathSpeed = ARRIVAL_WALK_SPEED;
  if (age < startSeconds) {
    distance = ARRIVAL_WALK_SPEED * age * age / (2 * startSeconds);
    pathSpeed *= age / startSeconds;
  } else if (age > duration - stopSeconds) {
    const remaining = Math.max(0, duration - age);
    distance = lengthTotal - ARRIVAL_WALK_SPEED * remaining * remaining / (2 * stopSeconds);
    pathSpeed *= remaining / stopSeconds;
  }
  if (age >= duration) return { x: end.x, z: end.z, footY: end.y,
    facing: Math.atan2(pod.position.x - end.x, pod.position.z - end.z), speed: 0, complete: true };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z, b.y - a.y);
    if (distance <= length && length > 0) {
      const f = distance / length;
      const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
      // The ramp supports feet above terrain; the final leg follows the actual surface.
      const footY = surface(x, z);
      const speed = pathSpeed * Math.hypot(b.x - a.x, b.z - a.z) / length;
      return { x, z, footY, facing: Math.atan2(b.x - a.x, b.z - a.z), speed, complete: false };
    }
    distance -= length;
  }
  return { x: end.x, z: end.z, footY: end.y, facing: Math.atan2(pod.position.x - end.x, pod.position.z - end.z), speed: 0, complete: true };
}
