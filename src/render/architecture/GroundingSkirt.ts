import * as THREE from 'three';
import type { StructureGrounding } from '../../shared/StructureGrounding';

let unitBox: THREE.BoxGeometry | undefined;
let skirtMaterial: THREE.MeshStandardMaterial | undefined;

/**
 * Foundation skirt that closes the gap between a structure's base and lower ground on the
 * downhill side. The box top sits at the parent's origin; it descends `drop` units below it.
 * `unitScale` converts world units into the parent's local units (a building scaled by its fit).
 * Shared geometry and material keep the cost to one mesh per sloped structure.
 */
export function createGroundingSkirt(grounding: StructureGrounding, baseY: number, width: number, depth: number, unitScale = 1): THREE.Mesh | undefined {
  if (!grounding.skirt) return undefined;
  const drop = (baseY - grounding.skirtBottomY) / unitScale;
  if (!(drop > 0) || !(width > 0) || !(depth > 0)) return undefined;
  unitBox ??= new THREE.BoxGeometry(1, 1, 1);
  skirtMaterial ??= new THREE.MeshStandardMaterial({ color: '#7d7468', roughness: 0.94, metalness: 0 });
  const mesh = new THREE.Mesh(unitBox, skirtMaterial);
  mesh.name = 'grounding-skirt';
  mesh.scale.set(width, drop, depth);
  mesh.position.set(0, -drop / 2, 0);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}
