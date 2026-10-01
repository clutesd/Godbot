import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater } from '../src/render/terrain/WaterSystem';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';
import { renderedGroundColorSampler } from '../src/render/terrain/WaterGround';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import * as THREE from 'three';
import { terrainDiagonalAD } from '../src/sim/terrain/TerrainTopology';
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
  it('clips reconstructed water against real terrain without lowering or burying vertices', () => {
    // This generated terrain has four cliff vertices that the old per-face stabilization buried.
    const world = new Simulation({ seed: 'water-performance-check', startingPopulation: 20,
      world: { size: 32 }, settlementCount: [2, 2] }).state.world;
    const levels = world.terrain.waterLevel.slice();
    const water = buildInlandWater(world)!;
    const p = water.geometry.getAttribute('position');
    const ground = renderedGroundSampler(world);
    for (let i = 0; i < p.count; i++) {
      expect(p.getY(i) - ground(p.getX(i), p.getZ(i))).toBeGreaterThan(0.0001);
    }
    expect(world.terrain.waterLevel).toEqual(levels);
    water.geometry.dispose();
    (water.material as THREE.Material).dispose();
  });
  it('uses the rendered terrain palette and triangle interpolation beneath shallow water', () => {
    const world = fixture();
    const surface = new TerrainSurface(world);
    const mesh = surface.buildMesh('ground-colour');
    const colors = mesh.geometry.getAttribute('color');
    const sample = renderedGroundColorSampler(world, surface, 'ground-colour');
    const result = new THREE.Color();
    const field = world.terrain;
    for (const [x, z] of [[2, 2], [3, 2]]) {
      const a = z! * field.resolution + x!;
      // Centre of each diagonal: even cells interpolate B/C, odd cells interpolate A/D.
      const [i, j] = !terrainDiagonalAD(field, x!, z!) ? [a + 1, a + field.resolution] : [a, a + field.resolution + 1];
      sample(field.originX + (x! + 0.5) * field.step, field.originZ + (z! + 0.5) * field.step, result);
      expect(result.r).toBeCloseTo((colors.getX(i) + colors.getX(j)) / 2, 6);
      expect(result.g).toBeCloseTo((colors.getY(i) + colors.getY(j)) / 2, 6);
      expect(result.b).toBeCloseTo((colors.getZ(i) + colors.getZ(j)) / 2, 6);
    }
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
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
    const level = elevationToY(field.waterLevel[0]!, world.seaLevel);
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
        expect(Math.abs(y - level)).toBeLessThan(0.001);
        expect(y - ground(x, z)).toBeGreaterThan(0.00015);
      }
    }
    water.geometry.dispose();
  });

  it('keeps explicitly mapped waterfall discontinuities covered without crystalline ramps or deleted triangles', () => {
    const world = fixture();
    const field = world.terrain;
    const split = Math.floor(field.resolution / 2);
    field.lake.fill(0);
    field.river.fill(1);
    field.fall.fill(0);
    for (let i = 0; i < field.height.length; i++) {
      if (i % field.resolution < split) field.waterLevel[i] = world.seaLevel + 0.3;
    }
    if (field.drainage) {
      for (let z = 0; z < field.resolution; z++) {
        const upstream = z * field.resolution + split - 1;
        const downstream = upstream + 1;
        field.drainage.downstream[upstream] = downstream;
        field.fall[upstream] = 1;
      }
    }
    const water = buildInlandWater(world)!;
    const p = water.geometry.getAttribute('position');
    expect(p.count).toBeGreaterThan(0);
    for (let i = 0; i < p.count; i += 3) {
      const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i);
      const bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1);
      const cx = p.getX(i + 2), cy = p.getY(i + 2), cz = p.getZ(i + 2);
      const area = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
      const horizontal = Math.max(Math.hypot(bx - ax, bz - az), Math.hypot(cx - bx, cz - bz), Math.hypot(ax - cx, az - cz));
      const span = Math.max(ay, by, cy) - Math.min(ay, by, cy);
      expect(area).toBeGreaterThan(1e-10);
      expect(span).toBeLessThanOrEqual(Math.max(0.68, horizontal * 0.85) + 1e-5);
    }
    water.geometry.dispose();
  });

  it('keeps a steep ordinary river reach connected instead of splitting it into floating shelves', () => {
    const world = fixture();
    const field = world.terrain;
    const split = Math.floor(field.resolution / 2);
    field.lake.fill(0);
    field.river.fill(1);
    field.fall.fill(0);
    for (let i = 0; i < field.height.length; i++) {
      field.waterLevel[i] = i % field.resolution < split ? world.seaLevel + 0.30 : world.seaLevel + 0.10;
    }

    const water = buildInlandWater(world)!;
    const p = water.geometry.getAttribute('position');
    const boundaryX = field.originX + (split - 0.5) * field.step;
    const boundaryY: number[] = [];
    const shared = new Map<string, number>();
    const ground = renderedGroundSampler(world);
    for (let i = 0; i < p.count; i++) {
      // Sample intersections of the actual triangles with the section, not a particular
      // subdivision's vertices.
      if (i % 3 === 0) for (let edge = 0; edge < 3; edge++) {
        const a = i + edge, b = i + (edge + 1) % 3;
        if ((p.getX(a) - boundaryX) * (p.getX(b) - boundaryX) < 0) {
          const f = (boundaryX - p.getX(a)) / (p.getX(b) - p.getX(a));
          boundaryY.push(p.getY(a) + (p.getY(b) - p.getY(a)) * f);
        }
      }
      const key = `${p.getX(i)}:${p.getZ(i)}`;
      if (shared.has(key)) expect(p.getY(i)).toBeCloseTo(shared.get(key)!, 5);
      shared.set(key, p.getY(i));
      expect(p.getY(i) - ground(p.getX(i), p.getZ(i))).toBeGreaterThan(0.0001);
    }

    expect(boundaryY.length).toBeGreaterThan(0);
    expect(Math.max(...boundaryY) - Math.min(...boundaryY)).toBeLessThan(0.0002);
    water.geometry.dispose();
  });

  it('clips an isolated sample to a bounded footprint without square tile corners', () => {
    const world = fixture();
    const field = world.terrain;
    field.waterLevel.fill(-1);
    field.lake.fill(0);
    const x = Math.floor(field.resolution / 2);
    const z = Math.floor(field.resolution / 2);
    const index = z * field.resolution + x;
    field.waterLevel[index] = world.seaLevel + 0.10;
    field.lake[index] = 1;
    const water = buildInlandWater(world)!;
    const p = water.geometry.getAttribute('position');
    const cx = field.originX + x * field.step;
    const cz = field.originZ + z * field.step;
    const unique = new Set<string>();
    let squareCorners = 0;
    for (let i = 0; i < p.count; i++) {
      const dx = Math.abs(p.getX(i) - cx) / field.step;
      const dz = Math.abs(p.getZ(i) - cz) / field.step;
      // Past its own sample the shoreline belongs to the terrain, but never beyond one sample.
      expect(dx).toBeLessThanOrEqual(1.001);
      expect(dz).toBeLessThanOrEqual(1.001);
      if (dx > 0.99 && dz > 0.99) squareCorners += 1;
      unique.add(`${p.getX(i).toFixed(4)}:${p.getZ(i).toFixed(4)}`);
    }
    expect(unique.size).toBeGreaterThanOrEqual(5);
    expect(squareCorners).toBe(0);
    water.geometry.dispose();
  });

  it('only reaches past the wet footprint over ground that is already under the water surface', () => {
    const world = fixture();
    const field = world.terrain;
    field.waterLevel.fill(-1);
    field.lake.fill(0);
    const half = Math.floor(field.resolution / 2);
    // A lake filling one half of the map, against a bank that climbs steeply out of it.
    for (let z = 0; z < field.resolution; z += 1) for (let x = 0; x < field.resolution; x += 1) {
      const index = z * field.resolution + x;
      if (x < half) {
        field.height[index] = world.seaLevel + 0.02;
        field.waterLevel[index] = world.seaLevel + 0.10;
        field.lake[index] = 1;
      } else {
        field.height[index] = world.seaLevel + 0.02 + (x - half + 1) * 0.05;
      }
    }
    const water = buildInlandWater(world)!;
    const p = water.geometry.getAttribute('position');
    const ground = renderedGroundSampler(world);
    const lastWetX = field.originX + (half - 1) * field.step;
    let shore = 0;
    for (let i = 0; i < p.count; i += 1) {
      // Never dry land, and never further than one sample past the last wet sample.
      expect(p.getY(i)).toBeGreaterThan(ground(p.getX(i), p.getZ(i)));
      expect(p.getX(i)).toBeLessThanOrEqual(lastWetX + field.step * 1.001);
      if (p.getX(i) > lastWetX && p.getY(i) - ground(p.getX(i), p.getZ(i)) < 0.001) shore += 1;
    }
    // The wet-to-dry interval ends on terrain with zero depth, without a hanging lip.
    expect(shore).toBeGreaterThan(0);
    water.geometry.dispose();
  });
});
