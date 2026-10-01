import type { WorldState } from '../../sim/types';
import { elevationToY, surfaceHeightAt } from '../../sim/terrain/SurfaceGeometry';
import { terrainDiagonalAD, terrainTriangleAt } from '../../sim/terrain/TerrainTopology';

/** Numerical clearance only; stage/depth reconstruction never supplies minimum river depth. */
export const WATER_CLEARANCE = 0.00025;
export interface WaterVertex { x: number; y: number; z: number; depth: number; source: number }
export type WaterFace = [WaterVertex, WaterVertex, WaterVertex];

/** Piecewise linear finite-element reconstruction. Stage and bed use the SAME basis, so depth
 * inside a triangle is a convex combination of its signed nodal depths. It cannot manufacture
 * a spike or a deep shelf between samples. Dry nodes are boundary conditions, never new water. */
export class WaterReconstruction {
  readonly bed: Float64Array;
  readonly stage: Float64Array;
  readonly source: Int32Array;
  readonly wet: Uint8Array;
  constructor(readonly world: WorldState) {
    const t = world.terrain, n = t.height.length;
    this.bed = new Float64Array(n);
    this.stage = new Float64Array(n);
    this.source = new Int32Array(n).fill(-1);
    this.wet = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = t.originX + i % t.resolution * t.step, z = t.originZ + Math.floor(i / t.resolution) * t.step;
      this.bed[i] = Math.fround(surfaceHeightAt(world, x, z));
      if (Number.isFinite(t.waterLevel[i]) && t.waterLevel[i]! >= 0) {
        this.stage[i] = elevationToY(t.waterLevel[i]!, world.seaLevel) + WATER_CLEARANCE;
        this.source[i] = i;
        this.wet[i] = 1;
      }
    }
    for (let i = 0; i < n; i++) {
      if (this.wet[i]) continue;
      const x = i % t.resolution, z = Math.floor(i / t.resolution);
      let nearest = -1, distance = Infinity, ocean = -1;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= t.resolution || nz >= t.resolution) continue;
        const j = nz * t.resolution + nx;
        if (!this.wet[j]) continue;
        if (t.waterLevel[j]! <= world.seaLevel + 1e-7) ocean = j;
        // Prefer the lower stage at a tie: a high tributary must not flood an unrelated bank.
        const d = dx * dx + dz * dz;
        if (d < distance || (d === distance && this.stage[j]! < this.stage[nearest]!)) { nearest = j; distance = d; }
      }
      this.source[i] = nearest;
      let boundaryStage = nearest < 0 ? this.bed[i]! : this.stage[nearest]!;
      // A bank beside a bend inherits the stage at its projection onto the routed reach.
      // Nearest endpoint selection switches abruptly between upstream and downstream and
      // creates a transverse cliff on the outside of a D8 bend.
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= t.resolution || nz >= t.resolution) continue;
        const j = nz * t.resolution + nx, k = t.drainage?.downstream[j] ?? -1;
        if (!this.wet[j] || !t.river[j] || k < 0 || !this.wet[k]) continue;
        const ex = k % t.resolution - nx, ez = Math.floor(k / t.resolution) - nz;
        const length2 = ex * ex + ez * ez;
        if (!length2 || length2 > 2) continue;
        const f = Math.max(0, Math.min(1, (-dx * ex - dz * ez) / length2));
        const d = (dx + ex * f) ** 2 + (dz + ez * f) ** 2;
        const stage = this.stage[j]! + (this.stage[k]! - this.stage[j]!) * f;
        if (d < distance || (d === distance && stage < boundaryStage)) { boundaryStage = stage; distance = d; }
      }
      // Shoreline extrapolation can reach a submerged bank, at most one raster cell. Where a
      // dry sample lies below its wet neighbour, signed depth crosses zero before that sample;
      // carrying the neighbour's stage across it would instead create an unsupported shelf.
      const depth = nearest < 0 ? WATER_CLEARANCE : Math.max(WATER_CLEARANCE, this.stage[nearest]! - this.bed[nearest]!);
      this.stage[i] = nearest < 0 ? this.bed[i]! - depth
        : Math.min(boundaryStage, this.bed[i]! - depth);
      if (ocean >= 0) this.stage[i] = this.stage[ocean]!;
    }
  }

  sample(x: number, z: number): WaterVertex {
    const { indices, weights } = terrainTriangleAt(this.world.terrain, x, z);
    let y = 0, bed = 0, source = -1, strongest = -1;
    for (let k = 0; k < 3; k++) {
      const i = indices[k]!, w = weights[k]!;
      y += this.stage[i]! * w; bed += this.bed[i]! * w;
      if (this.wet[i] && w > strongest) { source = i; strongest = w; }
    }
    if (source < 0) source = this.source[indices[weights.indexOf(Math.max(...weights))]!]!;
    return { x, y, z, depth: y - bed, source };
  }

  /** Exact linear clipping. Intersections are ordered by coordinates before interpolation so
   * adjacent faces produce identical vertices. No bisection, endpoint snapping, or face removal. */
  private clip(face: WaterFace): WaterVertex[] {
    const out: WaterVertex[] = [];
    for (let k = 0; k < 3; k++) {
      const a = face[k]!, b = face[(k + 1) % 3]!;
      if (a.depth >= WATER_CLEARANCE) out.push(a);
      if ((a.depth >= WATER_CLEARANCE) === (b.depth >= WATER_CLEARANCE)) continue;
      const [lo, hi] = a.x < b.x || (a.x === b.x && a.z < b.z) ? [a, b] : [b, a];
      const f = (WATER_CLEARANCE - lo.depth) / (hi.depth - lo.depth);
      out.push({ x: lo.x + (hi.x - lo.x) * f, y: lo.y + (hi.y - lo.y) * f,
        z: lo.z + (hi.z - lo.z) * f, depth: WATER_CLEARANCE,
        source: lo.depth > hi.depth ? lo.source : hi.source });
    }
    return out;
  }

  forEachFace(visit: (face: WaterFace, ocean: boolean, cascade: boolean) => void): void {
    const t = this.world.terrain, n = t.resolution;
    const vertex = (i: number): WaterVertex => ({ x: t.originX + i % n * t.step,
      z: t.originZ + Math.floor(i / n) * t.step, y: this.stage[i]!,
      depth: this.stage[i]! - this.bed[i]!, source: this.source[i]! });
    for (let z = 0; z < n - 1; z++) for (let x = 0; x < n - 1; x++) {
      const a = z * n + x, b = a + 1, c = a + n, d = c + 1;
      const triangles = terrainDiagonalAD(t, x, z) ? [[a, c, d], [a, d, b]] : [[a, c, b], [b, c, d]];
      for (const ids of triangles) {
        if (!ids.some(i => this.wet[i])) continue;
        const ocean = ids.every(i => !this.wet[i] || t.waterLevel[i]! <= this.world.seaLevel + 1e-7);
        const face = ids.map(vertex) as WaterFace;
        const cascade = ids.some(i => t.river[i] && t.fall[i]! >= 0.22
          && ids.includes(t.drainage?.downstream[i] ?? -1)
          && this.stage[i]! - this.stage[t.drainage!.downstream[i]!]! > 0.12);
        const polygon = this.clip(face);
        for (let k = 1; k < polygon.length - 1; k++) {
          const tri: WaterFace = [polygon[0]!, polygon[k]!, polygon[k + 1]!];
          const [p, q, r] = tri;
          // Test in the precision actually sent to the GPU. An intersection closer than one
          // float ULP is the same point; keeping its zero-area face creates duplicate triangles.
          const area = (Math.fround(q.x) - Math.fround(p.x)) * (Math.fround(r.z) - Math.fround(p.z))
            - (Math.fround(q.z) - Math.fround(p.z)) * (Math.fround(r.x) - Math.fround(p.x));
          if (area !== 0) visit(tri, ocean, cascade);
        }
      }
    }
  }
}
