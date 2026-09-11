import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { DynamicHydrology, MAX_DYNAMIC_FLOOD_DEPTH } from '../src/sim/terrain/Hydrology';
import { elevationFromY, elevationToY } from '../src/sim/terrain/SurfaceGeometry';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';

const maximum = (values: Float32Array): number => {
  let result = 0;
  for (const value of values) result = Math.max(result, value);
  return result;
};

const flooded = (values: Float32Array): number => {
  let result = 0;
  for (const value of values) if (value > 0.005) result += 1;
  return result;
};

describe('Volume-routed dynamic flooding', () => {
  it('keeps extreme storm inundation local-depth bounded instead of propagating a mountain-high surface', () => {
    const config = configWith({ seed: 'bounded-flood-head', world: { size: 24 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const baseWater = world.terrain.waterLevel.slice();
    const hydrology = new DynamicHydrology(world);

    for (let month = 0; month < 10; month += 1) {
      for (const conditions of weather.state.cells) conditions.runoff = 0.52;
      hydrology.advance(weather.state.cells);
    }

    expect(flooded(world.terrain.floodDepth)).toBeGreaterThan(0);
    expect(maximum(world.terrain.floodDepth)).toBeLessThanOrEqual(MAX_DYNAMIC_FLOOD_DEPTH + 1e-6);

    let projectedFloods = 0;
    for (let index = 0; index < world.terrain.height.length; index += 1) {
      const depth = world.terrain.floodDepth[index]!;
      if (depth <= 0.005 || baseWater[index]! >= 0) continue;
      projectedFloods += 1;
      expect(world.terrain.waterLevel[index]).toBeGreaterThanOrEqual(0);
      const surfaceY = elevationToY(world.terrain.waterLevel[index]!, world.seaLevel);
      const groundY = elevationToY(world.terrain.height[index]!, world.seaLevel);
      expect(surfaceY - groundY).toBeLessThanOrEqual(MAX_DYNAMIC_FLOOD_DEPTH + 0.003);
    }
    expect(projectedFloods).toBeGreaterThan(0);
  });

  it('spends floodwater downhill and recedes after forcing ends', () => {
    const config = configWith({ seed: 'flood-recession-volume', world: { size: 20 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const hydrology = new DynamicHydrology(world);

    for (let month = 0; month < 8; month += 1) {
      for (const conditions of weather.state.cells) conditions.runoff = 0.42;
      hydrology.advance(weather.state.cells);
    }
    const peakDepth = maximum(world.terrain.floodDepth);
    const peakArea = flooded(world.terrain.floodDepth);
    expect(peakDepth).toBeGreaterThan(0.01);
    expect(peakArea).toBeGreaterThan(0);

    for (let month = 0; month < 36; month += 1) {
      for (const conditions of weather.state.cells) conditions.runoff = 0;
      hydrology.advance(weather.state.cells);
    }
    expect(maximum(world.terrain.floodDepth)).toBeLessThan(peakDepth * 0.2);
    expect(flooded(world.terrain.floodDepth)).toBeLessThan(peakArea);
  });

  it('round-trips world-space flood height through the canonical elevation projection', () => {
    const seaLevel = 0.34;
    for (const elevation of [0.35, 0.5, 0.72, 0.96]) {
      const baseY = elevationToY(elevation, seaLevel);
      const desiredY = baseY + 0.63;
      const projected = elevationFromY(desiredY, seaLevel);
      expect(elevationToY(projected, seaLevel)).toBeCloseTo(desiredY, 3);
    }
  });
});
