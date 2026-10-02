import type * as THREE from 'three';
import type { PersonVisualGround } from './PeopleVisualState';

/** Sample once per footfall, so a planted sole never chases a noisy normal each frame. */
export function sampleSoleSlope(out: { terrainPitch: number; roll: number },
  x: number, z: number, yaw: number, scale: number, ground: PersonVisualGround): void {
  const radius = Math.max(0.002, scale * 0.045);
  const forwardX = Math.sin(yaw) * radius, forwardZ = Math.cos(yaw) * radius;
  const rightX = Math.cos(yaw) * radius, rightZ = -Math.sin(yaw) * radius;
  const forward = (ground.heightAt(x + forwardX, z + forwardZ)
    - ground.heightAt(x - forwardX, z - forwardZ)) / (2 * radius);
  const right = (ground.heightAt(x + rightX, z + rightZ)
    - ground.heightAt(x - rightX, z - rightZ)) / (2 * radius);
  // Navigation decides standability; bounds keep isolated terrain edges from flipping an ankle.
  out.terrainPitch = Math.max(-0.48, Math.min(0.48, -Math.atan(forward)));
  out.roll = Math.max(-0.40, Math.min(0.40, Math.atan(right * Math.cos(out.terrainPitch))));
}

/** Anchor is the flat sole origin. Roll about a fixed heel/toe, never about the ankle in mid-air. */
export function soleTarget(out: THREE.Vector3, contact: {
  x: number; y: number; z: number; yaw: number; pitch: number; terrainPitch?: number;
}, scale: number, thickness: number): THREE.Vector3 {
  const pivot = (contact.pitch > 0 ? 0.092 : -0.026) * scale * thickness;
  const slope = contact.terrainPitch ?? 0;
  // YXZ rotation leaves a forward pivot independent of lateral roll. Subtract its rotated
  // position from its resting position on the slope to keep the loaded toe/heel fixed.
  const forward = (Math.cos(slope) - Math.cos(slope + contact.pitch)) * pivot;
  return out.set(contact.x + Math.sin(contact.yaw) * forward,
    contact.y + (Math.sin(slope + contact.pitch) - Math.sin(slope)) * pivot,
    contact.z + Math.cos(contact.yaw) * forward);
}
