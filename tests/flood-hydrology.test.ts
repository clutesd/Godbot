import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { DynamicHydrology } from '../src/sim/terrain/Hydrology';
import { elevationToY, surfaceHeightAt } from '../src/sim/terrain/SurfaceGeometry';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';

function maximum(values: Float32Array): number {
  let max = 0;
  for (const value of values) max = Math.max(max, value);
  return max;
}

describe('finite-volume dynamic flooding', () => {
  it('keeps temporary flood depth separate from permanent river and lake geography', () => {
    const world = generateWorld(configWith({ seed: 'flood-field-separation', world: { size: 20 } }));
    expect(world.terrain.floodDepth).toBeInstanceOf(Float32Array);
    expect(world.terrain.floodDepth.length).toBe(world.terrain.height.length);
    expect(maximum(world.terrain.floodDepth)).toBe(0);
    expect(world.terrain.waterLevel.some(level => level >= 0)).toBe(true);
  });

  it('cannot turn an upland flood source into a mountain-high downstream water sheet', () => {
    const config = configWith({ seed: 'bounded-flood-surface', world: { size: 24 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const permanent = world.terrain.waterLevel.slice();
    const hydrology = new DynamicHydrology(world);
    for (let month = 0; month < 14; month += 1) {
      for (const cell of weather.state.cells) cell.runoff = 0.55;
      hydrology.advance(weather.state.cells);
    }

    expect(maximum(world.terrain.floodDepth)).toBeGreaterThan(0);
    expect(maximum(world.terrain.floodDepth)).toBeLessThanOrEqual(1.100001);

    let transientSamples = 0;
    for (let index = 0; index < world.terrain.height.length; index += 1) {
      if (permanent[index]! >= 0 || world.terrain.floodDepth[index]! <= 0.005) continue;
      transientSamples += 1;
      const x = world.terrain.originX + index % world.terrain.resolution * world.terrain.step;
      const z = world.terrain.originZ + Math.floor(index / world.terrain.resolution) * world.terrain.step;
      const surface = elevationToY(world.terrain.waterLevel[index]!, world.seaLevel);
      const ground = surfaceHeightAt(world, x, z);
      expect(surface - ground).toBeLessThanOrEqual(1.11);
    }
    expect(transientSamples).toBeGreaterThan(0);
  });

  it('recedes after runoff ends instead of retaining a propagated absolute water table', () => {
    const config = configWith({ seed: 'flood-recession-volume', world: { size: 20 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const hydrology = new DynamicHydrology(world);
    for (let month = 0; month < 10; month += 1) {
      for (const cell of weather.state.cells) cell.runoff = 0.5;
      hydrology.advance(weather.state.cells);
    }
    const peak = maximum(world.terrain.floodDepth);
    expect(peak).toBeGreaterThan(0);
    for (let month = 0; month < 30; month += 1) {
      for (const cell of weather.state.cells) cell.runoff = 0;
      hydrology.advance(weather.state.cells);
    }
    expect(maximum(world.terrain.floodDepth)).toBeLessThan(peak * 0.15);
  });

  it('replays the same flood-depth field exactly from the same seed and runoff history', () => {
    const run = () => {
      const config = configWith({ seed: 'flood-depth-replay', world: { size: 18 } });
      const world = generateWorld(config);
      const weather = new WeatherSystem(world, config);
      const hydrology = new DynamicHydrology(world);
      for (let month = 0; month < 12; month += 1) {
        for (let index = 0; index < weather.state.cells.length; index += 1) {
          weather.state.cells[index]!.runoff = ((index * 17 + month * 11) % 31) / 90;
        }
        hydrology.advance(weather.state.cells);
      }
      return Array.from(world.terrain.floodDepth);
    };
    expect(run()).toEqual(run());
  });
});
