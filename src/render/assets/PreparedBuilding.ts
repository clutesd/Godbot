import * as THREE from 'three';
import type { MaterialPalette } from '../materials/MaterialPalette';
import type { SurfaceKey } from '../materials/MaterialPalette';
import { isArchitecturalMaterial } from '../architecture/MaterialLibrary';
import { packGeometry, type PreparedMesh } from './PreparedGeometry';

export interface PreparedBuilding {
  name: string; kind: 'group' | 'mesh' | 'lod'; userData: THREE.Object3D['userData']; visible: boolean;
  position: number[]; quaternion: number[]; scale: number[];
  mesh?: PreparedMesh;
  geometryData?: THREE.BufferGeometry['userData'];
  children: PreparedBuilding[];
  levels?: { child: number; distance: number; hysteresis: number }[];
}
export function packBuilding(root: THREE.Object3D): PreparedBuilding {
  return { name: root.name, kind: root instanceof THREE.Mesh ? 'mesh' : root instanceof THREE.LOD ? 'lod' : 'group',
    userData: root.userData, visible: root.visible, position: root.position.toArray(), quaternion: root.quaternion.toArray(), scale: root.scale.toArray(),
    ...(root instanceof THREE.Mesh ? { mesh: packGeometry(root)[0]!, geometryData: root.geometry.userData } : {}),
    ...(root instanceof THREE.LOD ? { levels: root.levels.map(l => ({ child: root.children.indexOf(l.object), distance: l.distance, hysteresis: l.hysteresis })) } : {}),
    children: root.children.map(packBuilding) };
}
export function buildingTransfers(node: PreparedBuilding): ArrayBuffer[] {
  return [...(node.mesh ? [...node.mesh.attributes.map(a => a.array.buffer as ArrayBuffer), ...(node.mesh.index ? [node.mesh.index.buffer as ArrayBuffer] : [])] : []),
    ...node.children.flatMap(buildingTransfers)];
}
export function unpackBuilding(data: PreparedBuilding, palette: MaterialPalette): THREE.Object3D {
  let object: THREE.Object3D;
  if (data.mesh) {
    const geometry = new THREE.BufferGeometry();
    for (const a of data.mesh.attributes) geometry.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.size, a.normalized));
    if (data.mesh.index) geometry.setIndex(new THREE.BufferAttribute(data.mesh.index, 1));
    geometry.userData = data.geometryData ?? {};
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(data.mesh.box), new THREE.Vector3().fromArray(data.mesh.box, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3().fromArray(data.mesh.sphere), data.mesh.sphere[3]!);
    const material = isArchitecturalMaterial(data.name) ? palette.getArchitecturalMaterial(data.name) : palette.getSurfaceMaterial(data.name as SurfaceKey);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = data.mesh.castShadow; mesh.receiveShadow = data.mesh.receiveShadow; mesh.renderOrder = data.mesh.renderOrder;
    object = mesh;
  } else object = data.kind === 'lod' ? new THREE.LOD() : new THREE.Group();
  object.name = data.name; object.userData = data.userData; object.visible = data.visible;
  object.position.fromArray(data.position); object.quaternion.fromArray(data.quaternion); object.scale.fromArray(data.scale);
  const children = data.children.map(child => unpackBuilding(child, palette));
  if (children.length) object.add(...children);
  if (object instanceof THREE.LOD) for (const level of data.levels ?? []) object.addLevel(children[level.child]!, level.distance, level.hysteresis);
  return object;
}
