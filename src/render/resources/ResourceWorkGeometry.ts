import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Shared end-grain and bark colours make even a small log pile legible in silhouette and shade. */
export function resourceLogGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.11, 0.13, 0.9, 7);
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  const bark = new THREE.Color('#806047'), end = new THREE.Color('#d4b080');
  for (let i = 0; i < normals.count; i++) {
    const color = Math.abs(normals.getY(i)) > 0.8 ? end : bark;
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** A tied spray of stems and leaves, built once for the entire plant-work pool. */
export function resourceBundleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    const x = Math.cos(angle) * 0.013, z = Math.sin(angle) * 0.013;
    parts.push(new THREE.CylinderGeometry(0.0025, 0.0035, 0.105, 4).translate(x, 0, z));
    parts.push(new THREE.SphereGeometry(0.016, 5, 3).scale(0.55, 1.4, 1)
      .rotateZ((i % 2 ? 1 : -1) * 0.45).translate(x, 0.032 + i * 0.007, z));
  }
  parts.push(new THREE.TorusGeometry(0.018, 0.0025, 3, 8).rotateX(Math.PI / 2).translate(0, -0.016, 0));
  const merged = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return merged;
}

/** A tapered metal/stone wedge: scale it broad for an axe, slender for a pick. */
export function resourceToolHeadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const edge = position.getX(i) > 0;
    position.setY(i, position.getY(i) * (edge ? 1.15 : 0.65));
    position.setZ(i, position.getZ(i) * (edge ? 0.25 : 1));
  }
  geometry.computeVertexNormals();
  return geometry;
}
