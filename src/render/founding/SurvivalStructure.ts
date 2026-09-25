import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DevelopmentResponse } from '../../sim/development/types';
import type { MaterialPalette, SurfaceKey } from '../materials/MaterialPalette';

/** Hand-built shelters, revealed only as paid construction reaches each usable stage. */
export function createSurvivalStructure(response: DevelopmentResponse, progress: number, width: number, depth: number, palette: MaterialPalette, groundAt?: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  const stage = progress >= 1 ? 'complete' : progress >= 0.75 ? 'usable' : progress >= 0.5 ? 'enclosure' : progress >= 0.2 ? 'frame' : 'site';
  group.userData['adaptation'] = response.adaptation;
  group.userData['constructionStage'] = stage;
  group.userData['progress'] = progress;
  const parts = new Map<SurfaceKey, THREE.BufferGeometry[]>();
  const box = (name: string, surface: SurfaceKey, x: number, y: number, z: number, w: number, h: number, d: number, rx = 0, rz = 0) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(1, 1, 1)));
    const bucket = parts.get(surface) ?? []; bucket.push(geometry); parts.set(surface, bucket);
    // Semantic markers survive material batching for construction-stage inspection.
    if (!group.getObjectByName(name)) { const marker = new THREE.Object3D(); marker.name = name; group.add(marker); }
  };
  const beam = (name: string, a: THREE.Vector3, b: THREE.Vector3, radius = 0.025) => {
    const direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius * 0.8, radius, direction.length(), 5);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    const bucket = parts.get('timber') ?? []; bucket.push(geometry); parts.set('timber', bucket);
    if (!group.getObjectByName(name)) { const marker = new THREE.Object3D(); marker.name = name; group.add(marker); }
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const cache = response.adaptation === 'cache';
  const lean = response.adaptation === 'lean-to';
  const earth = response.adaptation === 'earth-shelter';
  const h = cache ? 0.48 : response.temporary ? 0.7 : earth ? 0.78 : 0.95;
  const x = width * 0.36, z = depth * 0.35;
  const base = 0.09, rise = lean ? 0.24 : Math.min(width * 0.26, 0.42);
  box('site', 'ground', 0, 0.014, 0, width * 0.92, 0.028, depth * 0.92);
  if (progress > 0 && progress < 1) for (let i = 0; i < 3; i++)
    box('paid-materials', earth ? 'stone' : 'timber', width * 0.22, 0.07 + i * 0.045, depth * 0.18, width * 0.28, 0.045, 0.065);
  if (progress >= 0.2) {
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const top = h + (lean && end < 0 ? rise : 0);
      box('stone-footings', 'stone', side * x, 0.045, end * z, 0.15, 0.09, 0.15);
      beam('post', v(side * x, base, end * z), v(side * x, top, end * z), 0.036);
      beam('knee-braces', v(side * x, top - 0.24, end * z), v(side * (x - width * 0.13), top, end * z));
      box('bound-joints', 'hide', side * x, top - 0.045, end * z, 0.083, 0.045, 0.083);
    }
    for (const end of [-1, 1]) {
      const top = h + (lean && end < 0 ? rise : 0);
      beam('wall-plate', v(-x, top, end * z), v(x, top, end * z), 0.035);
      if (!lean) {
        beam('gable-rafter', v(-x, h, end * z), v(0, h + rise, end * z));
        beam('gable-rafter', v(x, h, end * z), v(0, h + rise, end * z));
      }
    }
    beam('ridge-beam', v(0, h + rise, -z), v(0, h + (lean ? 0 : rise), z), 0.033);
  }
  if (progress >= 0.5) {
    box('back-wall', earth ? 'daub' : 'thatch', 0, (h + base) / 2, -z, x * 2, h - base, 0.065);
    for (const side of [-1, 1]) {
      box('side-wall', earth ? 'daub' : 'thatch', side * x, (h + base) / 2, 0, earth ? 0.13 : 0.065, h - base, z * 2);
      for (let row = 0; row < 6; row++)
        box('woven-wall-binding', 'timber', side * (x + 0.035), base + (row + 0.5) * (h - base) / 6, 0, 0.018, 0.014, z * 1.96);
    }
    // Split front panels leave a real opening, rather than painting a doorway on a solid wall.
    if (!lean) for (const side of [-1, 1])
      box('entrance-cheek', earth ? 'daub' : 'thatch', side * x * 0.72, (h + base) / 2, z, x * 0.56, h - base, 0.07);
    for (const side of [-1, 1]) beam('door-jamb', v(side * x * 0.42, base, z), v(side * x * 0.42, h, z), 0.023);
    box('threshold', 'timber', 0, base, z, x * 0.94, 0.055, 0.15);
  }
  if (progress >= 0.75) {
    const roof = new THREE.Object3D(); roof.name = 'protective-roof'; group.add(roof);
    // Overlapping thatch courses create a deep, irregular eave inside the reserved plot.
    const courses = 7;
    if (lean) {
      const slope = Math.atan2(rise, depth * 0.86);
      for (let row = 0; row < courses; row++) {
        const t = (row + 0.5) / courses;
        box('thatch-courses', 'roof-thatch', 0, h + rise * (1 - t) + 0.045,
          (t - 0.5) * depth * 0.86, width * 0.9, 0.065, depth * 0.86 / courses + 0.04, slope);
      }
    } else {
      const run = width * 0.44, slope = Math.atan2(rise, run);
      for (const side of [-1, 1]) for (let row = 0; row < courses; row++) {
        const t = (row + 0.5) / courses;
        box('thatch-courses', earth ? 'ground' : 'roof-thatch', side * run * t, h + rise * (1 - t) + 0.045, 0,
          run / courses / Math.cos(slope) + 0.028, earth ? 0.09 : 0.065, depth * (0.88 + (row % 2) * 0.012), 0, -side * slope);
      }
      box('ridge-cap', 'roof-thatch', 0, h + rise + 0.045, 0, 0.12, 0.085, depth * 0.92);
    }
    if (progress >= 1) {
      box('entrance-step', 'stone', 0, 0.045, depth * 0.43, width * 0.29, 0.07, depth * 0.12);
      box('sleeping-mat', 'hide', -x * 0.3, 0.045, 0, x * 0.9, 0.024, z * 1.5);
    }
  }
  if (groundAt) {
    const samples: number[] = [];
    for (const sx of [-0.46, 0, 0.46]) for (const sz of [-0.46, 0, 0.46]) samples.push(groundAt(sx * width, sz * depth));
    const lift = Math.max(0, ...samples);
    for (const geometries of parts.values()) for (const geometry of geometries) geometry.translate(0, lift, 0);
    // A low dry-stone terrace joins the level shelter floor to the actual slope.
    if (progress >= 0.2) for (let ix = 0; ix < 3; ix++) for (let iz = 0; iz < 3; iz++) {
      const cx = (ix - 1) * width * 0.3, cz = (iz - 1) * depth * 0.3;
      const bottom = Math.min(...[-1, 1].flatMap(sx => [-1, 1].map(sz =>
        groundAt(cx + sx * width * 0.15, cz + sz * depth * 0.15)))) - 0.025;
      const height = lift + 0.025 - bottom;
      box('terrain-foundation', 'stone', cx, bottom + height / 2, cz, width * 0.3, height, depth * 0.3);
    }
    group.userData['foundationLift'] = lift;
  }
  for (const [surface, geometries] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries)!, palette.getSurfaceMaterial(surface));
    mesh.name = `shelter-${surface}`; mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); geometries.forEach(geometry => geometry.dispose());
  }
  return group;
}
