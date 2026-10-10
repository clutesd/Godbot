/**
 * OcclusionField.ts
 *
 * Baked ambient occlusion for a composed structure.
 *
 * The composer already emits real carpentry — rafter tails under an overhang, posts standing
 * against plaster, laid courses, a recessed window reveal, a plinth meeting the ground. None of
 * that detail is *lit* as carpentry: a settlement is shaded by one sun plus a bright hemisphere,
 * and the hemisphere term is the same wherever a surface faces, so every crevice the geometry
 * describes gets filled back in with ambient light and the structure flattens out. Shadow maps
 * cannot help at this scale — the features are centimetres across.
 *
 * So occlusion is measured once, at composition time, from the geometry itself:
 *
 *   1. every piece the builders recorded is rasterised into a coarse solidity grid, by the
 *      fraction of each cell it actually fills, so a plank counts for a plank and a wall for
 *      a wall;
 *   2. each vertex marches a short cosine-weighted fan of rays through that grid and keeps how
 *      much of its own hemisphere is blocked;
 *   3. the result rides in the spare channel of `aSurfaceDetail`, where the shared surface shader
 *      multiplies it into indirect light (see SurfaceDetail.ts).
 *
 * The whole measurement happens in the canonical building frame, on geometry that is cached per
 * asset, so it costs nothing per frame and nothing per instance: no extra draw calls, no extra
 * materials, no texture, and one byte per vertex.
 *
 * It is deliberately an approximation, and the approximations are worth knowing:
 *
 *   - pieces are axis-aligned bounds, so a diagonal brace occludes as the slab around it rather
 *     than as a stick;
 *   - anything thinner than a cell is thickened to one, so that a lofted roof shell still shades
 *     the wall beneath it;
 *   - rays start clear of their own surface (see `ORIGIN_BIAS_CELLS`), which means two surfaces
 *     *facing each other* closer than that bias do not shade one another — stacked roof courses,
 *     a board immediately under a shelf. The architectural cues that carry the look are all
 *     perpendicular relationships — a reveal, an inside corner, an eave over a wall, a wall
 *     meeting the ground — and those are measured at full strength.
 */

import type { Vec3 } from './GeometryBuilder';

/** An occluding piece: the axis-aligned bounds a builder recorded for one assembled part. */
export interface OccluderBox {
  min: Vec3;
  max: Vec3;
}

/** Cells across the structure's own span. Fine enough to resolve a plank, coarse enough to blur. */
const CELLS_PER_SPAN = 44;
/**
 * Hard cap on the grid. A watermill's composition is a sprawling site — pond, dam, races, yard —
 * around a small mill house, and at plank resolution that site would be a very large volume. Such
 * compositions coarsen instead; their occlusion is read at a distance anyway.
 */
const MAX_CELLS = 220_000;
/** How far occlusion is gathered, as a share of the span: about a metre at six metres per unit. */
const REACH_SPAN_SHARE = 0.14;
/**
 * …but never shorter than this many cells, however coarse the grid had to become. See `build`.
 *
 * Deliberately just under `CELLS_PER_SPAN * REACH_SPAN_SHARE`, so it never changes the reach of a
 * structure whose grid fitted the cap — it only rescues one whose grid had to be coarsened.
 */
const MIN_REACH_CELLS = 6;
/**
 * Rays start this many cells off the surface.
 *
 * This is the one number that decides whether a building looks shaded or looks sooty. `spread`
 * smears every member a cell beyond its own surface, so a ray that starts on that surface begins
 * inside its own member's halo and the member shadows itself — and a building is mostly thin
 * members, so nearly every vertex would come out dark. The bias has to clear the halo: the
 * member's own cell, plus the cell the smear reaches into, plus a little.
 */
const ORIGIN_BIAS_CELLS = 2.2;
/** Sample distances along each ray, as shares of the reach, with near hits weighted hardest. */
const DISTANCES = [0.3, 0.6, 1] as const;
const DISTANCE_WEIGHTS = [1, 0.6, 0.34] as const;
/**
 * The hemisphere, as thirteen rays: straight out along the normal, then rings of four and eight.
 *
 * The count is what decides whether an inside corner reads as a corner. A sparser fan measures
 * the same geometry correctly but in visible steps — a right angle either catches a ray or does
 * not — so the shading comes out quantised rather than smooth.
 */
const RING_TILTS = [0.6, 1.1] as const;
const RING_COUNTS = [4, 8] as const;

/**
 * The fan flattened into taps, as (tangent, bitangent, normal, weight) per sample.
 *
 * One flat array rather than nested loops over direction and distance: this is the innermost
 * loop of the whole bake, run once per vertex of every structure in the world.
 */
const FAN_TAPS: Float64Array = (() => {
  const directions: Array<[number, number, number]> = [[0, 0, 1]];
  for (let ring = 0; ring < RING_TILTS.length; ring += 1) {
    const tilt = RING_TILTS[ring]!;
    const count = RING_COUNTS[ring]!;
    const sin = Math.sin(tilt);
    const cos = Math.cos(tilt);
    for (let step = 0; step < count; step += 1) {
      const angle = (step / count) * Math.PI * 2;
      directions.push([Math.cos(angle) * sin, Math.sin(angle) * sin, cos]);
    }
  }
  const flat: Array<[number, number, number, number]> = [];
  for (const [t, b, n] of directions) {
    for (let step = 0; step < DISTANCES.length; step += 1) {
      const distance = DISTANCES[step]!;
      // Cosine-weighted, as ambient occlusion is defined, and attenuated with distance so a
      // neighbouring post matters more than the far side of the yard.
      flat.push([t * distance, b * distance, n * distance, n * DISTANCE_WEIGHTS[step]!]);
    }
  }
  // Heaviest taps first, so a vertex that is simply buried — and most of a structure's triangles
  // are, where one member meets the next — saturates and stops early.
  flat.sort((a, b) => b[3] - a[3]);
  const taps = new Float64Array(flat.length * 4);
  for (let index = 0; index < flat.length; index += 1) taps.set(flat[index]!, index * 4);
  return taps;
})();

/**
 * What the measured share of a hemisphere is worth as a shading term.
 *
 * Cosine-weighted occlusion is a share of a hemisphere, and real architecture occupies a narrow
 * band of it: an exposed wall face measures zero, the inside of a right-angle junction about a
 * sixth, the slot between two closely set members and the line where a wall meets the ground
 * about three tenths. Spending that raw share directly would be a measurement nobody can see, so
 * the usable band is stretched across the channel — the usual bargain of a baked occlusion map.
 *
 * There is deliberately no floor subtracted first. A flat face measures exactly nothing, because
 * the rays leave from clear of their own surface, so there is no residue to discard and a distant
 * occluder's small contribution survives instead of being clipped away.
 */
const OCCLUSION_GAIN = 3;

const TOTAL_WEIGHT = (() => {
  let sum = 0;
  for (let at = 3; at < FAN_TAPS.length; at += 4) sum += FAN_TAPS[at]!;
  return sum;
})();

/** Accumulated weight past which the mapped result is already 1, so the remaining taps cannot matter. */
const SATURATION_WEIGHT = (TOTAL_WEIGHT * 255) / OCCLUSION_GAIN;

export class OcclusionField {
  private constructor(
    /** Fraction of each cell filled by structure, quantised to a byte. */
    private readonly solidity: Uint8Array,
    private readonly countX: number,
    private readonly countY: number,
    private readonly countZ: number,
    private readonly originX: number,
    private readonly originY: number,
    private readonly originZ: number,
    private readonly cell: number,
    /** Gather radius, in the structure's own units. */
    readonly reach: number,
  ) {
    this.inverseCell = 1 / cell;
  }

  /** Hoisted out of the sampling loop; see `occlusionAt`. */
  private readonly inverseCell: number;

  /**
   * Rasterise a structure's recorded pieces into a solidity grid.
   *
   * Returns undefined when there is nothing to measure, so a caller can skip the bake entirely
   * rather than branch on an empty field.
   */
  static build(boxes: readonly OccluderBox[], span: number): OcclusionField | undefined {
    if (boxes.length === 0) return undefined;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const box of boxes) {
      if (box.min.x < minX) minX = box.min.x;
      if (box.min.y < minY) minY = box.min.y;
      if (box.min.z < minZ) minZ = box.min.z;
      if (box.max.x > maxX) maxX = box.max.x;
      if (box.max.y > maxY) maxY = box.max.y;
      if (box.max.z > maxZ) maxZ = box.max.z;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return undefined;

    let cell = Math.max(1e-5, span / CELLS_PER_SPAN);
    let reach = 0, pad = 0;
    let countX = 0, countY = 0, countZ = 0;
    // Coarsen until the volume fits the cap. Two rounds converge: the first scales by the exact
    // cube root of the overshoot, the second absorbs the rounding the cell counts introduce.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // The reach has to stay several cells long whatever the cell turns out to be. A coarsened
      // grid is the case that matters: the rays start a fixed number of cells off the surface, so
      // on a coarse grid a reach fixed to the span alone would be shorter than its own bias and
      // every tap would land beyond the gather radius, measuring nothing at all.
      reach = Math.max(1e-4, span * REACH_SPAN_SHARE, cell * MIN_REACH_CELLS);
      // The grid has to hold the rays as well as the geometry, or occlusion would stop at the
      // bounding box and every outward-facing wall would darken along its own edge.
      pad = (reach + cell * ORIGIN_BIAS_CELLS) * 1.1;
      countX = Math.max(1, Math.ceil((maxX - minX + pad * 2) / cell));
      countY = Math.max(1, Math.ceil((maxY - minY + pad * 2) / cell));
      countZ = Math.max(1, Math.ceil((maxZ - minZ + pad * 2) / cell));
      const cells = countX * countY * countZ;
      if (cells <= MAX_CELLS) break;
      cell *= Math.cbrt(cells / MAX_CELLS) * 1.02;
    }

    const field = new OcclusionField(
      new Uint8Array(countX * countY * countZ),
      countX, countY, countZ,
      minX - pad, minY - pad, minZ - pad,
      cell,
      reach,
    );
    for (const box of boxes) field.rasterise(box);
    field.spread();
    return field;
  }

  /**
   * Smear the grid by one cell in each axis.
   *
   * Thirty-nine taps per vertex is a coarse way to integrate a hemisphere, and a sharp grid
   * punishes it: a rafter or a laid course is thinner than the gap between sample distances, so
   * rays pass straight through the slab between one tap and the next and the member casts nothing.
   * Smearing each piece across its neighbouring cells costs one pass over the volume — not one per
   * vertex — and gives every thin member a soft presence that the taps cannot miss. It also settles
   * the shading between adjacent vertices, which otherwise alternates with whichever cell each one
   * happened to land in.
   */
  private spread(): void {
    const { solidity, countX, countY, countZ } = this;
    const scratch = new Uint8Array(solidity.length);
    const blur = (source: Uint8Array, target: Uint8Array, stride: number, count: number): void => {
      for (let index = 0; index < source.length; index += 1) {
        // Which position this cell occupies along the blurred axis, so the ends do not wrap.
        const step = Math.floor(index / stride) % count;
        const low = step > 0 ? source[index - stride]! : source[index]!;
        const high = step < count - 1 ? source[index + stride]! : source[index]!;
        target[index] = (low + source[index]! * 2 + high) * 0.25;
      }
    };
    blur(solidity, scratch, 1, countX);
    blur(scratch, solidity, countX, countZ);
    blur(solidity, scratch, countX * countZ, countY);
    solidity.set(scratch);
  }

  /**
   * Add one piece's share of every cell it touches.
   *
   * Coverage is the overlap *volume*, so a thin board contributes less than a massive wall of the
   * same footprint and occludes accordingly. Pieces thinner than a cell on some axis — a lofted
   * roof panel, a single laid course, a flat triangle of paving — are thickened to one cell on
   * that axis: a surface with no volume would otherwise cast no occlusion at all, and the eaves
   * are exactly where occlusion matters most.
   */
  private rasterise(box: OccluderBox): void {
    const floor = this.cell * 0.9;
    const spread = (low: number, high: number): readonly [number, number] => {
      if (high - low >= floor) return [low, high];
      const middle = (low + high) * 0.5;
      return [middle - floor * 0.5, middle + floor * 0.5];
    };
    const [lowX, highX] = spread(box.min.x, box.max.x);
    const [lowY, highY] = spread(box.min.y, box.max.y);
    const [lowZ, highZ] = spread(box.min.z, box.max.z);

    const firstX = this.cellIndex(lowX, this.originX, this.countX);
    const lastX = this.cellIndex(highX, this.originX, this.countX);
    const firstY = this.cellIndex(lowY, this.originY, this.countY);
    const lastY = this.cellIndex(highY, this.originY, this.countY);
    const firstZ = this.cellIndex(lowZ, this.originZ, this.countZ);
    const lastZ = this.cellIndex(highZ, this.originZ, this.countZ);
    if (firstX > lastX || firstY > lastY || firstZ > lastZ) return;

    const cellVolume = this.cell * this.cell * this.cell;
    for (let ix = firstX; ix <= lastX; ix += 1) {
      const overlapX = this.overlap(ix, this.originX, lowX, highX);
      if (overlapX <= 0) continue;
      for (let iy = firstY; iy <= lastY; iy += 1) {
        const overlapY = this.overlap(iy, this.originY, lowY, highY);
        if (overlapY <= 0) continue;
        const rowBase = (iy * this.countZ) * this.countX + ix;
        for (let iz = firstZ; iz <= lastZ; iz += 1) {
          const overlapZ = this.overlap(iz, this.originZ, lowZ, highZ);
          if (overlapZ <= 0) continue;
          const index = rowBase + iz * this.countX;
          const added = ((overlapX * overlapY * overlapZ) / cellVolume) * 255;
          const value = this.solidity[index]! + added;
          this.solidity[index] = value > 255 ? 255 : value;
        }
      }
    }
  }

  private cellIndex(value: number, origin: number, count: number): number {
    const index = Math.floor((value - origin) / this.cell);
    return index < 0 ? 0 : index >= count ? count - 1 : index;
  }

  private overlap(index: number, origin: number, low: number, high: number): number {
    const cellLow = origin + index * this.cell;
    const cellHigh = cellLow + this.cell;
    return Math.min(cellHigh, high) - Math.max(cellLow, low);
  }

  /**
   * How solid the structure is at one point: 0 in open air, 1 inside built fabric.
   *
   * Everything below the plot's ground plane counts as solid. The terrain is somebody else's
   * geometry, but a wall, a post and a plinth all meet it, and the dark line where they do is
   * most of what makes a structure sit on the ground rather than hover above it.
   */
  solidityAt(x: number, y: number, z: number): number {
    if (y < 0) return 1;
    const ix = Math.floor((x - this.originX) / this.cell);
    if (ix < 0 || ix >= this.countX) return 0;
    const iy = Math.floor((y - this.originY) / this.cell);
    if (iy < 0 || iy >= this.countY) return 0;
    const iz = Math.floor((z - this.originZ) / this.cell);
    if (iz < 0 || iz >= this.countZ) return 0;
    return this.solidity[(iy * this.countZ + iz) * this.countX + ix]! / 255;
  }

  /**
   * The share of a surface point's hemisphere that its own structure blocks: 0 for a wall facing
   * open sky, rising toward 1 deep inside a reveal, a bay or the junction of two walls.
   */
  occlusionAt(
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
  ): number {
    // An arbitrary tangent frame is enough: the fan is symmetric about the normal, so only the
    // normal direction has to be right. Cross with whichever axis the normal is furthest from.
    const vertical = Math.abs(ny) > 0.9;
    let tx = vertical ? ny : -nz;
    let ty = vertical ? -nx : 0;
    let tz = vertical ? 0 : nx;
    const tangentLength = Math.hypot(tx, ty, tz) || 1;
    tx /= tangentLength; ty /= tangentLength; tz /= tangentLength;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;

    const originX = px + nx * this.cell * ORIGIN_BIAS_CELLS;
    const originY = py + ny * this.cell * ORIGIN_BIAS_CELLS;
    const originZ = pz + nz * this.cell * ORIGIN_BIAS_CELLS;

    // The sampling below is deliberately written out rather than delegated to `solidityAt`: it is
    // the bake's innermost loop, thirty-nine taps for every vertex of every structure in the world.
    const { solidity, countX, countY, countZ, inverseCell, originX: gridX, originY: gridY, originZ: gridZ } = this;
    const taps = FAN_TAPS;
    const reach = this.reach;
    let blocked = 0;
    for (let at = 0; at < taps.length; at += 4) {
      const localT = taps[at]! * reach;
      const localB = taps[at + 1]! * reach;
      const localN = taps[at + 2]! * reach;
      const y = originY + ty * localT + by * localB + ny * localN;
      const weight = taps[at + 3]!;
      // Below the plot's ground plane. See `solidityAt`.
      if (y < 0) { blocked += weight * 255; continue; }
      const iy = Math.floor((y - gridY) * inverseCell);
      if (iy < 0 || iy >= countY) continue;
      const x = originX + tx * localT + bx * localB + nx * localN;
      const ix = Math.floor((x - gridX) * inverseCell);
      if (ix < 0 || ix >= countX) continue;
      const z = originZ + tz * localT + bz * localB + nz * localN;
      const iz = Math.floor((z - gridZ) * inverseCell);
      if (iz < 0 || iz >= countZ) continue;
      blocked += weight * solidity[(iy * countZ + iz) * countX + ix]!;
      if (blocked >= SATURATION_WEIGHT) return 1;
    }
    // `solidity` is a byte, so the accumulated weight is 255 times too large.
    const measured = blocked / (TOTAL_WEIGHT * 255);
    const occlusion = measured * OCCLUSION_GAIN;
    return occlusion <= 0 ? 0 : occlusion >= 1 ? 1 : occlusion;
  }

  /** Diagnostic: the grid this field measured on. */
  get stats(): { cells: number; cell: number; reach: number } {
    return { cells: this.countX * this.countY * this.countZ, cell: this.cell, reach: this.reach };
  }
}
