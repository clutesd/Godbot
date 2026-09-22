import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * A compact tied sheaf: stalks, seed heads and binding are one reusable geometry. It is only
 * documentary harvest evidence; quantity still comes from the existing agriculture presentation.
 */
export function farmSheafGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const offsets = [-0.022, -0.011, 0, 0.011, 0.022];
  for (let i = 0; i < offsets.length; i++) {
    const x = offsets[i]!;
    const z = (i % 2 ? 1 : -1) * 0.009;
    parts.push(new THREE.CylinderGeometry(0.0024, 0.0032, 0.16, 4).translate(x, 0.015, z));
    parts.push(new THREE.SphereGeometry(0.012, 5, 3).scale(0.65, 1.7, 0.8).translate(x, 0.105 + (i % 3) * 0.006, z));
  }
  parts.push(new THREE.TorusGeometry(0.028, 0.0035, 4, 10).rotateX(Math.PI / 2).translate(0, -0.005, 0));
  const merged = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return merged;
}

/** A faceted, soft-sided sack that remains readable at normal game scale. */
export function farmSackGeometry(): THREE.BufferGeometry {
  const sack = new THREE.SphereGeometry(0.075, 7, 5).scale(0.9, 1.15, 0.72);
  const neck = new THREE.CylinderGeometry(0.026, 0.038, 0.04, 6).translate(0, 0.09, 0);
  const merged = mergeGeometries([sack, neck])!;
  sack.dispose(); neck.dispose();
  return merged;
}
