import './SettlementStreetPresentation';
import type * as THREE from 'three';
import { GodboxRenderer } from '../GodboxRenderer';
import { eraRank } from '../assets/BuildingGrammar';
import type { Era, MaterialPalette } from '../materials/MaterialPalette';

/**
 * Primitive and early settlements have no synthetic street/common overlay. Their visible ground
 * circulation is entirely movement-worn terrain from ResourceSiteRenderer, so the shape of the
 * settlement records actual journeys instead of a radial planning template. Deliberately planned
 * ground craft returns only once the settlement reaches village/urban street-building maturity.
 */
type GroundCraftMethod = (
  this: GodboxRenderer,
  group: THREE.Group,
  era: Era,
  palette: MaterialPalette,
  random: unknown,
) => void;

const rendererPrototype = GodboxRenderer.prototype as unknown as Record<string, unknown>;
const plannedGroundCraft = rendererPrototype['addGroundCraft'] as GroundCraftMethod | undefined;

if (plannedGroundCraft) {
  rendererPrototype['addGroundCraft'] = (function movementDrivenGroundCraft(
    this: GodboxRenderer,
    group: THREE.Group,
    era: Era,
    palette: MaterialPalette,
    random: unknown,
  ): void {
    if (eraRank(era) < 2) return;
    plannedGroundCraft.call(this, group, era, palette, random);
  }) as GroundCraftMethod;
}
