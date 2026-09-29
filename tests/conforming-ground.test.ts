import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TerrainField } from '../src/sim/terrain/TerrainField';
import { conformGroundGeometry, renderedGroundSampler } from '../src/render/terrain/ConformingGround';

const terrain = { resolution: 4, step: 1, originX: 0, originZ: 0 } as TerrainField;
const height = (x: number, z: number) => Math.sin(x * 2.4) * 0.6 + Math.cos(z * 2.1) * 0.4;

describe('Terrain-conforming ground covers', () => {
  it('splits broad covers over ridges without holes, buried interiors or downward faces', () => {
    const points = [[0.1, 0.2], [2.8, 0.1], [2.6, 2.9], [0.2, 2.7]];
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(([x, z]) => [x!, height(x!, z!) + 0.016, z!]), 3));
    source.setIndex([0, 3, 1, 1, 3, 2]);
    const result = conformGroundGeometry(source, terrain, height);
    const position = result.getAttribute('position');
    const surface = renderedGroundSampler(terrain, height);
    expect(position.count).toBeGreaterThan(6);
    let area = 0;
    for (let i = 0; i < position.count; i += 3) {
      const p = [0, 1, 2].map(n => new THREE.Vector3().fromBufferAttribute(position, i + n));
      const normal = p[1]!.clone().sub(p[0]!).cross(p[2]!.clone().sub(p[0]!));
      expect(normal.y).toBeGreaterThan(0);
      area += normal.y / 2;
      // Interior coverage matters: vertex-only checks missed the original clipping.
      for (const weights of [[1 / 3, 1 / 3, 1 / 3], [0.1, 0.6, 0.3], [0.8, 0.1, 0.1]]) {
        const q = p.reduce((sum, v, k) => sum.addScaledVector(v, weights[k]!), new THREE.Vector3());
        expect(q.y - surface(q.x, q.z)).toBeCloseTo(0.016, 5);
      }
    }
    const polygonArea = Math.abs(points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length]!;
      return sum + p[0]! * q[1]! - q[0]! * p[1]!;
    }, 0)) / 2;
    expect(area).toBeCloseTo(polygonArea, 5);
    source.dispose(); result.dispose();
  });

  it('matches both alternating terrain diagonals independently of smooth height interpolation', () => {
    const sample = renderedGroundSampler(terrain, height);
    expect(sample(0.2, 0.3)).toBeCloseTo(height(0, 0) * 0.5 + height(1, 0) * 0.2 + height(0, 1) * 0.3);
    expect(sample(1.2, 0.7)).toBeCloseTo(height(1, 0) * 0.3 + height(1, 1) * 0.5 + height(2, 1) * 0.2);
  });
});
