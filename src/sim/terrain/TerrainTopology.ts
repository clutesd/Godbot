import type { TerrainField } from './TerrainField';

/** Match D8 channel routing before choosing a decorative terrain diagonal. A river cannot
 * cross the ridge made by the other two (dry) corners of its own raster cell. */
export function terrainDiagonalAD(field: TerrainField, x: number, z: number): boolean {
  const a = z * field.resolution + x, b = a + 1, c = a + field.resolution, d = c + 1;
  const next = field.drainage?.downstream;
  if (next) {
    const routed = (i: number, j: number): number => field.river[i] && next[i] === j
      ? field.drainage!.accumulation[i]! : 0;
    const ad = Math.max(routed(a, d), routed(d, a));
    const bc = Math.max(routed(b, c), routed(c, b));
    if (ad || bc) return ad >= bc;
  }
  return ((x + z) & 1) !== 0;
}

/** Barycentric coordinates in the very triangles drawn by TerrainSurface. */
export function terrainTriangleAt(field: TerrainField, x: number, z: number): {
  indices: [number, number, number]; weights: [number, number, number];
} {
  const fx = Math.max(0, Math.min(field.resolution - 1, (x - field.originX) / field.step));
  const fz = Math.max(0, Math.min(field.resolution - 1, (z - field.originZ) / field.step));
  const ix = Math.min(field.resolution - 2, Math.floor(fx));
  const iz = Math.min(field.resolution - 2, Math.floor(fz));
  const u = fx - ix, v = fz - iz;
  const a = iz * field.resolution + ix, b = a + 1, c = a + field.resolution, d = c + 1;
  if (!terrainDiagonalAD(field, ix, iz)) return u + v <= 1
    ? { indices: [a, b, c], weights: [1 - u - v, u, v] }
    : { indices: [d, c, b], weights: [u + v - 1, 1 - u, 1 - v] };
  return v >= u ? { indices: [a, c, d], weights: [1 - v, v - u, u] }
    : { indices: [a, b, d], weights: [1 - u, u - v, v] };
}
