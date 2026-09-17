import type { StructureMaterial } from '../../sim/development/types';
import type { Era } from '../materials/MaterialPalette';
import { BUILD_STAGE, type BuildStage } from '../assets/BuildingComposer';
import type { BuildingRole } from '../assets/BuildingGrammar';

/**
 * Active projects rebuild only when one of these presentation thresholds is crossed.
 * The same thresholds drive both geometry and the heavy-render signature, so the renderer
 * never computes a construction state that its settlement cache is unable to display.
 */
export const CONSTRUCTION_STAGE_THRESHOLDS = {
  frame: 0.2,
  walls: 0.45,
  roof: 0.78,
  detail: 1,
} as const;

/** Map paid simulation progress onto the canonical procedural building lifecycle. */
export function constructionBuildStage(progress: number): BuildStage {
  const paid = Math.max(0, Math.min(1, progress));
  if (paid >= CONSTRUCTION_STAGE_THRESHOLDS.detail) return BUILD_STAGE.DETAIL;
  if (paid >= CONSTRUCTION_STAGE_THRESHOLDS.roof) return BUILD_STAGE.ROOF;
  if (paid >= CONSTRUCTION_STAGE_THRESHOLDS.walls) return BUILD_STAGE.WALLS;
  if (paid >= CONSTRUCTION_STAGE_THRESHOLDS.frame) return BUILD_STAGE.FRAME;
  return BUILD_STAGE.FOUNDATION;
}

/**
 * Stable cache bucket for active construction. Zero means no visible paid work yet; one through
 * four are foundation/frame/walls/roof, and five is the completed-detail boundary.
 */
export function constructionPresentationBucket(progress: number): number {
  const paid = Math.max(0, Math.min(1, progress));
  if (paid <= 0) return 0;
  return constructionBuildStage(paid) + 1;
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
