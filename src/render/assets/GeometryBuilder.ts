/**
 * GeometryBuilder.ts
 *
 * Accumulates flat-shaded triangles into a single BufferGeometry.
 * Buildings are assembled from many small architectural modules; merging them per
 * material keeps draw calls low while allowing dense detail.
 */

import * as THREE from 'three';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Index ranges of actual architectural pieces, retained after material batching. */
export interface AssemblyPiece {
  start: number;
  count: number;
  min: Vec3;
  max: Vec3;
  stage: number;
}

type LocalMap = (x: number, y: number, z: number) => Vec3;

// Buildable sizes, as shares of the building's span. Source buildings are authored at roughly one
// unit across and are fitted to their plot later, so absolute lengths would be building-sized at
// one scale and pebble-sized at another; a share of the span keeps the cut proportionate.

/** Longest run a crew cuts and seats as one member (about a bay). */
const SECTION_SPAN = 0.35;
/** One laid course on a roof or skin: tile, shingle, thatch or board. Matches ConstructionAssembly's course rhythm. */
const COURSE_SPAN = 0.12;
/** Caps the cut count per member so a degenerate input cannot explode the mesh. */
const MAX_SECTIONS = 12;
/** Caps how finely one hand-placed face is divided into sub-triangles. */
const MAX_FACE_DIVISIONS = 4;

function sectionCount(length: number, maxSection: number, cap = MAX_SECTIONS): number {
  return Math.min(cap, Math.max(1, Math.ceil(length / maxSection - 1e-9)));
}

/** Boundary `i` of `n` equal divisions of an interval; the ends are exact so unsplit primitives keep their numbers. */
function cut(from: number, to: number, i: number, n: number): number {
  return i <= 0 ? from : i >= n ? to : from + ((to - from) * i) / n;
}

function lerpPoint(a: Vec3, b: Vec3, t: number): Vec3 {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** 0 = x, 1 = y, 2 = z. */
function dominantAxis(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ay >= ax && ay >= az) return 1;
  return az > ax ? 2 : 0;
}

export class GeometryBuilder {
  private readonly pieces: AssemblyPiece[] = [];
  private recordingBox = false;
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly indices: number[] = [];
  /** (weathering, tone jitter, grain axis, unused) per vertex as normalized bytes; only materialised once something asks for it. */
  private readonly details: number[] = [];
  private detailUsed = false;
  private wear = 0;
  private tone = 0;
  private grain = 0;
  private originX = 0;
  private originY = 0;
  private originZ = 0;
  private sectionLength = 1;
  private courseHeight = 0.3;

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  /**
   * Age and use for everything emitted from now on. `wear` darkens, dulls and desaturates in the
   * shared surface shader; `tone` is a small deterministic lightness offset per building.
   * The macro architecture is untouched — this only drives shading.
   */
  /**
   * Translate everything emitted from now on.
   *
   * Every method eventually writes through `addTriangle`, so the offset lands on vertex
   * positions *and* on the recorded assembly-piece bounds. That matters: the construction
   * animation reads those bounds as geometry-local coordinates, so a structure composed away
   * from the origin has to carry the offset in its geometry rather than in a parent transform.
   */
  setOrigin(x: number, y: number, z: number): void {
    this.originX = x;
    this.originY = y;
    this.originZ = z;
  }

  /**
   * Sizes the cuts for a building whose span is `span` units across. Only changes how the
   * finished surface is divided into pieces; the surface itself is the same.
   */
  setSectioning(span: number): void {
    this.sectionLength = span * SECTION_SPAN;
    this.courseHeight = span * COURSE_SPAN;
  }

  setWeathering(wear: number, tone = 0): void {
    this.wear = Math.round(Math.max(0, Math.min(1, wear)) * 127);
    this.tone = Math.round(Math.max(-1, Math.min(1, tone)) * 127);
    if (this.wear !== 0 || this.tone !== 0) this.ensureDetail();
  }

  private ensureDetail(): void {
    if (this.detailUsed) return;
    this.detailUsed = true;
    const vertices = this.positions.length / 3;
    for (let index = 0; index < vertices * 4; index += 1) this.details.push(0);
  }

  addTriangle(a: Vec3, b: Vec3, c: Vec3): void {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length < 1e-9) return; // Degenerate slivers appear where lofted rings collapse to a ridge.
    nx /= length;
    ny /= length;
    nz /= length;
    const base = this.positions.length / 3;
    const ox = this.originX, oy = this.originY, oz = this.originZ;
    this.positions.push(
      a.x + ox, a.y + oy, a.z + oz,
      b.x + ox, b.y + oy, b.z + oz,
      c.x + ox, c.y + oy, c.z + oz,
    );
    this.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.indices.push(base, base + 1, base + 2);
    if (this.detailUsed) {
      for (let index = 0; index < 3; index += 1) this.details.push(this.wear, this.tone, this.grain, 0);
    }
  }

  addQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
    const order = this.recordingBox ? 1 : Math.max(this.faceOrder(a, b, c), this.faceOrder(a, c, d));
    this.emitQuad(a, b, c, d, order);
  }

  /**
   * Two triangles (a, b, c) and (a, c, d). At order 1 the quad is one piece, exactly as before.
   * Above 1 each triangle becomes a grid of sub-triangles, one piece each.
   */
  private emitQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, order: number): void {
    if (order <= 1) {
      const start = this.indices.length;
      this.addTriangle(a, b, c);
      this.addTriangle(a, c, d);
      if (!this.recordingBox) this.recordPiece(start);
      return;
    }
    this.addFaceGrid(a, b, c, order);
    this.addFaceGrid(a, c, d, order);
  }

  /**
   * How finely a flat face is divided: bays along its longest edge, courses across it.
   * A single face therefore never spans a building-sized run of roof or wall.
   */
  private faceOrder(a: Vec3, b: Vec3, c: Vec3): number {
    const longest = Math.max(distance(a, b), distance(b, c), distance(c, a));
    if (longest <= 0) return 1;
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    // |u × v| is twice the area, so dividing by the longest edge gives the altitude onto it.
    const altitude = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / longest;
    return Math.max(
      sectionCount(longest, this.sectionLength, MAX_FACE_DIVISIONS),
      sectionCount(altitude, this.courseHeight, MAX_FACE_DIVISIONS),
    );
  }

  /** Divides triangle (a, b, c) into an order-`order` grid. Every new point lies on the original triangle. */
  private addFaceGrid(a: Vec3, b: Vec3, c: Vec3, order: number): void {
    const point = (i: number, j: number): Vec3 => {
      if (i === 0 && j === 0) return a;
      if (i === order && j === 0) return b;
      if (i === 0 && j === order) return c;
      const s = i / order, t = j / order;
      return {
        x: a.x + (b.x - a.x) * s + (c.x - a.x) * t,
        y: a.y + (b.y - a.y) * s + (c.y - a.y) * t,
        z: a.z + (b.z - a.z) * s + (c.z - a.z) * t,
      };
    };
    for (let j = 0; j < order; j += 1) {
      for (let i = 0; i < order - j; i += 1) {
        this.addPieceTriangle(point(i, j), point(i + 1, j), point(i, j + 1));
        if (i + j <= order - 2) this.addPieceTriangle(point(i + 1, j), point(i + 1, j + 1), point(i, j + 1));
      }
    }
  }

  private addPieceTriangle(a: Vec3, b: Vec3, c: Vec3): void {
    const start = this.indices.length;
    this.addTriangle(a, b, c);
    if (!this.recordingBox) this.recordPiece(start);
  }

  /** Axis-aligned box optionally spun about Y. */
  addBox(
    centerX: number,
    centerY: number,
    centerZ: number,
    sizeX: number,
    sizeY: number,
    sizeZ: number,
    rotationY = 0,
  ): void {
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    this.setGrainAxis(dominantAxis(sizeX, sizeY, sizeZ), Math.abs(sin) > Math.abs(cos));
    const map: LocalMap = (x, y, z) => ({
      x: centerX + x * cos + z * sin,
      y: centerY + y,
      z: centerZ - x * sin + z * cos,
    });
    this.emitBox(map, sizeX / 2, sizeY / 2, -sizeZ / 2, sizeZ / 2);
    this.grain = 0;
  }

  /** Box swept between two points — rafters, braces, trusses, railings. */
  addBeam(from: Vec3, to: Vec3, width: number, thickness: number): void {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-6) return;
    dx /= length;
    dy /= length;
    dz /= length;
    this.setGrainAxis(dominantAxis(dx, dy, dz), false);
    const nearVertical = Math.abs(dy) > 0.94;
    const upY = nearVertical ? 0 : 1;
    const upZ = nearVertical ? 1 : 0;
    let rx = dy * upZ - dz * upY;
    let ry = -dx * upZ;
    let rz = dx * upY;
    const rightLength = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    rx /= rightLength;
    ry /= rightLength;
    rz /= rightLength;
    const ux = dy * rz - dz * ry;
    const uy = dz * rx - dx * rz;
    const uz = dx * ry - dy * rx;
    const map: LocalMap = (x, y, z) => ({
      x: from.x + rx * x + ux * y + dx * z,
      y: from.y + ry * x + uy * y + dy * z,
      z: from.z + rz * x + uz * y + dz * z,
    });
    this.emitBox(map, width / 2, thickness / 2, 0, length);
    this.grain = 0;
  }

  /**
   * Loft a closed strip between two rings of equal length.
   * A loft taller than one course is laid in horizontal courses; every quad uses the same course
   * count so neighbouring quads meet on identical points.
   */
  addLoft(lower: Vec3[], upper: Vec3[]): void {
    const count = Math.min(lower.length, upper.length);
    let courses = 1;
    for (let index = 0; index < count; index += 1) {
      const l = lower[index];
      const u = upper[index];
      if (l && u) courses = Math.max(courses, sectionCount(distance(l, u), this.courseHeight));
    }
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      const l0 = lower[index];
      const l1 = lower[next];
      const u0 = upper[index];
      const u1 = upper[next];
      if (!l0 || !l1 || !u0 || !u1) continue;
      if (courses === 1) {
        // Ring-to-ring quads stay whole here: subdividing a shared ring edge would put T-junctions in
        // the next loft up, so only the course strips below cut lofts.
        this.emitQuad(l0, u0, u1, l1, 1);
        continue;
      }
      // The quad is the triangles (l0, u0, u1) and (l0, u1, l1), cut into bands that never leave them.
      for (let course = 0; course < courses; course += 1) {
        const start = this.indices.length;
        this.addStrip(l0, u0, u1, courses, course);
        this.addStrip(u1, l1, l0, courses, course);
        this.recordPiece(start);
      }
    }
  }

  /** Cap a ring with an upward-facing fan (roof apex). */
  addFanUp(apex: Vec3, ring: Vec3[]): void {
    const bands = this.fanBands(apex, ring);
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (!a || !b) continue;
      // Wedge (a, apex, b) is the same triangle as (apex, b, a): cut it into bands from the apex out.
      for (let band = 0; band < bands; band += 1) {
        const start = this.indices.length;
        this.addStrip(apex, b, a, bands, band);
        this.recordPiece(start);
      }
    }
  }

  /** Cap a ring with a downward-facing fan (eave soffit). */
  addFanDown(center: Vec3, ring: Vec3[]): void {
    const bands = this.fanBands(center, ring);
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (!a || !b) continue;
      for (let band = 0; band < bands; band += 1) {
        const start = this.indices.length;
        this.addStrip(center, a, b, bands, band);
        this.recordPiece(start);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    if (this.detailUsed) {
      geometry.setAttribute('aSurfaceDetail', new THREE.Int8BufferAttribute(this.details, 4, true));
    }
    geometry.setIndex(this.indices);
    geometry.userData['assemblyPieces'] = this.pieces;
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Timber and sheet materials run their grain along the element's long axis. */
  private setGrainAxis(axis: number, swapHorizontal: boolean): void {
    const resolved = swapHorizontal && axis !== 1 ? 2 - axis : axis;
    this.grain = resolved === 0 ? 0 : resolved === 1 ? 63 : 127;
    if (this.grain !== 0) this.ensureDetail();
  }

  /**
   * Emits a box as a grid of closed sections, one per buildable length on each axis it exceeds.
   * Each section keeps its own faces, so a partly built member shows cut ends, and the joined
   * member has the same outer surface and enclosed volume as one solid box.
   */
  private emitBox(map: LocalMap, halfX: number, halfY: number, zMin: number, zMax: number): void {
    const nx = sectionCount(halfX * 2, this.sectionLength);
    const ny = sectionCount(halfY * 2, this.sectionLength);
    const nz = sectionCount(zMax - zMin, this.sectionLength);
    for (let i = 0; i < nx; i += 1) {
      const x0 = cut(-halfX, halfX, i, nx), x1 = cut(-halfX, halfX, i + 1, nx);
      for (let j = 0; j < ny; j += 1) {
        const y0 = cut(-halfY, halfY, j, ny), y1 = cut(-halfY, halfY, j + 1, ny);
        for (let k = 0; k < nz; k += 1) {
          this.emitSection(map, x0, x1, y0, y1, cut(zMin, zMax, k, nz), cut(zMin, zMax, k + 1, nz));
        }
      }
    }
  }

  /** Bands from a fan's centre to its rim, each one course deep. */
  private fanBands(centre: Vec3, ring: Vec3[]): number {
    let longest = 0;
    for (const point of ring) longest = Math.max(longest, distance(centre, point));
    return sectionCount(longest, this.courseHeight);
  }

  private emitSection(map: LocalMap, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    const start = this.indices.length;
    this.recordingBox = true;
    const a = map(x0, y0, z0);
    const b = map(x1, y0, z0);
    const c = map(x1, y0, z1);
    const d = map(x0, y0, z1);
    const e = map(x0, y1, z0);
    const f = map(x1, y1, z0);
    const g = map(x1, y1, z1);
    const h = map(x0, y1, z1);
    this.addQuad(a, b, c, d); // bottom
    this.addQuad(h, g, f, e); // top
    this.addQuad(d, c, g, h); // +z
    this.addQuad(b, a, e, f); // -z
    this.addQuad(c, b, f, g); // +x
    this.addQuad(a, d, h, e); // -x
    this.recordingBox = false;
    this.recordPiece(start);
  }

  /**
   * Band `index` of `count` across the triangle (apex, p, q), emitted as two triangles.
   * Every point is a lerp along an original edge, so the bands tile the original triangle exactly.
   */
  private addStrip(apex: Vec3, p: Vec3, q: Vec3, count: number, index: number): void {
    const p0 = lerpPoint(apex, p, index / count);
    const p1 = lerpPoint(apex, p, (index + 1) / count);
    const q0 = lerpPoint(apex, q, index / count);
    const q1 = lerpPoint(apex, q, (index + 1) / count);
    this.addTriangle(p0, p1, q1);
    this.addTriangle(p0, q1, q0);
  }

  private recordPiece(start: number): void {
    if (this.indices.length === start) return;
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = start; i < this.indices.length; i++) {
      const v = this.indices[i]! * 3;
      min.x = Math.min(min.x, this.positions[v]!); max.x = Math.max(max.x, this.positions[v]!);
      min.y = Math.min(min.y, this.positions[v + 1]!); max.y = Math.max(max.y, this.positions[v + 1]!);
      min.z = Math.min(min.z, this.positions[v + 2]!); max.z = Math.max(max.z, this.positions[v + 2]!);
    }
    this.pieces.push({ start, count: this.indices.length - start, min, max, stage: 0 });
  }
}

/**
 * Points around a rounded-corner rectangle, ordered by increasing angle so that
 * GeometryBuilder.addLoft produces outward-facing normals.
 * `cornerWeight` is 1 exactly at a corner and 0 at the middle of a side, which drives
 * the upturned eaves that define the roof silhouette.
 */
export interface RingPoint extends Vec3 {
  cornerWeight: number;
}

export function squareRing(
  halfX: number,
  halfZ: number,
  y: number,
  segmentsPerSide: number,
): RingPoint[] {
  const corners: Array<[number, number]> = [
    [halfX, halfZ],
    [-halfX, halfZ],
    [-halfX, -halfZ],
    [halfX, -halfZ],
  ];
  const points: RingPoint[] = [];
  for (let side = 0; side < 4; side += 1) {
    const from = corners[side]!;
    const to = corners[(side + 1) % 4]!;
    for (let step = 0; step < segmentsPerSide; step += 1) {
      const t = step / segmentsPerSide;
      points.push({
        x: from[0] + (to[0] - from[0]) * t,
        y,
        z: from[1] + (to[1] - from[1]) * t,
        cornerWeight: 1 - Math.min(t, 1 - t) * 2,
      });
    }
  }
  return points;
}
