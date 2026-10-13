export interface CircularZone { readonly x: number; readonly z: number; readonly radius: number }

/**
 * Point-in-any-circle test over a coarse grid. Answers exactly what
 * `zones.some(zone => Math.hypot(x - zone.x, z - zone.z) < zone.radius + margin)` answers, but
 * each query only tests the zones registered in its grid cell. Vegetation LOD passes ran that scan
 * for every placement against every settlement and occupied plot, which grew with the settlement.
 */
export class ZoneIndex {
  private readonly cells = new Map<number, CircularZone[]>();
  /** Zones too large to grid (non-finite reach) are tested on every query. */
  private readonly everywhere: CircularZone[] = [];

  constructor(zones: readonly CircularZone[], private readonly margin = 0, private readonly cellSize = 8) {
    for (const zone of zones) {
      const reach = zone.radius + margin;
      if (!(reach > 0)) continue; // hypot is never below a non-positive reach
      if (!Number.isFinite(reach) || !Number.isFinite(zone.x) || !Number.isFinite(zone.z)) {
        this.everywhere.push(zone);
        continue;
      }
      const minX = Math.floor((zone.x - reach) / cellSize), maxX = Math.floor((zone.x + reach) / cellSize);
      const minZ = Math.floor((zone.z - reach) / cellSize), maxZ = Math.floor((zone.z + reach) / cellSize);
      for (let gx = minX; gx <= maxX; gx += 1) {
        for (let gz = minZ; gz <= maxZ; gz += 1) {
          const key = cellKey(gx, gz);
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(zone);
          else this.cells.set(key, [zone]);
        }
      }
    }
  }

  contains(x: number, z: number): boolean {
    for (const zone of this.everywhere) if (Math.hypot(x - zone.x, z - zone.z) < zone.radius + this.margin) return true;
    const bucket = this.cells.get(cellKey(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize)));
    if (!bucket) return false;
    for (const zone of bucket) if (Math.hypot(x - zone.x, z - zone.z) < zone.radius + this.margin) return true;
    return false;
  }
}

function cellKey(x: number, z: number): number {
  return (x + 32768) * 65536 + (z + 32768);
}
