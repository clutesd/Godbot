import * as THREE from 'three';
import type { TerrainField } from '../../sim/terrain/TerrainField';

type Point = { x: number; z: number };
const cross = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);

/** Height of the rendered triangles, including their alternating diagonal. */
export function renderedGroundSampler(terrain: TerrainField, heightAt: (x: number, z: number) => number) {
  const cache = new Map<number, number>();
  const { step, originX, originZ, resolution } = terrain;
  const node = (x: number, z: number) => {
    const key = z * resolution + x;
    if (!cache.has(key)) cache.set(key, heightAt(originX + x * step, originZ + z * step));
    return cache.get(key)!;
  };
  return (worldX: number, worldZ: number): number => {
    const gx = (worldX - originX) / step, gz = (worldZ - originZ) / step;
    if (gx < 0 || gz < 0 || gx > resolution - 1 || gz > resolution - 1) return heightAt(worldX, worldZ);
    const x = Math.min(resolution - 2, Math.floor(gx)), z = Math.min(resolution - 2, Math.floor(gz));
    const u = gx - x, v = gz - z;
    const a = node(x, z), b = node(x + 1, z), c = node(x, z + 1), d = node(x + 1, z + 1);
    if ((x + z) % 2 === 0) return u + v <= 1 ? a * (1 - u - v) + b * u + c * v
      : b * (1 - v) + c * (1 - u) + d * (u + v - 1);
    return v >= u ? a * (1 - v) + c * (v - u) + d * u : a * (1 - u) + d * v + b * (u - v);
  };
}

/** Split ground overlays at every visible terrain edge. Sampling only overlay vertices
 * leaves triangles cutting through ridges, even when each vertex is above the ground.
 * Positions remain in the input coordinate frame; colors and authored surface lifts survive.
 */
export function conformGroundGeometry(source: THREE.BufferGeometry, terrain: TerrainField,
  heightAt: (x: number, z: number) => number, origin = { x: 0, y: 0, z: 0 }): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [];
  const input = source.getAttribute('position'), color = source.getAttribute('color');
  const count = source.index?.count ?? input.count;
  const { step, originX, originZ, resolution } = terrain;
  const heights = new Map<number, number>();
  const vertex = (x: number, z: number) => {
    const key = z * resolution + x;
    const point = { x: originX + x * step, z: originZ + z * step };
    if (!heights.has(key)) heights.set(key, heightAt(point.x, point.z));
    return { ...point, y: heights.get(key)! };
  };
  const weights = (a: Point, b: Point, c: Point, p: Point) => {
    const area = cross(a, b, c);
    const u = cross(b, c, p) / area, v = cross(c, a, p) / area;
    return [u, v, 1 - u - v];
  };
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(n => source.index?.getX(i + n) ?? i + n);
    const tri = ids.map(id => ({ x: input.getX(id) + origin.x, z: input.getZ(id) + origin.z,
      lift: input.getY(id) + origin.y - heightAt(input.getX(id) + origin.x, input.getZ(id) + origin.z) }));
    if (Math.abs(cross(tri[0]!, tri[1]!, tri[2]!)) < 1e-12) continue;
    const minX = Math.max(0, Math.floor((Math.min(...tri.map(p => p.x)) - originX) / step));
    const maxX = Math.min(resolution - 2, Math.floor((Math.max(...tri.map(p => p.x)) - originX) / step));
    const minZ = Math.max(0, Math.floor((Math.min(...tri.map(p => p.z)) - originZ) / step));
    const maxZ = Math.min(resolution - 2, Math.floor((Math.max(...tri.map(p => p.z)) - originZ) / step));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const a = vertex(x, z), b = vertex(x + 1, z), c = vertex(x, z + 1), d = vertex(x + 1, z + 1);
      // Same alternating diagonals as TerrainSurface.buildGeometry.
      for (const face of (x + z) % 2 === 0 ? [[a, c, b], [b, c, d]] : [[a, c, d], [a, d, b]]) {
        let polygon: Point[] = tri;
        for (let edge = 0; edge < 3; edge++) {
          const start = face[edge]!, end = face[(edge + 1) % 3]!;
          const clipped: Point[] = [];
          for (let j = 0; j < polygon.length; j++) {
            const p = polygon[j]!, q = polygon[(j + 1) % polygon.length]!;
            const dp = cross(start, end, p), dq = cross(start, end, q);
            if (dp <= 1e-10) clipped.push(p);
            if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
              const t = dp / (dp - dq);
              clipped.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
            }
          }
          polygon = clipped;
        }
        for (let j = 1; j + 1 < polygon.length; j++) {
          const output = [polygon[0]!, polygon[j]!, polygon[j + 1]!];
          if (Math.abs(cross(...output as [Point, Point, Point])) < 1e-12) continue;
          if (cross(...output as [Point, Point, Point]) > 0) output.reverse();
          for (const point of output) {
            const w = weights(tri[0]!, tri[1]!, tri[2]!, point);
            const ground = weights(face[0]!, face[1]!, face[2]!, point);
            const y = face.reduce((sum, p, k) => sum + p.y * ground[k]!, 0)
              + tri.reduce((sum, p, k) => sum + p.lift * w[k]!, 0);
            positions.push(point.x - origin.x, y - origin.y, point.z - origin.z);
            if (color) for (let channel = 0; channel < 3; channel++) colors.push(ids.reduce((sum, id, k) =>
              sum + color.getComponent(id, channel) * w[k]!, 0));
          }
        }
      }
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (color) result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  result.computeVertexNormals(); result.computeBoundingSphere();
  return result;
}
