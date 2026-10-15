import type { Vec2 } from '../types';

export interface PedestrianFootprint {
  key?: string;
  /** Explicit rendered room walls and door approach nodes. Absent on simulation/legacy footprints. */
  physicalWalls?: readonly PedestrianFootprint[];
  passages?: readonly Vec2[];
  worldX: number; worldZ: number; width: number; depth: number; rotationY?: number;
}

/**
 * Numeric bucket key. The grid is a terrain index a few dozen buckets wide, so the multiplier is
 * far larger than any reachable |z| and the mapping is injective. Numeric keys matter because
 * `clear` runs tens of thousands of times per simulated month; string keys made every one of
 * those probes allocate.
 */
const bucketKey = (x: number, z: number): number => x * 1_048_576 + z;

/** Default body clearance for the blocking test. */
const BODY_CLEARANCE = 0.14;

/**
 * A footprint with its rotation and expanded half-extents resolved once at registration. The
 * values are the exact expressions `intersects` used to evaluate on every probe, so every test
 * returns bit-identical results without recomputing two trig calls per footprint per probe.
 */
interface IndexedFootprint {
  readonly s: PedestrianFootprint;
  readonly cos: number;
  readonly sin: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
}

/** Spatially indexed, expanded rectangles. The expansion includes the pedestrian's body. */
export class StructureNavigation {
  private buckets = new Map<number, IndexedFootprint[]>();
  private signature = '';
  revision = 0;

  set(structures: readonly PedestrianFootprint[]): boolean {
    const signature = structures.map(s => `${s.key ?? ''}:${s.worldX},${s.worldZ},${s.width},${s.depth},${s.rotationY ?? 0}`).join('|');
    if (signature === this.signature) return false;
    this.signature = signature; this.revision++; this.buckets.clear();
    for (const s of structures) {
      const rotation = s.rotationY ?? 0;
      const indexed: IndexedFootprint = {
        s, cos: Math.cos(rotation), sin: Math.sin(rotation),
        halfWidth: s.width / 2 + BODY_CLEARANCE, halfDepth: s.depth / 2 + BODY_CLEARANCE,
      };
      const radius = Math.hypot(s.width, s.depth) / 2 + 0.16;
      for (let x = Math.floor((s.worldX - radius) / 4); x <= Math.floor((s.worldX + radius) / 4); x++) {
        for (let z = Math.floor((s.worldZ - radius) / 4); z <= Math.floor((s.worldZ + radius) / 4); z++) {
          const key = bucketKey(x, z), bucket = this.buckets.get(key) ?? [];
          bucket.push(indexed); this.buckets.set(key, bucket);
        }
      }
    }
    return true;
  }

  nearby(a: Vec2, b = a, margin = 0): PedestrianFootprint[] {
    const result = new Set<PedestrianFootprint>();
    for (let x = Math.floor((Math.min(a.x, b.x) - margin) / 4); x <= Math.floor((Math.max(a.x, b.x) + margin) / 4); x++) {
      for (let z = Math.floor((Math.min(a.z, b.z) - margin) / 4); z <= Math.floor((Math.max(a.z, b.z) + margin) / 4); z++) {
        for (const indexed of this.buckets.get(bucketKey(x, z)) ?? []) result.add(indexed.s);
      }
    }
    return [...result];
  }

  /**
   * Allocation-free equivalent of `nearby(a, b).every(...)` for the blocking test. A footprint
   * registered in several buckets is tested more than once, which is harmless because the test is
   * a pure predicate, and that is what lets this avoid the deduplicating Set, the spread array and
   * the per-probe string key that `nearby` needs for its ordered callers.
   */
  private obstructed(a: Vec2, b: Vec2, interiorKey: string | undefined): boolean {
    const minX = Math.floor(Math.min(a.x, b.x) / 4), maxX = Math.floor(Math.max(a.x, b.x) / 4);
    const minZ = Math.floor(Math.min(a.z, b.z) / 4), maxZ = Math.floor(Math.max(a.z, b.z) / 4);
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const bucket = this.buckets.get(bucketKey(x, z));
        if (!bucket) continue;
        for (let index = 0; index < bucket.length; index++) {
          const f = bucket[index]!;
          if (interiorKey !== undefined && f.s.key === interiorKey) continue;
          if (slabIntersects(a, b, f.s.worldX, f.s.worldZ, f.cos, f.sin, f.halfWidth, f.halfDepth)) return true;
        }
      }
    }
    return false;
  }

  clear(a: Vec2, b = a, interior?: PedestrianFootprint & { key: string; doorWidth: number }): boolean {
    if (this.obstructed(a, b, interior?.key)) return false;
    if (!interior) return true;
    if (interior.physicalWalls) return interior.physicalWalls.every(wall => !intersects(a,b,wall,.06));
    const { width: w, depth: d, doorWidth: door } = interior;
    const walls = [[-w / 2, 0, 0.04, d], [w / 2, 0, 0.04, d], [0, -d / 2, w, 0.04],
      [-(w + door) / 4, d / 2, (w - door) / 2, 0.04], [(w + door) / 4, d / 2, (w - door) / 2, 0.04]];
    const c = Math.cos(interior.rotationY ?? 0), sn = Math.sin(interior.rotationY ?? 0);
    return walls.every(([x, z, width, depth]) => !intersects(a, b, {
      worldX: interior.worldX + x! * c + z! * sn, worldZ: interior.worldZ - x! * sn + z! * c,
      width: width!, depth: depth!, rotationY: interior.rotationY,
    }, 0.06));
  }

  /** Bounded local visibility search supplements the existing terrain grid, not another mover. */
  detour(a: Vec2, b: Vec2, safe: (a: Vec2, b: Vec2) => boolean,
    interior?: PedestrianFootprint & { key: string; doorWidth: number }): Vec2[] {
    const structures = this.nearby(a, b, 2);
    if (structures.length > 48) return [];
    const nodes: Vec2[] = [a, b];
    if (interior) {
      for (const point of interior.passages ?? []) if (safe(point,point)) nodes.push(point);
      const c = Math.cos(interior.rotationY ?? 0), sn = Math.sin(interior.rotationY ?? 0);
      for (const z of [interior.depth / 2 + 0.25, interior.depth / 2 - 0.2, 0]) {
        const point = { x: interior.worldX + z * sn, z: interior.worldZ + z * c };
        if (safe(point, point)) nodes.push(point);
      }
    }
    for (const s of structures) for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const c = Math.cos(s.rotationY ?? 0), sn = Math.sin(s.rotationY ?? 0);
      const lx = x * (s.width / 2 + 0.2), lz = z * (s.depth / 2 + 0.2);
      const point = { x: s.worldX + c * lx + sn * lz, z: s.worldZ - sn * lx + c * lz };
      if (safe(point, point)) nodes.push(point);
    }
    const cost = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Uint8Array(nodes.length);
    cost[0] = 0;
    for (let pass = 0; pass < nodes.length; pass++) {
      let next = -1;
      for (let i = 0; i < nodes.length; i++) if (!visited[i] && (next < 0 || cost[i]! < cost[next]!)) next = i;
      if (next < 0 || !Number.isFinite(cost[next])) break;
      if (next === 1) {
        const path: Vec2[] = [];
        for (let i = 1; i > 0; i = previous[i]!) path.push(nodes[i]!);
        return path.reverse();
      }
      visited[next] = 1;
      for (let i = 1; i < nodes.length; i++) {
        const distance = cost[next]! + Math.hypot(nodes[next]!.x - nodes[i]!.x, nodes[next]!.z - nodes[i]!.z);
        if (visited[i] || distance >= cost[i]! || !safe(nodes[next]!, nodes[i]!)) continue;
        cost[i] = distance; previous[i] = next;
      }
    }
    return [];
  }
}

/** Slab intersection in building-local coordinates; catches thin walls between frame samples. */
function intersects(a: Vec2, b: Vec2, s: PedestrianFootprint, clearance = BODY_CLEARANCE): boolean {
  const rotation = s.rotationY ?? 0;
  return slabIntersects(a, b, s.worldX, s.worldZ, Math.cos(rotation), Math.sin(rotation),
    s.width / 2 + clearance, s.depth / 2 + clearance);
}

/**
 * Allocation-free slab test with the footprint's trig and half-extents supplied. The two axes are
 * evaluated in the original order with the original expressions, so results are bit-identical.
 */
function slabIntersects(a: Vec2, b: Vec2, worldX: number, worldZ: number, c: number, sn: number,
  halfWidth: number, halfDepth: number): boolean {
  const ax = c * (a.x - worldX) - sn * (a.z - worldZ);
  const az = sn * (a.x - worldX) + c * (a.z - worldZ);
  const bx = c * (b.x - worldX) - sn * (b.z - worldZ);
  const bz = sn * (b.x - worldX) + c * (b.z - worldZ);
  let low = 0, high = 1;
  const deltaX = bx - ax;
  if (Math.abs(deltaX) < 1e-9) { if (Math.abs(ax) > halfWidth) return false; }
  else {
    const t1 = (-halfWidth - ax) / deltaX, t2 = (halfWidth - ax) / deltaX;
    low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
    if (low > high) return false;
  }
  const deltaZ = bz - az;
  if (Math.abs(deltaZ) < 1e-9) { if (Math.abs(az) > halfDepth) return false; }
  else {
    const t1 = (-halfDepth - az) / deltaZ, t2 = (halfDepth - az) / deltaZ;
    low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
    if (low > high) return false;
  }
  return true;
}
