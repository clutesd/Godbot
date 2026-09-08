import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { generateWorld, TERRAIN_SUBDIVISION } from '../src/sim/world';
import { sampleHeight } from '../src/sim/terrain/TerrainField';

const SEEDS = ['terrain-alpha', 'terrain-beta', 'placement-highlands'];

describe('Terrain synthesis', () => {
  it('produces the same landscape for the same seed', () => {
    const a = generateWorld(configWith({ seed: 'terrain-determinism' }));
    const b = generateWorld(configWith({ seed: 'terrain-determinism' }));
    expect(Array.from(a.terrain.height)).toEqual(Array.from(b.terrain.height));
    expect(a.landmarks).toEqual(b.landmarks);
  });

  it('gives every seed ocean, habitable lowland and high country', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(configWith({ seed }));
      const land = world.cells.filter((cell) => !cell.water);
      const ocean = world.cells.filter((cell) => cell.elevation < world.seaLevel);
      const mountains = world.cells.filter((cell) => cell.biome === 'mountain');
      expect(ocean.length / world.cells.length, seed).toBeGreaterThan(0.15);
      expect(ocean.length / world.cells.length, seed).toBeLessThan(0.65);
      expect(land.length, seed).toBeGreaterThan(world.cells.length * 0.3);
      expect(mountains.length, seed).toBeGreaterThan(4);
      expect(land.filter((cell) => cell.habitability > 0.45).length, seed).toBeGreaterThan(40);
    }
  });

  it('routes rivers downhill into lakes or the sea', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(configWith({ seed }));
      const { resolution, height, river, lake, waterLevel } = world.terrain;
      const surfaceAt = (index: number): number => {
        const water = waterLevel[index] ?? -1;
        return water >= 0 ? water : (height[index] ?? 1);
      };
      const offsets = [-1, 1, -resolution, resolution, -resolution - 1, -resolution + 1, resolution - 1, resolution + 1];
      let rivers = 0;
      let stranded = 0;
      for (let z = 1; z < resolution - 1; z += 1) {
        for (let x = 1; x < resolution - 1; x += 1) {
          const start = z * resolution + x;
          if (!river[start]) continue;
          rivers += 1;
          let cursor = start;
          let steps = 0;
          while ((height[cursor] ?? 1) >= world.seaLevel && steps < resolution * 4) {
            let next = -1;
            let lowest = surfaceAt(cursor);
            for (const offset of offsets) {
              const neighbour = cursor + offset;
              if (neighbour < 0 || neighbour >= height.length) continue;
              if ((waterLevel[neighbour] ?? -1) < 0) continue;
              if (surfaceAt(neighbour) < lowest) {
                lowest = surfaceAt(neighbour);
                next = neighbour;
              }
            }
            if (next < 0) break;
            cursor = next;
            steps += 1;
          }
          if ((height[cursor] ?? 1) >= world.seaLevel) stranded += 1;
        }
      }
      expect(rivers, `${seed} river samples`).toBeGreaterThan(60);
      expect(stranded, `${seed} rivers that never reach the sea`).toBe(0);
      expect(waterLevel.some((value, index) => lake[index] === 1 && value > world.seaLevel), seed).toBe(true);
    }
  });

  it('aligns the field with the simulation grid so cells and mesh agree', () => {
    const world = generateWorld(configWith({ seed: 'terrain-alignment' }));
    expect(world.terrain.resolution).toBe((world.size - 1) * TERRAIN_SUBDIVISION + 1);
    for (const cell of world.cells.filter((candidate) => candidate.x % 7 === 0 && candidate.z % 7 === 0)) {
      expect(sampleHeight(world.terrain, cell.worldX, cell.worldZ)).toBeCloseTo(cell.elevation, 5);
    }
  });

  it('names a small set of rare natural landmarks', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(configWith({ seed }));
      expect(world.landmarks.length, seed).toBeGreaterThan(0);
      expect(world.landmarks.length, seed).toBeLessThanOrEqual(12);
      const kinds = new Set(world.landmarks.map((landmark) => landmark.kind));
      expect(kinds.size, seed).toBeGreaterThan(1);
    }
  });
});
