import type { RawHeightfield } from './Heightfield';
import { clamp01 } from './noise';
import { nearestIndex } from './TerrainField';
import type { WeatherCellState, WorldState } from '../types';
import { classifyWaterDepth, DANGEROUS_WATER_DEPTH, elevationToY, surfaceHeightAt } from './SurfaceGeometry';

const STORAGE_TO_STAGE = 0.055;
const MIN_VISIBLE_STORAGE = 0.0015;
const RIVER_RETENTION = 0.58;
const LAKE_RETENTION = 0.88;
const FLOODPLAIN_RETENTION = 0.34;
const RIVER_BANKFULL_EXCESS = 0.055;
const LAKE_BANKFULL_EXCESS = 0.18;
const FLOODPLAIN_BANKFULL = 0.035;
const MAX_FLOOD_PASSES = 6;

export interface HydrologyWaterBudget {
  readonly runoffInput: number;
  readonly startingStorage: number;
  readonly endingStorage: number;
  readonly outletLoss: number;
  readonly floodedStorage: number;
  readonly maxDischarge: number;
  readonly massError: number;
}

export class DynamicHydrology {
  private readonly baseLevel: Float32Array;
  private readonly baseFlow: Float32Array;
  private readonly baseWater: boolean[];
  private readonly storage: Float64Array;
  private readonly incoming: Float64Array;
  private readonly discharge: Float64Array;
  private readonly referenceStorage: Float64Array;
  private readonly referenceDischarge: Float64Array;
  private readonly cellIndices: Int32Array;
  private readonly samplesPerCell: Uint16Array;
  private readonly flooded: Uint8Array;
  private readonly cellGroundY: Float32Array;

  lastBudget: HydrologyWaterBudget = {
    runoffInput: 0,
    startingStorage: 0,
    endingStorage: 0,
    outletLoss: 0,
    floodedStorage: 0,
    maxDischarge: 0,
    massError: 0,
  };

  constructor(private readonly world: WorldState) {
    const terrain = world.terrain;
    this.baseLevel = terrain.waterLevel.slice();
    this.baseFlow = terrain.flow.slice();
    this.baseWater = world.cells.map((cell) => cell.water);
    this.cellGroundY = Float32Array.from(world.cells, cell => surfaceHeightAt(world, cell.worldX, cell.worldZ));
    this.storage = new Float64Array(terrain.height.length);
    this.incoming = new Float64Array(terrain.height.length);
    this.discharge = new Float64Array(terrain.height.length);
    this.referenceStorage = new Float64Array(terrain.height.length);
    this.referenceDischarge = new Float64Array(terrain.height.length);
    this.flooded = new Uint8Array(terrain.height.length);
    this.samplesPerCell = new Uint16Array(world.cells.length);
    this.cellIndices = Int32Array.from(terrain.height, (_, index) => {
      const worldX = terrain.originX + index % terrain.resolution * terrain.step;
      const worldZ = terrain.originZ + Math.floor(index / terrain.resolution) * terrain.step;
      const cellX = Math.max(0, Math.min(world.size - 1, Math.round(worldX / world.cellSize + world.size / 2)));
      const cellZ = Math.max(0, Math.min(world.size - 1, Math.round(worldZ / world.cellSize + world.size / 2)));
      const cellIndex = cellZ * world.size + cellX;
      this.samplesPerCell[cellIndex]!++;
      return cellIndex;
    });
    for (let index = 0; index < terrain.height.length; index += 1) {
      if (terrain.height[index]! < world.seaLevel || this.baseLevel[index]! < 0) continue;
      const depth = Math.max(0, this.baseLevel[index]! - terrain.height[index]!);
      const reference = terrain.lake[index]
        ? 0.2 + Math.min(0.28, depth / STORAGE_TO_STAGE * 0.25)
        : terrain.river[index]
          ? 0.035 + this.baseFlow[index]! * 0.09 + Math.min(0.08, depth / STORAGE_TO_STAGE * 0.15)
          : 0;
      this.referenceStorage[index] = reference;
      this.storage[index] = reference;
      const retained = this.retentionAt(index);
      this.referenceDischarge[index] = Math.max(0.0025, reference * (1 - retained));
    }
  }

  advance(conditions: readonly WeatherCellState[]): void {
    const { terrain, seaLevel } = this.world;
    const { drainage, waterLevel, height, flow } = terrain;
    const startingStorage = sum(this.storage);
    let runoffInput = 0;
    let outletLoss = 0;
    let maxDischarge = 0;
    this.incoming.fill(0);
    this.discharge.fill(0);

    const order = drainage?.order ?? Array.from({ length: height.length }, (_, index) => index);
    for (const index of order) {
      const cellIndex = this.cellIndices[index]!;
      const localRunoff = Math.max(0, conditions[cellIndex]?.runoff ?? 0) / Math.max(1, this.samplesPerCell[cellIndex]!);
      runoffInput += localRunoff;
      let available = this.storage[index]! + this.incoming[index]! + localRunoff;

      if (height[index]! < seaLevel) {
        outletLoss += available;
        this.storage[index] = 0;
        this.discharge[index] = available;
        maxDischarge = Math.max(maxDischarge, available);
        continue;
      }

      const retention = this.retentionAt(index);
      let retained = available * retention;
      const softCapacity = this.softStorageCapacity(index);
      if (softCapacity > 0 && retained > softCapacity * 4) retained = softCapacity * 4;
      const outflow = Math.max(0, available - retained);
      this.storage[index] = retained;
      this.discharge[index] = outflow;
      maxDischarge = Math.max(maxDischarge, outflow);

      const downstream = drainage?.downstream[index] ?? -1;
      if (downstream >= 0) this.incoming[downstream] += outflow;
      else outletLoss += outflow;
    }

    this.spillFloodwater(height, seaLevel);
    waterLevel.fill(-1);
    for (let index = 0; index < height.length; index += 1) {
      if (height[index]! < seaLevel) {
        waterLevel[index] = seaLevel;
        flow[index] = this.baseFlow[index]!;
        this.flooded[index] = 0;
        continue;
      }

      const reference = this.referenceStorage[index]!;
      if (this.baseLevel[index]! >= 0) {
        const stage = this.baseLevel[index]! + (this.storage[index]! - reference) * STORAGE_TO_STAGE;
        waterLevel[index] = stage > height[index]! + 0.00035 && this.storage[index]! > MIN_VISIBLE_STORAGE ? stage : -1;
      } else if (this.flooded[index] && this.storage[index]! > MIN_VISIBLE_STORAGE) {
        waterLevel[index] = height[index]! + this.storage[index]! * STORAGE_TO_STAGE;
      } else {
        this.flooded[index] = 0;
      }

      const referenceDischarge = Math.max(this.referenceDischarge[index]!, 0.004 + this.baseFlow[index]! * 0.04);
      const dischargeRatio = this.discharge[index]! / referenceDischarge;
      flow[index] = clamp01(this.baseFlow[index]! * Math.sqrt(Math.max(0, dischargeRatio)));
    }

    let floodedStorage = 0;
    for (let index = 0; index < this.flooded.length; index += 1) {
      if (this.flooded[index]) floodedStorage += this.storage[index]!;
    }
    const endingStorage = sum(this.storage);
    this.lastBudget = {
      runoffInput,
      startingStorage,
      endingStorage,
      outletLoss,
      floodedStorage,
      maxDischarge,
      massError: startingStorage + runoffInput - endingStorage - outletLoss,
    };

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
      const reference = this.referenceStorage[sample]!;
      const bankfull = Math.max(reference + this.bankfullExcess(sample), FLOODPLAIN_BANKFULL);
      weather.floodRisk = clamp01(Math.max(0, this.storage[sample]! - reference) / Math.max(0.02, bankfull - reference) * (1 - cell.slope));
      // Coarse water remains a regional descriptor. Exact traversal/placement authority is terrain.waterLevel.
      cell.water = this.baseWater[index]! || weather.floodDepth > 0.035;
      cell.flow = flow[sample]!;
    }
  }

  private retentionAt(index: number): number {
    const terrain = this.world.terrain;
    if (terrain.lake[index]) return LAKE_RETENTION;
    if (terrain.river[index] || this.baseLevel[index]! >= 0) return RIVER_RETENTION;
    return this.flooded[index] ? FLOODPLAIN_RETENTION : 0;
  }

  private bankfullExcess(index: number): number {
    const terrain = this.world.terrain;
    if (terrain.lake[index]) return LAKE_BANKFULL_EXCESS;
    if (terrain.river[index] || this.baseLevel[index]! >= 0) return RIVER_BANKFULL_EXCESS;
    return FLOODPLAIN_BANKFULL;
  }

  private softStorageCapacity(index: number): number {
    if (this.world.terrain.height[index]! < this.world.seaLevel) return 0;
    const reference = this.referenceStorage[index]!;
    if (reference > 0) return reference + this.bankfullExcess(index);
    return this.flooded[index] ? FLOODPLAIN_BANKFULL : 0;
  }

  /**
   * Moves only water that actually exists into adjacent low ground. Every transferred unit is
   * removed from the source sample, so widening a floodplain cannot manufacture water volume.
   */
  private spillFloodwater(height: Float32Array, seaLevel: number): void {
    const resolution = this.world.terrain.resolution;
    for (let pass = 0; pass < MAX_FLOOD_PASSES; pass += 1) {
      let moved = false;
      for (let index = 0; index < height.length; index += 1) {
        const reference = this.referenceStorage[index]!;
        if (reference <= 0 && !this.flooded[index]) continue;
        const bankfull = reference > 0 ? reference + this.bankfullExcess(index) : FLOODPLAIN_BANKFULL;
        let excess = this.storage[index]! - bankfull;
        if (excess <= 1e-9) continue;
        const sourceSurface = reference > 0
          ? this.baseLevel[index]! + (this.storage[index]! - reference) * STORAGE_TO_STAGE
          : height[index]! + this.storage[index]! * STORAGE_TO_STAGE;
        const sourceX = index % resolution;
        const sourceZ = Math.floor(index / resolution);
        const candidates: number[] = [];
        for (const [offsetX, offsetZ] of NEIGHBOURS) {
          const nextX = sourceX + offsetX;
          const nextZ = sourceZ + offsetZ;
          if (nextX < 0 || nextZ < 0 || nextX >= resolution || nextZ >= resolution) continue;
          const next = nextZ * resolution + nextX;
          if (height[next]! < seaLevel || height[next]! >= sourceSurface - 0.0005) continue;
          candidates.push(next);
        }
        candidates.sort((a, b) => height[a]! - height[b]! || a - b);
        for (const next of candidates) {
          if (excess <= 1e-9) break;
          const capacity = Math.max(0, (sourceSurface - height[next]!) / STORAGE_TO_STAGE - this.storage[next]!);
          if (capacity <= 1e-9) continue;
          const transfer = Math.min(excess, capacity);
          this.storage[index] -= transfer;
          this.storage[next] += transfer;
          this.flooded[next] = 1;
          excess -= transfer;
          moved = true;
        }
      }
      if (!moved) break;
    }
    for (let index = 0; index < this.flooded.length; index += 1) {
      if (this.referenceStorage[index]! > 0 || this.storage[index]! > MIN_VISIBLE_STORAGE) continue;
      this.flooded[index] = 0;
    }
  }
}

function sum(values: Float64Array): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += values[index]!;
  return total;
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
