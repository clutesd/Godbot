import type { GodboxConfig } from '../config';
import { SeededRandom } from './prng';
import { computeRockiness, synthesizeHeightfield } from './terrain/Heightfield';
import { carveChannels, computeHydrology, enforceChannelDescent, type Hydrology } from './terrain/Hydrology';
import { detectLandmarks } from './terrain/Landmarks';
import type { TerrainField } from './terrain/TerrainField';
import { fbm } from './terrain/noise';
import type { Biome, Landform, WorldCell, WorldState } from './types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Field samples per simulation cell edge. Three is enough to hide the logical grid entirely. */
export const TERRAIN_SUBDIVISION = 3;
/** World units of relief across the full 0..1 elevation range. */
export const TERRAIN_VERTICAL_SCALE = 17.5;

const read = (values: Float32Array, index: number): number => values[index] ?? 0;

function biomeFor(cell: Omit<WorldCell, 'biome'>, mountainLevel: number): Biome {
  if (cell.water) return 'water';
  if (cell.elevation > mountainLevel) return 'mountain';
  if (cell.elevation > mountainLevel - 0.11) return 'highland';
  if (cell.moisture > 0.7 && cell.elevation < 0.48) return 'wetland';
  if (cell.moisture > 0.57) return 'forest';
  if (cell.moisture < 0.29) return 'dryland';
  return 'grassland';
}

function landformFor(elevation: number, slope: number, relief: number, flow: number, seaLevel: number, mountainLevel: number): Landform {
  if (elevation < seaLevel) return 'ocean';
  if (elevation < seaLevel + 0.03) return 'shore';
  if (elevation > mountainLevel + 0.06 && slope > 0.34) return 'peak';
  if (elevation > mountainLevel - 0.04) return slope > 0.3 ? 'ridge' : 'plateau';
  if (relief > 0.15 && slope > 0.42) return 'canyon';
  if (slope < 0.09 && relief < 0.05 && elevation > seaLevel + 0.12) return 'plateau';
  if (flow > 0.45 && relief > 0.045) return 'valley';
  if (slope > 0.2) return 'hill';
  if (relief < 0.04) return 'basin';
  return 'lowland';
}

interface CellSample {
  elevation: number;
  slope: number;
  relief: number;
  flow: number;
  rockiness: number;
  lake: boolean;
  river: boolean;
}

/** Reduces the high-resolution field back onto a simulation cell, keeping the extremes visible. */
function sampleCell(
  field: { resolution: number; height: Float32Array },
  hydrology: Hydrology,
  rock: Float32Array,
  step: number,
  fieldX: number,
  fieldZ: number,
): CellSample {
  const { resolution, height } = field;
  const index = fieldZ * resolution + fieldX;
  const radius = TERRAIN_SUBDIVISION;
  let lowest = 1;
  let highest = 0;
  for (let dz = -radius; dz <= radius; dz += 1) {
    const nz = Math.min(resolution - 1, Math.max(0, fieldZ + dz));
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = Math.min(resolution - 1, Math.max(0, fieldX + dx));
      const value = read(height, nz * resolution + nx);
      lowest = Math.min(lowest, value);
      highest = Math.max(highest, value);
    }
  }
  // Water is sampled tightly: a channel one sample wide should not flood the whole cell.
  let lake = false;
  let river = false;
  let flow = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    const nz = Math.min(resolution - 1, Math.max(0, fieldZ + dz));
    for (let dx = -1; dx <= 1; dx += 1) {
      const neighbour = nz * resolution + Math.min(resolution - 1, Math.max(0, fieldX + dx));
      if (hydrology.lake[neighbour]) lake = true;
      if (hydrology.river[neighbour]) river = true;
      flow = Math.max(flow, read(hydrology.flow, neighbour));
    }
  }
  const east = read(height, fieldZ * resolution + Math.min(resolution - 1, fieldX + 1));
  const west = read(height, fieldZ * resolution + Math.max(0, fieldX - 1));
  const south = read(height, Math.min(resolution - 1, fieldZ + 1) * resolution + fieldX);
  const north = read(height, Math.max(0, fieldZ - 1) * resolution + fieldX);
  const gradient = Math.hypot((east - west) * TERRAIN_VERTICAL_SCALE, (south - north) * TERRAIN_VERTICAL_SCALE) / (2 * step);
  return {
    elevation: read(height, index),
    slope: clamp01(gradient * 0.6),
    relief: highest - lowest,
    flow,
    rockiness: read(rock, index),
    lake,
    river,
  };
}

export function generateWorld(config: GodboxConfig, random = new SeededRandom(`${config.seed}:world`)): WorldState {
  const { size, cellSize, seaLevel, mountainLevel, noiseScale, resourceAbundance, climateVariability } = config.world;
  const offsetX = random.range(-200, 200);
  const offsetZ = random.range(-200, 200);

  const raw = synthesizeHeightfield({
    seed: config.seed,
    size,
    cellSize,
    subdivision: TERRAIN_SUBDIVISION,
    noiseScale,
    seaLevel,
    mountainLevel,
    offsetX,
    offsetZ,
  });

  const riverThreshold = Math.max(24, Math.round(raw.height.length * 0.0034));
  const hydrologyOptions = { seaLevel, verticalScale: TERRAIN_VERTICAL_SCALE, riverThreshold };
  carveChannels(raw, computeHydrology(raw, hydrologyOptions), seaLevel);
  enforceChannelDescent(raw, computeHydrology(raw, hydrologyOptions));
  const hydrology = computeHydrology(raw, hydrologyOptions);
  const rock = computeRockiness(config.seed, raw, mountainLevel, TERRAIN_VERTICAL_SCALE);

  const terrain: TerrainField = {
    resolution: raw.resolution,
    step: raw.step,
    originX: raw.originX,
    originZ: raw.originZ,
    height: raw.height,
    waterLevel: hydrology.waterLevel,
    floodDepth: new Float32Array(raw.height.length),
    flow: hydrology.flow,
    rock,
    lake: hydrology.lake,
    river: hydrology.river,
    fall: hydrology.fall,
    drainage: { downstream: hydrology.downstream, order: hydrology.order, accumulation: hydrology.accumulation },
  };

  const cells: WorldCell[] = [];
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const fieldX = Math.min(raw.resolution - 1, x * TERRAIN_SUBDIVISION);
      const fieldZ = Math.min(raw.resolution - 1, z * TERRAIN_SUBDIVISION);
      const sample = sampleCell(raw, hydrology, rock, raw.step, fieldX, fieldZ);
      const nx = x * noiseScale + offsetX;
      const nz = z * noiseScale + offsetZ;
      const elevation = sample.elevation;
      const latitude = Math.abs(z / (size - 1) - 0.5) * 2;
      const temperatureNoise = fbm(`${config.seed}:temperature`, nx * 0.54, nz * 0.54, 3);
      const temperature = clamp01(0.83 - latitude * 0.48 - elevation * 0.3 + (temperatureNoise - 0.5) * climateVariability * 0.5);

      // Moisture follows the land: rivers and lakes water their surroundings, and steep high
      // ground sheds its rain, which is what gives biome transitions a geographic reason.
      const moistureNoise = fbm(`${config.seed}:moisture`, nx * 0.82 + 91, nz * 0.82 - 43);
      const rainShadow = clamp01((elevation - (mountainLevel - 0.2)) * 2.4) * clamp01(sample.slope * 1.4);
      const hydration = sample.river || sample.lake ? 0.16 : clamp01(sample.flow) * 0.1;
      const moisture = clamp01(moistureNoise * 0.92 + (1 - elevation) * 0.12 + hydration - rainShadow * 0.24 - 0.05);

      const river = sample.river && elevation > seaLevel;
      const lake = sample.lake;
      const water = elevation < seaLevel || lake || river;
      const temperate = 1 - Math.abs(temperature - 0.58) * 1.55;
      const flatness = 1 - clamp01(sample.slope * 1.6);
      // Floodplain bonus: the land a river waters is where agriculture actually happens.
      const floodplain = 1 + clamp01((sample.flow - 0.3) / 0.7) * 0.34;
      const fertility = water ? 0 : clamp01((moisture * 0.5 + temperate * 0.32 + flatness * 0.24) * floodplain);
      const wood = water ? 0 : clamp01((moisture * 0.78 + temperature * 0.17 - Math.max(0, elevation - 0.65) - sample.rockiness * 0.3) * resourceAbundance);
      const mineralNoise = fbm(`${config.seed}:mineral`, nx * 2.3 - 17, nz * 2.3 + 27, 3);
      const minerals = water ? 0 : clamp01((mineralNoise * 0.5 + elevation * 0.52 + sample.rockiness * 0.3 - 0.28) * resourceAbundance);
      const habitability = water ? 0 : clamp01(fertility * 0.48 + moisture * 0.12 + temperate * 0.22 + flatness * 0.18 - sample.relief * 0.5);
      const movementCost = water
        ? 3.8
        : 0.75 + elevation * 1.15 + sample.slope * 2.6 + (moisture > 0.7 ? 0.45 : 0) + (elevation > mountainLevel ? 1.5 : 0);

      const base = {
        x,
        z,
        worldX: (x - size / 2) * cellSize,
        worldZ: (z - size / 2) * cellSize,
        elevation,
        moisture,
        temperature,
        fertility,
        wood,
        minerals,
        habitability,
        movementCost,
        water,
        coast: false,
        river,
        lake,
        slope: sample.slope,
        relief: sample.relief,
        flow: sample.flow,
        rockiness: sample.rockiness,
        landform: landformFor(elevation, sample.slope, sample.relief, sample.flow, seaLevel, mountainLevel),
      };
      cells.push({ ...base, biome: biomeFor(base, mountainLevel) });
    }
  }

  const neighborOffsets = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  for (const cell of cells) {
    if (cell.water) continue;
    cell.coast = neighborOffsets.some(([dx, dz]) => {
      const nx = cell.x + dx;
      const nz = cell.z + dz;
      const neighbour = nx >= 0 && nx < size && nz >= 0 && nz < size ? cells[nz * size + nx] : undefined;
      return Boolean(neighbour) && Boolean(neighbour?.water) && !neighbour?.river;
    });
    if (cell.coast) {
      cell.fertility = clamp01(cell.fertility + 0.08);
      cell.habitability = clamp01(cell.habitability + 0.1);
    }
  }

  const landmarks = detectLandmarks(raw, hydrology, { seaLevel, mountainLevel, verticalScale: TERRAIN_VERTICAL_SCALE });
  return { size, cellSize, cells, terrain, landmarks, seaLevel, mountainLevel };
}

export function cellAt(world: WorldState, x: number, z: number): WorldCell | undefined {
  const gridX = Math.round(x / world.cellSize + world.size / 2);
  const gridZ = Math.round(z / world.cellSize + world.size / 2);
  if (gridX < 0 || gridX >= world.size || gridZ < 0 || gridZ >= world.size) return undefined;
  return world.cells[gridZ * world.size + gridX];
}

/**
 * Settlement sites read the landscape, not just a habitability score: flat ground, fresh water,
 * a harbour or a famous landmark are all reasons a town ends up where it does.
 */
export function strategicSettlementCells(world: WorldState, count: number, random: SeededRandom): WorldCell[] {
  const landmarkBonus = (cell: WorldCell): number => {
    let best = 0;
    const reach = world.cellSize * 6;
    for (const landmark of world.landmarks) {
      const distance = Math.hypot(cell.worldX - landmark.worldX, cell.worldZ - landmark.worldZ);
      if (distance < reach) best = Math.max(best, (1 - distance / reach) * landmark.prominence * 0.22);
    }
    return best;
  };
  const landformBonus: Record<WorldCell['landform'], number> = {
    ocean: -1,
    shore: 0.05,
    lowland: 0.12,
    basin: 0.14,
    valley: 0.16,
    hill: 0.04,
    plateau: 0.06,
    ridge: -0.2,
    peak: -0.4,
    canyon: -0.3,
  };
  const candidates = world.cells
    .filter((cell) => !cell.water && cell.habitability > 0.38 && cell.slope < 0.28 && cell.elevation < 0.78)
    .map((cell) => ({
      cell,
      score:
        cell.habitability +
        cell.fertility * 0.4 +
        (cell.coast ? 0.1 : 0) +
        (cell.flow > 0.4 ? 0.18 : 0) +
        landformBonus[cell.landform] +
        landmarkBonus(cell) +
        random.range(0, 0.16),
    }))
    .sort((a, b) => b.score - a.score);
  const selected: WorldCell[] = [];
  const initialDistance = world.size * world.cellSize * 0.17;
  for (let distance = initialDistance; distance >= world.cellSize * 3 && selected.length < count; distance *= 0.82) {
    for (const { cell } of candidates) {
      if (selected.length >= count) break;
      if (selected.every((other) => Math.hypot(cell.worldX - other.worldX, cell.worldZ - other.worldZ) >= distance)) {
        selected.push(cell);
      }
    }
  }
  return selected.slice(0, count);
}
