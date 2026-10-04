/**
 * MillKit.ts
 *
 * A small drafting kit for machine buildings, in metres.
 *
 * Mills are designed around their machinery, which means wheels, gears, sails, chutes and shafts at
 * arbitrary orientations. The shared geometry builder only rotates boxes about Y, so this kit adds
 * the few primitives a millwright needs — an oriented box, a frustum between two points, a gear, a
 * wheel, a sail — and draws them in real dimensions. One scale factor converts metres to building
 * units at emission, so every mill is drafted at true proportion and then fitted like any other
 * structure.
 *
 * Every face is wound from an explicit outward direction rather than from point order, so nothing
 * drawn here can come out inside-out under single-sided materials.
 */

import type { GeometryBuilder, Vec3 } from '../assets/GeometryBuilder';
import type { SurfaceKey } from '../materials/MaterialPalette';
import type { RotorSpec } from './MillMotion';
import { rotorBuilder, type GeometrySink } from './StructureGeometry';

export type Builder = GeometryBuilder | undefined;
export type Axis = 'x' | 'y' | 'z';

/** One building unit is roughly six metres. */
export const METRE = 1 / 6;

export const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: Vec3, s: number): Vec3 => v(a.x * s, a.y * s, a.z * s);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length = (a: Vec3): number => Math.sqrt(dot(a, a));
const unit = (a: Vec3): Vec3 => { const l = length(a) || 1; return mul(a, 1 / l); };

const AXES: Record<Axis, Vec3> = { x: v(1, 0, 0), y: v(0, 1, 0), z: v(0, 0, 1) };

/** Two unit vectors spanning the plane square to an axis. */
function planeOf(axis: Vec3): [Vec3, Vec3] {
  const helper = Math.abs(axis.y) < 0.9 ? v(0, 1, 0) : v(1, 0, 0);
  const u = unit(cross(helper, axis));
  return [u, unit(cross(axis, u))];
}

export interface DraftBounds {
  min: Vec3;
  max: Vec3;
  /** The extent of everything that stands on the ground, which is what placement reserves. */
  groundMin: Vec3;
  groundMax: Vec3;
}

/**
 * The kit. Every coordinate is in metres in the plot frame: +Y up, the working entrance facing +Z,
 * and — by convention across the family — water arriving on the west (-X).
 */
export class MillKit {
  readonly bounds: DraftBounds = {
    min: v(Infinity, Infinity, Infinity), max: v(-Infinity, -Infinity, -Infinity),
    groundMin: v(Infinity, 0, Infinity), groundMax: v(-Infinity, 0, -Infinity),
  };

  constructor(private readonly sink: GeometrySink, readonly scale = METRE) {}

  at(surface: SurfaceKey, stage: number): Builder {
    return this.sink.at(surface, stage);
  }

  /** A moving part. Same name, different surface: the same part in another material. */
  rotor(name: string, pivot: Vec3, surface: SurfaceKey, stage: number, spec: RotorSpec): Builder {
    return rotorBuilder(this.sink, name, mul(pivot, this.scale), surface, stage, spec);
  }

  /** Record a moving part's swept circle, so the reserved extent covers where it travels. */
  sweep(centre: Vec3, radius: number, axis: Axis): void {
    const [u, w] = planeOf(AXES[axis]);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      this.note(add(centre, add(mul(u, Math.cos(angle) * radius), mul(w, Math.sin(angle) * radius))));
    }
  }

  private note(point: Vec3): void {
    const b = this.bounds;
    b.min.x = Math.min(b.min.x, point.x); b.min.y = Math.min(b.min.y, point.y); b.min.z = Math.min(b.min.z, point.z);
    b.max.x = Math.max(b.max.x, point.x); b.max.y = Math.max(b.max.y, point.y); b.max.z = Math.max(b.max.z, point.z);
    if (point.y < 2.5) {
      b.groundMin.x = Math.min(b.groundMin.x, point.x); b.groundMin.z = Math.min(b.groundMin.z, point.z);
      b.groundMax.x = Math.max(b.groundMax.x, point.x); b.groundMax.z = Math.max(b.groundMax.z, point.z);
    }
  }

  /** A planar face wound so its normal points along `out`. Triangles and quads only. */
  face(b: Builder, points: Vec3[], out: Vec3): void {
    if (!b) return;
    for (const point of points) this.note(point);
    const normal = cross(sub(points[1]!, points[0]!), sub(points[2]!, points[0]!));
    const ordered = dot(normal, out) < 0 ? [...points].reverse() : points;
    const s = this.scale;
    const p = ordered.map(point => mul(point, s));
    if (p.length === 4) b.addQuad(p[0]!, p[1]!, p[2]!, p[3]!);
    else b.addTriangle(p[0]!, p[1]!, p[2]!);
  }

  /** A thin sheet visible from both sides: cloth, a vane, a sheet of falling water. */
  sheet(b: Builder, points: Vec3[]): void {
    const normal = cross(sub(points[1]!, points[0]!), sub(points[2]!, points[0]!));
    this.face(b, points, normal);
    this.face(b, points, mul(normal, -1));
  }

  /** A box on arbitrary unit axes. `ax` is the length axis. */
  obox(b: Builder, centre: Vec3, ax: Vec3, ay: Vec3, sx: number, sy: number, sz: number): void {
    if (!b) return;
    const x = unit(ax);
    const z = unit(cross(x, ay));
    const y = cross(z, x);
    const hx = mul(x, sx / 2), hy = mul(y, sy / 2), hz = mul(z, sz / 2);
    const corner = (i: number, j: number, k: number): Vec3 => add(centre, add(mul(hx, i), add(mul(hy, j), mul(hz, k))));
    const faces: [Vec3[], Vec3][] = [
      [[corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(1, -1, 1)], x],
      [[corner(-1, -1, -1), corner(-1, 1, -1), corner(-1, 1, 1), corner(-1, -1, 1)], mul(x, -1)],
      [[corner(-1, 1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(-1, 1, 1)], y],
      [[corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(-1, -1, 1)], mul(y, -1)],
      [[corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)], z],
      [[corner(-1, -1, -1), corner(1, -1, -1), corner(1, 1, -1), corner(-1, 1, -1)], mul(z, -1)],
    ];
    for (const [points, out] of faces) this.face(b, points, out);
  }

  /** An axis-aligned box by its centre, optionally turned about Y. */
  box(b: Builder, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotationY = 0): void {
    this.obox(b, v(x, y, z), v(Math.cos(rotationY), 0, -Math.sin(rotationY)), v(0, 1, 0), sx, sy, sz);
  }

  /** A box standing on `y`, which is how most masonry is thought about. */
  block(b: Builder, x: number, y: number, z: number, sx: number, h: number, sz: number, rotationY = 0): void {
    this.box(b, x, y + h / 2, z, sx, h, sz, rotationY);
  }

  /** A square-section member between two points. `up` orients its section; defaults sensibly. */
  bar(b: Builder, from: Vec3, to: Vec3, width: number, depth = width, up?: Vec3): void {
    const along = sub(to, from);
    if (length(along) < 1e-6) return;
    const dir = unit(along);
    const hint = up ?? (Math.abs(dir.y) > 0.9 ? v(0, 0, 1) : v(0, 1, 0));
    this.obox(b, mul(add(from, to), 0.5), dir, hint, length(along), depth, width);
  }

  /** A frustum between two points: shafts, drums, towers, silos, stacks, cones (r1 = 0). */
  cyl(b: Builder, from: Vec3, to: Vec3, r0: number, r1: number, segments = 12, caps = true, phase = 0): void {
    if (!b) return;
    const axis = unit(sub(to, from));
    const [u, w] = planeOf(axis);
    const ring = (centre: Vec3, r: number): Vec3[] => Array.from({ length: segments }, (_, index) => {
      const angle = phase + (index / segments) * Math.PI * 2;
      return add(centre, add(mul(u, Math.cos(angle) * r), mul(w, Math.sin(angle) * r)));
    });
    const lower = ring(from, r0);
    const upper = ring(to, r1);
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      const middle = mul(add(add(lower[index]!, lower[next]!), add(upper[index]!, upper[next]!)), 0.25);
      const centreLine = add(from, mul(axis, dot(sub(middle, from), axis)));
      const out = sub(middle, centreLine);
      if (r1 < 1e-4) this.face(b, [lower[index]!, lower[next]!, upper[index]!], out);
      else if (r0 < 1e-4) this.face(b, [lower[index]!, upper[next]!, upper[index]!], out);
      else this.face(b, [lower[index]!, lower[next]!, upper[next]!, upper[index]!], out);
    }
    if (!caps) return;
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      if (r1 > 1e-4) this.face(b, [to, upper[index]!, upper[next]!], axis);
      if (r0 > 1e-4) this.face(b, [from, lower[index]!, lower[next]!], mul(axis, -1));
    }
  }

  /** A lofted solid of revolution through (height, radius) stations about a vertical axis. */
  lathe(b: Builder, x: number, z: number, stations: readonly [number, number][], segments = 16): void {
    for (let index = 0; index < stations.length - 1; index += 1) {
      const [y0, r0] = stations[index]!;
      const [y1, r1] = stations[index + 1]!;
      this.cyl(b, v(x, y0, z), v(x, y1, z), r0, r1, segments, false);
    }
    const [topY, topR] = stations[stations.length - 1]!;
    if (topR > 1e-4) this.cyl(b, v(x, topY, z), v(x, topY + 0.01, z), topR, 0, segments, false);
  }

  /** A disc of given thickness centred on `centre`, square to `axis`. */
  disc(b: Builder, centre: Vec3, axis: Axis, radius: number, thickness: number, segments = 14): void {
    const a = mul(AXES[axis], thickness / 2);
    this.cyl(b, sub(centre, a), add(centre, a), radius, radius, segments);
  }

  /** A point on a circle square to `axis`. Angle 0 is "up" for horizontal axes, +X for Y. */
  onCircle(centre: Vec3, axis: Axis, radius: number, angle: number): Vec3 {
    const [u, w] = axis === 'y' ? [v(1, 0, 0), v(0, 0, 1)] : axis === 'x' ? [v(0, 1, 0), v(0, 0, 1)] : [v(0, 1, 0), v(1, 0, 0)];
    return add(centre, add(mul(u, Math.cos(angle) * radius), mul(w, Math.sin(angle) * radius)));
  }

  /** A ring of short members: a wheel rim, a curb, a gallery edge. */
  rim(b: Builder, centre: Vec3, axis: Axis, radius: number, section: number, segments = 18): void {
    for (let index = 0; index < segments; index += 1) {
      const a = this.onCircle(centre, axis, radius, (index / segments) * Math.PI * 2);
      const c = this.onCircle(centre, axis, radius, ((index + 1) / segments) * Math.PI * 2);
      this.bar(b, a, c, section, section, AXES[axis]);
    }
  }

  /** A spur or face gear: a disc with teeth, so meshing reads at a glance. */
  gear(b: Builder, centre: Vec3, axis: Axis, radius: number, thickness: number, teeth: number): void {
    this.disc(b, centre, axis, radius * 0.92, thickness, Math.max(10, Math.min(24, teeth)));
    for (let index = 0; index < teeth; index += 1) {
      const angle = (index / teeth) * Math.PI * 2;
      this.bar(b, this.onCircle(centre, axis, radius * 0.86, angle), this.onCircle(centre, axis, radius * 1.06, angle),
        Math.max(0.05, radius * 0.07), thickness * 0.9, AXES[axis]);
    }
    // Arms, so a big wheel reads as a framed millwright's wheel rather than a solid plate.
    if (radius > 0.6) {
      for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
        this.bar(b, centre, this.onCircle(centre, axis, radius * 0.9, angle), radius * 0.09, thickness * 1.3, AXES[axis]);
      }
    }
  }

  /**
   * A water wheel on a horizontal axle along X.
   *
   * Undershot and breast wheels carry flat floats; an overshot wheel carries buckets between closed
   * shrouds — the one detail that tells a wheel fed from above from one pushed from below.
   */
  waterWheel(b: Builder, centre: Vec3, radius: number, width: number, style: 'undershot' | 'breast' | 'overshot'): void {
    const sides = [-width / 2, width / 2];
    const floats = style === 'overshot' ? 32 : 24;
    for (const side of sides) {
      const c = add(centre, v(side, 0, 0));
      this.rim(b, c, 'x', radius, 0.16, 24);
      this.rim(b, c, 'x', radius * (style === 'overshot' ? 0.8 : 0.72), 0.12, 20);
      for (let arm = 0; arm < 8; arm += 1) {
        const angle = (arm / 8) * Math.PI * 2;
        this.bar(b, c, this.onCircle(c, 'x', radius * 0.98, angle), 0.16, 0.16, v(1, 0, 0));
      }
    }
    for (let index = 0; index < floats; index += 1) {
      const angle = (index / floats) * Math.PI * 2;
      if (style === 'overshot') {
        const inner = this.onCircle(centre, 'x', radius * 0.8, angle);
        const outer = this.onCircle(centre, 'x', radius * 0.99, angle + 0.16);
        this.bar(b, inner, outer, width, 0.06, v(1, 0, 0));
      } else {
        const inner = this.onCircle(centre, 'x', radius * 0.7, angle);
        const outer = this.onCircle(centre, 'x', radius * 1.06, angle);
        this.bar(b, inner, outer, width, 0.07, v(1, 0, 0));
      }
    }
    if (style === 'overshot') {
      // Shrouds: the closed side plates that make each bucket a bucket.
      for (const side of sides) {
        const c = add(centre, v(side, 0, 0));
        for (let index = 0; index < 24; index += 1) {
          const a0 = (index / 24) * Math.PI * 2, a1 = ((index + 1) / 24) * Math.PI * 2;
          const quad = [this.onCircle(c, 'x', radius * 0.8, a0), this.onCircle(c, 'x', radius, a0), this.onCircle(c, 'x', radius, a1), this.onCircle(c, 'x', radius * 0.8, a1)];
          this.sheet(b, quad);
        }
      }
    }
    // The axle-tree: a heavy squared oak shaft, or iron on a later wheel.
    this.cyl(b, add(centre, v(-width / 2 - 0.4, 0, 0)), add(centre, v(width / 2 + 0.4, 0, 0)), 0.28, 0.28, 8);
  }

  /**
   * A sail cross in the XY plane, turning about Z.
   *
   * 'common' sails are canvas spread on a lattice; 'patent' sails are rows of painted shutters; a
   * 'multiblade' wheel is the steel fan of a farm wind pump. Each reads unmistakably at distance.
   */
  sails(frame: Builder, cloth: Builder, hub: Vec3, radius: number, count: number, style: 'common' | 'patent' | 'multiblade'): void {
    if (style === 'multiblade') {
      const blades = 18;
      for (let index = 0; index < blades; index += 1) {
        const angle = (index / blades) * Math.PI * 2;
        const dir = v(Math.cos(angle), Math.sin(angle), 0);
        const perp = v(-dir.y, dir.x, 0);
        // A pitched blade: twisted out of the plane so it catches the wind.
        const pitch = add(mul(perp, Math.cos(0.5)), v(0, 0, Math.sin(0.5)));
        this.obox(cloth, add(hub, mul(dir, radius * 0.65)), dir, pitch, radius * 0.62, radius * 0.2, 0.025);
      }
      this.rim(frame, hub, 'z', radius * 0.55, 0.05, 18);
      this.rim(frame, hub, 'z', radius * 0.98, 0.05, 24);
      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2;
        this.bar(frame, hub, add(hub, mul(v(Math.cos(angle), Math.sin(angle), 0), radius * 0.98)), 0.05, 0.05, v(0, 0, 1));
      }
      this.disc(frame, hub, 'z', radius * 0.16, 0.3, 10);
      return;
    }
    for (let arm = 0; arm < count; arm += 1) {
      const angle = (arm / count) * Math.PI * 2 + Math.PI / 4;
      const dir = v(Math.cos(angle), Math.sin(angle), 0);
      const perp = v(-dir.y, dir.x, 0);
      const at = (along: number, across: number, depth = 0): Vec3 => add(hub, add(mul(dir, along), add(mul(perp, across), v(0, 0, depth))));
      const inner = radius * 0.2;
      const width = radius * (style === 'patent' ? 0.22 : 0.24);
      // The whip: the main spar each sail is built on.
      this.bar(frame, at(-0.4, 0), at(radius, 0), 0.26, 0.3, v(0, 0, 1));
      // Hemlath along the trailing edge, and a narrow leading board.
      this.bar(frame, at(inner, width), at(radius * 0.99, width), 0.1, 0.12, v(0, 0, 1));
      this.bar(frame, at(inner, -width * 0.28), at(radius * 0.99, -width * 0.28), 0.08, 0.1, v(0, 0, 1));
      const bays = Math.max(6, Math.round((radius - inner) / 0.75));
      for (let index = 0; index <= bays; index += 1) {
        const along = inner + ((radius * 0.99 - inner) * index) / bays;
        this.bar(frame, at(along, -width * 0.28), at(along, width), 0.07, 0.07, v(0, 0, 1));
      }
      if (style === 'common') {
        // Canvas spread on the trailing side of the lattice, just behind it.
        if (cloth) this.sheet(cloth, [at(inner + 0.2, 0.12, -0.12), at(radius * 0.97, 0.12, -0.12), at(radius * 0.97, width * 0.96, -0.12), at(inner + 0.2, width * 0.96, -0.12)]);
      } else {
        // Shutters: a row of pivoted boards per bay, each canted open a little.
        for (let index = 0; index < bays; index += 1) {
          const along = inner + ((radius * 0.99 - inner) * (index + 0.5)) / bays;
          const tilt = add(mul(perp, Math.cos(0.25)), v(0, 0, Math.sin(0.25)));
          this.obox(cloth, at(along, width * 0.52, -0.08), dir, tilt, (radius - inner) / bays * 0.86, width * 0.88, 0.04);
        }
      }
    }
    this.disc(frame, hub, 'z', 0.55, 0.6, 10);
  }

  /** A pitched roof as two solid slabs. Ridge along X or Z. */
  gableRoof(b: Builder, cx: number, eaveY: number, cz: number, width: number, depth: number, rise: number, overhang: number, ridge: Axis = 'x', thickness = 0.18): void {
    const alongX = ridge === 'x';
    const run = (alongX ? depth : width) / 2 + overhang;
    const span = (alongX ? width : depth) + overhang * 2;
    const slope = Math.sqrt(run * run + rise * rise);
    for (const side of [-1, 1]) {
      const low = alongX ? v(cx, eaveY, cz + side * run) : v(cx + side * run, eaveY, cz);
      const high = v(cx, eaveY + rise, cz);
      const mid = mul(add(low, high), 0.5);
      const ridgeDir = alongX ? v(1, 0, 0) : v(0, 0, 1);
      const down = unit(sub(low, high));
      // The slab's thickness hangs below the rafter line, so the ridge meets cleanly.
      const normal = unit(cross(ridgeDir, down));
      const outward = dot(normal, v(0, 1, 0)) > 0 ? normal : mul(normal, -1);
      this.obox(b, add(mid, mul(outward, -thickness / 2)), ridgeDir, down, span, slope, thickness);
    }
  }

  /** The triangular gable walls under a ridge, filling the end of a pitched roof. */
  gableEnds(b: Builder, cx: number, eaveY: number, cz: number, width: number, depth: number, rise: number, ridge: Axis = 'x'): void {
    for (const side of [-1, 1]) {
      const points = ridge === 'x'
        ? [v(cx + side * width / 2, eaveY, cz - depth / 2), v(cx + side * width / 2, eaveY, cz + depth / 2), v(cx + side * width / 2, eaveY + rise, cz)]
        : [v(cx - width / 2, eaveY, cz + side * depth / 2), v(cx + width / 2, eaveY, cz + side * depth / 2), v(cx, eaveY + rise, cz + side * depth / 2)];
      this.face(b, points, ridge === 'x' ? v(side, 0, 0) : v(0, 0, side));
    }
  }

  /** A pitched single-slope roof from a high edge to a low one. */
  shedRoof(b: Builder, x0: number, x1: number, zHigh: number, yHigh: number, zLow: number, yLow: number, thickness = 0.16): void {
    const high = v((x0 + x1) / 2, yHigh, zHigh);
    const low = v((x0 + x1) / 2, yLow, zLow);
    const down = unit(sub(low, high));
    this.obox(b, mul(add(high, low), 0.5), v(1, 0, 0), down, Math.abs(x1 - x0), length(sub(low, high)), thickness);
  }

  /** A window: a dark reveal with a sill and a head, set into a wall facing `out`. */
  window(dark: Builder, trim: Builder, at: Vec3, out: Vec3, width: number, height: number): void {
    const n = unit(out);
    const along = unit(cross(v(0, 1, 0), n));
    this.obox(dark, add(at, mul(n, 0.04)), along, v(0, 1, 0), width, height, 0.08);
    this.obox(trim, add(at, add(mul(n, 0.08), v(0, -height / 2 - 0.05, 0))), along, v(0, 1, 0), width + 0.2, 0.1, 0.16);
    this.obox(trim, add(at, add(mul(n, 0.07), v(0, height / 2 + 0.06, 0))), along, v(0, 1, 0), width + 0.16, 0.12, 0.12);
    this.obox(trim, add(at, mul(n, 0.07)), v(0, 1, 0), along, height, 0.06, 0.06);
  }

  /** A plank door with its frame, in a wall facing `out`. Bottom of the door at `at.y`. */
  door(leaf: Builder, dark: Builder, at: Vec3, out: Vec3, width: number, height: number): void {
    const n = unit(out);
    const along = unit(cross(v(0, 1, 0), n));
    const centre = add(at, v(0, height / 2, 0));
    this.obox(dark, add(centre, mul(n, 0.03)), along, v(0, 1, 0), width + 0.16, height + 0.1, 0.08);
    // Leaf stood a little open, so the doorway reads as a way in.
    this.obox(leaf, add(add(centre, mul(n, 0.12)), mul(along, -width * 0.3)), add(mul(along, 0.8), mul(n, 0.6)), v(0, 1, 0), width * 0.5, height, 0.07);
  }

  /** A straight flight of steps with stringers, rising from `from` to `to`. */
  stair(b: Builder, from: Vec3, to: Vec3, width: number): void {
    const rise = to.y - from.y;
    const steps = Math.max(2, Math.round(rise / 0.2));
    const run = sub(v(to.x, 0, to.z), v(from.x, 0, from.z));
    const dir = unit(run);
    const side = unit(cross(v(0, 1, 0), dir));
    for (let index = 0; index < steps; index += 1) {
      const t = (index + 0.5) / steps;
      const centre = add(from, v(run.x * t, rise * ((index + 1) / steps) - 0.04, run.z * t));
      this.obox(b, centre, side, v(0, 1, 0), width, 0.08, length(run) / steps + 0.06);
    }
    for (const offset of [-width / 2, width / 2]) {
      this.bar(b, add(from, mul(side, offset)), add(to, mul(side, offset)), 0.08, 0.26, side);
    }
  }

  /** A post-and-rail run along a polyline, at a given deck height. */
  railing(b: Builder, points: readonly Vec3[], height = 1.0): void {
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index]!, c = points[index + 1]!;
      const posts = Math.max(1, Math.round(length(sub(c, a)) / 1.4));
      for (let post = 0; post <= posts; post += 1) {
        const p = add(a, mul(sub(c, a), post / posts));
        this.bar(b, p, add(p, v(0, height, 0)), 0.08);
      }
      this.bar(b, add(a, v(0, height, 0)), add(c, v(0, height, 0)), 0.07);
      this.bar(b, add(a, v(0, height * 0.5, 0)), add(c, v(0, height * 0.5, 0)), 0.05);
    }
  }

  /** A ladder between two points: stringers and rungs. */
  ladder(b: Builder, from: Vec3, to: Vec3, width = 0.6): void {
    const dir = sub(to, from);
    const side = unit(cross(v(0, 1, 0), dir));
    for (const offset of [-width / 2, width / 2]) this.bar(b, add(from, mul(side, offset)), add(to, mul(side, offset)), 0.08);
    const rungs = Math.max(3, Math.round(length(dir) / 0.32));
    for (let index = 1; index < rungs; index += 1) {
      const p = add(from, mul(dir, index / rungs));
      this.bar(b, add(p, mul(side, -width / 2)), add(p, mul(side, width / 2)), 0.05);
    }
  }

  /** Open water as a flat sheet at `y`. */
  water(b: Builder, x0: number, x1: number, z0: number, z1: number, y: number): void {
    this.face(b, [v(x0, y, z0), v(x1, y, z0), v(x1, y, z1), v(x0, y, z1)], v(0, 1, 0));
  }

  /** A sack of grain or flour, lying or leaning. */
  sack(b: Builder, x: number, y: number, z: number, turn: number, standing = false): void {
    if (standing) this.block(b, x, y, z, 0.42, 0.75, 0.32, turn);
    else this.block(b, x, y, z, 0.48, 0.3, 0.8, turn);
  }

  /** A two-wheeled cart, shafts down. */
  cart(timber: Builder, x: number, z: number, turn: number, load?: Builder): void {
    const c = Math.cos(turn), s = Math.sin(turn);
    const at = (dx: number, dy: number, dz: number): Vec3 => v(x + dx * c + dz * s, dy, z - dx * s + dz * c);
    const fwd = v(s, 0, c);
    this.obox(timber, at(0, 0.85, 0), fwd, v(0, 1, 0), 2.2, 0.12, 1.3);
    for (const side of [-1, 1]) {
      this.obox(timber, at(side * 0.66, 1.05, 0), fwd, v(0, 1, 0), 2.2, 0.35, 0.06);
      this.cyl(timber, at(side * 0.78, 0.6, 0), at(side * 0.88, 0.6, 0), 0.6, 0.6, 12);
      this.bar(timber, at(side * 0.4, 0.85, 1.1), at(side * 0.4, 0.12, 2.6), 0.08);
    }
    if (load) for (let index = 0; index < 4; index += 1) this.sack(load, x + (index % 2 - 0.5) * 0.5 * c, 0.92, z + (Math.floor(index / 2) - 0.5) * 0.9 * c, turn);
  }

  /** A pile of logs, stacked in a pyramid, lying along `turn`. */
  logPile(b: Builder, x: number, z: number, logLength: number, rows: number, turn = 0): void {
    const along = v(Math.cos(turn), 0, -Math.sin(turn));
    const across = v(Math.sin(turn), 0, Math.cos(turn));
    for (let row = 0; row < rows; row += 1) {
      for (let index = 0; index < rows - row; index += 1) {
        const offset = (index - (rows - row - 1) / 2) * 0.62;
        const centre = add(v(x, 0.3 + row * 0.52, z), mul(across, offset));
        this.cyl(b, add(centre, mul(along, -logLength / 2)), add(centre, mul(along, logLength / 2)), 0.3, 0.27, 9);
      }
    }
  }

  /** A stack of sawn boards in courses with stickers between. */
  boardStack(b: Builder, x: number, z: number, lengthM: number, width: number, courses: number, turn = 0): void {
    for (let course = 0; course < courses; course += 1) {
      this.block(b, x, 0.15 + course * 0.16, z, lengthM, 0.1, width, turn);
    }
  }
}