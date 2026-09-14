import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configWith } from '../src/config';
import { WeatherRenderer } from '../src/render/atmosphere/WeatherRenderer';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';
import { generateWorld } from '../src/sim/world';

describe('weather and topology revision split', () => {
  it('keeps topology stable for ordinary weather and invalidates only during dynamic flood/recession', () => {
    const config = configWith({ seed: 'revision-split-topology', world: { size: 12, seaLevel: 0.28 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    world.environmentRevision = 0;

    const internals = weather as unknown as {
      hydrology: {
        advance: (conditions: typeof weather.state.cells) => void;
        lastBudget: { floodedStorage: number };
      };
    };

    // Ordinary weather must not invalidate topology consumers. The hydrology solver has already
    // visited the fine field, so WeatherSystem should not rescan/hash that field just to prove it.
    internals.hydrology.advance = () => { internals.hydrology.lastBudget.floodedStorage = 0; };
    weather.advanceMonth();
    expect(world.environmentRevision).toBe(0);

    // Dynamic floodwater makes the fine wet footprint potentially different, so presentation and
    // traversal consumers receive one conservative topology revision for that month.
    internals.hydrology.advance = () => { internals.hydrology.lastBudget.floodedStorage = 0.25; };
    weather.advanceMonth();
    expect(world.environmentRevision).toBe(1);

    // The first dry month invalidates once more so flood recession is visible.
    internals.hydrology.advance = () => { internals.hydrology.lastBudget.floodedStorage = 0; };
    weather.advanceMonth();
    expect(world.environmentRevision).toBe(2);

    // Once dry topology is settled, later ordinary months stay quiet again.
    weather.advanceMonth();
    expect(world.environmentRevision).toBe(2);
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
