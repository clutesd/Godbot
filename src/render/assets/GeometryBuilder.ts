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

type LocalMap = (x: number, y: number, z: number) => Vec3;

export class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly indices: number[] = [];

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
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
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.indices.push(base, base + 1, base + 2);
  }

  addQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
    this.addTriangle(a, b, c);
    this.addTriangle(a, c, d);
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
    const map: LocalMap = (x, y, z) => ({
      x: centerX + x * cos + z * sin,
      y: centerY + y,
      z: centerZ - x * sin + z * cos,
    });
    this.emitBox(map, sizeX / 2, sizeY / 2, -sizeZ / 2, sizeZ / 2);
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
  }

  /** Loft a closed strip between two rings of equal length. */
  addLoft(lower: Vec3[], upper: Vec3[]): void {
    const count = Math.min(lower.length, upper.length);
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      const l0 = lower[index];
      const l1 = lower[next];
      const u0 = upper[index];
      const u1 = upper[next];
      if (!l0 || !l1 || !u0 || !u1) continue;
      this.addQuad(l0, u0, u1, l1);
    }
  }

  /** Cap a ring with an upward-facing fan (roof apex). */
  addFanUp(apex: Vec3, ring: Vec3[]): void {
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (!a || !b) continue;
      this.addTriangle(a, apex, b);
    }
  }

  /** Cap a ring with a downward-facing fan (eave soffit). */
  addFanDown(center: Vec3, ring: Vec3[]): void {
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (!a || !b) continue;
      this.addTriangle(a, b, center);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private emitBox(map: LocalMap, halfX: number, halfY: number, zMin: number, zMax: number): void {
    const a = map(-halfX, -halfY, zMin);
    const b = map(halfX, -halfY, zMin);
    const c = map(halfX, -halfY, zMax);
    const d = map(-halfX, -halfY, zMax);
    const e = map(-halfX, halfY, zMin);
    const f = map(halfX, halfY, zMin);
    const g = map(halfX, halfY, zMax);
    const h = map(-halfX, halfY, zMax);
    this.addQuad(a, b, c, d); // bottom
    this.addQuad(h, g, f, e); // top
    this.addQuad(d, c, g, h); // +z
    this.addQuad(b, a, e, f); // -z
    this.addQuad(c, b, f, g); // +x
    this.addQuad(a, d, h, e); // -x
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
