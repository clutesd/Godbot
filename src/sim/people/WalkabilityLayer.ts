import { cellAt } from '../world';
import { fineSegmentDry, waterAt } from '../transport/TerrainTraversal';
import type { Vec2, WorldCell, WorldState } from '../types';

export type CrossingMode = 'walk' | 'bridge' | 'ferry' | 'boat' | 'rail';

interface GridPoint {
  x: number;
  z: number;
}

const keyFor = (x: number, z: number): number => z * 10_000 + x;
const GRID_OFFSETS = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

/**
 * Lightweight deterministic pedestrian navigation over the simulation terrain grid. Local
 * roads are supplied as preferred waypoints; A* is only used when a preferred segment would
 * enter water or a cliff. This keeps ordinary town movement cheap while making the safety
 * guarantee explicit.
 */
export class WalkabilityLayer {
  private readonly routeCache = new Map<string, Vec2[]>();
  private readonly failedRouteRevisions = new Map<string, number>();
  private readonly gridEdges = new Map<number, boolean>();
  private readonly groundCache = new Map<string, { point: Vec2; regions: number[]; revisions: number[] }>();
  private readonly regionWidth: number;
  private readonly regionRevisions: Uint32Array;
  private readonly components: Int32Array;
  private readonly componentQueue: Int32Array;
  private nextComponent = 1;
  private gridRevision = 0;
  private observedEnvironmentRevision = -1;
  private blockedCells?: Uint8Array;
  private blockedSamples?: Uint8Array;

  constructor(private readonly world: WorldState) {
    this.regionWidth = Math.ceil(world.size / 4);
    this.regionRevisions = new Uint32Array(this.regionWidth ** 2);
    this.components = new Int32Array(world.cells.length);
    this.componentQueue = new Int32Array(world.cells.length);
  }

  isWalkable(point: Vec2): boolean {
    const cell = cellAt(this.world, point.x, point.z);
    return Boolean(cell && this.isWalkableCell(cell) && !waterAt(this.world, point, cell));
  }

  isDeepWater(point: Vec2): boolean {
    const cell = cellAt(this.world, point.x, point.z);
    if (!cell?.water) return false;
    if (cell.river) return cell.flow > 0.34;
    return cell.lake || cell.elevation < this.world.seaLevel - 0.015;
  }

  isSegmentWalkable(start: Vec2, end: Vec2): boolean {
    if (!this.isWalkable(start) || !this.isWalkable(end)) return false;
    if (!fineSegmentDry(this.world, start, end)) return false;
    // Exact cell-level traversal (supercover DDA). Walkability is a per-cell predicate, so
    // walking every touched cell makes validation exact and sub-segment consistent: any point
    // midway along a walkable segment is itself on a walkable route. Allocation-free: this runs
    // per person per tick.
    const size = this.world.size;
    const x0 = start.x / this.world.cellSize + size / 2;
    const z0 = start.z / this.world.cellSize + size / 2;
    let cx = Math.round(x0);
    let cz = Math.round(z0);
    const ex = Math.round(end.x / this.world.cellSize + size / 2);
    const ez = Math.round(end.z / this.world.cellSize + size / 2);
    const dx = end.x / this.world.cellSize + size / 2 - x0;
    const dz = end.z / this.world.cellSize + size / 2 - z0;
    if (!this.cellClear(cx, cz)) return false;
    if (dx === 0 && dz === 0) return true;
    const stepX = Math.sign(dx);
    const stepZ = Math.sign(dz);
    let tMaxX = stepX !== 0 ? (cx + stepX * 0.5 - x0) / dx : Infinity;
    let tMaxZ = stepZ !== 0 ? (cz + stepZ * 0.5 - z0) / dz : Infinity;
    const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
    while (cx !== ex || cz !== ez) {
      if (tMaxX < tMaxZ) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else if (tMaxZ < tMaxX) {
        cz += stepZ;
        tMaxZ += tDeltaZ;
      } else {
        // Perfect corner crossing: a body moving through the corner touches both neighbors.
        if (!this.cellClear(cx + stepX, cz) || !this.cellClear(cx, cz + stepZ)) return false;
        cx += stepX;
        cz += stepZ;
        tMaxX += tDeltaX;
        tMaxZ += tDeltaZ;
      }
      if (!this.cellClear(cx, cz)) return false;
    }
    return true;
  }

  /** Finds stable ground without consuming the simulation random stream. */
  nearestWalkable(point: Vec2, identity = 'walkable', maxRadius = this.world.cellSize * 6): Vec2 {
    if (this.isWalkable(point)) return { ...point };
    this.syncTraversalRevision();
    const cacheKey = `${point.x}:${point.z}:${maxRadius}:${identity}`;
    const cached = this.groundCache.get(cacheKey);
    if (cached && cached.regions.every((region, index) => this.regionRevisions[region] === cached.revisions[index])) return { ...cached.point };
    if (this.groundCache.size >= 2048) this.groundCache.clear();
    const phase = (stableHash(identity) / 0xffffffff) * Math.PI * 2;
    const step = this.world.cellSize * 0.32;
    for (let radius = step; radius <= maxRadius; radius += step) {
      const samples = Math.max(8, Math.ceil(Math.PI * 2 * radius / step));
      for (let index = 0; index < samples; index += 1) {
        const angle = phase + index / samples * Math.PI * 2;
        const candidate = { x: point.x + Math.cos(angle) * radius, z: point.z + Math.sin(angle) * radius };
        if (this.isWalkable(candidate)) {
          this.cacheGround(cacheKey, point, candidate, radius);
          return { ...candidate };
        }
      }
    }
    let fallback: WorldCell | undefined;
    let bestDistance = Infinity;
    for (const cell of this.world.cells) {
      if (!this.isWalkable({ x: cell.worldX, z: cell.worldZ })) continue;
      const candidateDistance = squaredDistance(cell, point);
      if (candidateDistance < bestDistance) {
        fallback = cell;
        bestDistance = candidateDistance;
      }
    }
    const result = fallback ? { x: fallback.worldX, z: fallback.worldZ } : { ...point };
    this.cacheGround(cacheKey, point, result, Infinity);
    return { ...result };
  }

  private regionAt(coordinate: number): number {
    return Math.max(0, Math.min(this.regionWidth - 1, Math.floor((coordinate / this.world.cellSize + this.world.size / 2) / 4)));
  }

  private cacheGround(key: string, origin: Vec2, point: Vec2, radius: number): void {
    const margin = radius + Math.max(this.world.cellSize, this.world.terrain.step);
    const regions: number[] = [];
    const revisions: number[] = [];
    for (let regionZ = this.regionAt(origin.z - margin); regionZ <= this.regionAt(origin.z + margin); regionZ++) {
      for (let regionX = this.regionAt(origin.x - margin); regionX <= this.regionAt(origin.x + margin); regionX++) {
        const region = regionZ * this.regionWidth + regionX;
        regions.push(region);
        revisions.push(this.regionRevisions[region]!);
      }
    }
    this.groundCache.set(key, { point, regions, revisions });
  }

  private invalidateGround(worldX: number, worldZ: number, radius: number): void {
    for (let regionZ = this.regionAt(worldZ - radius); regionZ <= this.regionAt(worldZ + radius); regionZ++) {
      for (let regionX = this.regionAt(worldX - radius); regionX <= this.regionAt(worldX + radius); regionX++) {
        this.regionRevisions[regionZ * this.regionWidth + regionX]!++;
      }
    }
  }

  /**
   * Routes through road/path hints when possible. Unsafe segments are replaced by a cached
   * terrain-grid route. Boat/ferry travel is the only mode allowed to retain water waypoints.
   */
  route(start: Vec2, end: Vec2, preferred: readonly Vec2[] = [], mode: CrossingMode = 'walk'): Vec2[] {
    const destination = mode === 'boat' || mode === 'ferry' ? { ...end } : this.nearestWalkable(end, `destination:${end.x}:${end.z}`);
    // A mode label is not a ticket or crossing. Passenger legs need explicit network support.
    if (mode === 'boat' || mode === 'ferry' || mode === 'rail') return [];

    const nodes = [
      this.nearestWalkable(start, `origin:${start.x}:${start.z}`),
      ...preferred.map((point, index) => this.nearestWalkable(point, `preferred:${index}:${point.x}:${point.z}`)),
      destination,
    ];
    const result: Vec2[] = [];
    let cursor = nodes[0]!;
    for (let index = 1; index < nodes.length; index += 1) {
      const to = nodes[index];
      if (!to) continue;
      const segment = this.isSegmentWalkable(cursor, to) ? [{ ...to }] : this.gridRoute(cursor, to);
      if (segment.length > 0 && !this.isSegmentWalkable(cursor, segment[0]!)) {
        return result;
      }
      if (segment.length === 0) {
        const safe = this.nearestWalkable(to, `unreachable:${to.x}:${to.z}`);
        if (this.isSegmentWalkable(cursor, safe)) {
          result.push(safe);
          cursor = safe;
        }
      } else {
        result.push(...segment);
        cursor = segment[segment.length - 1]!;
      }
    }
    return dedupe(result);
  }

  routeIsValid(points: readonly Vec2[], mode: CrossingMode = 'walk'): boolean {
    if (mode === 'boat' || mode === 'ferry' || mode === 'rail') return false;
    return points.every((point) => this.isWalkable(point))
      && points.every((point, index) => index === 0 || this.isSegmentWalkable(points[index - 1]!, point));
  }

  private isWalkableCell(cell: WorldCell): boolean {
    if (cell.landform === 'peak' || cell.landform === 'canyon') return false;
    const weather = this.world.weather?.cells[cell.z * this.world.size + cell.x];
    return cell.slope <= 0.54 && cell.movementCost - (weather?.travelPenalty ?? 0) < 4.2 && (weather?.snowpack ?? 0) < 1;
  }

  private cellClear(cellX: number, cellZ: number): boolean {
    if (cellX < 0 || cellZ < 0 || cellX >= this.world.size || cellZ >= this.world.size) return true;
    const cell = this.world.cells[cellZ * this.world.size + cellX];
    return !cell || this.isWalkableCell(cell);
  }

  travelMultiplier(point: Vec2): number {
    const cell = cellAt(this.world, point.x, point.z);
    if (!cell) return 1;
    const weather = this.world.weather?.cells[cell.z * this.world.size + cell.x];
    return 1 + (weather?.travelPenalty ?? 0);
  }

  private gridRoute(start: Vec2, end: Vec2): Vec2[] {
    this.syncTraversalRevision();
    const startCell = cellAt(this.world, start.x, start.z);
    const endCell = cellAt(this.world, end.x, end.z);
    if (!startCell || !endCell || !this.isWalkableCell(startCell) || !this.isWalkableCell(endCell)) return [];
    const cacheKey = `${startCell.x},${startCell.z}>${endCell.x},${endCell.z}`;
    const cached = this.routeCache.get(cacheKey);
    if (cached && cached.length > 0 && this.routeIsValid(cached)) return this.attachExactEnd(cached, end);
    if (cached?.length === 0 && this.failedRouteRevisions.get(cacheKey) === this.gridRevision) return [];
    if (this.routeCache.size > 2048) {
      this.routeCache.clear();
      this.failedRouteRevisions.clear();
    }
    if (!this.connected(startCell, endCell)) {
      this.routeCache.set(cacheKey, []);
      this.failedRouteRevisions.set(cacheKey, this.gridRevision);
      return [];
    }

    const startKey = keyFor(startCell.x, startCell.z);
    const endKey = keyFor(endCell.x, endCell.z);
    const open = new MinScoreQueue();
    const points = new Map<number, GridPoint>([[startKey, { x: startCell.x, z: startCell.z }]]);
    const cameFrom = new Map<number, number>();
    const cost = new Map<number, number>([[startKey, 0]]);
    const estimate = new Map<number, number>([[startKey, heuristic(startCell, endCell)]]);
    const closed = new Set<number>();
    open.push(startKey, estimate.get(startKey)!);

    while (open.size > 0 && closed.size < 1024) {
      const currentEntry = open.pop();
      if (!currentEntry) break;
      const currentKey = currentEntry.key;
      if (closed.has(currentKey) || currentEntry.score !== estimate.get(currentKey)) continue;
      if (currentKey === endKey) {
        const route = this.reconstruct(cameFrom, points, currentKey);
        this.routeCache.set(cacheKey, route);
        return this.attachExactEnd(route, end);
      }
      closed.add(currentKey);
      const current = points.get(currentKey);
      if (!current) continue;
      for (const [dx, dz] of GRID_OFFSETS) {
        const x = current.x + dx;
        const z = current.z + dz;
        if (x < 0 || z < 0 || x >= this.world.size || z >= this.world.size) continue;
        const cell = this.world.cells[z * this.world.size + x];
        const fromIndex = current.z * this.world.size + current.x;
        const toIndex = z * this.world.size + x;
        if (!cell || !this.gridStepClear(fromIndex, toIndex)) continue;
        const neighborKey = keyFor(x, z);
        const travel = Math.hypot(dx, dz) * (0.7 + cell.movementCost);
        const tentative = (cost.get(currentKey) ?? Infinity) + travel;
        if (tentative >= (cost.get(neighborKey) ?? Infinity)) continue;
        cameFrom.set(neighborKey, currentKey);
        points.set(neighborKey, { x, z });
        cost.set(neighborKey, tentative);
        const score = tentative + Math.hypot(endCell.x - x, endCell.z - z);
        estimate.set(neighborKey, score);
        open.push(neighborKey, score);
      }
    }
    this.routeCache.set(cacheKey, []);
    this.failedRouteRevisions.set(cacheKey, this.gridRevision);
    return [];
  }

  private gridStepClear(fromIndex: number, toIndex: number): boolean {
    const from = this.world.cells[fromIndex]!;
    const to = this.world.cells[toIndex]!;
    if (!this.isWalkableCell(to)) return false;
    if (from.x !== to.x && from.z !== to.z) {
      const sideA = this.world.cells[from.z * this.world.size + to.x];
      const sideB = this.world.cells[to.z * this.world.size + from.x];
      if (!sideA || !sideB || !this.isWalkableCell(sideA) || !this.isWalkableCell(sideB)) return false;
    }
    const edgeKey = Math.min(fromIndex, toIndex) * this.world.cells.length + Math.max(fromIndex, toIndex);
    let clear = this.gridEdges.get(edgeKey);
    if (clear === undefined) {
      clear = this.isSegmentWalkable({ x: from.worldX, z: from.worldZ }, { x: to.worldX, z: to.worldZ });
      this.gridEdges.set(edgeKey, clear);
    }
    return clear;
  }

  private connected(start: WorldCell, end: WorldCell): boolean {
    const startIndex = start.z * this.world.size + start.x;
    const endIndex = end.z * this.world.size + end.x;
    if (this.components[startIndex]) return this.components[startIndex] === this.components[endIndex];
    const component = this.nextComponent++;
    this.components[startIndex] = component;
    this.componentQueue[0] = startIndex;
    let count = 1;
    for (let cursor = 0; cursor < count; cursor++) {
      const index = this.componentQueue[cursor]!;
      const cell = this.world.cells[index]!;
      for (const [offsetX, offsetZ] of GRID_OFFSETS) {
        const cellX = cell.x + offsetX;
        const cellZ = cell.z + offsetZ;
        if (cellX < 0 || cellZ < 0 || cellX >= this.world.size || cellZ >= this.world.size) continue;
        const neighbor = cellZ * this.world.size + cellX;
        if (this.components[neighbor] || !this.gridStepClear(index, neighbor)) continue;
        this.components[neighbor] = component;
        this.componentQueue[count++] = neighbor;
      }
    }
    return this.components[endIndex] === component;
  }

  /** Weather time alone does not change connectivity. Reuse failed surveys until a barrier changes. */
  private syncTraversalRevision(): void {
    const revision = this.world.environmentRevision ?? 0;
    if (revision === this.observedEnvironmentRevision) return;
    this.observedEnvironmentRevision = revision;
    const field = this.world.terrain;
    let changed = !this.blockedCells;
    this.blockedCells ??= new Uint8Array(this.world.cells.length);
    this.blockedSamples ??= new Uint8Array(field.height.length);
    for (let i = 0; i < this.world.cells.length; i++) {
      const cell = this.world.cells[i]!;
      const blocked = Number(!this.isWalkableCell(cell));
      if (this.blockedCells[i] !== blocked) {
        changed = true;
        this.blockedCells[i] = blocked;
        this.invalidateGround(cell.worldX, cell.worldZ, this.world.cellSize / 2);
      }
    }
    for (let i = 0; i < field.height.length; i++) {
      const blocked = Number(field.waterLevel[i]! >= 0 || field.river[i] || field.lake[i] || field.height[i]! < this.world.seaLevel);
      if (this.blockedSamples[i] !== blocked) {
        changed = true;
        this.blockedSamples[i] = blocked;
        this.invalidateGround(field.originX + i % field.resolution * field.step,
          field.originZ + Math.floor(i / field.resolution) * field.step, field.step / 2);
      }
    }
    if (changed) {
      this.gridRevision++;
      this.gridEdges.clear();
      this.components.fill(0);
      this.nextComponent = 1;
    }
  }

  private reconstruct(cameFrom: Map<number, number>, points: Map<number, GridPoint>, currentKey: number): Vec2[] {
    const reversed: Vec2[] = [];
    while (true) {
      const point = points.get(currentKey);
      if (point) {
        reversed.push({
          x: (point.x - this.world.size / 2) * this.world.cellSize,
          z: (point.z - this.world.size / 2) * this.world.cellSize,
        });
      }
      if (!cameFrom.has(currentKey)) break;
      currentKey = cameFrom.get(currentKey)!;
    }
    return dedupe(reversed.reverse());
  }

  private attachExactEnd(cellRoute: readonly Vec2[], exactEnd: Vec2): Vec2[] {
    const last = cellRoute[cellRoute.length - 1];
    if (!last || !this.isSegmentWalkable(last, exactEnd)) return [];
    return dedupe([...cellRoute, exactEnd]);
  }
}

function heuristic(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function squaredDistance(cell: WorldCell, point: Vec2): number {
  return (cell.worldX - point.x) ** 2 + (cell.worldZ - point.z) ** 2;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dedupe(points: readonly Vec2[]): Vec2[] {
  const result: Vec2[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || Math.hypot(previous.x - point.x, previous.z - point.z) > 0.04) result.push({ ...point });
  }
  return result;
}

interface ScoredCell {
  key: number;
  score: number;
}

/** Small deterministic binary heap for A*: lower score wins, then lower cell key. */
class MinScoreQueue {
  private readonly values: ScoredCell[] = [];

  get size(): number {
    return this.values.length;
  }

  push(key: number, score: number): void {
    const value = { key, score };
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!less(value, this.values[parent]!)) break;
      this.values[index] = this.values[parent]!;
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): ScoredCell | undefined {
    const first = this.values[0];
    const tail = this.values.pop();
    if (!first || !tail || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && less(this.values[right]!, this.values[left]!) ? right : left;
      if (!less(this.values[child]!, tail)) break;
      this.values[index] = this.values[child]!;
      index = child;
    }
    this.values[index] = tail;
    return first;
  }
}

function less(a: ScoredCell, b: ScoredCell): boolean {
  return a.score < b.score || (a.score === b.score && a.key < b.key);
}
