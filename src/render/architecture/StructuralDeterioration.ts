/**
 * StructuralDeterioration.ts
 *
 * How a standing building shows that it is failing, without ever changing its size.
 *
 * A plot's `condition` used to squash the whole building vertically, so a weathered barn was a
 * shorter barn and an abandoned hall sank into the ground year by year. Real fabric does not do
 * that. It weathers, loses its finish and fittings, then its roof covering, then its upper courses,
 * and what falls lies at its foot. This module expresses exactly that on the finished geometry the
 * building already has: every composed mesh carries `assemblyPieces` tagged with their construction
 * stage, so decay is the construction sequence run backwards — last on, first off — over a
 * deterministic per-plot selection of pieces.
 *
 * Nothing here scales, tilts or moves the structure. Weathering of surfaces is handled separately
 * by feeding the banded condition into the spec's age state, which drives texture and vertex wear.
 */

import * as THREE from 'three';
import type { AssemblyPiece } from '../assets/GeometryBuilder';
import { BUILD_STAGE } from '../assets/BuildStages';

/**
 * Condition, banded so that buildings in similar repair keep sharing one cached asset and a plot
 * does not rebuild its geometry for every hundredth of a point of decay.
 */
export function conditionBand(condition: number): number {
  if (!Number.isFinite(condition) || condition >= 0.85) return 1;
  if (condition >= 0.6) return 0.72;
  if (condition >= 0.3) return 0.45;
  if (condition > 0) return 0.2;
  return 0;
}

export interface DeteriorationProfile {
  band: number;
  /** Share of pieces lost, by the construction stage they belong to. */
  loss: Record<number, number>;
  /** Fallen fragments at the building's foot. */
  debris: number;
}

/** What a building in this condition has lost. The reverse of the order it was built in. */
export function deteriorationProfile(condition: number): DeteriorationProfile {
  const band = conditionBand(condition);
  const loss: Record<number, number> = {};
  const set = (finish: number, fitout: number, utilities: number, roof: number, walls: number, frame: number) => {
    loss[BUILD_STAGE.FINISH] = finish; loss[BUILD_STAGE.FITOUT] = fitout; loss[BUILD_STAGE.UTILITIES] = utilities;
    loss[BUILD_STAGE.ROOF] = roof; loss[BUILD_STAGE.WALLS] = walls; loss[BUILD_STAGE.FRAME] = frame;
  };
  if (band >= 1) set(0, 0, 0, 0, 0, 0);
  else if (band >= 0.72) set(0.25, 0.08, 0, 0.04, 0, 0);
  else if (band >= 0.45) set(0.6, 0.3, 0.2, 0.18, 0.04, 0);
  else if (band > 0) set(0.9, 0.65, 0.5, 0.5, 0.22, 0.12);
  // A ruin keeps its footings and the stubs of its lower walls; everything that was carried is down.
  else set(1, 1, 1, 1, 0.7, 0.75);
  const debris = band >= 1 ? 0 : band >= 0.72 ? 1 : band >= 0.45 ? 3 : band > 0 ? 6 : 10;
  return { band, loss, debris };
}

function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

const DEBRIS_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
DEBRIS_GEOMETRY.userData['shared'] = true;

export interface DeteriorationResult {
  /** Pieces removed across every mesh. */
  removedPieces: number;
  totalPieces: number;
  debris: number;
}

/**
 * Remove the pieces this condition has lost from every composed mesh under `root`, and lay the
 * fallen fragments at its foot. Deterministic in `seed`, so a plot decays the same way every time
 * it is rebuilt and further decay only ever removes more.
 *
 * The root's own transform is never touched: dimensions are preserved by construction.
 */
export function applyStructuralDeterioration(root: THREE.Object3D, condition: number, seed: string): DeteriorationResult {
  const profile = deteriorationProfile(condition);
  const result: DeteriorationResult = { removedPieces: 0, totalPieces: 0, debris: 0 };
  if (profile.band >= 1) return result;
  const bounds = new THREE.Box3();
  let debrisMaterial: THREE.Material | undefined;
  let meshIndex = 0;
  const meshes: THREE.Mesh[] = [];
  root.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
  for (const mesh of meshes) {
    const pieces = mesh.geometry.userData['assemblyPieces'] as AssemblyPiece[] | undefined;
    meshIndex++;
    if (!pieces?.length) continue;
    const source = mesh.geometry;
    const index = source.index;
    if (!index) continue;
    let top = -Infinity, bottom = Infinity;
    for (const piece of pieces) { top = Math.max(top, piece.max.y); bottom = Math.min(bottom, piece.min.y); }
    const height = Math.max(1e-6, top - bottom);
    const kept: number[] = [];
    let removed = 0;
    pieces.forEach((piece, i) => {
      result.totalPieces++;
      const share = profile.loss[piece.stage] ?? 0;
      // Upper fabric goes first: a wall loses its top courses long before its footing.
      const elevation = (piece.min.y - bottom) / height;
      const exposure = piece.stage === BUILD_STAGE.WALLS || piece.stage === BUILD_STAGE.FRAME ? 0.35 + elevation * 1.3 : 1;
      const lost = share > 0 && hash01(`${seed}:${meshIndex}:${i}`) < share * exposure;
      if (lost) { removed++; return; }
      for (let k = piece.start; k < piece.start + piece.count; k++) kept.push(index.getX(k));
    });
    if (removed === 0) continue;
    result.removedPieces += removed;
    if (!debrisMaterial && pieces.some(p => p.stage === BUILD_STAGE.WALLS)) debrisMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const geometry = source.clone();
    geometry.setIndex(kept);
    geometry.userData = { ...source.userData, shared: false,
      assemblyPieces: [], deteriorated: profile.band };
    geometry.computeBoundingSphere();
    mesh.geometry = geometry;
  }
  // Fallen fabric lies just outside the footprint, never inside the walls people walk between.
  bounds.setFromObject(root, true);
  if (profile.debris > 0 && debrisMaterial && !bounds.isEmpty()) {
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    const local = bounds.clone().applyMatrix4(inverse);
    const size = local.getSize(new THREE.Vector3());
    const debris = new THREE.Group();
    debris.name = 'deterioration-debris';
    for (let i = 0; i < profile.debris; i++) {
      const side = hash01(`${seed}:debris-side:${i}`);
      const along = hash01(`${seed}:debris-along:${i}`) - 0.5;
      const scale = 0.04 + hash01(`${seed}:debris-size:${i}`) * 0.08;
      const fragment = new THREE.Mesh(DEBRIS_GEOMETRY, debrisMaterial);
      fragment.name = 'fallen-fabric';
      const sx = side < 0.5 ? along * size.x : (side < 0.75 ? -1 : 1) * (size.x / 2 + scale);
      const sz = side < 0.5 ? (side < 0.25 ? -1 : 1) * (size.z / 2 + scale) : along * size.z;
      fragment.position.set(local.min.x + size.x / 2 + sx, local.min.y + scale * 0.35, local.min.z + size.z / 2 + sz);
      fragment.scale.set(scale * 1.6, scale * 0.7, scale);
      fragment.rotation.y = hash01(`${seed}:debris-turn:${i}`) * Math.PI;
      fragment.castShadow = true; fragment.receiveShadow = true;
      debris.add(fragment);
    }
    result.debris = profile.debris;
    root.add(debris);
  }
  root.userData['deteriorationBand'] = profile.band;
  return result;
}
