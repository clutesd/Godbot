import type { BuildingSpec } from '../architecture/BuildingSpec';
import type { DevelopmentResponse, StructureMaterial } from '../../sim/development/types';
import type { Settlement } from '../../sim/types';
import type { Era } from '../materials/MaterialPalette';
import { BUILD_STAGE, type BuildStage } from '../assets/BuildingComposer';
import { developmentBuildingRole, developmentPresentationEra, type BuildingRole } from '../assets/BuildingGrammar';

/**
 * Active projects rebuild only when one of these presentation thresholds is crossed.
 * The same thresholds drive geometry, worksite dressing and the heavy-render signature.
 */
export const CONSTRUCTION_STAGE_THRESHOLDS = {
  /** Footings begin once the ground is cleared and set out. */
  foundation: 0.06,
  frame: 0.2,
  walls: 0.45,
  roof: 0.7,
  /** Flues, stacks and services, run once the shell is weathertight. */
  utilities: 0.86,
  /** Joinery, glazing and working equipment, fitted into a closed shell. */
  fitout: 0.91,
  // Reserve the final 5% of paid work for ornament, frontage and yard detail, with scaffold
  // stripping beginning at the same point. `detail` is retained as the name of that boundary
  // because the renderer's completed-building stage is still called DETAIL.
  detail: 0.95,
  finishing: 0.95,
} as const;

/**
 * Single presentation authority for construction progress.
 * A live DevelopmentProject is authoritative; settlement.constructionProgress is retained only
 * as a compatibility mirror for legacy/founding states that have no active project object.
 */
export function constructionPresentationProgress(settlement: Settlement): number {
  const progress = settlement.development?.project?.progress ?? settlement.constructionProgress;
  return Math.max(0, Math.min(1, progress));
}

export interface ConstructionStagePresentation {
  stage: BuildStage;
  previousStage?: BuildStage;
  /** 0..1 reveal amount within the current canonical stage. */
  phase: number;
  /** Late-stage scaffold stripping / cleanup state. */
  finishing: boolean;
}

/** Map paid simulation progress onto the canonical procedural building lifecycle. */
export function constructionBuildStage(progress: number): BuildStage {
  return constructionStagePresentation(progress).stage;
}

/**
 * Continuous presentation state inside the canonical stages. Simulation progress remains the only
 * authority; this merely converts it into a staged reveal amount for rendering.
 */
/**
 * The construction lifecycle as an ordered table of (stage, the paid progress it begins at).
 *
 * One table drives stage selection, the reveal phase inside a stage, and the previous stage, so
 * the eight stages cannot drift out of step with each other the way parallel branches would.
 */
const STAGE_TABLE: readonly { stage: BuildStage; start: number }[] = [
  { stage: BUILD_STAGE.SITE, start: 0 },
  { stage: BUILD_STAGE.FOUNDATION, start: CONSTRUCTION_STAGE_THRESHOLDS.foundation },
  { stage: BUILD_STAGE.FRAME, start: CONSTRUCTION_STAGE_THRESHOLDS.frame },
  { stage: BUILD_STAGE.WALLS, start: CONSTRUCTION_STAGE_THRESHOLDS.walls },
  { stage: BUILD_STAGE.ROOF, start: CONSTRUCTION_STAGE_THRESHOLDS.roof },
  { stage: BUILD_STAGE.UTILITIES, start: CONSTRUCTION_STAGE_THRESHOLDS.utilities },
  { stage: BUILD_STAGE.FITOUT, start: CONSTRUCTION_STAGE_THRESHOLDS.fitout },
  { stage: BUILD_STAGE.FINISH, start: CONSTRUCTION_STAGE_THRESHOLDS.detail },
];

/** Every construction stage in physical build order. */
export const CONSTRUCTION_STAGE_SEQUENCE: readonly BuildStage[] = STAGE_TABLE.map(entry => entry.stage);

export function constructionStagePresentation(progress: number): ConstructionStagePresentation {
  const paid = Math.max(0, Math.min(1, progress));

  let index = 0;
  for (let candidate = STAGE_TABLE.length - 1; candidate >= 0; candidate -= 1) {
    if (paid >= STAGE_TABLE[candidate]!.start) { index = candidate; break; }
  }
  const entry = STAGE_TABLE[index]!;
  const start = entry.start;
  const end = index + 1 < STAGE_TABLE.length ? STAGE_TABLE[index + 1]!.start : 1;

  const phase = (paid - start) / Math.max(1e-6, end - start);
  return {
    stage: entry.stage,
    previousStage: index > 0 ? STAGE_TABLE[index - 1]!.stage : undefined,
    phase: Math.max(0, Math.min(1, phase)),
    finishing: paid >= CONSTRUCTION_STAGE_THRESHOLDS.finishing && paid < 1,
  };
}

/**
 * Reveal slices inside each construction stage.
 *
 * Total cache buckets are (stages x slices), and each bucket boundary is one geometry rebuild for
 * every building under construction. Going from five stages to eight therefore has to come with
 * fewer slices each, or the finer lifecycle would silently cost ~60% more rebuilds across a
 * build: eight stages at three slices is twenty-four buckets, close to the twenty this had
 * before, so the added physical fidelity is free in rebuild terms.
 */
const STAGE_REVEAL_SLICES = 3;

/**
 * Stable cache bucket for active construction. A handful of reveal slices per canonical stage
 * preserve readable growth without rebuilding a settlement for every microscopic simulation tick.
 */
export function constructionPresentationBucket(progress: number): number {
  const paid = Math.max(0, Math.min(1, progress));
  if (paid <= 0) return 0;
  const presentation = constructionStagePresentation(paid);
  // Small epsilon keeps exact slice boundaries stable despite binary floating-point
  // representation (e.g. phase 0.3333 landing just under rather than just over a third).
  const revealSlice = Math.min(
    STAGE_REVEAL_SLICES - 1,
    Math.floor(presentation.phase * STAGE_REVEAL_SLICES + 1e-9),
  );
  return 1 + presentation.stage * STAGE_REVEAL_SLICES + revealSlice;
}

/**
 * During an upgrade/repurpose the active project, not the old plot fabric, defines the future
 * structure being built. This keeps the construction silhouette continuous with completion.
 */
export function constructionTargetIdentity(
  project: DevelopmentResponse | undefined,
  fallbackRole: BuildingRole,
  fallbackEra: Era,
): { role: BuildingRole; era: Era } {
  return project
    ? { role: developmentBuildingRole(project), era: developmentPresentationEra(project) }
    : { role: fallbackRole, era: fallbackEra };
}

/**
 * Construction technology follows the society instead of every era using the same timber cage.
 * Timber remains believable for early work; industrial heavy structures and advanced societies
 * use metal access frames without changing what the finished structure is made from.
 */
export function constructionScaffoldSurface(
  era: Era,
  role: BuildingRole,
  material?: StructureMaterial,
  spec?: BuildingSpec,
): 'timber' | 'metal' {
  if (era === 'advanced') return 'metal';
  if (era !== 'industrial') return 'timber';
  if (spec) return ['steel-industrial-frame', 'reinforced-concrete', 'curtain-wall-frame'].includes(spec.family) ? 'metal' : 'timber';
  // Compatibility fixtures and non-building memorial access only. Production shells supply spec.
  if (material === 'metal') return 'metal';
  return ['factory', 'foundry', 'warehouse', 'research', 'energy', 'gate-tower'].includes(role)
    ? 'metal'
    : 'timber';
}
