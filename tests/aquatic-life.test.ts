import { describe, expect, it } from 'vitest';
import { planKoiSchools } from '../src/render/terrain/AquaticLifeRenderer';
import type { TerrainField } from '../src/sim/terrain/TerrainField';

function standingWaterField(river = false): TerrainField {
  const resolution = 13;
  const samples = resolution * resolution;
  return {
    resolution,
    step: 0.32,
    originX: -1.92,
    originZ: -1.92,
    height: new Float32Array(samples).fill(0.4),
    waterLevel: new Float32Array(samples).fill(0.42),
    flow: new Float32Array(samples),
    rock: new Float32Array(samples),
    lake: new Uint8Array(samples).fill(1),
    river: new Uint8Array(samples).fill(river ? 1 : 0),
    fall: new Float32Array(samples),
  };
}

describe('koi aquatic life planning', () => {
  it('creates deterministic schools only in standing inland water', () => {
    const field = standingWaterField();
    const first = planKoiSchools(field, 0.35, 42.75, 2);
    const replay = planKoiSchools(field, 0.35, 42.75, 2);

    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(7);
    expect(replay).toEqual(first);
    expect(first.every(school => school.depth > 0.105 && school.waterY > 0)).toBe(true);
  });

  it('does not mistake river channels for ornamental lake habitat', () => {
    expect(planKoiSchools(standingWaterField(true), 0.35, 12.5, 2)).toEqual([]);
  });

  it('respects the zero-complexity visual budget', () => {
    expect(planKoiSchools(standingWaterField(), 0.35, 12.5, 0)).toEqual([]);
  });
});
