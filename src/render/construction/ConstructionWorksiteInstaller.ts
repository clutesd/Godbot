import * as THREE from 'three';
import type { Settlement } from '../../sim/types';
import type { MaterialPalette } from '../materials/MaterialPalette';
import { createConstructionWorksite } from './ConstructionWorksite';
import { constructionPresentationProgress } from './ConstructionVisualGrammar';
import { constructionPresentedMaterial, constructionSitePresentationState } from './ConstructionActionPresentation';

interface ActiveSiteGeometry extends THREE.BoxGeometry {
  parameters: THREE.BoxGeometry['parameters'];
}

/**
 * Explicit presentation-only decoration for the active construction group already created by the
 * core renderer. Importing this module has no side effects: callers opt in by invoking this helper.
 *
 * The simulation remains authoritative for project existence, progress, materials and blockers.
 */
export function decorateConstructionWorksite(
  activeSite: THREE.Group,
  settlement: Settlement,
  palette: MaterialPalette,
): THREE.Group | undefined {
  const project = settlement.development?.project;
  if (!project || project.progress >= 1) return undefined;

  const existing = activeSite.getObjectByName(`construction-worksite:${project.plotId}`);
  if (existing instanceof THREE.Group) return existing;

  const foundation = activeSite.children.find((child): child is THREE.Mesh =>
    child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry);
  const geometry = foundation?.geometry as ActiveSiteGeometry | undefined;
  const fallbackWidth = (geometry?.parameters.width ?? 1.35) / 0.9;
  const fallbackDepth = (geometry?.parameters.depth ?? 1.1) / 0.9;

  // Step 1B publishes the exact rendered future-building footprint. Keep the foundation inference
  // only as a compatibility fallback for survival/legacy presentation paths.
  const metadataWidth = Number(activeSite.userData['constructionFootprintWidth']);
  const metadataDepth = Number(activeSite.userData['constructionFootprintDepth']);
  const width = Number.isFinite(metadataWidth) && metadataWidth > 0 ? metadataWidth : fallbackWidth;
  const depth = Number.isFinite(metadataDepth) && metadataDepth > 0 ? metadataDepth : fallbackDepth;
  const siteState = constructionSitePresentationState(settlement);
  const worksite = createConstructionWorksite({
    width,
    depth,
    progress: constructionPresentationProgress(settlement),
    response: { ...project.response, material: constructionPresentedMaterial(settlement) },
    seedKey: project.plotId,
    materialsAvailable: siteState === 'active' || siteState === 'finishing',
  }, palette);
  worksite.userData['constructionSiteState'] = siteState;
  activeSite.add(worksite);
  return worksite;
}
