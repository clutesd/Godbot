import * as THREE from 'three';
import type { WorldState } from '../../sim/types';
import type { TransportSegment } from '../../sim/transport/types';
import { surfaceHeightAt } from '../../sim/terrain/SurfaceGeometry';

/** A surface ribbon over the exact surveyed polyline. No spline or invented connection. */
export function transportRibbon(world: WorldState, segment: TransportSegment, width: number, offset = 0, lift = 0): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  const roadUV: number[] = [];
  // Preserve the surveyed centerline, inserting samples only along existing segments.
  const points: typeof segment.points = [];
  for (let i = 0; i < segment.points.length; i++) {
    const p = segment.points[i]!;
    const next = segment.points[i + 1];
    points.push(p);
    if (!next) continue;
    const steps = Math.ceil(Math.hypot(next.x - p.x, next.z - p.z) / 0.16);
    for (let j = 1; j < steps; j++) {
      const t = j / steps;
      points.push({ x: p.x + (next.x - p.x) * t, y: p.y + (next.y - p.y) * t, z: p.z + (next.z - p.z) * t });
    }
  }
  let distance = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (i > 0) distance += Math.hypot(p.x - points[i - 1]!.x, p.z - points[i - 1]!.z);
    const before = points[Math.max(0, i - 1)]!;
    const after = points[Math.min(points.length - 1, i + 1)]!;
    const length = Math.max(0.00001, Math.hypot(after.x - before.x, after.z - before.z));
    const nx = -(after.z - before.z) / length;
    const nz = (after.x - before.x) / length;
    for (const side of [-1, 1]) {
      const x = p.x + nx * (offset + side * width / 2);
      const z = p.z + nz * (offset + side * width / 2);
      const y = segment.kind === 'bridge' ? p.y : surfaceHeightAt(world, x, z) + 0.04;
      vertices.push(x, y + lift, z);
      roadUV.push((side + 1) / 2, distance, 4);
    }
    if (i > 0) { const n = i * 2; indices.push(n - 2, n, n - 1, n - 1, n, n + 1); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('roadUV', new THREE.Float32BufferAttribute(roadUV, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
