/**
 * StructureGrounding.ts
 *
 * Footprint-wide grounding authority for structures and their construction sites.
 *
 * A structure is grounded against the terrain under its whole reserved plot, not the height at
 * its centre. The base sits on the highest ground under the plot so no corner is buried; any
 * downhill gap is closed by a foundation skirt. Finished buildings and construction sites both
 * ask this module, so the first frame of a worksite lands exactly where the completed structure
 * will stand.
 *
 * Pure and deterministic: no Three.js, no renderer state.
 */

export type HeightSampler = (worldX: number, worldZ: number) => number;

/** How far a foundation skirt is driven below the lowest ground, so no sliver of daylight shows. */
export const GROUNDING_SINK = 0.06;

/** Below this relief the ground is effectively level and a skirt would be invisible noise. */
export const MIN_SKIRT_RELIEF = 0.04;

export interface FootprintGroundSurvey {
  /** Lowest ground under the plot. */
  min: number;
  /** Highest ground under the plot. */
  max: number;
  /** Mean ground under the plot. */
  mean: number;
  /** True when any sampled point is water: the structure meets the sea or a river here. */
  waterContact: boolean;
}

export interface StructureGrounding {
  /** World height of the structure's base: the highest ground under the plot. */
  baseY: number;
  /** Height difference across the plot that the foundation must bridge. */
  relief: number;
  /** Whether a foundation skirt should close the downhill gap. Water contact suppresses it. */
  skirt: boolean;
  /** World height the skirt descends to (lowest ground, sunk slightly). */
  skirtBottomY: number;
}

export interface ReservedGround {
  x: number;
  z: number;
  radius: number;
}

/**
 * Samples the terrain over a rotated rectangle centred on (centerX, centerZ). The grid includes
 * the corners and edge midpoints, so a slope crossing the plot is always seen.
 * Local +X/+Z follow the renderer's Y-rotation convention (three.js rotation.y).
 */
export function surveyFootprintGround(
  heightAt: HeightSampler,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  rotationY = 0,
  isWater?: (worldX: number, worldZ: number) => boolean,
  divisions = 8,
): FootprintGroundSurvey {
  const cos = Math.cos(rotationY), sin = Math.sin(rotationY);
  const halfWidth = Math.max(0, width) / 2, halfDepth = Math.max(0, depth) / 2;
  let min = Infinity, max = -Infinity, sum = 0, count = 0, waterContact = false;
  for (let i = 0; i <= divisions; i += 1) {
    const u = -halfWidth + (2 * halfWidth * i) / divisions;
    for (let j = 0; j <= divisions; j += 1) {
      const v = -halfDepth + (2 * halfDepth * j) / divisions;
      const worldX = centerX + u * cos + v * sin;
      const worldZ = centerZ - u * sin + v * cos;
      const height = heightAt(worldX, worldZ);
      if (!Number.isFinite(height)) continue;
      min = Math.min(min, height);
      max = Math.max(max, height);
      sum += height;
      count += 1;
      if (isWater?.(worldX, worldZ)) waterContact = true;
    }
  }
  if (count === 0) {
    const fallback = heightAt(centerX, centerZ);
    return { min: fallback, max: fallback, mean: fallback, waterContact };
  }
  return { min, max, mean: sum / count, waterContact };
}

/** Turns a footprint survey into the single grounding decision used by every renderer path. */
export function groundStructure(survey: FootprintGroundSurvey): StructureGrounding {
  const relief = survey.max - survey.min;
  return {
    baseY: survey.max,
    relief,
    skirt: relief > MIN_SKIRT_RELIEF && !survey.waterContact,
    skirtBottomY: survey.min - GROUNDING_SINK,
  };
}

/**
 * True when a point of radius `radius` falls inside any reserved zone (plot, worksite, farm,
 * monument). Used to keep decorative clutter out of ground that a structure owns.
 */
export function isInsideReservedGround(worldX: number, worldZ: number, radius: number, zones: readonly ReservedGround[]): boolean {
  for (const zone of zones) {
    if (Math.hypot(worldX - zone.x, worldZ - zone.z) < zone.radius + radius) return true;
  }
  return false;
}
