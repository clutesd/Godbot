import type { Vec2 } from '../types';

export interface PedestrianFootprint {
  key?: string;
  worldX: number; worldZ: number; width: number; depth: number; rotationY?: number;
}

/** Spatially indexed, expanded rectangles. The expansion includes the pedestrian's body. */
export class StructureNavigation {
  private buckets = new Map<string, PedestrianFootprint[]>();
  private signature = '';
  revision = 0;

  set(structures: readonly PedestrianFootprint[]): boolean {
    const signature = structures.map(s => `${s.key ?? ''}:${s.worldX},${s.worldZ},${s.width},${s.depth},${s.rotationY ?? 0}`).join('|');
    if (signature === this.signature) return false;
    this.signature = signature; this.revision++; this.buckets.clear();
    for (const s of structures) {
      const radius = Math.hypot(s.width, s.depth) / 2 + 0.16;
      for (let x = Math.floor((s.worldX - radius) / 4); x <= Math.floor((s.worldX + radius) / 4); x++) {
        for (let z = Math.floor((s.worldZ - radius) / 4); z <= Math.floor((s.worldZ + radius) / 4); z++) {
          const key = `${x}:${z}`, bucket = this.buckets.get(key) ?? [];
          bucket.push(s); this.buckets.set(key, bucket);
        }
      }
    }
    return true;
  }

  nearby(a: Vec2, b = a, margin = 0): PedestrianFootprint[] {
    const result = new Set<PedestrianFootprint>();
    for (let x = Math.floor((Math.min(a.x, b.x) - margin) / 4); x <= Math.floor((Math.max(a.x, b.x) + margin) / 4); x++) {
      for (let z = Math.floor((Math.min(a.z, b.z) - margin) / 4); z <= Math.floor((Math.max(a.z, b.z) + margin) / 4); z++) {
        for (const s of this.buckets.get(`${x}:${z}`) ?? []) result.add(s);
      }
    }
    return [...result];
  }

  clear(a: Vec2, b = a, interior?: PedestrianFootprint & { key: string; doorWidth: number }): boolean {
    if (!this.nearby(a, b).every(s => s.key === interior?.key && interior !== undefined || !intersects(a, b, s))) return false;
    if (!interior) return true;
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
    const cost = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set<number>();
    cost[0] = 0;
    for (let pass = 0; pass < nodes.length; pass++) {
      let next = -1;
      for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (next < 0 || cost[i]! < cost[next]!)) next = i;
      if (next < 0 || !Number.isFinite(cost[next])) break;
      if (next === 1) {
        const path: Vec2[] = [];
        for (let i = 1; i > 0; i = previous[i]!) path.push(nodes[i]!);
        return path.reverse();
      }
      visited.add(next);
      for (let i = 1; i < nodes.length; i++) {
        const distance = cost[next]! + Math.hypot(nodes[next]!.x - nodes[i]!.x, nodes[next]!.z - nodes[i]!.z);
        if (visited.has(i) || distance >= cost[i]! || !safe(nodes[next]!, nodes[i]!)) continue;
        cost[i] = distance; previous[i] = next;
      }
    }
    return [];
  }
}

/** Slab intersection in building-local coordinates; catches thin walls between frame samples. */
function intersects(a: Vec2, b: Vec2, s: PedestrianFootprint, clearance = 0.14): boolean {
  const c = Math.cos(s.rotationY ?? 0), sn = Math.sin(s.rotationY ?? 0);
  const ax = c * (a.x - s.worldX) - sn * (a.z - s.worldZ);
  const az = sn * (a.x - s.worldX) + c * (a.z - s.worldZ);
  const bx = c * (b.x - s.worldX) - sn * (b.z - s.worldZ);
  const bz = sn * (b.x - s.worldX) + c * (b.z - s.worldZ);
  let low = 0, high = 1;
  for (const [start, end, half] of [[ax, bx, s.width / 2 + clearance], [az, bz, s.depth / 2 + clearance]]) {
    const delta = end! - start!;
    if (Math.abs(delta) < 1e-9) { if (Math.abs(start!) > half!) return false; }
    else {
      const t1 = (-half! - start!) / delta, t2 = (half! - start!) / delta;
      low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
      if (low > high) return false;
    }
  }
  return true;
}
