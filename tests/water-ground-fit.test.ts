import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater } from '../src/render/terrain/WaterSystem';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';
import { elevationToY } from '../src/sim/terrain/SurfaceGeometry';

function fixture() {
  const world = new Simulation({ seed: 'water-ground-fit', startingPopulation: 12,
    world: { size: 12 }, settlementCount: [1, 1] }).state.world;
  world.terrain.height.fill(world.seaLevel + 0.02);
  world.terrain.waterLevel.fill(world.seaLevel + 0.10);
  world.terrain.lake.fill(1);
  world.terrain.river.fill(0);
  return world;
}

describe('water fits the rendered earth', () => {
  it('keeps lake faces level and clips their entire area above alternating ground triangles', () => {
    const world = fixture();
    const field = world.terrain;
    // A jagged island exercises both diagonal orientations and shoreline intersections.
    for (let z = 2; z < field.resolution - 2; z++) {
      for (let x = 2; x < field.resolution - 2; x++) {
        if ((x + z * 3) % 7 === 0) field.height[z * field.resolution + x] = world.seaLevel + 0.16;
      }
    }
    const water = buildInlandWater(world)!;
    const p = water.geometry.getAttribute('position');
    const ground = renderedGroundSampler(world);
    const level = elevationToY(field.waterLevel[0]!, world.seaLevel) + 0.002;
    for (let i = 0; i < p.count; i += 3) {
      const area = Math.abs((p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i))
        - (p.getZ(i + 1) - p.getZ(i)) * (p.getX(i + 2) - p.getX(i)));
      expect(area).toBeGreaterThan(1e-10);
      for (const weights of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]) {
        let x = 0, y = 0, z = 0;
        for (let j = 0; j < 3; j++) {
          x += p.getX(i + j) * weights[j]!;
          y += p.getY(i + j) * weights[j]!;
          z += p.getZ(i + j) * weights[j]!;
        }
        expect(y).toBeCloseTo(level, 5);
        expect(y - ground(x, z)).toBeGreaterThan(-0.00001);
      }
    }
    water.geometry.dispose();
  });

  it('does not bridge a waterfall with a sloping crystalline surface or deleted faces', () => {
    const world = fixture();
    const field = world.terrain;
    for (let i = 0; i < field.height.length; i++) {
      if (i % field.resolution < Math.floor(field.resolution / 2)) field.waterLevel[i] = world.seaLevel + 0.3;
    }
    const water = buildInlandWater(world)!;
    const p = water.geometry.getAttribute('position');
    // Both pools remain horizontal right to their lips, with complete coverage.
    expect(p.count).toBe(field.height.length * 24);
    for (let i = 0; i < p.count; i += 3) {
      expect(p.getY(i)).toBe(p.getY(i + 1));
      expect(p.getY(i)).toBe(p.getY(i + 2));
    }
    water.geometry.dispose();
  });
});
