import { describe, expect, it } from 'vitest';
import { seasonalFoliage } from '../src/sim/weather/SeasonalState';
import { snowTravelMultiplier } from '../src/sim/transport/TerrainTraversal';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';

describe('Climate-aware foliage', () => {
  const temperate = { temperature: 0.46, moisture: 0.6 };
  it('keeps rail more resilient to snow than roads and undeveloped paths', () => {
    const config = configWith({ seed: 'snow-transport', world: { size: 12 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const cell = world.cells.find((entry) => !entry.water)!;
    weather.state.cells[cell.z * world.size + cell.x]!.snowpack = 0.8;
    const point = { x: cell.worldX, z: cell.worldZ };
    expect(snowTravelMultiplier(world, point, 'walk')).toBeGreaterThan(snowTravelMultiplier(world, point, 'road'));
    expect(snowTravelMultiplier(world, point, 'road')).toBeGreaterThan(snowTravelMultiplier(world, point, 'rail'));
    expect(snowTravelMultiplier(world, point, 'road', 1)).toBeLessThan(snowTravelMultiplier(world, point, 'road'));
  });
  it('grows in spring, colors in autumn and loses its canopy in winter', () => {
    expect(seasonalFoliage(2, temperate, { temperature: 0.45 }, false).canopy).toBeLessThan(1);
    expect(seasonalFoliage(5, temperate, { temperature: 0.62 }, false).canopy).toBe(1);
    expect(seasonalFoliage(8, temperate, { temperature: 0.5 }, false).autumn).toBeGreaterThan(0);
    expect(seasonalFoliage(9, temperate, { temperature: 0.4 }, false).leafFall).toBeGreaterThan(0);
    expect(seasonalFoliage(11, temperate, { temperature: 0.25 }, false).canopy).toBe(0);
    expect(seasonalFoliage(5, temperate, { temperature: 0.62 }, false).leafFall).toBe(0);
  });
  it('preserves evergreens and warm-climate foliage and staggers deterministic transitions', () => {
    expect(seasonalFoliage(11, temperate, { temperature: 0.25 }, true).canopy).toBe(1);
    expect(seasonalFoliage(11, { ...temperate, temperature: 0.75 }, { temperature: 0.6 }, false).canopy).toBe(1);
    const early = seasonalFoliage(9, temperate, { temperature: 0.4 }, false, 0.1);
    expect(early).toEqual(seasonalFoliage(9, temperate, { temperature: 0.4 }, false, 0.1));
    expect(early).not.toEqual(seasonalFoliage(9, temperate, { temperature: 0.4 }, false, 0.9));
  });
});