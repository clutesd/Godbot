import * as THREE from 'three';
import type { WorldState } from '../../sim/types';
import type { TransportSegment } from '../../sim/transport/types';
import { surfaceHeightAt } from '../../sim/terrain/SurfaceGeometry';

/** A surface ribbon over the exact surveyed polyline. No spline or invented connection. */
export function transportRibbon(world: WorldState, segment: TransportSegment, width: number, offset = 0, lift = 0): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < segment.points.length; i++) {
    const p = segment.points[i]!;
    const before = segment.points[Math.max(0, i - 1)]!;
    const after = segment.points[Math.min(segment.points.length - 1, i + 1)]!;
    const length = Math.max(0.00001, Math.hypot(after.x - before.x, after.z - before.z));
    const nx = -(after.z - before.z) / length;
    const nz = (after.x - before.x) / length;
    for (const side of [-1, 1]) {
      const x = p.x + nx * (offset + side * width / 2);
      const z = p.z + nz * (offset + side * width / 2);
      const y = segment.kind === 'bridge' ? p.y : surfaceHeightAt(world, x, z) + 0.04;
      vertices.push(x, y + lift, z);
    }
    if (i > 0) { const n = i * 2; indices.push(n - 2, n, n - 1, n - 1, n, n + 1); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
