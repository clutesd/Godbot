import { COSMIC_CROWN_HEIGHT, COSMIC_HEIGHT_MULTIPLIER } from './CosmicPeople';

/** Canonical rig scale, applied once by the people renderer. */
export const HUMAN_WORLD_SCALE = 0.28;
/** Feet-to-crown height of the canonical adult in settlement world units. */
export const CANONICAL_ADULT_HEIGHT = HUMAN_WORLD_SCALE * COSMIC_HEIGHT_MULTIPLIER * COSMIC_CROWN_HEIGHT;
/** Physical props authored in metres share the scale of a 1.7 m adult. */
export const HUMAN_METRES_TO_WORLD = CANONICAL_ADULT_HEIGHT / 1.7;
