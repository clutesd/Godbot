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
  frame: 0.2,
  walls: 0.45,
  roof: 0.78,
  // Reserve the final 8% of paid work for doors, trim, glow, ornament, frontage and yard detail.
  // Cleanup/scaffold stripping begins shortly after, at 95%, while this stage continues revealing.
  detail: 0.92,
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
export function constructionStagePresentation(progress: number): ConstructionStagePresentation {
  const paid = Math.max(0, Math.min(1, progress));
  let stage: BuildStage;
  let previousStage: BuildStage | undefined;
  let start = 0;
  let end = CONSTRUCTION_STAGE_THRESHOLDS.frame;

  if (paid >= CONSTRUCTION_STAGE_THRESHOLDS.detail) {
    stage = BUILD_STAGE.DETAIL;
    previousStage = BUILD_STAGE.ROOF;
    start = CONSTRUCTION_STAGE_THRESHOLDS.detail;
    end = 1;
  } else if (paid >= CONSTRUCTION_STAGE_THRESHOLDS.roof) {
    stage = BUILD_STAGE.ROOF;
    previousStage = BUILD_STAGE.WALLS;
    start = CONSTRUCTION_STAGE_THRESHOLDS.roof;
    end = CONSTRUCTION_STAGE_THRESHOLDS.detail;
  } else if (paid >= CONSTRUCTION_STAGE_THRESHOLDS.walls) {
    stage = BUILD_STAGE.WALLS;
    previousStage = BUILD_STAGE.FRAME;
    start = CONSTRUCTION_STAGE_THRESHOLDS.walls;
    end = CONSTRUCTION_STAGE_THRESHOLDS.roof;
  } else if (paid >= CONSTRUCTION_STAGE_THRESHOLDS.frame) {
    stage = BUILD_STAGE.FRAME;
    previousStage = BUILD_STAGE.FOUNDATION;
    start = CONSTRUCTION_STAGE_THRESHOLDS.frame;
    end = CONSTRUCTION_STAGE_THRESHOLDS.walls;
  } else {
    stage = BUILD_STAGE.FOUNDATION;
  }

  const phase = stage === BUILD_STAGE.FOUNDATION
    ? paid / Math.max(1e-6, CONSTRUCTION_STAGE_THRESHOLDS.frame)
    : (paid - start) / Math.max(1e-6, end - start);
  return {
    stage,
    previousStage,
    phase: Math.max(0, Math.min(1, phase)),
    finishing: paid >= CONSTRUCTION_STAGE_THRESHOLDS.finishing && paid < 1,
  };
}

/**
 * Stable cache bucket for active construction. Four reveal slices per canonical stage preserve
 * readable growth without rebuilding a settlement for every microscopic simulation tick.
 */
export function constructionPresentationBucket(progress: number): number {
  const paid = Math.max(0, Math.min(1, progress));
  if (paid <= 0) return 0;
  const presentation = constructionStagePresentation(paid);
  // Small epsilon makes exact quarter-stage boundaries stable despite binary floating-point
  // representation (e.g. DETAIL 0.94 => phase 0.25 rather than 0.249999999999...).
  const revealSlice = Math.min(3, Math.floor(presentation.phase * 4 + 1e-9));
  return 1 + presentation.stage * 4 + revealSlice;
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
): 'timber' | 'metal' {
  if (era === 'advanced') return 'metal';
  if (era !== 'industrial') return 'timber';
  if (material === 'metal') return 'metal';
  return ['factory', 'foundry', 'warehouse', 'research', 'energy', 'gate-tower'].includes(role)
    ? 'metal'
    : 'timber';
}
