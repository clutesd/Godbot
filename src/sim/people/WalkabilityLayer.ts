import { cellAt } from '../world';
import { fineSegmentDry, waterAt } from '../transport/TerrainTraversal';
import type { Vec2, WorldCell, WorldState } from '../types';
import { StructureNavigation, type PedestrianFootprint } from './StructureNavigation';

export type CrossingMode = 'walk' | 'bridge' | 'ferry' | 'boat' | 'rail';

interface GridPoint {
  x: number;
  z: number;
}

const keyFor = (x: number, z: number): number => z * 10_000 + x;
const GRID_OFFSETS = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

/** One slot per 3x3 neighbour offset, so an 8-neighbour step always has a distinct address. */
const EDGE_SLOTS = 9;
const EDGE_UNKNOWN = 0;
const EDGE_CLEAR = 1;
const EDGE_BLOCKED = 2;

/**
 * Lightweight deterministic pedestrian navigation over the simulation terrain grid. Local
 * roads are supplied as preferred waypoints; A* is only used when a preferred segment would
 * enter water or a cliff. This keeps ordinary town movement cheap while making the safety
 * guarantee explicit.
 */
export class WalkabilityLayer {
  readonly structures = new StructureNavigation();
  setStructures(structures: readonly PedestrianFootprint[]): void {
    if (!this.structures.set(structures)) return;
    this.routeCache.clear(); this.groundCache.clear();
    this.gridEdgeCache.fill(EDGE_UNKNOWN); this.components.fill(0); this.nextComponent = 1; this.gridRevision++;
  }
  private readonly routeCache = new Map<string, { revision: number; points: Vec2[] }>();
  private readonly gridEdgeCache: Uint8Array;
  private readonly edgeStart: Vec2 = { x: 0, z: 0 };
  private readonly edgeEnd: Vec2 = { x: 0, z: 0 };
  /**
   * Reusable A* working set. `searchStamp`/`searchClosed` hold the generation that last wrote a
   * cell, which makes every search O(expanded cells) instead of O(grid) with no clearing pass.
   */
  private readonly searchCost: Float64Array;
  private readonly searchEstimate: Float64Array;
  private readonly searchCameFrom: Int32Array;
  private readonly searchStamp: Int32Array;
  private readonly searchClosed: Int32Array;
  private readonly searchQueue: MinScoreQueue;
  private searchGeneration = 0;
  private readonly groundCache = new Map<string, { point: Vec2; regions: number[]; revisions: number[] }>();
  private readonly regionWidth: number;
  private readonly regionRevisions: Uint32Array;
  private readonly components: Int32Array;
  private readonly componentQueue: Int32Array;
  private nextComponent = 1;
  private gridRevision = 0;
  private observedEnvironmentRevision = -1;
  private observedWeatherMonth = -1;
  private coarseRevisionScans = 0;
  private fineRevisionScans = 0;
  private blockedCells?: Uint8Array;
  private blockedSamples?: Uint8Array;

  constructor(private readonly world: WorldState) {
    this.regionWidth = Math.ceil(world.size / 4);
    this.regionRevisions = new Uint32Array(this.regionWidth ** 2);
    this.gridEdgeCache = new Uint8Array(world.cells.length * EDGE_SLOTS);
    this.searchCost = new Float64Array(world.cells.length);
    this.searchEstimate = new Float64Array(world.cells.length);
    this.searchCameFrom = new Int32Array(world.cells.length);
    this.searchStamp = new Int32Array(world.cells.length);
    this.searchClosed = new Int32Array(world.cells.length);
    this.searchQueue = new MinScoreQueue(world.cells.length);
    this.components = new Int32Array(world.cells.length);
    this.componentQueue = new Int32Array(world.cells.length);
  }

  isWalkable(point: Vec2): boolean {
    const cell = cellAt(this.world, point.x, point.z);
    return Boolean(cell && this.isWalkableCell(cell) && !waterAt(this.world, point, cell) && this.structures.clear(point));
  }

  isDeepWater(point: Vec2): boolean {
    const cell = cellAt(this.world, point.x, point.z);
    if (!cell?.water) return false;
    if (cell.river) return cell.flow > 0.34;
    return cell.lake || cell.elevation < this.world.seaLevel - 0.015;
  }

  isSegmentWalkable(start: Vec2, end: Vec2): boolean {
    if (!this.structures.clear(start, end)) return false;
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

    // Road hints are preferences, never a compulsory trip across town.
    const directLength = Math.hypot(end.x - start.x, end.z - start.z);
    let hintedLength = 0, lastHint = start;
    for (const hint of [...preferred, end]) { hintedLength += Math.hypot(hint.x - lastHint.x, hint.z - lastHint.z); lastHint = hint; }
    const hints = hintedLength <= directLength * 1.4 + 0.5 ? preferred : [];
    const nodes = [
      this.nearestWalkable(start, `origin:${start.x}:${start.z}`),
      ...hints.map((point, index) => this.nearestWalkable(point, `preferred:${index}:${point.x}:${point.z}`)),
      destination,
    ];
    const result: Vec2[] = [];
    let cursor = nodes[0]!;
    for (let index = 1; index < nodes.length; index += 1) {
      const to = nodes[index];
      if (!to) continue;
      let segment = this.isSegmentWalkable(cursor, to) ? [{ ...to }] : [];
      if (!segment.length && !this.structures.clear(cursor, to)) segment = this.structures.detour(cursor, to, (a, b) => this.isSegmentWalkable(a, b));
      if (!segment.length) segment = this.gridRoute(cursor, to);
      if (segment.length > 0 && !this.isSegmentWalkable(cursor, segment[0]!)) {
        return [];
      }
      if (segment.length === 0) {
        const safe = this.nearestWalkable(to, `unreachable:${to.x}:${to.z}`);
        if (this.isSegmentWalkable(cursor, safe)) {
          result.push(safe);
          cursor = safe;
        } else return [];
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
    if (cached?.revision === this.gridRevision) {
      if (cached.points.length === 0) return [];
      return this.attachExactEnd(cached.points, end);
    }
    if (this.routeCache.size > 2048) {
      this.routeCache.clear();
    }
    if (!this.connected(startCell, endCell)) {
      this.routeCache.set(cacheKey, { revision: this.gridRevision, points: [] });
      return [];
    }

    // A* over reusable per-cell arrays. The previous implementation allocated four Maps, a Set, a
    // heap and one GridPoint per expanded cell on every call; with up to 1024 closed cells per
    // search that was the largest single source of simulation garbage. Scores, tie-breaks, the
    // neighbour order and the closed-set bound are all unchanged, so the chosen route is identical.
    const size = this.world.size;
    const generation = ++this.searchGeneration;
    const startIndex = startCell.z * size + startCell.x;
    const endIndex = endCell.z * size + endCell.x;
    const open = this.searchQueue;
    open.reset();
    this.searchStamp[startIndex] = generation;
    this.searchCost[startIndex] = 0;
    this.searchEstimate[startIndex] = heuristic(startCell, endCell);
    this.searchCameFrom[startIndex] = -1;
    open.push(startIndex, keyFor(startCell.x, startCell.z), this.searchEstimate[startIndex]!);

    let closedCount = 0;
    while (open.size > 0 && closedCount < 1024) {
      if (!open.pop()) break;
      const currentIndex = open.poppedIndex;
      // Lazy-deletion guard: a stale heap entry whose score no longer matches the best known
      // estimate for that cell is skipped, exactly as the Map-based version did.
      if (this.searchClosed[currentIndex] === generation) continue;
      if (this.searchStamp[currentIndex] !== generation || open.poppedScore !== this.searchEstimate[currentIndex]) continue;
      if (currentIndex === endIndex) {
        const route = this.reconstruct(currentIndex, generation);
        this.routeCache.set(cacheKey, { revision: this.gridRevision, points: route });
        return this.attachExactEnd(route, end);
      }
      this.searchClosed[currentIndex] = generation;
      closedCount += 1;
      const currentX = currentIndex % size;
      const currentZ = (currentIndex - currentX) / size;
      const currentCost = this.searchCost[currentIndex]!;
      for (const [dx, dz] of GRID_OFFSETS) {
        const x = currentX + dx;
        const z = currentZ + dz;
        if (x < 0 || z < 0 || x >= size || z >= size) continue;
        const toIndex = z * size + x;
        const cell = this.world.cells[toIndex];
        if (!cell || !this.gridStepClear(currentIndex, toIndex)) continue;
        const travel = Math.hypot(dx, dz) * (0.7 + cell.movementCost);
        const tentative = currentCost + travel;
        const known = this.searchStamp[toIndex] === generation ? this.searchCost[toIndex]! : Infinity;
        if (tentative >= known) continue;
        this.searchStamp[toIndex] = generation;
        this.searchCameFrom[toIndex] = currentIndex;
        this.searchCost[toIndex] = tentative;
        const score = tentative + Math.hypot(endCell.x - x, endCell.z - z);
        this.searchEstimate[toIndex] = score;
        open.push(toIndex, keyFor(x, z), score);
      }
    }
    this.routeCache.set(cacheKey, { revision: this.gridRevision, points: [] });
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
    // Dense slot cache in place of a Map keyed by an index pair. Steps are always between
    // 8-neighbours, so the undirected edge addresses exactly one slot of the owning lower cell.
    // The canonical (lower-index) orientation keeps the cache symmetric, as the Map key did.
    const lowIndex = fromIndex < toIndex ? fromIndex : toIndex;
    const low = fromIndex < toIndex ? from : to;
    const high = fromIndex < toIndex ? to : from;
    const slot = lowIndex * EDGE_SLOTS + (high.z - low.z + 1) * 3 + (high.x - low.x + 1);
    const cached = this.gridEdgeCache[slot]!;
    if (cached !== EDGE_UNKNOWN) return cached === EDGE_CLEAR;
    // Scratch vectors: this runs tens of thousands of times per simulated month and none of the
    // walkability predicates retain their arguments.
    this.edgeStart.x = from.worldX; this.edgeStart.z = from.worldZ;
    this.edgeEnd.x = to.worldX; this.edgeEnd.z = to.worldZ;
    const clear = this.isSegmentWalkable(this.edgeStart, this.edgeEnd);
    this.gridEdgeCache[slot] = clear ? EDGE_CLEAR : EDGE_BLOCKED;
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

  /**
   * Weather can change coarse pedestrian barriers monthly, while fine wet/dry topology changes
   * only when environmentRevision advances. Keep those scans independent so an ordinary weather
   * month never walks the high-resolution terrain field just to preserve route caches.
   */
  private syncTraversalRevision(): void {
    const environmentRevision = this.world.environmentRevision ?? 0;
    const weatherMonth = this.world.weather?.month ?? 0;
    const firstScan = !this.blockedCells || !this.blockedSamples;
    const weatherChanged = firstScan || weatherMonth !== this.observedWeatherMonth;
    const environmentChanged = firstScan || environmentRevision !== this.observedEnvironmentRevision;
    if (!weatherChanged && !environmentChanged) return;

    const field = this.world.terrain;
    let changed = firstScan;
    this.blockedCells ??= new Uint8Array(this.world.cells.length);
    this.blockedSamples ??= new Uint8Array(field.height.length);

    if (weatherChanged) {
      this.coarseRevisionScans += 1;
      for (let i = 0; i < this.world.cells.length; i++) {
        const cell = this.world.cells[i]!;
        const blocked = Number(!this.isWalkableCell(cell));
        if (this.blockedCells[i] !== blocked) {
          changed = true;
          this.blockedCells[i] = blocked;
          this.invalidateGround(cell.worldX, cell.worldZ, this.world.cellSize / 2);
        }
      }
      this.observedWeatherMonth = weatherMonth;
    }

    if (environmentChanged) {
      this.fineRevisionScans += 1;
      for (let i = 0; i < field.height.length; i++) {
        const blocked = Number(field.waterLevel[i]! >= 0 || field.river[i] || field.lake[i] || field.height[i]! < this.world.seaLevel);
        if (this.blockedSamples[i] !== blocked) {
          changed = true;
          this.blockedSamples[i] = blocked;
          this.invalidateGround(field.originX + i % field.resolution * field.step,
            field.originZ + Math.floor(i / field.resolution) * field.step, field.step / 2);
        }
      }
      this.observedEnvironmentRevision = environmentRevision;
    }

    if (changed) {
      this.gridRevision++;
      this.gridEdgeCache.fill(EDGE_UNKNOWN);
      this.components.fill(0);
      this.nextComponent = 1;
    }
  }

  /** Diagnostic counters used by regression tests and performance inspection. */
  revisionScanCounts(): { coarse: number; fine: number } {
    return { coarse: this.coarseRevisionScans, fine: this.fineRevisionScans };
  }

  private reconstruct(currentIndex: number, generation: number): Vec2[] {
    const size = this.world.size;
    const reversed: Vec2[] = [];
    while (currentIndex >= 0) {
      const x = currentIndex % size;
      const z = (currentIndex - x) / size;
      reversed.push({
        x: (x - size / 2) * this.world.cellSize,
        z: (z - size / 2) * this.world.cellSize,
      });
      if (this.searchStamp[currentIndex] !== generation) break;
      currentIndex = this.searchCameFrom[currentIndex]!;
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

/**
 * Deterministic binary heap for A*: lower score wins, then lower cell key. Entries live in three
 * parallel growable arrays and the popped entry is read from `poppedIndex`/`poppedScore`, so a
 * whole search allocates nothing. Ordering is identical to the previous object-per-entry heap.
 */
class MinScoreQueue {
  private indices: Int32Array;
  private orders: Float64Array;
  private scores: Float64Array;
  private length = 0;
  poppedIndex = -1;
  poppedScore = 0;

  constructor(capacity: number) {
    const initial = Math.max(64, capacity);
    this.indices = new Int32Array(initial);
    this.orders = new Float64Array(initial);
    this.scores = new Float64Array(initial);
  }

  get size(): number {
    return this.length;
  }

  reset(): void {
    this.length = 0;
    this.poppedIndex = -1;
  }

  private grow(): void {
    const indices = new Int32Array(this.indices.length * 2);
    const orders = new Float64Array(this.orders.length * 2);
    const scores = new Float64Array(this.scores.length * 2);
    indices.set(this.indices); orders.set(this.orders); scores.set(this.scores);
    this.indices = indices; this.orders = orders; this.scores = scores;
  }

  /** `order` is the historical cell key, preserved so equal scores break ties as before. */
  push(index: number, order: number, score: number): void {
    if (this.length === this.indices.length) this.grow();
    let slot = this.length++;
    while (slot > 0) {
      const parent = (slot - 1) >> 1;
      if (!less(score, order, this.scores[parent]!, this.orders[parent]!)) break;
      this.indices[slot] = this.indices[parent]!;
      this.orders[slot] = this.orders[parent]!;
      this.scores[slot] = this.scores[parent]!;
      slot = parent;
    }
    this.indices[slot] = index;
    this.orders[slot] = order;
    this.scores[slot] = score;
  }

  /** Returns false when empty; otherwise the winner is in `poppedIndex`/`poppedScore`. */
  pop(): boolean {
    if (this.length === 0) return false;
    this.poppedIndex = this.indices[0]!;
    this.poppedScore = this.scores[0]!;
    this.length -= 1;
    if (this.length === 0) return true;
    const tailIndex = this.indices[this.length]!;
    const tailOrder = this.orders[this.length]!;
    const tailScore = this.scores[this.length]!;
    let slot = 0;
    while (true) {
      const left = slot * 2 + 1;
      if (left >= this.length) break;
      const right = left + 1;
      const child = right < this.length && less(this.scores[right]!, this.orders[right]!, this.scores[left]!, this.orders[left]!)
        ? right : left;
      if (!less(this.scores[child]!, this.orders[child]!, tailScore, tailOrder)) break;
      this.indices[slot] = this.indices[child]!;
      this.orders[slot] = this.orders[child]!;
      this.scores[slot] = this.scores[child]!;
      slot = child;
    }
    this.indices[slot] = tailIndex;
    this.orders[slot] = tailOrder;
    this.scores[slot] = tailScore;
    return true;
  }
}

function less(scoreA: number, orderA: number, scoreB: number, orderB: number): boolean {
  return scoreA < scoreB || (scoreA === scoreB && orderA < orderB);
}
