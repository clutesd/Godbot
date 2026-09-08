/**
 * PlacementContract.ts
 * 
 * Hard validation rules for persistent world asset placement.
 * 
 * Every building, route, and infrastructure element must satisfy:
 * - Terrain height constraints (above water, stable ground)
 * - Slope tolerance (per-asset type)
 * - Water proximity (not in deep water, respects shoreline)
 * - Biome suitability (culture-dependent)
 * - Footprint clearance (no overlap with existing structures)
 * 
 * Once placed, structures keep their world positions permanently unless simulation
 * explicitly destroys or rebuilds them.
 */

import type { Biome, WorldState } from '../../sim/types';
import { SeededRandom } from '../../sim/prng';
import type { CultureStyle } from '../../sim/types';
import { TerrainQueries } from './TerrainQueries';

/**
 * Per-asset-type slope tolerance in degrees
 */
export interface SlopeTolerances {
  majorBuilding: number; // Civic/industrial structures, narrower base
  smallBuilding: number; // Houses, workshops, flexible
  infrastructure: number; // Roads, bridges, specialized
  terraced: number; // Deliberately built on slopes
}

export const DEFAULT_SLOPE_TOLERANCES: SlopeTolerances = {
  majorBuilding: 10, // ~17% grade
  smallBuilding: 20, // ~36% grade
  infrastructure: 15, // ~27% grade
  terraced: 35, // ~70% grade (specialized terraced structures only)
};

export type PlacementType = 'major-building' | 'small-building' | 'infrastructure' | 'terraced';

export interface PlacementConstraints {
  type: PlacementType;
  worldX: number;
  worldZ: number;
  footprintRadius: number; // Circular approximation for initial validation
  /** Building-specific slope tolerance override (degrees), or undefined to use default */
  slopeTolerance?: number;
  /** Biomes where this asset can exist, or undefined if no restriction */
  biomeWhitelist?: Biome[];
  /** Minimum elevation above sea level (0.0-1.0) */
  minElevation?: number;
  /** Maximum distance from coast (negative = no coast required) */
  maxDistanceFromCoast?: number;
  /** Can be placed in/around water (e.g., bridges, ports) */
  waterTolerant?: boolean;
  /** Can be placed on river cells */
  riverTolerant?: boolean;
}

export interface PlacementValidation {
  valid: boolean;
  reason?: string;
  terrain: {
    elevation: number;
    slope: number;
    maxSlope: number;
    water: boolean;
    biome: Biome;
    distanceToCoast: number;
    riverNearby: boolean;
  };
}

/**
 * Placement validation engine
 */
export class PlacementContract {
  private readonly terrain: TerrainQueries;
  private readonly slopeTolerances: SlopeTolerances;

  constructor(world: WorldState, tolerances: Partial<SlopeTolerances> = {}) {
    this.terrain = new TerrainQueries(world);
    this.slopeTolerances = {
      ...DEFAULT_SLOPE_TOLERANCES,
      ...tolerances,
    };
  }

  /**
   * Validate placement at given position
   */
  validate(constraints: PlacementConstraints): PlacementValidation {
    const { worldX, worldZ, type, footprintRadius } = constraints;

    // Sample central point and neighbors
    const center = this.terrain.queryTerrainAt(worldX, worldZ);
    if (!center) {
      return {
        valid: false,
        reason: 'Outside world bounds',
        terrain: {
          elevation: 0,
          slope: 0,
          maxSlope: 0,
          water: false,
          biome: 'grassland',
          distanceToCoast: 0,
          riverNearby: false,
        },
      };
    }

    const footprintSamples = this.sampleFootprint(worldX, worldZ, footprintRadius);
    if (footprintSamples.some((sample) => sample === null)) {
      return { valid: false, reason: 'Footprint extends outside world bounds', terrain: center };
    }
    const sampledTerrain = footprintSamples.filter((sample): sample is NonNullable<typeof sample> => sample !== null);

    // A dry origin is not enough: roofs, walls, and precincts must all remain on land.
    const waterSample = sampledTerrain.find((sample) => sample.water && !constraints.waterTolerant && !(constraints.riverTolerant && sample.riverNearby));
    if (waterSample) {
      return {
        valid: false,
        reason: 'Footprint intersects water',
        terrain: waterSample,
      };
    }

    // Check biome whitelist
    if (constraints.biomeWhitelist && !constraints.biomeWhitelist.includes(center.biome)) {
      return {
        valid: false,
        reason: `Biome '${center.biome}' not in whitelist: ${constraints.biomeWhitelist.join(', ')}`,
        terrain: center,
      };
    }

    // Check elevation
    if (constraints.minElevation !== undefined && center.elevation < constraints.minElevation) {
      return {
        valid: false,
        reason: `Elevation ${center.elevation.toFixed(2)} below minimum ${constraints.minElevation}`,
        terrain: center,
      };
    }

    // Check slope tolerance
    const slopeTolerance =
      constraints.slopeTolerance ?? this.slopeTolerances[this.mapTypeToToleranceKey(type)];
    const avgSlope = this.terrain.calculateAverageSlope(worldX, worldZ, footprintRadius);
    const maxSlope = sampledTerrain.reduce((maximum, sample) => Math.max(maximum, sample.maxSlope), 0);

    if (avgSlope > slopeTolerance || maxSlope > slopeTolerance * 1.35) {
      return {
        valid: false,
        reason: `Footprint slope ${avgSlope.toFixed(1)}° average / ${maxSlope.toFixed(1)}° maximum exceeds tolerance ${slopeTolerance}°`,
        terrain: center,
      };
    }

    // Check distance from coast
    if (constraints.maxDistanceFromCoast !== undefined && constraints.maxDistanceFromCoast >= 0) {
      if (center.distanceToCoast > constraints.maxDistanceFromCoast) {
        return {
          valid: false,
          reason: `Distance to coast ${center.distanceToCoast.toFixed(0)} exceeds ${constraints.maxDistanceFromCoast}`,
          terrain: center,
        };
      }
    }

    // Footprint clearance is checked separately by PlacementFootprint after position is committed
    // (to avoid circular dependency with already-placed structures)

    return {
      valid: true,
      terrain: center,
    };
  }

  private sampleFootprint(worldX: number, worldZ: number, radius: number): Array<ReturnType<TerrainQueries['queryTerrainAt']>> {
    const samples: Array<ReturnType<TerrainQueries['queryTerrainAt']>> = [this.terrain.queryTerrainAt(worldX, worldZ)];
    if (radius <= 0) return samples;
    for (const scale of [0.55, 1]) {
      for (let index = 0; index < 12; index += 1) {
        const angle = index / 12 * Math.PI * 2;
        samples.push(this.terrain.queryTerrainAt(worldX + Math.cos(angle) * radius * scale, worldZ + Math.sin(angle) * radius * scale));
      }
    }
    return samples;
  }

  /**
   * Get suitable placement near a target (e.g., settlement center)
   */
  findSuitablePlacementNear(
    targetX: number,
    targetZ: number,
    constraints: Omit<PlacementConstraints, 'worldX' | 'worldZ'>,
    searchRadius: number = 50,
    attempts: number = 16,
    seed: string = 'placement',
  ): { worldX: number; worldZ: number } | null {
    const rng = new SeededRandom(`${seed}:${targetX.toFixed(2)}:${targetZ.toFixed(2)}:${constraints.type}`);

    for (let attempt = 0; attempt < attempts; attempt++) {
      const angle = rng.float() * Math.PI * 2;
      const distance = rng.float() * searchRadius;
      const candidateX = targetX + Math.cos(angle) * distance;
      const candidateZ = targetZ + Math.sin(angle) * distance;

      const result = this.validate({
        ...constraints,
        worldX: candidateX,
        worldZ: candidateZ,
      });

      if (result.valid) {
        return { worldX: candidateX, worldZ: candidateZ };
      }
    }

    return null;
  }

  /**
   * Check if footprint overlaps with existing structures (called by PlacementFootprint)
   */
  checkFootprintClearance(
    worldX: number,
    worldZ: number,
    footprintRadius: number,
    existingFootprints: Array<{ x: number; z: number; radius: number }>,
  ): { clear: boolean; blockingFootprint?: { x: number; z: number; radius: number } } {
    for (const existing of existingFootprints) {
      const distance = Math.hypot(worldX - existing.x, worldZ - existing.z);
      const minSeparation = footprintRadius + existing.radius;

      if (distance < minSeparation) {
        return {
          clear: false,
          blockingFootprint: existing,
        };
      }
    }

    return { clear: true };
  }

  /**
   * Get placement recommendations for a culture/biome combination
   */
  getPlacementRecommendations(
    cultureStyle: CultureStyle,
    biome: Biome,
  ): Partial<PlacementConstraints> {
    void biome;
    // Cultural preferences
    const preferences: Partial<PlacementConstraints> = {};

    // Culture-based biome preferences
    switch (cultureStyle.symbol) {
      case 'river-eye':
        // River cultures prefer coastal and riverine
        preferences.biomeWhitelist = ['grassland', 'forest', 'wetland'];
        preferences.maxDistanceFromCoast = 120;
        preferences.riverTolerant = true;
        break;

      case 'mountain-knot':
        // Mountain cultures handle highland/mountain
        preferences.biomeWhitelist = ['highland', 'grassland', 'mountain'];
        preferences.minElevation = 0.35;
        preferences.slopeTolerance = 15; // Slightly steeper
        break;

      case 'sun-step':
        // Desert/step cultures handle dryland
        preferences.biomeWhitelist = ['dryland', 'grassland'];
        preferences.minElevation = 0.25;
        break;

      case 'woven-moon':
        // Moon cultures (African-inspired) prefer diverse terrain
        preferences.biomeWhitelist = ['grassland', 'forest', 'dryland'];
        break;

      case 'seed-spiral':
        // Agricultural cultures prefer grassland/forest
        preferences.biomeWhitelist = ['grassland', 'forest', 'wetland'];
        preferences.maxDistanceFromCoast = 80;
        break;
    }

    return preferences;
  }

  private mapTypeToToleranceKey(type: PlacementType): keyof SlopeTolerances {
    const mapping: Record<PlacementType, keyof SlopeTolerances> = {
      'major-building': 'majorBuilding',
      'small-building': 'smallBuilding',
      infrastructure: 'infrastructure',
      terraced: 'terraced',
    };
    return mapping[type];
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.terrain.dispose();
  }
}
