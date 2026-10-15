import * as THREE from 'three';

export interface PreparedMesh {
  name: string;
  userData: THREE.Object3D['userData'];
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  attributes: { name: string; array: THREE.TypedArray; size: number; normalized: boolean }[];
  index: Uint16Array | Uint32Array | null;
  box: number[];
  sphere: number[];
}
export function packGeometry(root: THREE.Object3D): PreparedMesh[] {
  const meshes: PreparedMesh[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    meshes.push({ name: object.name, userData: object.userData, castShadow: object.castShadow,
      receiveShadow: object.receiveShadow, renderOrder: object.renderOrder,
      attributes: Object.entries(geometry.attributes).map(([name, a]) => ({ name, array: a.array, size: a.itemSize, normalized: a.normalized })),
      index: geometry.index?.array as Uint16Array | Uint32Array | undefined ?? null,
      box: [...geometry.boundingBox!.min.toArray(), ...geometry.boundingBox!.max.toArray()],
      sphere: [...geometry.boundingSphere!.center.toArray(), geometry.boundingSphere!.radius] });
  });
  return meshes;
}
export function unpackGeometry(meshes: PreparedMesh[], source: THREE.Object3D,
  inherit: (mesh: THREE.Mesh, original: THREE.Mesh) => void): THREE.Group {
  const materials = new Map<string, THREE.Mesh>();
  source.traverse(object => { if (object instanceof THREE.Mesh) materials.set(String(object.userData['batchKey']), object); });
  const group = new THREE.Group();
  for (const data of meshes) {
    const template = materials.get(String(data.userData['batchKey']));
    if (!template) throw new Error(`Missing source material for prepared ${data.name}`);
    const geometry = new THREE.BufferGeometry();
    for (const a of data.attributes) geometry.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.size, a.normalized));
    if (data.index) geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
    geometry.userData = { shared: true, assemblyPieces: [], derivedLod: true };
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(data.box), new THREE.Vector3().fromArray(data.box, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3().fromArray(data.sphere), data.sphere[3]!);
    const mesh = new THREE.Mesh(geometry, template.material);
    mesh.name = data.name; mesh.userData = data.userData;
    mesh.castShadow = data.castShadow; mesh.receiveShadow = data.receiveShadow; mesh.renderOrder = data.renderOrder;
    inherit(mesh, template);
    group.add(mesh);
  }
  return group;
}
