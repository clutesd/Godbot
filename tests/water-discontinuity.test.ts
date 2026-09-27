import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { packInlandAttributes, smoothInlandWaterNormals } from '../src/render/terrain/WaterAttributes';

const scalarChannels = [
  'waterDepth', 'waterFlow', 'waterKind', 'waterHierarchy', 'waterRapid', 'waterWind',
  'waterRain', 'waterStorm', 'waterFreezePrevious', 'waterFreeze', 'waterSnow', 'waterEmergence',
] as const;

function waterGeometry(values: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
  const count = values.length / 3;
  for (const name of scalarChannels) geometry.setAttribute(name, new THREE.Float32BufferAttribute(new Array(count).fill(0), 1));
  geometry.setAttribute('waterFlowDirection', new THREE.Float32BufferAttribute(new Array(count * 2).fill(0), 2));
  geometry.setAttribute('waterWindDirection', new THREE.Float32BufferAttribute(new Array(count * 2).fill(0), 2));
  return geometry;
}

function triangleArea(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number {
  const a = new THREE.Vector3(position.getX(0), position.getY(0), position.getZ(0));
  const b = new THREE.Vector3(position.getX(1), position.getY(1), position.getZ(1));
  const c = new THREE.Vector3(position.getX(2), position.getY(2), position.getZ(2));
  return b.sub(a).cross(c.sub(a)).length() * 0.5;
}

describe('Inland water attribute continuity', () => {
  it('packs attributes without deleting surface coverage', () => {
    const geometry = waterGeometry([
      0, 0.02, 0,
      0.5, 3.2, 0.5,
      1, 0.03, 0,
    ]);
    expect(triangleArea(geometry.getAttribute('position'))).toBeGreaterThan(1);

    packInlandAttributes(geometry);

    expect(triangleArea(geometry.getAttribute('position'))).toBeGreaterThan(1);
    expect(geometry.getAttribute('waterPacked0').count).toBe(3);
    geometry.dispose();
  });

  it('shares lighting normals across duplicate clipped vertices without flattening real slope', () => {
    const geometry = waterGeometry([
      0, 0.10, 0, 0, 0.11, 1, 1, 0.12, 0,
      1, 0.12, 0, 0, 0.11, 1, 1, 0.13, 1,
    ]);
    smoothInlandWaterNormals(geometry);
    const normals = geometry.getAttribute('normal');
    expect(normals.getY(0)).toBeGreaterThan(0.95);
    // Shared physical points receive the same averaged normal even though the geometry is non-indexed.
    expect(normals.getX(2)).toBeCloseTo(normals.getX(3), 6);
    expect(normals.getY(2)).toBeCloseTo(normals.getY(3), 6);
    expect(normals.getZ(2)).toBeCloseTo(normals.getZ(3), 6);
    geometry.dispose();
  });

});
