import { describe, expect, it } from 'vitest';
import { erodeMountainDrainage } from '../src/sim/terrain/MountainErosion';

describe('mountain drainage erosion', () => {
  it('carves converging upland drainage while preserving lowlands and downhill outlets', () => {
    const resolution = 41;
    const before = Float32Array.from({ length: resolution * resolution }, (_, i) => {
      const x = i % resolution - 20;
      const z = Math.floor(i / resolution);
      return 0.35 + z * 0.012 + Math.abs(x) * 0.004;
    });
    const height = before.slice();
    erodeMountainDrainage(height, resolution, 0.75, 0.35);
    let carved = 0;
    for (let i = 0; i < height.length; i += 1) {
      expect(Number.isFinite(height[i])).toBe(true);
      expect(height[i]!).toBeLessThanOrEqual(before[i]!);
      if (before[i]! <= 0.49) expect(height[i]).toBe(before[i]);
      if (before[i]! - height[i]! > 0.001) carved += 1;
      // This sloping basin must retain an escape to a lower neighbour after erosion.
      const x = i % resolution;
      const z = Math.floor(i / resolution);
      if (z > 0 && x > 0 && x < resolution - 1) {
        const neighbours = [-1, 1, -resolution, -resolution - 1, -resolution + 1];
        expect(neighbours.some(offset => height[i + offset]! < height[i]!)).toBe(true);
      }
    }
    expect(carved).toBeGreaterThan(resolution);
    const repeat = before.slice();
    erodeMountainDrainage(repeat, resolution, 0.75, 0.35);
    expect(repeat).toEqual(height);
  });

  it('leaves flat terrain unchanged', () => {
    const height = new Float32Array(81).fill(0.75);
    erodeMountainDrainage(height, 9, 1, 0.35);
    expect(height.every(value => value === 0.75)).toBe(true);
  });
});
