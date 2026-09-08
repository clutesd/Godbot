/**
 * TerrainQueries.ts
 * 
 * Enhanced terrain queries for placement validation:
 * - Slope calculation (average, max, per-direction)
 * - Water mask queries (deep water, shallow, coast proximity)
 * - Normal vectors (for visual orientation)
 * - Biome queries with transitions
 * - Elevation gradients
 */

import type { Biome, WorldCell, WorldState } from '../../sim/types';
import { cellAt } from '../../sim/world';
import * as THREE from 'three';

/**
 * Terrain properties queried at a specific world position
 */
export interface TerrainProperties {
  elevation: number;
  slope: number; // Average slope in degrees
  maxSlope: number; // Steepest direction
  water: boolean;
  shallow: boolean; // In water but navigable (ford point)
  biome: Biome;
  distanceToCoast: number; // Negative if coast, positive if inland
  riverNearby: boolean;
  normal: THREE.Vector3; // Surface normal for visual orientation
  moisture: number;
  temperature: number;
}

export class TerrainQueries {
  private readonly world: WorldState;
  private readonly cellCache: Map<string, WorldCell | undefined>;
  private readonly propertiesCache: Map<string, TerrainProperties>;

  constructor(world: WorldState) {
    this.world = world;
    this.cellCache = new Map();
    this.propertiesCache = new Map();
  }

  /**
   * Query terrain properties at world position
   */
  queryTerrainAt(worldX: number, worldZ: number): TerrainProperties | null {
    const cacheKey = `${worldX.toFixed(2)}:${worldZ.toFixed(2)}`;
    if (this.propertiesCache.has(cacheKey)) {
      const cached = this.propertiesCache.get(cacheKey)!;
      const cell = cellAt(this.world, worldX, worldZ);
      if (cell) {
        cached.water = cell.water;
        cached.shallow = cell.water && !this.isDeepWater(cell);
        cached.moisture = cell.moisture;
      }
      return cached;
    }

    const cell = cellAt(this.world, worldX, worldZ);
    if (!cell) return null;

    const properties: TerrainProperties = {
      elevation: cell.elevation,
      slope: this.calculateSlope(cell),
      maxSlope: this.calculateMaxSlope(cell),
      water: cell.water,
      shallow: cell.water && !this.isDeepWater(cell),
      biome: cell.biome,
      distanceToCoast: cell.coast ? -cell.elevation * 100 : this.distanceToCoastFrom(cell),
      riverNearby: this.riverNearby(cell),
      normal: this.calculateNormal(cell),
      moisture: cell.moisture,
      temperature: cell.temperature,
    };

    this.propertiesCache.set(cacheKey, properties);
    return properties;
  }

  /**
   * Calculate average slope at a position (degrees)
   */
  calculateAverageSlope(worldX: number, worldZ: number, radius: number): number {
    const cellSize = this.world.cellSize;
    const stepSize = Math.max(cellSize * 0.5, Math.min(radius / 3, cellSize * 2));

    let slopeSum = 0;
    let sampleCount = 0;

    // Sample in grid pattern within radius
    for (let dx = -radius; dx <= radius; dx += stepSize) {
      for (let dz = -radius; dz <= radius; dz += stepSize) {
        if (Math.sqrt(dx * dx + dz * dz) > radius) continue;

        const cell = cellAt(this.world, worldX + dx, worldZ + dz);
        if (cell && !cell.water) {
          slopeSum += this.calculateSlope(cell);
          sampleCount += 1;
        }
      }
    }

    return sampleCount > 0 ? slopeSum / sampleCount : 0;
  }

  /**
   * Get elevation at world position (interpolated)
   */
  getElevationAt(worldX: number, worldZ: number): number {
    const cell = cellAt(this.world, worldX, worldZ);
    if (!cell) return 0;

    // Simple bilinear interpolation for smoother terrain
    const cellSize = this.world.cellSize;
    const localX = (worldX % cellSize) / cellSize;
    const localZ = (worldZ % cellSize) / cellSize;

    // Sample neighbors
    const c00 = cell;
    const c10 = cellAt(this.world, worldX + cellSize, worldZ);
    const c01 = cellAt(this.world, worldX, worldZ + cellSize);
    const c11 = cellAt(this.world, worldX + cellSize, worldZ + cellSize);

    if (!c10 || !c01 || !c11) return c00.elevation;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const top = lerp(c00.elevation, c10.elevation, localX);
    const bottom = lerp(c01.elevation, c11.elevation, localX);
    return lerp(top, bottom, localZ);
  }

  /**
   * Get water mask (true = water/unsafe, false = buildable)
   */
  getWaterMask(worldX: number, worldZ: number): boolean {
    const cell = cellAt(this.world, worldX, worldZ);
    if (!cell) return true; // Outside bounds = unsafe

    return cell.water && this.isDeepWater(cell);
  }

  /**
   * Calculate surface normal for visual orientation (buildings, terrain)
   */
  calculateNormal(cell: WorldCell): THREE.Vector3 {
    const cellSize = this.world.cellSize;
    const { size } = this.world;

    // Find neighbors for finite differences
    const north = (cell.z > 0 ? this.world.cells[(cell.z - 1) * size + cell.x] : cell) ?? cell;
    const south = (cell.z < size - 1 ? this.world.cells[(cell.z + 1) * size + cell.x] : cell) ?? cell;
    const east = (cell.x < size - 1 ? this.world.cells[cell.z * size + (cell.x + 1)] : cell) ?? cell;
    const west = (cell.x > 0 ? this.world.cells[cell.z * size + (cell.x - 1)] : cell) ?? cell;

    // Finite differences
    const dx = (east.elevation - west.elevation) * cellSize;
    const dz = (south.elevation - north.elevation) * cellSize;

    // Cross product to get normal (dx, dz, cellSize)
    const normal = new THREE.Vector3(-dx, cellSize * 2, -dz);
    return normal.normalize();
  }

  /**
   * True if this cell is deep water (not fordable)
   */
  private isDeepWater(cell: WorldCell): boolean {
    // Water cells with low habitability are too deep for fords
    return cell.water && cell.elevation < 0.05;
  }

  /**
   * Public slope query for tests and debug overlays.
   */
  getCellSlope(cell: WorldCell): number {
    return this.calculateSlope(cell);
  }

  /**
   * Calculate local slope (degrees) between this cell and neighbors
   */
  private calculateSlope(cell: WorldCell): number {
    const { size } = this.world;
    const cellSize = this.world.cellSize;

    let maxSlopeDelta = 0;

    // Check 4 cardinal neighbors
    const neighbors = [
      [cell.x - 1, cell.z, 'west'],
      [cell.x + 1, cell.z, 'east'],
      [cell.x, cell.z - 1, 'north'],
      [cell.x, cell.z + 1, 'south'],
    ];

    for (const [nx, nz] of neighbors) {
      if ((nx as number) >= 0 && (nx as number) < size && (nz as number) >= 0 && (nz as number) < size) {
        const neighbor = this.world.cells[(nz as number) * size + (nx as number)];
        if (!neighbor) continue;
        const elevDiff = Math.abs(cell.elevation - neighbor.elevation);
        const slopeRad = Math.atan2(elevDiff, cellSize);
        const slopeDeg = (slopeRad * 180) / Math.PI;
        maxSlopeDelta = Math.max(maxSlopeDelta, slopeDeg);
      }
    }

    return maxSlopeDelta;
  }

  /**
   * Maximum slope in any direction (steeper metric for placement rejection)
   */
  private calculateMaxSlope(cell: WorldCell): number {
    const { size } = this.world;
    const cellSize = this.world.cellSize;

    let maxSlope = 0;

    // Check 8 directions (including diagonals)
    const offsets = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ];

    for (const [dx = 0, dz = 0] of offsets) {
      const nx = cell.x + dx;
      const nz = cell.z + dz;
      if (nx >= 0 && nx < size && nz >= 0 && nz < size) {
        const neighbor = this.world.cells[nz * size + nx];
        if (!neighbor) continue;
        const elevDiff = Math.abs(cell.elevation - neighbor.elevation);
        const distance = Math.hypot(dx, dz) * cellSize;
        const slopeRad = Math.atan2(elevDiff, distance);
        const slopeDeg = (slopeRad * 180) / Math.PI;
        maxSlope = Math.max(maxSlope, slopeDeg);
      }
    }

    return maxSlope;
  }

  /**
   * Distance to coast (negative if on coast, positive if inland)
   */
  private distanceToCoastFrom(cell: WorldCell): number {
    if (cell.coast) return -1;

    let minDistance = Infinity;
    const searchRadius = 15; // cell grid radius

    for (let dz = -searchRadius; dz <= searchRadius; dz++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const nx = cell.x + dx;
        const nz = cell.z + dz;
        if (nx >= 0 && nx < this.world.size && nz >= 0 && nz < this.world.size) {
          const neighbor = this.world.cells[nz * this.world.size + nx];
          if (!neighbor) continue;
          if (neighbor.coast) {
            minDistance = Math.min(minDistance, Math.hypot(dx, dz) * this.world.cellSize);
          }
        }
      }
    }

    return isFinite(minDistance) ? minDistance : Infinity;
  }

  /**
   * True if river is nearby (within a few cells)
   */
  private riverNearby(cell: WorldCell): boolean {
    if (cell.river) return true;

    const searchRadius = 3;
    for (let dz = -searchRadius; dz <= searchRadius; dz++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const nx = cell.x + dx;
        const nz = cell.z + dz;
        if (nx >= 0 && nx < this.world.size && nz >= 0 && nz < this.world.size) {
          const neighbor = this.world.cells[nz * this.world.size + nx];
          if (!neighbor) continue;
          if (neighbor.river) return true;
        }
      }
    }

    return false;
  }

  /**
   * Clear caches (call after world changes or periodically)
   */
  clearCaches(): void {
    this.cellCache.clear();
    this.propertiesCache.clear();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.clearCaches();
  }
}
