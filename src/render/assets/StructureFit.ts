/**
 * StructureFit.ts
 *
 * The single rule that converts a composed structure into a placed one.
 *
 * Architecture is authored in real dimensions: one grammar unit is six metres, and the archetype
 * lineages, mill drafters and surface programs are all written to that. `HumanScale` independently
 * fixes a standing adult at `CANONICAL_ADULT_HEIGHT` world units. Those two facts together
 * determine the only scale at which a settlement reads correctly against its own inhabitants, and
 * `ARCHITECTURAL_FIT` is that scale.
 *
 * A structure is therefore drawn at its declared size whenever its plot can hold it, and shrunk
 * only when the plot genuinely cannot — never enlarged past true size by a generous plot, and
 * never allowed to overrun its plot onto a neighbour's. The fit is uniform, so proportions survive
 * either way, and a structure that comes out small is reporting a mis-sized plot rather than
 * mis-drawn architecture: `structureFitShortfall` is what says so.
 *
 * Both the finished-building path and the construction path must agree exactly, because a
 * worksite's geometry has to converge on the completed building it is scaffolding. That is why
 * this is one function rather than a formula copied into each.
 */

import { CANONICAL_ADULT_HEIGHT } from '../people/HumanScale';

/** One grammar unit, in metres. Mills draft in metres and divide by this; so does the shell. */
export const GRAMMAR_UNIT_METRES = 6;

/** A standing adult is 1.75 m, so this converts a real measurement into world units. */
export const WORLD_UNITS_PER_METRE = CANONICAL_ADULT_HEIGHT / 1.75;

/** World units per grammar unit: the scale at which architecture is drawn at its true size. */
export const ARCHITECTURAL_FIT = GRAMMAR_UNIT_METRES * WORLD_UNITS_PER_METRE;

export interface StructureFitInputs {
  /** Reserved plot, in world units. */
  plotWidth: number;
  plotDepth: number;
  /** Built mass of the composed asset, in grammar units — not its site extent. */
  massWidth: number;
  massDepth: number;
  /** Development level, where a settlement's earliest structures are built smaller. */
  level?: number;
}

/**
 * Uniform scale from grammar units to world units for one placed structure.
 *
 * Site works — a mill's pond and race, a yard, a forecourt — are excluded from `massWidth`/
 * `massDepth` upstream and so may extend past the plot into its reserved precinct, which is what
 * the precinct is for. Only the building itself has to fit.
 */
export function structureFit(inputs: StructureFitInputs): number {
  const { plotWidth, plotDepth, massWidth, massDepth, level } = inputs;
  const plotFit = Math.min(plotWidth / Math.max(1e-6, massWidth), plotDepth / Math.max(1e-6, massDepth));
  // Early structures are modest because they were built modestly, not because their plot is small.
  const maturity = level === undefined ? 1 : Math.min(1, 0.82 + level * 0.06);
  return Math.min(plotFit, ARCHITECTURAL_FIT) * maturity;
}

/** 0 when a structure is drawn at its true size, rising towards 1 as its plot crowds it. */
export function structureFitShortfall(fit: number): number {
  return Math.max(0, 1 - fit / ARCHITECTURAL_FIT);
}
