import * as THREE from 'three';
import type { FreightTrip } from '../../sim/transport/types';
import { resourceBundleGeometry, resourceLogGeometry } from './ResourceWorkGeometry';
import { storedMaterialColour } from './ResourceFlowPresentation';
import { isMinedMaterial, mineralCargoGeometry, mineralVisualProfile } from './MineralPresentation';

/** Attached to the existing authoritative vehicle; never advances a route or invents freight. */
export function createResourceCargo(trip: FreightTrip): THREE.InstancedMesh | undefined {
  const id = trip.materialId ?? trip.material;
  if (!id || !Number.isFinite(trip.quantity) || trip.quantity <= 0) return undefined;
  const timber = id === 'timber';
  const plant = /fiber|flora|herb/.test(id);
  const mineral = isMinedMaterial(id);
  const mineralProfile = mineral ? mineralVisualProfile(id) : undefined;
  const geometry = timber ? resourceLogGeometry() : plant ? resourceBundleGeometry()
    : mineral ? mineralCargoGeometry(id) : new THREE.BoxGeometry(0.19, 0.055, 0.12);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({
    color: timber ? '#ffffff' : mineralProfile?.baseColour ?? storedMaterialColour(id),
    vertexColors: timber, roughness: mineralProfile?.roughness ?? 0.7, metalness: mineralProfile?.metalness ?? 0,
  }), 6);
  mesh.name = 'Authoritative material cargo';
  mesh.userData['resourceId'] = id;
  mesh.count = Math.min(6, Math.ceil(Math.log2(1 + trip.quantity)));
  const marker = new THREE.Object3D();
  for (let i = 0; i < mesh.count; i++) {
    marker.position.set((i % 3 - 1) * 0.13, Math.floor(i / 3) * 0.1, 0);
    if (mineral && mineralProfile) {
      marker.rotation.set((i % 2 ? 1 : -1) * mineralProfile.tilt, i * 0.73, (i % 3 - 1) * 0.18);
      marker.scale.set(mineralProfile.scale[0], mineralProfile.scale[1], mineralProfile.scale[2]).multiplyScalar(0.82);
    } else {
      marker.rotation.set(timber ? Math.PI / 2 : 0, 0, 0);
      marker.scale.setScalar(timber ? 0.65 : plant ? 3 : 1);
    }
    marker.updateMatrix(); mesh.setMatrixAt(i, marker.matrix);
  }
  const walking = trip.mode === 'walk';
  mesh.scale.setScalar(walking ? 0.45 : 0.8);
  mesh.position.set(0, walking ? 0.36 : trip.mode === 'water' ? 0.18 : 0.37, walking ? -0.14 : -0.28);
  mesh.castShadow = true;
  return mesh;
}
