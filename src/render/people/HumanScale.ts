import { COSMIC_HEIGHT_MULTIPLIER, COSMIC_CROWN_HEIGHT } from './CosmicPeople';

/**
 * Authoritative humanoid world scale. All person geometry, position offsets and
 * `heightScale`/`buildScale` are expressed relative to a canonical adult of height 1; this
 * factor converts that canonical rig into world units so a normal adult reads as clearly
 * smaller than the smallest inhabited structure (huts/shelters) and never approaches an
 * ordinary house. Applying it once, at the top of the scale chain, keeps LOD and camera
 * framing changes from ever altering apparent world-space height.
 */
export const HUMAN_WORLD_SCALE = 0.28;

/** A standing adult's height in world units: the one reference every non-architectural prop (pottery, tools, carried goods) must stay legible against. */
export const CANONICAL_ADULT_HEIGHT = HUMAN_WORLD_SCALE * COSMIC_HEIGHT_MULTIPLIER * COSMIC_CROWN_HEIGHT;

/** Converts a real-world metre measurement (a vessel's throwing height, a tool's length, ...) into world units. */
export const metresToWorld = (metres: number): number => metres * (CANONICAL_ADULT_HEIGHT / 1.75);
