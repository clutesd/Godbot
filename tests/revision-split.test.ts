import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configWith } from '../src/config';
import { WeatherRenderer } from '../src/render/atmosphere/WeatherRenderer';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';
import { generateWorld } from '../src/sim/world';

describe('weather and topology revision split', () => {
  it('keeps topology stable for ordinary weather and advances it when the fine wet footprint changes', () => {
    const config = configWith({ seed: 'revision-split-topology', world: { size: 12, seaLevel: 0.28 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    world.environmentRevision = 0;

    const internals = weather as unknown as {
      hydrology: { advance: (conditions: typeof weather.state.cells) => void };
    };

    // A month of weather with no hydrology footprint change must not invalidate topology consumers.
    internals.hydrology.advance = () => {};
    weather.advanceMonth();
    expect(world.environmentRevision).toBe(0);

    const dryIndex = world.terrain.waterLevel.findIndex((level, index) => level < 0
      && world.terrain.height[index]! >= world.seaLevel
      && !world.terrain.river[index]
      && !world.terrain.lake[index]);
    expect(dryIndex).toBeGreaterThanOrEqual(0);

    // A new fine-water sample is a real traversal/geometry change and must invalidate once.
    internals.hydrology.advance = () => {
      world.terrain.waterLevel[dryIndex] = world.terrain.height[dryIndex]! + 0.02;
    };
    weather.advanceMonth();
    expect(world.environmentRevision).toBe(1);
  });

  it('refreshes weather presentation from the weather month without requiring a topology revision', () => {
    const config = configWith({ seed: 'revision-split-render', world: { size: 12 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const renderer = new WeatherRenderer(world, new TerrainSurface(world), config.seed);
    const camera = new THREE.PerspectiveCamera();
    const index = world.cells.findIndex((cell) => !cell.water);
    expect(index).toBeGreaterThanOrEqual(0);

    const pixels = renderer.texture.image.data!;
    const before = pixels[index * 4]!;
    const topologyRevision = world.environmentRevision ?? 0;
    const cell = weather.state.cells[index]!;
    cell.wind = 1;
    cell.windX = -1;
    cell.windZ = 0;
    weather.state.month += 1;

    renderer.update(1, 1, camera);
    expect(pixels[index * 4]).not.toBe(before);
    expect(world.environmentRevision ?? 0).toBe(topologyRevision);
    renderer.dispose();
  });
});
