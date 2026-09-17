import * as THREE from 'three';
import type { Culture, Settlement } from '../../sim/types';
import { developmentPresentationEra } from '../assets/BuildingGrammar';
import { GodboxRenderer } from '../GodboxRenderer';
import type { MaterialPalette } from '../materials/MaterialPalette';
import { createConstructionWorksite } from './ConstructionWorksite';

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
    const renderedWidth = geometry?.parameters.width ?? 1.35;
    const renderedDepth = geometry?.parameters.depth ?? 1.1;
    // Core construction foundation occupies 90% of the reserved plot dimensions.
    const width = renderedWidth / 0.9;
    const depth = renderedDepth / 0.9;
    const renderer = this as unknown as RendererInternals;
    const era = developmentPresentationEra(project.response);
    const palette = renderer.getPalette(project.response.style, era);
    const worksite = createConstructionWorksite({
      width,
      depth,
      progress: project.progress,
      response: project.response,
      seedKey: project.plotId,
    }, palette);
    activeSite.add(worksite);
    return visual;
  };
  prototype[INSTALL_KEY] = true;
}
