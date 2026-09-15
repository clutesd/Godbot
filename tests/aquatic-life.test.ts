import { describe, expect, it } from 'vitest';
import { planKoiSchools } from '../src/render/terrain/AquaticLifeRenderer';
import type { TerrainField } from '../src/sim/terrain/TerrainField';

function standingWaterField(river = false): TerrainField {
  const resolution = 13;
  const samples = resolution * resolution;
  const downstream = new Int32Array(samples).fill(-1);
  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution - 1; x += 1) downstream[z * resolution + x] = z * resolution + x + 1;
  }
  return {
    resolution,
    step: 0.32,
    originX: -1.92,
    originZ: -1.92,
    height: new Float32Array(samples).fill(0.4),
    waterLevel: new Float32Array(samples).fill(0.42),
    flow: new Float32Array(samples).fill(river ? 0.48 : 0),
    rock: new Float32Array(samples),
    lake: new Uint8Array(samples).fill(1),
    river: new Uint8Array(samples).fill(river ? 1 : 0),
    fall: new Float32Array(samples),
    drainage: { downstream, order: [], accumulation: new Float32Array(samples).fill(4) },
  };
}

function coastalField(): TerrainField {
  const field = standingWaterField();
  field.height.fill(0.31);
  field.waterLevel.fill(-1);
  field.lake.fill(0);
  field.river.fill(0);
  return field;
}

function routeSpan(route: readonly { x: number; z: number }[]): number {
  let span = 0;
  for (const a of route) {
    for (const b of route) span = Math.max(span, Math.hypot(a.x - b.x, a.z - b.z));
  }
  return span;
}

describe('koi aquatic life planning', () => {
  it('creates deterministic lake schools with traversing swim routes', () => {
    const field = standingWaterField();
    const first = planKoiSchools(field, 0.35, 42.75, 2);
    const replay = planKoiSchools(field, 0.35, 42.75, 2);

    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(16);
    expect(replay).toEqual(first);
    expect(first.every(school => school.kind === 'lake' && school.depth > 0.075 && school.waterY > 0)).toBe(true);
    expect(first.every(school => school.route.length >= 2)).toBe(true);
    expect(first.some(school => routeSpan(school.route) > field.step * 2)).toBe(true);
  });

  it('creates current-aware river routes that travel along the channel', () => {
    const field = standingWaterField(true);
    const schools = planKoiSchools(field, 0.35, 12.5, 2);
    expect(schools.length).toBeGreaterThan(0);
    expect(schools.length).toBeLessThanOrEqual(16);
    expect(schools.every(school => school.kind === 'river')).toBe(true);
    expect(schools.every(school => Math.hypot(school.flowX, school.flowZ) > 0.9)).toBe(true);
    expect(schools.every(school => school.route.length >= 3)).toBe(true);
    expect(schools.every(school => routeSpan(school.route) >= field.step * 2)).toBe(true);
  });

  it('creates human-adjacent coastal schools with open-water routes', () => {
    const field = coastalField();
    const schools = planKoiSchools(field, 0.35, 18.5, 2, [{ x: 0, z: 0 }]);
    expect(schools.length).toBeGreaterThan(0);
    expect(schools.some(school => school.kind === 'coast')).toBe(true);
    expect(schools.every(school => school.humanProximity > 0.08)).toBe(true);
    expect(schools.some(school => school.route.length >= 3 && routeSpan(school.route) > field.step * 2)).toBe(true);
  });

  it('respects the zero-complexity visual budget', () => {
    expect(planKoiSchools(standingWaterField(), 0.35, 12.5, 0)).toEqual([]);
  });
});
