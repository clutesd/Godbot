import './SettlementStreetPresentation';
import * as THREE from 'three';
import { GodboxRenderer } from '../GodboxRenderer';
import { eraRank } from '../assets/BuildingGrammar';
import type { Era, MaterialPalette } from '../materials/MaterialPalette';

/**
 * Young settlements should not begin with a planned hub-and-spoke street diagram. Until a society
 * has enough urban/engineering maturity to deliberately maintain streets, the visible circulation
 * network comes from movement-worn terrain rendered by ResourceSiteRenderer. We keep only a small
 * trodden common around the civic hearth so the settlement still has a readable centre.
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
    const rank = eraRank(era);
    if (rank >= 2) {
      plannedGroundCraft.call(this, group, era, palette, random);
      return;
    }

    const radius = rank === 0 ? 1.3 : 1.55;
    const earth = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 18),
      new THREE.MeshStandardMaterial({ color: rank === 0 ? '#756149' : '#80694d', roughness: 1, transparent: true, opacity: 0.78, depthWrite: false }),
    );
    earth.name = 'settlement-trodden-common';
    earth.rotation.x = -Math.PI / 2;
    earth.scale.y = 0.84;
    earth.position.y = 0.014;
    earth.receiveShadow = true;
    earth.userData['weatherSurface'] = true;
    group.add(earth);
  }) as GroundCraftMethod;
}
