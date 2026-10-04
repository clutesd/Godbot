import type { AssemblyPiece } from './GeometryBuilder';
import { BUILD_STAGE } from './BuildStages';
import * as THREE from 'three';
import type { AssetBuilder, AssetConfig } from './AssetBuilder';

/** Placement adapter only: every shell, including subsystem buildings, is a production asset. */
export function productionBuildingShell(builder: AssetBuilder, config: AssetConfig, width: number, depth: number, name: string): THREE.Object3D {
  const source = builder.getAsset('building', config).mesh;
  const shell = source.clone(true);
  shell.name = name;
  shell.scale.setScalar(Math.min(width / Number(source.userData['footprintWidth']), depth / Number(source.userData['footprintDepth'])));
  shell.traverse(node => { node.userData['sharedAsset'] = true; });
  return shell;
}

/** Bake placement transforms into the real finished members before ConstructionAssembly reads them. */
export function productionConstructionTarget(source: THREE.Object3D): THREE.Group {
  source.updateMatrixWorld(true);
  const inverse = source.matrixWorld.clone().invert();
  const target = new THREE.Group();
  const visit = (node: THREE.Object3D): void => {
    if (node instanceof THREE.LOD) { visit(node.levels[0]!.object); return; }
    if (node instanceof THREE.Mesh) {
      const transform = inverse.clone().multiply(node.matrixWorld);
      const geometry = node.geometry.clone();
      geometry.applyMatrix4(transform);
      if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const parts = (node.geometry.userData['assemblyPieces'] ?? []) as AssemblyPiece[];
      geometry.userData['shared'] = false;
      geometry.userData['assemblyPieces'] = parts.length ? parts.map(piece => {
        const box = new THREE.Box3(new THREE.Vector3(piece.min.x, piece.min.y, piece.min.z), new THREE.Vector3(piece.max.x, piece.max.y, piece.max.z)).applyMatrix4(transform);
        return { ...piece, min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } };
      }) : [{ start: 0, count: geometry.index!.count, stage: BUILD_STAGE.FITOUT,
        min: { ...geometry.boundingBox!.min }, max: { ...geometry.boundingBox!.max } }];
      const mesh = new THREE.Mesh(geometry, node.material); mesh.name = node.name;
      target.add(mesh);
    }
    for (const child of node.children) visit(child);
  };
  visit(source);
  const bounds = new THREE.Box3().setFromObject(target);
  target.userData['bodyWidth'] = Math.max(0.1, bounds.max.x - bounds.min.x);
  target.userData['bodyDepth'] = Math.max(0.1, bounds.max.z - bounds.min.z);
  target.userData['buildingHeight'] = Math.max(0.1, bounds.max.y);
  return target;
}
