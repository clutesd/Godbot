import type { RawHeightfield } from './Heightfield';
import { clamp01 } from './noise';
import { nearestIndex } from './TerrainField';
import type { WeatherCellState, WorldState } from '../types';
import { classifyWaterDepth, DANGEROUS_WATER_DEPTH, elevationToY, surfaceHeightAt } from './SurfaceGeometry';

export class DynamicHydrology {
  private readonly baseLevel: Float32Array;
  private readonly baseFlow: Float32Array;
  private readonly baseWater: boolean[];
  private readonly runoff: Float32Array;
  private readonly storage: Float32Array;
  private readonly cellIndices: Int32Array;
  private readonly visited: Uint8Array;
  private readonly cellGroundY: Float32Array;

  constructor(private readonly world: WorldState) {
    const terrain = world.terrain;
    this.baseLevel = terrain.waterLevel.slice();
    this.baseFlow = terrain.flow.slice();
    this.baseWater = world.cells.map((cell) => cell.water);
    this.cellGroundY = Float32Array.from(world.cells, cell => surfaceHeightAt(world, cell.worldX, cell.worldZ));
    this.runoff = new Float32Array(terrain.height.length);
    this.storage = new Float32Array(terrain.height.length);
    this.visited = new Uint8Array(terrain.height.length);
    this.cellIndices = Int32Array.from(terrain.height, (_, index) => {
      const worldX = terrain.originX + index % terrain.resolution * terrain.step;
      const worldZ = terrain.originZ + Math.floor(index / terrain.resolution) * terrain.step;
      const cellX = Math.max(0, Math.min(world.size - 1, Math.round(worldX / world.cellSize + world.size / 2)));
      const cellZ = Math.max(0, Math.min(world.size - 1, Math.round(worldZ / world.cellSize + world.size / 2)));
      return cellZ * world.size + cellX;
    });
  }

  advance(conditions: readonly WeatherCellState[]): void {
    const { terrain, seaLevel } = this.world;
    const { drainage, waterLevel, height, resolution, flow } = terrain;
    for (let index = 0; index < height.length; index += 1) this.runoff[index] = conditions[this.cellIndices[index]!]!.runoff;
    if (drainage) {
      for (const index of drainage.order) {
        const downstream = drainage.downstream[index] ?? -1;
        if (downstream >= 0) this.runoff[downstream] = this.runoff[downstream]! + this.runoff[index]!;
      }
    }
    waterLevel.set(this.baseLevel);
    this.visited.fill(0);
    const queue = new FloodQueue();
    for (let index = 0; index < height.length; index += 1) {
      const inflow = this.runoff[index]! / Math.max(1, drainage?.accumulation[index] ?? 1);
      this.storage[index] = Math.min(1, this.storage[index]! * 0.65 + inflow);
      flow[index] = clamp01(this.baseFlow[index]! + this.storage[index]! * 0.35);
      if (this.baseLevel[index]! < 0 || height[index]! < seaLevel) continue;
      waterLevel[index] = this.baseLevel[index]! + this.storage[index]! * 0.006 + Math.max(0, this.storage[index]! - 0.12) * 0.1;
      if (this.storage[index]! > 0.12) queue.push(-waterLevel[index]!, index);
    }
    while (queue.size > 0) {
      const index = queue.pop();
      if (this.visited[index]) continue;
      this.visited[index] = 1;
      const surface = waterLevel[index]!;
      const sourceX = index % resolution;
      const sourceZ = Math.floor(index / resolution);
      for (const [offsetX, offsetZ] of NEIGHBOURS) {
        const nextX = sourceX + offsetX;
        const nextZ = sourceZ + offsetZ;
        if (nextX < 0 || nextZ < 0 || nextX >= resolution || nextZ >= resolution) continue;
        const next = nextZ * resolution + nextX;
        if (this.visited[next] || height[next]! < seaLevel || height[next]! >= surface - 0.001 || waterLevel[next]! >= surface - 0.000101) continue;
        waterLevel[next] = surface - 0.0001;
        queue.push(-waterLevel[next]!, next);
      }
    }
    for (let index = 0; index < this.world.cells.length; index += 1) {
      const cell = this.world.cells[index]!;
      const weather = conditions[index]!;
      const sample = nearestIndex(terrain, cell.worldX, cell.worldZ);
      const level = waterLevel[sample]!;
      const depth = level < 0 ? 0 : Math.max(0, elevationToY(level, seaLevel) - this.cellGroundY[index]!);
      weather.waterDepth = depth;
      weather.floodDepth = this.baseWater[index] || this.baseLevel[sample]! >= 0 ? 0 : depth;
      weather.floodState = classifyWaterDepth(depth, cell.moisture);
      weather.floodMonths = weather.floodDepth >= DANGEROUS_WATER_DEPTH ? weather.floodMonths + 1 : 0;
      if (weather.floodDepth > 0.02) cell.moisture = Math.max(cell.moisture, 0.9);
      if (weather.floodDepth >= DANGEROUS_WATER_DEPTH) {
        weather.cropDamage = clamp01(weather.cropDamage + weather.floodDepth * 0.35);
        if (weather.floodMonths > 1) {
          const loss = Math.min(0.2, weather.floodDepth * 0.06);
          cell.wood *= 1 - loss;
          weather.treeDamage = clamp01(weather.treeDamage + loss);
          weather.lastWindthrowMonth = this.world.weather?.month ?? 0;
        }
      }
      weather.floodRisk = clamp01(this.storage[sample]! * (1 - cell.slope) * 3);
      cell.water = this.baseWater[index]! || weather.floodDepth > 0.035;
      cell.flow = flow[sample]!;
    }
  }
}

export interface Hydrology {
  /** Depression-filled surface; strictly descending toward the sea, so every drop has an outlet. */
  readonly filled: Float32Array;
  readonly waterLevel: Float32Array;
  readonly flow: Float32Array;
  readonly accumulation: Float32Array;
  readonly lake: Uint8Array;
  readonly river: Uint8Array;
  readonly fall: Float32Array;
  readonly downstream: Int32Array;
  /** Sample indices ordered from the highest filled surface down to the sea. */
  readonly order: readonly number[];
}

const read = (values: Float32Array, index: number): number => values[index] ?? 0;

/** Min-heap over (priority, index) pairs. Index is the tiebreak, which keeps flooding deterministic. */
class FloodQueue {
  private readonly priority: number[] = [];
  private readonly payload: number[] = [];

  get size(): number {
    return this.payload.length;
  }

  push(priority: number, index: number): void {
    this.priority.push(priority);
    this.payload.push(index);
    let child = this.payload.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.compare(child, parent) >= 0) break;
      this.swap(child, parent);
      child = parent;
    }
  }

  pop(): number {
    const top = this.payload[0] ?? -1;
    const lastPriority = this.priority.pop();
    const lastPayload = this.payload.pop();
    if (this.payload.length > 0 && lastPriority !== undefined && lastPayload !== undefined) {
      this.priority[0] = lastPriority;
      this.payload[0] = lastPayload;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.payload.length && this.compare(left, smallest) < 0) smallest = left;
        if (right < this.payload.length && this.compare(right, smallest) < 0) smallest = right;
        if (smallest === parent) break;
        this.swap(parent, smallest);
        parent = smallest;
      }
    }
    return top;
  }

  private compare(a: number, b: number): number {
    const pa = this.priority[a] ?? 0;
    const pb = this.priority[b] ?? 0;
    if (pa !== pb) return pa - pb;
    return (this.payload[a] ?? 0) - (this.payload[b] ?? 0);
  }

  private swap(a: number, b: number): void {
    const priority = this.priority[a] ?? 0;
    const payload = this.payload[a] ?? 0;
    this.priority[a] = this.priority[b] ?? 0;
    this.payload[a] = this.payload[b] ?? 0;
    this.priority[b] = priority;
    this.payload[b] = payload;
  }
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * Priority flood. Water enters at the map border and rises; anything it cannot escape becomes a
 * filled basin, which is where lakes belong. A tiny epsilon per step keeps the filled surface
 * strictly descending so flow routing never stalls on a flat lake.
 */
function fillDepressions(raw: RawHeightfield, seaLevel: number): Float32Array {
  const { resolution, height } = raw;
  const filled = new Float32Array(height.length);
  const closed = new Uint8Array(height.length);
  const queue = new FloodQueue();

  for (let index = 0; index < height.length; index += 1) {
    const x = index % resolution;
    const z = (index / resolution) | 0;
    if (x !== 0 && z !== 0 && x !== resolution - 1 && z !== resolution - 1) continue;
    const level = Math.max(read(height, index), seaLevel);
    filled[index] = level;
    closed[index] = 1;
    queue.push(level, index);
  }

  while (queue.size > 0) {
    const index = queue.pop();
    if (index < 0) break;
    const x = index % resolution;
    const z = (index / resolution) | 0;
    const level = read(filled, index);
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= resolution || nz >= resolution) continue;
      const neighbour = nz * resolution + nx;
      if (closed[neighbour]) continue;
      closed[neighbour] = 1;
      const next = Math.max(read(height, neighbour), level + 1e-6);
      filled[neighbour] = next;
      queue.push(next, neighbour);
    }
  }
  return filled;
}

/** D8 steepest descent over the filled surface, accumulated from the highest sample downward. */
function routeFlow(raw: RawHeightfield, filled: Float32Array): { accumulation: Float32Array; downstream: Int32Array; order: number[] } {
  const { resolution } = raw;
  const count = filled.length;
  const order = new Int32Array(count);
  for (let index = 0; index < count; index += 1) order[index] = index;
  const ordered = Array.from(order).sort((a, b) => {
    const delta = read(filled, b) - read(filled, a);
    return delta !== 0 ? delta : a - b;
  });

  const downstream = new Int32Array(count).fill(-1);
  const accumulation = new Float32Array(count).fill(1);
  for (const index of ordered) {
    const x = index % resolution;
    const z = (index / resolution) | 0;
    const level = read(filled, index);
    let best = -1;
    let bestSlope = 0;
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= resolution || nz >= resolution) continue;
      const neighbour = nz * resolution + nx;
      const slope = (level - read(filled, neighbour)) / Math.hypot(dx, dz);
      if (slope > bestSlope) {
        bestSlope = slope;
        best = neighbour;
      }
    }
    downstream[index] = best;
    if (best >= 0) accumulation[best] = read(accumulation, best) + read(accumulation, index);
  }
  return { accumulation, downstream, order: ordered };
}

export interface HydrologyOptions {
  readonly seaLevel: number;
  readonly verticalScale: number;
  /** Accumulated upstream samples required before a channel reads as a river. */
  readonly riverThreshold: number;
}

export function computeHydrology(raw: RawHeightfield, options: HydrologyOptions): Hydrology {
  const { seaLevel, verticalScale, riverThreshold } = options;
  const { height, resolution } = raw;
  const filled = fillDepressions(raw, seaLevel);
  const { accumulation, downstream, order } = routeFlow(raw, filled);

  let maxAccumulation = 1;
  for (let index = 0; index < accumulation.length; index += 1) maxAccumulation = Math.max(maxAccumulation, read(accumulation, index));
  const logMax = Math.log(1 + maxAccumulation);

  const flow = new Float32Array(height.length);
  const lake = new Uint8Array(height.length);
  const river = new Uint8Array(height.length);
  const fall = new Float32Array(height.length);
  const waterLevel = new Float32Array(height.length).fill(-1);

  for (let index = 0; index < height.length; index += 1) {
    const ground = read(height, index);
    const surface = read(filled, index);
    flow[index] = clamp01(Math.log(1 + read(accumulation, index)) / logMax);
    if (ground < seaLevel) {
      waterLevel[index] = seaLevel;
      continue;
    }
    if (surface - ground > 0.006) {
      lake[index] = 1;
      waterLevel[index] = surface;
      continue;
    }
    if (read(accumulation, index) >= riverThreshold) {
      river[index] = 1;
      // The channel surface rides the filled sheet, which descends monotonically to the sea, so a
      // river can never pool in a pit its own bed happens to carve.
      waterLevel[index] = surface;
    }
  }

  for (let index = 0; index < height.length; index += 1) {
    if (!river[index]) continue;
    const next = downstream[index] ?? -1;
    if (next < 0) continue;
    const stepDistance = Math.hypot((next % resolution) - (index % resolution), ((next / resolution) | 0) - ((index / resolution) | 0)) * raw.step;
    const drop = (read(height, index) - read(height, next)) * verticalScale;
    if (drop > stepDistance * 0.85) fall[index] = clamp01(drop / (stepDistance * 3.2));
  }

  return { filled, waterLevel, flow, accumulation, lake, river, fall, downstream, order };
}

/**
 * Forces every channel bed to descend along its own flow path. Without this a carved river can
 * leave millimetre pits behind, and the water reads as a chain of puddles instead of a river.
 */
export function enforceChannelDescent(raw: RawHeightfield, hydrology: Hydrology): void {
  const { height } = raw;
  for (const index of hydrology.order) {
    if (!hydrology.river[index]) continue;
    const next = hydrology.downstream[index] ?? -1;
    if (next < 0 || !hydrology.river[next]) continue;
    height[next] = Math.min(read(height, next), read(height, index) - 1e-4);
  }
}

/**
 * Incises the channels the routing found. Rivers cut their own valleys, which is what makes a
 * waterway read as carved into the land rather than painted onto it.
 */
export function carveChannels(raw: RawHeightfield, hydrology: Hydrology, seaLevel: number): void {
  const { height, resolution } = raw;
  for (let index = 0; index < height.length; index += 1) {
    const ground = read(height, index);
    if (ground <= seaLevel) continue;
    const strength = clamp01((read(hydrology.flow, index) - 0.42) / 0.58);
    if (strength <= 0) continue;
    height[index] = ground - strength * 0.05 * clamp01((ground - seaLevel) * 4);
  }
  // One pass of channel-local smoothing widens the incision into a valley profile.
  const source = Float32Array.from(height);
  for (let z = 1; z < resolution - 1; z += 1) {
    for (let x = 1; x < resolution - 1; x += 1) {
      const index = z * resolution + x;
      const strength = clamp01((read(hydrology.flow, index) - 0.3) / 0.7);
      if (strength <= 0) continue;
      const centre = read(source, index);
      const average = (
        read(source, index - 1) + read(source, index + 1) +
        read(source, index - resolution) + read(source, index + resolution)
      ) / 4;
      height[index] = centre + (average - centre) * strength * 0.5;
    }
  }
}
