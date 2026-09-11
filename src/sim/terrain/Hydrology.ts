import type { RawHeightfield } from './Heightfield';
import { clamp01 } from './noise';
import { nearestIndex } from './TerrainField';
import type { WeatherCellState, WorldState } from '../types';
import { classifyWaterDepth, DANGEROUS_WATER_DEPTH, elevationFromY, elevationToY, surfaceHeightAt } from './SurfaceGeometry';

/** Hard physical guardrail in world units: dynamic floodwater can become dangerous, never mountainous. */
export const MAX_DYNAMIC_FLOOD_DEPTH = 1.25;
const FLOOD_PRESENT_DEPTH = 0.005;
const FLOOD_RELAX_PASSES = 4;

/**
 * Weather-driven hydrology is intentionally separate from generated rivers and lakes. Permanent
 * water is frozen in `baseLevel`; transient inundation lives in `terrain.floodDepth` as actual
 * world-space depth. `terrain.waterLevel` is only the composed surface consumed by legacy systems
 * and the renderer.
 */
export class DynamicHydrology {
  private readonly baseLevel: Float32Array;
  private readonly baseFlow: Float32Array;
  private readonly baseWater: boolean[];
  private readonly runoff: Float32Array;
  private readonly storage: Float32Array;
  private readonly transfer: Float32Array;
  private readonly cellIndices: Int32Array;
  private readonly cellGroundY: Float32Array;
  private readonly sampleGroundY: Float32Array;
  private readonly maximumAccumulation: number;

  constructor(private readonly world: WorldState) {
    const terrain = world.terrain;
    this.baseLevel = terrain.waterLevel.slice();
    this.baseFlow = terrain.flow.slice();
    this.baseWater = world.cells.map((cell) => cell.water);
    this.cellGroundY = Float32Array.from(world.cells, cell => surfaceHeightAt(world, cell.worldX, cell.worldZ));
    this.sampleGroundY = Float32Array.from(terrain.height, elevation => elevationToY(elevation, world.seaLevel));
    this.runoff = new Float32Array(terrain.height.length);
    this.storage = new Float32Array(terrain.height.length);
    this.transfer = new Float32Array(terrain.height.length);
    let maximumAccumulation = 1;
    if (terrain.drainage) {
      for (const amount of terrain.drainage.accumulation) maximumAccumulation = Math.max(maximumAccumulation, amount);
    }
    this.maximumAccumulation = maximumAccumulation;
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
    const { drainage, waterLevel, floodDepth, height, flow } = terrain;

    // Route catchment runoff downstream, but retain the catchment-average wetness signal. This is
    // the rainfall/snowmelt forcing; it is not itself a water-surface elevation.
    for (let index = 0; index < height.length; index += 1) this.runoff[index] = conditions[this.cellIndices[index]!]!.runoff;
    if (drainage) {
      for (const index of drainage.order) {
        const downstream = drainage.downstream[index] ?? -1;
        if (downstream >= 0) this.runoff[downstream] = this.runoff[downstream]! + this.runoff[index]!;
      }
    }

    // Existing floodwater infiltrates and drains between storms instead of retaining a magical
    // high-altitude sheet. Flood depth is measured locally, so recession cannot inherit upstream altitude.
    for (let index = 0; index < floodDepth.length; index += 1) {
      const depth = floodDepth[index]!;
      if (depth <= 0) continue;
      const weather = conditions[this.cellIndices[index]!]!;
      const cell = this.world.cells[this.cellIndices[index]!]!;
      const drying = 0.003 + weather.temperature * 0.005 + Math.max(0, 0.7 - cell.moisture) * 0.004;
      floodDepth[index] = Math.max(0, Math.min(MAX_DYNAMIC_FLOOD_DEPTH, depth * 0.82 - drying));
    }

    for (let index = 0; index < height.length; index += 1) {
      const accumulation = Math.max(1, drainage?.accumulation[index] ?? 1);
      const inflow = this.runoff[index]! / accumulation;
      this.storage[index] = Math.min(1, this.storage[index]! * 0.62 + inflow);
      flow[index] = clamp01(this.baseFlow[index]! + this.storage[index]! * 0.24);

      if (this.baseLevel[index]! < 0 || height[index]! < seaLevel) continue;
      const threshold = this.bankfullThreshold(index);
      const excess = this.storage[index]! - threshold;
      if (excess > 0) this.spillFromChannel(index, excess);
    }

    // Equalise local hydraulic head in a few cheap monthly passes. Each transfer spends water from
    // the donor, so a high mountain stream cannot stamp its absolute altitude across a valley.
    for (let pass = 0; pass < FLOOD_RELAX_PASSES; pass += 1) this.relaxFlood();

    // Compose permanent water, modest channel stage and dynamic floodwater into the canonical
    // visible surface. Consumers that predate this repair still see one coherent waterLevel field.
    waterLevel.set(this.baseLevel);
    for (let index = 0; index < height.length; index += 1) {
      if (height[index]! < seaLevel) continue;
      const base = this.baseLevel[index]!;
      if (base >= 0) {
        const threshold = this.bankfullThreshold(index);
        const stageSignal = Math.max(0, this.storage[index]! - threshold * 0.48);
        const stage = Math.min(0.14, stageSignal * (terrain.lake[index] ? 0.08 : 0.17));
        if (stage > 0) waterLevel[index] = elevationFromY(elevationToY(base, seaLevel) + stage, seaLevel);
      } else if (floodDepth[index]! > FLOOD_PRESENT_DEPTH) {
        waterLevel[index] = elevationFromY(this.sampleGroundY[index]! + floodDepth[index]!, seaLevel);
      }
    }

    for (let index = 0; index < this.world.cells.length; index += 1) {
      const cell = this.world.cells[index]!;
      const weather = conditions[index]!;
      const sample = nearestIndex(terrain, cell.worldX, cell.worldZ);
      const level = waterLevel[sample]!;
      const waterDepth = level < 0 ? 0 : Math.max(0, elevationToY(level, seaLevel) - this.cellGroundY[index]!);
      const dynamicDepth = floodDepth[sample] ?? 0;
      weather.waterDepth = waterDepth;
      weather.floodDepth = this.baseWater[index] || this.baseLevel[sample]! >= 0 ? 0 : dynamicDepth;
      weather.floodState = classifyWaterDepth(Math.max(waterDepth, weather.floodDepth), cell.moisture);
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
      weather.floodRisk = clamp01(this.storage[sample]! * (1 - cell.slope) * 2.1 + dynamicDepth / MAX_DYNAMIC_FLOOD_DEPTH * 0.45);
      cell.water = this.baseWater[index]! || weather.floodDepth > 0.035;
      cell.flow = flow[sample]!;
    }
  }

  /** Major channels and lakes carry more water before overtopping than small tributaries. */
  private bankfullThreshold(index: number): number {
    const drainage = this.world.terrain.drainage;
    const accumulation = Math.max(1, drainage?.accumulation[index] ?? 1);
    const hierarchy = Math.log1p(accumulation) / Math.log1p(this.maximumAccumulation);
    if (this.world.terrain.lake[index]) return 0.48 + hierarchy * 0.08;
    return 0.24 + hierarchy * 0.22;
  }

  /**
   * Convert excess channel wetness into a bounded local volume beside the channel. Only banks that
   * are actually low enough to overtop receive water; no absolute source elevation is propagated.
   */
  private spillFromChannel(index: number, excess: number): void {
    const { terrain, seaLevel } = this.world;
    const { resolution, height, floodDepth } = terrain;
    const base = this.baseLevel[index]!;
    if (base < 0) return;
    const sourceX = index % resolution;
    const sourceZ = Math.floor(index / resolution);
    const accumulation = Math.max(1, terrain.drainage?.accumulation[index] ?? 1);
    const hierarchy = Math.log1p(accumulation) / Math.log1p(this.maximumAccumulation);
    const sourceSurface = elevationToY(base, seaLevel);
    const overtoppingHead = sourceSurface + 0.05 + Math.min(0.26, excess * 0.38);
    let weightTotal = 0;

    for (const [dx, dz] of NEIGHBOURS) {
      const nx = sourceX + dx;
      const nz = sourceZ + dz;
      if (nx < 0 || nz < 0 || nx >= resolution || nz >= resolution) continue;
      const next = nz * resolution + nx;
      if (height[next]! < seaLevel || this.baseLevel[next]! >= 0) continue;
      const headroom = overtoppingHead - this.sampleGroundY[next]!;
      if (headroom <= 0) continue;
      weightTotal += (0.02 + headroom) / Math.hypot(dx, dz);
    }
    if (weightTotal <= 0) return;

    const release = Math.min(0.09, excess * (0.18 + (1 - hierarchy) * 0.08));
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = sourceX + dx;
      const nz = sourceZ + dz;
      if (nx < 0 || nz < 0 || nx >= resolution || nz >= resolution) continue;
      const next = nz * resolution + nx;
      if (height[next]! < seaLevel || this.baseLevel[next]! >= 0) continue;
      const headroom = overtoppingHead - this.sampleGroundY[next]!;
      if (headroom <= 0) continue;
      const weight = (0.02 + headroom) / Math.hypot(dx, dz);
      floodDepth[next] = Math.min(MAX_DYNAMIC_FLOOD_DEPTH, floodDepth[next]! + release * weight / weightTotal);
    }
  }

  /** One conservative relaxation pass over local water depth. */
  private relaxFlood(): void {
    const { terrain, seaLevel } = this.world;
    const { resolution, height, floodDepth } = terrain;
    this.transfer.fill(0);

    for (let index = 0; index < floodDepth.length; index += 1) {
      const depth = floodDepth[index]!;
      if (depth <= FLOOD_PRESENT_DEPTH || height[index]! < seaLevel || this.baseLevel[index]! >= 0) continue;
      const sourceX = index % resolution;
      const sourceZ = Math.floor(index / resolution);
      const sourceHead = this.sampleGroundY[index]! + depth;
      let potential = 0;

      for (const [dx, dz] of NEIGHBOURS) {
        const nx = sourceX + dx;
        const nz = sourceZ + dz;
        if (nx < 0 || nz < 0 || nx >= resolution || nz >= resolution) continue;
        const next = nz * resolution + nx;
        const destinationHead = height[next]! < seaLevel
          ? elevationToY(seaLevel, seaLevel)
          : this.baseLevel[next]! >= 0
            ? elevationToY(this.baseLevel[next]!, seaLevel)
            : this.sampleGroundY[next]! + floodDepth[next]!;
        const drop = (sourceHead - destinationHead) / Math.hypot(dx, dz);
        if (drop > 0.004) potential += drop;
      }
      if (potential <= 0) continue;

      const movable = Math.min(depth * 0.42, potential * 0.08);
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = sourceX + dx;
        const nz = sourceZ + dz;
        if (nx < 0 || nz < 0 || nx >= resolution || nz >= resolution) continue;
        const next = nz * resolution + nx;
        const destinationHead = height[next]! < seaLevel
          ? elevationToY(seaLevel, seaLevel)
          : this.baseLevel[next]! >= 0
            ? elevationToY(this.baseLevel[next]!, seaLevel)
            : this.sampleGroundY[next]! + floodDepth[next]!;
        const drop = (sourceHead - destinationHead) / Math.hypot(dx, dz);
        if (drop <= 0.004) continue;
        const amount = movable * drop / potential;
        this.transfer[index] -= amount;
        // Permanent rivers/lakes and the ocean are drainage sinks, not duplicate flood layers.
        if (height[next]! >= seaLevel && this.baseLevel[next]! < 0) this.transfer[next] += amount;
      }
    }

    for (let index = 0; index < floodDepth.length; index += 1) {
      floodDepth[index] = Math.max(0, Math.min(MAX_DYNAMIC_FLOOD_DEPTH, floodDepth[index]! + this.transfer[index]!));
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
