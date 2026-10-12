import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../src/sim/prng';
import { ZoneIndex, type CircularZone } from '../src/render/vegetation/ZoneIndex';

describe('zone index', () => {
  it('answers exactly what a linear scan over every zone answers', () => {
    const random = new SeededRandom('zone-index');
    for (let trial = 0; trial < 20; trial += 1) {
      const zones: CircularZone[] = Array.from({ length: random.int(0, 80) }, () => ({
        x: random.range(-60, 60), z: random.range(-60, 60), radius: random.range(-1, 14),
      }));
      if (trial % 5 === 0) zones.push({ x: 3, z: -4, radius: Infinity }, { x: 0, z: 0, radius: 0 });
      const margin = trial % 2 ? 0.35 : 0;
      const index = new ZoneIndex(zones, margin);
      for (let probe = 0; probe < 400; probe += 1) {
        const x = random.range(-75, 75), z = random.range(-75, 75);
        const expected = zones.some(zone => Math.hypot(x - zone.x, z - zone.z) < zone.radius + margin);
        expect(index.contains(x, z)).toBe(expected);
      }
    }
  });

  it('treats points exactly on a cell boundary or zone edge like the scan', () => {
    const zones = [{ x: 8, z: 8, radius: 8 }, { x: -16, z: 0, radius: 4 }];
    const index = new ZoneIndex(zones);
    for (const [x, z] of [[0, 8], [16, 8], [8, 0], [-20, 0], [-12, 0], [-16, 4], [8, 16], [24, 24]] as const) {
      expect(index.contains(x, z)).toBe(zones.some(zone => Math.hypot(x - zone.x, z - zone.z) < zone.radius));
    }
  });
});
