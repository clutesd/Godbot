import * as THREE from 'three';
import { indoorSleepingSpots, sleepAreaLocal, type IndoorSleepingArea } from './IndoorSleepingArea';
import { stableRestUnit } from './RestChoreography';

/** Low bedding preserves existing floor and aisle clearance; no raised frame beneath a floor-level pose. */
export function createSleepingBedding(area: IndoorSleepingArea, buildingScale: number, floorHeight: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Designated indoor sleeping mats';
  const spots = indoorSleepingSpots(area);
  group.userData['sleepingSpaces'] = spots.map(s => s.key);
  const parts = [
    { name: 'Woven reed base', size: [0.22, 0.012, 0.4], y: 0.008, z: 0, color: '#806747' },
    { name: 'Soft sleeping pad', size: [0.204, 0.014, 0.374], y: 0.019, z: 0, color: '#b5a17b' },
    { name: 'Linen head bolster', size: [0.17, 0.025, 0.075], y: 0.029, z: -0.143, color: '#d8cbb0' },
    { name: 'Folded wool cover', size: [0.206, 0.02, 0.108], y: 0.028, z: 0.132, color: '#6b8582' },
    { name: 'Cover hem', size: [0.208, 0.003, 0.012], y: 0.039, z: 0.089, color: '#c4b08a' },
  ];
  const matrix = new THREE.Matrix4();
  for (const part of parts) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(...part.size.map(n => n / buildingScale) as [number, number, number]),
      new THREE.MeshStandardMaterial({ color: part.color, roughness: 1 }), spots.length);
    mesh.name = part.name; mesh.receiveShadow = true; mesh.castShadow = true;
    spots.forEach((spot, index) => {
      const local = sleepAreaLocal(area, spot.destination);
      matrix.makeTranslation(local.x / buildingScale, (floorHeight + part.y) / buildingScale, (local.z + part.z) / buildingScale);
      mesh.setMatrixAt(index, matrix);
      const tint = new THREE.Color('white').multiplyScalar(0.92 + stableRestUnit(spot.key) * 0.16);
      mesh.setColorAt(index, tint);
    });
    group.add(mesh);
  }
  return group;
}
