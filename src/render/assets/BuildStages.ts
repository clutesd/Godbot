/**
 * BuildStages.ts
 *
 * The construction lifecycle, on its own so that anything may depend on it.
 *
 * These constants were originally declared in BuildingComposer, which meant every module that
 * needed to know "is this part built yet?" had to import the composer — and the composer cannot
 * import them back. Keeping them here lets the geometry modules the composer *calls* reference
 * stages without a cycle. BuildingComposer re-exports them, so existing imports are unaffected.
 */

/**
 * Construction lifecycle. Parts are emitted only once their stage has been reached.
 *
 * The sequence is the physical order of building work, which is what makes a site legible from
 * across a valley: ground is cleared and set out, footings go in, the frame or the first courses
 * rise, the envelope closes, the roof goes on, flues and services are run, joinery and equipment
 * are fitted, and only then does anything decorative appear.
 *
 * `DETAIL` is retained as an alias for the finished state so the many existing call sites that
 * mean "only on a completed building" keep meaning exactly that.
 */
export const BUILD_STAGE = {
  /** Site preparation: setting-out stakes, cleared ground, spoil and material stacks. */
  SITE: 0,
  FOUNDATION: 1,
  FRAME: 2,
  WALLS: 3,
  ROOF: 4,
  /** Flues, stacks, vents, water and power — run once the shell can carry them. */
  UTILITIES: 5,
  /** Joinery, doors, glazing and working equipment, fitted into a weathertight shell. */
  FITOUT: 6,
  /** Ornament, banners, lanterns, yard dressing: the last few per cent of the work. */
  FINISH: 7,
  /** Legacy alias for a fully built structure. */
  DETAIL: 7,
} as const;

export type BuildStage = (typeof BUILD_STAGE)[keyof typeof BUILD_STAGE];

export const BUILD_STAGE_ORDER: readonly string[] = [
  'site',
  'foundation',
  'frame',
  'partial-walls',
  'roof',
  'utilities',
  'fit-out',
  'complete',
];

export function stageFromName(name: string | undefined): BuildStage {
  const index = name ? BUILD_STAGE_ORDER.indexOf(name) : -1;
  return (index < 0 ? BUILD_STAGE.DETAIL : index) as BuildStage;
}
