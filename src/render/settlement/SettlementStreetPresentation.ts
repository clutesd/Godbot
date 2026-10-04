import * as THREE from 'three';
import { GodboxRenderer } from '../GodboxRenderer';
import { eraRank } from '../assets/BuildingGrammar';
import type { Era } from '../materials/MaterialPalette';

/** Local circulation is already drawn from persistent PathEvolution wear by ResourceSiteRenderer.
 * Semantic districts and era rank must never add a second, synthetic street network. */
function enhancedAddGroundCraft(this: GodboxRenderer, group: THREE.Group, era: Era): void {
  if (eraRank(era) !== 0) return;
  const earth = new THREE.Mesh(new THREE.CircleGeometry(1.65, 18),
    new THREE.MeshStandardMaterial({ color: '#756149', roughness: 1 }));
  earth.name = 'settlement-trodden-ground';
  earth.rotation.x = -Math.PI / 2;
  earth.position.y = 0.012;
  earth.receiveShadow = true;
  group.add(earth);
}

// There is no paid civic street project authority yet. Culture/technology alone cannot commission
// an axis, plaza or widening; future deliberate works must come through construction and transport.
function enhancedAddCeremonialAxis(): void {}

const rendererPrototype = GodboxRenderer.prototype as unknown as Record<string, unknown>;
rendererPrototype['addGroundCraft'] = enhancedAddGroundCraft;
rendererPrototype['addCeremonialAxis'] = enhancedAddCeremonialAxis;
