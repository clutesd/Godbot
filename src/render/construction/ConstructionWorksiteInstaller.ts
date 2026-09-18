import * as THREE from 'three';
import type { Culture, Settlement } from '../../sim/types';
import { developmentPresentationEra } from '../assets/BuildingGrammar';
import { GodboxRenderer } from '../GodboxRenderer';
import type { MaterialPalette } from '../materials/MaterialPalette';
import { createConstructionWorksite } from './ConstructionWorksite';
import { constructionPresentationProgress } from './ConstructionVisualGrammar';
import { constructionBlockedReason, constructionPresentedMaterial } from './ConstructionActionPresentation';

interface SettlementVisualLike {
  group: THREE.Group;
}

interface RendererInternals {
  createSettlementVisual: (settlement: Settlement) => SettlementVisualLike;
  getPalette: (style: Culture['style'], era: ReturnType<typeof developmentPresentationEra>) => MaterialPalette;
}

interface ActiveSiteGeometry extends THREE.BoxGeometry {
  parameters: THREE.BoxGeometry['parameters'];
}

const prototype = GodboxRenderer.prototype as unknown as RendererInternals & Record<string, unknown>;
const INSTALL_KEY = '__constructionWorksitePresentationInstalled';

/**
 * Adds construction-site dressing after the core renderer has created the authoritative active
 * project geometry. This deliberately wraps presentation only: it cannot start a project, spend
 * materials, add labour, or advance progress.
 */
if (!prototype[INSTALL_KEY]) {
  const baseCreateSettlementVisual = prototype.createSettlementVisual;
  prototype.createSettlementVisual = function createSettlementVisualWithWorksite(
    this: GodboxRenderer,
    settlement: Settlement,
  ): SettlementVisualLike {
    const visual = baseCreateSettlementVisual.call(this, settlement);
    const project = settlement.development?.project;
    if (!project) return visual;

    let activeSite: THREE.Group | undefined;
    visual.group.traverse((object) => {
      if (!activeSite && object instanceof THREE.Group && object.userData['constructionSite'] === true) activeSite = object;
    });
    if (!activeSite) return visual;
    if (activeSite.getObjectByName(`construction-worksite:${project.plotId}`)) return visual;

    const foundation = activeSite.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry);
    const geometry = foundation?.geometry as ActiveSiteGeometry | undefined;
    const fallbackWidth = (geometry?.parameters.width ?? 1.35) / 0.9;
    const fallbackDepth = (geometry?.parameters.depth ?? 1.1) / 0.9;
    // Step 1B publishes the exact rendered future-building footprint. Keep the old foundation
    // inference only as a compatibility fallback for survival/legacy presentation paths.
    const metadataWidth = Number(activeSite.userData['constructionFootprintWidth']);
    const metadataDepth = Number(activeSite.userData['constructionFootprintDepth']);
    const width = Number.isFinite(metadataWidth) && metadataWidth > 0 ? metadataWidth : fallbackWidth;
    const depth = Number.isFinite(metadataDepth) && metadataDepth > 0 ? metadataDepth : fallbackDepth;
    const renderer = this as unknown as RendererInternals;
    const era = developmentPresentationEra(project.response);
    const palette = renderer.getPalette(project.response.style, era);
    const worksite = createConstructionWorksite({
      width,
      depth,
      progress: constructionPresentationProgress(settlement),
      response: { ...project.response, material: constructionPresentedMaterial(settlement) },
      seedKey: project.plotId,
      materialsAvailable: !constructionBlockedReason(settlement),
    }, palette);
    activeSite.add(worksite);
    return visual;
  };
  prototype[INSTALL_KEY] = true;
}
