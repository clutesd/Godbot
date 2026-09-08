/**
 * PlacementFootprint.ts
 * 
 * Persistent footprint tracking for all placed world assets.
 * 
 * Once a building, route, or infrastructure is placed:
 * - Its footprint is locked in the placement register
 * - Future placements must respect clearance radius
 * - Footprints persist even if asset is damaged/ruined (archaeological state)
 * - Only simulation-driven destruction removes a footprint
 * 
 * This prevents buildings from drifting, ensures roads don't overlap,
 * and maintains consistent land use across simulation runs.
 */

import type { PlacementContract, PlacementConstraints } from './PlacementContract';
import type { WorldState } from '../../sim/types';

export type FootprintKind = 'building' | 'route' | 'infrastructure' | 'settlement';

export interface Footprint {
  id: string;
  kind: FootprintKind;
  worldX: number;
  worldZ: number;
  radius: number; // Circular approximation
  placedMonth: number;
  entityId: string; // Reference to settlement/route/building/person
  persistent: boolean; // If true, footprint survives asset destruction (ruins, archaeological)
}

/**
 * Register and validate placement footprints
 */
export class PlacementFootprint {
  private readonly footprints: Map<string, Footprint>;
  private readonly contract: PlacementContract;

  constructor(world: WorldState, contract: PlacementContract, seed: string = 'footprints') {
    void world;
    void seed;
    this.contract = contract;
    this.footprints = new Map();
  }

  /**
   * Register a new footprint
   */
  registerFootprint(
    footprint: Omit<Footprint, 'id'>,
  ): { success: boolean; footprintId?: string; reason?: string } {
    const previous = Array.from(this.footprints.values()).find((candidate) => candidate.entityId === footprint.entityId && candidate.kind === footprint.kind);
    if (previous) {
      const unchanged = previous.worldX === footprint.worldX && previous.worldZ === footprint.worldZ && previous.radius === footprint.radius;
      return unchanged
        ? { success: true, footprintId: previous.id }
        : { success: false, reason: `Persistent entity ${footprint.entityId} attempted to drift from its registered footprint` };
    }

    // Building registration cannot bypass terrain validation. This repeats the inexpensive
    // check intentionally so every public registration path preserves the contract.
    if (footprint.kind === 'building' || footprint.kind === 'settlement') {
      const validation = this.contract.validate({
        type: footprint.kind === 'settlement' ? 'major-building' : 'small-building',
        worldX: footprint.worldX,
        worldZ: footprint.worldZ,
        footprintRadius: footprint.radius,
      });
      if (!validation.valid) return { success: false, reason: validation.reason };
    }

    // Verify clearance
    const existing = Array.from(this.footprints.values());
    const clearance = this.contract.checkFootprintClearance(
      footprint.worldX,
      footprint.worldZ,
      footprint.radius,
      existing.map(f => ({ x: f.worldX, z: f.worldZ, radius: f.radius })),
    );

    if (!clearance.clear) {
      return {
        success: false,
        reason: `Footprint overlaps with existing structure at (${clearance.blockingFootprint?.x.toFixed(0)}, ${clearance.blockingFootprint?.z.toFixed(0)})`,
      };
    }

    // Entity-derived IDs stay stable if a visual group is rebuilt or cache order changes.
    const footprintId = `footprint-${stableHash(`${footprint.kind}:${footprint.entityId}`).toString(36)}`;
    const newFootprint: Footprint = {
      ...footprint,
      id: footprintId,
    };

    this.footprints.set(footprintId, newFootprint);
    return {
      success: true,
      footprintId,
    };
  }

  /**
   * Move an existing footprint (only during rebuild, not drift)
   */
  moveFootprint(
    footprintId: string,
    newWorldX: number,
    newWorldZ: number,
  ): { success: boolean; reason?: string } {
    const footprint = this.footprints.get(footprintId);
    if (!footprint) {
      return { success: false, reason: 'Footprint not found' };
    }
    if (footprint.persistent) return { success: false, reason: 'Persistent footprints cannot move; rebuild with the same entity ID and footprint' };

    // Check new clearance (excluding self)
    const otherFootprints = Array.from(this.footprints.values()).filter(f => f.id !== footprintId);
    const clearance = this.contract.checkFootprintClearance(
      newWorldX,
      newWorldZ,
      footprint.radius,
      otherFootprints.map(f => ({ x: f.worldX, z: f.worldZ, radius: f.radius })),
    );

    if (!clearance.clear) {
      return {
        success: false,
        reason: 'New position conflicts with existing footprint',
      };
    }

    footprint.worldX = newWorldX;
    footprint.worldZ = newWorldZ;
    return { success: true };
  }

  /**
   * Remove footprint (only when asset is destroyed)
   */
  removeFootprint(footprintId: string): boolean {
    return this.footprints.delete(footprintId);
  }

  /**
   * Remove footprints for an entity (settlement, route, etc.)
   */
  removeFootprintsForEntity(entityId: string): number {
    let removed = 0;
    for (const [id, footprint] of Array.from(this.footprints.entries())) {
      if (footprint.entityId === entityId) {
        this.footprints.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get footprints for a specific entity
   */
  getFootprintsForEntity(entityId: string): Footprint[] {
    return Array.from(this.footprints.values()).filter(f => f.entityId === entityId);
  }

  /**
   * Get all footprints of a specific kind
   */
  getFootprintsByKind(kind: FootprintKind): Footprint[] {
    return Array.from(this.footprints.values()).filter(f => f.kind === kind);
  }

  /**
   * Get footprint by ID
   */
  getFootprint(footprintId: string): Footprint | undefined {
    return this.footprints.get(footprintId);
  }

  /**
   * Get all footprints (for debugging, visualization)
   */
  getAllFootprints(): Footprint[] {
    return Array.from(this.footprints.values());
  }

  /**
   * Check if a specific area is clear for placement
   */
  isAreaClear(
    worldX: number,
    worldZ: number,
    radius: number,
  ): { clear: boolean; blockingId?: string } {
    const existing = Array.from(this.footprints.values());
    const clearance = this.contract.checkFootprintClearance(worldX, worldZ, radius, existing.map(f => ({ x: f.worldX, z: f.worldZ, radius: f.radius })));

    if (!clearance.clear) {
      // Find which footprint is blocking
      for (const f of existing) {
        const distance = Math.hypot(worldX - f.worldX, worldZ - f.worldZ);
        if (distance < radius + f.radius) {
          return { clear: false, blockingId: f.id };
        }
      }
    }

    return { clear: true };
  }

  /**
   * Validate and register placement in one operation
   */
  validateAndRegister(
    constraints: PlacementConstraints,
    footprintData: Omit<Footprint, 'id' | 'worldX' | 'worldZ'>,
  ): {
    success: boolean;
    footprintId?: string;
    validationReason?: string;
    footprintReason?: string;
  } {
    // First validate terrain
    const validation = this.contract.validate(constraints);
    if (!validation.valid) {
      return {
        success: false,
        validationReason: validation.reason,
      };
    }

    // Then check clearance and register
    const footprintResult = this.registerFootprint({
      ...footprintData,
      worldX: constraints.worldX,
      worldZ: constraints.worldZ,
    });

    if (!footprintResult.success) {
      return {
        success: false,
        footprintReason: footprintResult.reason,
      };
    }

    return {
      success: true,
      footprintId: footprintResult.footprintId,
    };
  }

  /**
   * Get statistics for debugging
   */
  getStats(): {
    totalFootprints: number;
    byKind: Record<FootprintKind, number>;
    persistentCount: number;
    temporaryCount: number;
  } {
    const byKind: Record<FootprintKind, number> = {
      building: 0,
      route: 0,
      infrastructure: 0,
      settlement: 0,
    };

    let persistentCount = 0;
    let temporaryCount = 0;

    for (const footprint of this.footprints.values()) {
      byKind[footprint.kind]++;
      if (footprint.persistent) {
        persistentCount++;
      } else {
        temporaryCount++;
      }
    }

    return {
      totalFootprints: this.footprints.size,
      byKind,
      persistentCount,
      temporaryCount,
    };
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.footprints.clear();
  }
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
