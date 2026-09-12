import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { packInlandAttributes, stabilizeInlandWaterGeometry } from '../src/render/terrain/WaterAttributes';

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

describe('Inland water discontinuity guard', () => {
  it('collapses a cliff-like water triangle instead of rendering a crystalline spike', () => {
    const geometry = waterGeometry([
      0, 0.02, 0,
      0.5, 3.2, 0.5,
      1, 0.03, 0,
    ]);
    expect(triangleArea(geometry.getAttribute('position'))).toBeGreaterThan(1);

    packInlandAttributes(geometry);

    expect(triangleArea(geometry.getAttribute('position'))).toBeLessThan(1e-6);
    expect(geometry.getAttribute('waterPacked0').count).toBe(3);
    geometry.dispose();
  });

  it('preserves ordinary water gradients and small wave-scale height differences', () => {
    const geometry = waterGeometry([
      0, 0.10, 0,
      0.5, 0.18, 0.5,
      1, 0.12, 0,
    ]);
    const position = geometry.getAttribute('position');
    const before = [position.getY(0), position.getY(1), position.getY(2)];

    expect(stabilizeInlandWaterGeometry(geometry)).toBe(0);
    const after = geometry.getAttribute('position');
    expect([after.getY(0), after.getY(1), after.getY(2)]).toEqual(before);
    expect(triangleArea(after)).toBeGreaterThan(0.2);
    geometry.dispose();
  });

  it('removes either a high or low lone outlier while leaving the neighbouring lip intact', () => {
    const highSpike = waterGeometry([0, 0, 0, 0.5, 2.4, 0.5, 1, 0.04, 0]);
    const lowSpike = waterGeometry([0, 2.2, 0, 0.5, 0.02, 0.5, 1, 2.18, 0]);

    expect(stabilizeInlandWaterGeometry(highSpike)).toBe(1);
    expect(stabilizeInlandWaterGeometry(lowSpike)).toBe(1);
    expect(triangleArea(highSpike.getAttribute('position'))).toBeLessThan(1e-6);
    expect(triangleArea(lowSpike.getAttribute('position'))).toBeLessThan(1e-6);

    highSpike.dispose();
    lowSpike.dispose();
  });
});
