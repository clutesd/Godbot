import './SettlementStreetPresentation';
import './MemorialSitePresentation';
import type * as THREE from 'three';
import { GodboxRenderer } from '../GodboxRenderer';
import { eraRank } from '../assets/BuildingGrammar';
import type { Era, MaterialPalette } from '../materials/MaterialPalette';

/**
 * Most settlements now reveal circulation through movement-shaped paths rather than a synthetic
 * hub-and-spoke overlay. Only industrial/advanced societies regain the legacy planned-ground layer;
 * by then deliberate boulevards and civic replanning are historically plausible. Earlier villages
 * and pre-industrial towns must earn their street pattern through repeated movement and path
 * promotion, preserving the irregular history visible in the landscape.
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
    if (eraRank(era) < 4) return;
    plannedGroundCraft.call(this, group, era, palette, random);
  }) as GroundCraftMethod;
}
