import * as THREE from 'three';
import type { DevelopmentResponse } from '../../sim/development/types';
import type { MaterialPalette, SurfaceKey } from '../materials/MaterialPalette';

/** Cheap stages derived only from paid simulation progress, including a genuinely covered usable stage. */
export function createSurvivalStructure(response: DevelopmentResponse, progress: number, width: number, depth: number, palette: MaterialPalette): THREE.Group {
  const group = new THREE.Group();
  const stage = progress >= 1 ? 'complete' : progress >= 0.75 ? 'usable' : progress >= 0.5 ? 'enclosure' : progress >= 0.2 ? 'frame' : 'site';
  group.userData['adaptation'] = response.adaptation;
  group.userData['constructionStage'] = stage;
  group.userData['progress'] = progress;
  const box = (name: string, surface: SurfaceKey, x: number, y: number, z: number, w: number, h: number, d: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), palette.getSurfaceMaterial(surface));
    mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  const h = response.adaptation === 'cache' ? 0.5 : response.temporary ? 0.75 : 1.1;
  const earth = response.adaptation === 'earth-shelter';
  box('site', 'ground', 0, 0.025, 0, width, 0.05, depth);
  // Empty reserved ground has no invented delivered material pile.
  if (progress > 0 && progress < 1) box('paid-materials', earth ? 'stone' : 'timber', width * 0.25, 0.1, depth * 0.2, width * 0.3, 0.16, depth * 0.25);
  if (progress >= 0.2) for (const x of [-1, 1]) for (const z of [-1, 1]) {
    box('post', 'timber', x * width * 0.4, h / 2, z * depth * 0.4, 0.06, h, 0.06);
  }
  if (progress >= 0.5) {
    box('back-wall', earth ? 'daub' : 'thatch', 0, h * 0.44, -depth * 0.4, width * 0.85, h * 0.85, 0.08);
    if (!response.temporary || earth) for (const x of [-1, 1]) box('side-wall', earth ? 'daub' : 'thatch', x * width * 0.4, h * 0.44, 0, 0.08, h * 0.85, depth * 0.85);
  }
  if (progress >= 0.75) {
    const roof = box('protective-roof', 'roof-thatch', 0, h, 0, width * 0.95, 0.1, depth * 0.95);
    roof.rotation.x = response.adaptation === 'lean-to' ? 0.18 : 0.08;
  }
  return group;
}
