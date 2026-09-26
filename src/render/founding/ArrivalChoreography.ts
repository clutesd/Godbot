import { podTouchdown, type FoundingPod } from '../../sim/founding/FoundingArrival';
import type { Person, Vec2 } from '../../sim/types';

/** All measurements here describe presentation geometry, never simulation destinations. */
export const ARRIVAL_FOOTPRINT_RADIUS = 3.2;
export const ARRIVAL_HATCH = { z: -0.87, sill: 0.36, length: 0.9, angle: 1.98 } as const;
export const ARRIVAL_WALK_SPEED = 0.5;
export const arrivalRampEnd = { z: ARRIVAL_HATCH.z - Math.sin(ARRIVAL_HATCH.angle) * ARRIVAL_HATCH.length,
  height: ARRIVAL_HATCH.sill + Math.cos(ARRIVAL_HATCH.angle) * ARRIVAL_HATCH.length };

/** The exhaust clears the physical landing/egress footprint just before hull contact. */
export function arrivalClearingRadius(pod: FoundingPod, seconds: number): number {
  const progress = Math.max(0, Math.min(1, (seconds - podTouchdown(pod) + 1.2) / 1.2));
  return ARRIVAL_FOOTPRINT_RADIUS * progress;
}

export interface ArrivalFounderPose extends Vec2 { footY: number; facing: number; speed: number; complete: boolean }

/** Two narrow lanes share the hatch, then fan toward the existing authoritative gathering places. */
export function arrivalFounderPose(person: Person, pod: FoundingPod, seconds: number,
  heightAt: (x: number, z: number) => number): ArrivalFounderPose | undefined {
  const origin = person.foundingOrigin;
  if (!origin || origin.podId !== pod.id || seconds < origin.emergedSeconds) return undefined;
  const lane = (Math.max(0, pod.personIds.indexOf(person.id)) % 2 ? 1 : -1) * 0.095;
  const start = { x: pod.position.x + lane, z: pod.position.z - 0.64, y: pod.groundY + ARRIVAL_HATCH.sill };
  const sill = { x: start.x, z: pod.position.z + ARRIVAL_HATCH.z, y: start.y };
  const ramp = { x: start.x, z: pod.position.z + arrivalRampEnd.z, y: pod.groundY + arrivalRampEnd.height };
  const end = { ...person.target, y: heightAt(person.target.x, person.target.z) };
  const path = [start, sill, ramp, end];
  let distance = Math.max(0, seconds - origin.emergedSeconds) * ARRIVAL_WALK_SPEED;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z, b.y - a.y);
    if (distance <= length && length > 0) {
      const f = distance / length;
      const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
      // The ramp supports feet above terrain; the final leg follows the actual surface.
      const footY = i < 3 ? a.y + (b.y - a.y) * f
        : Math.max(heightAt(x, z), a.y + (b.y - a.y) * f);
      return { x, z, footY, facing: Math.atan2(b.x - a.x, b.z - a.z), speed: ARRIVAL_WALK_SPEED, complete: false };
    }
    distance -= length;
  }
  return { x: end.x, z: end.z, footY: end.y, facing: Math.atan2(pod.position.x - end.x, pod.position.z - end.z), speed: 0, complete: true };
}
