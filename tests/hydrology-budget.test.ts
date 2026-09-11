import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { DynamicHydrology } from '../src/sim/terrain/Hydrology';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';
import { generateWorld } from '../src/sim/world';

describe('mass-balanced dynamic hydrology', () => {
  it('conserves routed runoff across storage and outlet loss', () => {
    const config = configWith({ seed: 'hydrology-budget', world: { size: 20 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const hydrology = new DynamicHydrology(world);
    for (let index = 0; index < weather.state.cells.length; index += 1) {
      weather.state.cells[index]!.runoff = 0.015 + index % 7 * 0.004;
    }

    hydrology.advance(weather.state.cells);
    const budget = hydrology.lastBudget;
    const expectedInput = weather.state.cells.reduce((total, cell) => total + cell.runoff, 0);
    const scale = Math.max(1, budget.startingStorage + budget.runoffInput);

    expect(budget.runoffInput).toBeCloseTo(expectedInput, 10);
    expect(budget.endingStorage).toBeGreaterThanOrEqual(0);
    expect(budget.outletLoss).toBeGreaterThanOrEqual(0);
    expect(Math.abs(budget.massError)).toBeLessThan(scale * 1e-10);
  });

  it('preserves catchment size instead of reducing discharge to average upstream wetness', () => {
    const config = configWith({ seed: 'hydrology-catchment', world: { size: 24 } });
    const world = generateWorld(config);
    const drainage = world.terrain.drainage!;
    const riverSamples = Array.from(world.terrain.river.keys())
      .filter((index) => world.terrain.river[index] === 1 && world.terrain.height[index]! >= world.seaLevel)
      .sort((a, b) => drainage.accumulation[a]! - drainage.accumulation[b]!);
    expect(riverSamples.length).toBeGreaterThan(8);
    for (const index of riverSamples) world.terrain.flow[index] = 0.5;

    const weather = new WeatherSystem(world, config);
    const hydrology = new DynamicHydrology(world);
    for (const cell of weather.state.cells) cell.runoff = 0.035;
    hydrology.advance(weather.state.cells);

    const low = riverSamples[Math.floor(riverSamples.length * 0.25)]!;
    const high = riverSamples[Math.floor(riverSamples.length * 0.8)]!;
    expect(drainage.accumulation[high]).toBeGreaterThan(drainage.accumulation[low]! * 1.5);
    expect(world.terrain.flow[high]).toBeGreaterThan(world.terrain.flow[low]!);
  });

  it('draws inland water below its generated baseline during prolonged drought and recovers with runoff', () => {
    const config = configWith({ seed: 'hydrology-drought', world: { size: 24 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const sample = Array.from(world.terrain.river.keys()).find((index) =>
      world.terrain.river[index] === 1 && world.terrain.height[index]! >= world.seaLevel && world.terrain.waterLevel[index]! >= 0,
    )!;
    const baseline = world.terrain.waterLevel[sample]!;
    const hydrology = new DynamicHydrology(world);
    for (const cell of weather.state.cells) cell.runoff = 0;
    for (let month = 0; month < 8; month += 1) hydrology.advance(weather.state.cells);
    const droughtLevel = world.terrain.waterLevel[sample]!;
    expect(droughtLevel < 0 || droughtLevel < baseline).toBe(true);
    const droughtFlow = world.terrain.flow[sample]!;

    for (const cell of weather.state.cells) cell.runoff = 0.06;
    for (let month = 0; month < 4; month += 1) hydrology.advance(weather.state.cells);
    expect(world.terrain.flow[sample]).toBeGreaterThan(droughtFlow);
    expect(world.terrain.waterLevel[sample]).toBeGreaterThan(droughtLevel);
  });

  it('releases floodplain storage after runoff stops without losing mass internally', () => {
    const config = configWith({ seed: 'hydrology-recession', world: { size: 20 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const hydrology = new DynamicHydrology(world);
    for (const cell of weather.state.cells) cell.runoff = 0.16;
    for (let month = 0; month < 5; month += 1) hydrology.advance(weather.state.cells);
    const peakFloodStorage = hydrology.lastBudget.floodedStorage;
    expect(peakFloodStorage).toBeGreaterThanOrEqual(0);

    for (const cell of weather.state.cells) cell.runoff = 0;
    for (let month = 0; month < 18; month += 1) {
      hydrology.advance(weather.state.cells);
      const budget = hydrology.lastBudget;
      const scale = Math.max(1, budget.startingStorage);
      expect(Math.abs(budget.massError)).toBeLessThan(scale * 1e-10);
    }
    expect(hydrology.lastBudget.floodedStorage).toBeLessThanOrEqual(peakFloodStorage);
  });
});
