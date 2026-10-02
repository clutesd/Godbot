import type * as THREE from 'three';

/** Anchor is the flat sole origin. Roll about a fixed heel/toe, never about the ankle in mid-air. */
export function soleTarget(out: THREE.Vector3, contact: {
  x: number; y: number; z: number; yaw: number; pitch: number;
}, scale: number, thickness: number): THREE.Vector3 {
  const pivot = (contact.pitch > 0 ? 0.092 : -0.026) * scale * thickness;
  const forward = (1 - Math.cos(contact.pitch)) * pivot;
  return out.set(contact.x + Math.sin(contact.yaw) * forward,
    contact.y + Math.sin(contact.pitch) * pivot,
    contact.z + Math.cos(contact.yaw) * forward);
}
