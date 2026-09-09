import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { WeatherRenderer } from '../src/render/atmosphere/WeatherRenderer';
import { Simulation } from '../src/sim/Simulation';

describe('Weather presentation', () => {
  it('eases the shared ground and roof snow input through accumulation, cold persistence and thaw', () => {
    const config = configWith({ seed: 'snow-material-cycle', world: { size: 12 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const renderer = new WeatherRenderer(world, new TerrainSurface(world), config.seed);
    const camera = new THREE.PerspectiveCamera();
    const cell = world.cells.find((entry) => !entry.water)!;
    const index = cell.z * world.size + cell.x;
    const pixels = renderer.texture.image.data!;
    const display = () => pixels[index * 4 + 2]!;
    const update = (elapsed: number) => {
      world.environmentRevision = (world.environmentRevision ?? 0) + 1;
      const before = JSON.stringify(weather.state);
      renderer.update(1, elapsed, camera);
      expect(JSON.stringify(weather.state)).toBe(before);
    };
    cell.temperature = 0.2;
    weather.applyWeatherToCell(cell, { kind: 'heavy-snow', intensity: 1, wind: 0.2 }, 3);
    update(1);
    const target = weather.state.cells[index]!.snowpack * 255;
    expect(display()).toBeGreaterThan(0);
    expect(display()).toBeLessThan(target);
    for (let frame = 2; frame < 10; frame += 1) renderer.update(1, frame, camera);
    expect(display()).toBeCloseTo(Math.round(target), 0);
    const covered = display();
    weather.applyWeatherToCell(cell, { kind: 'clear', intensity: 0 }, 2);
    update(10);
    expect(display()).toBe(covered);
    expect(weather.state.cells[index]!.precipitation).toBe('none');
    cell.temperature = 0.9;
    weather.applyWeatherToCell(cell, { kind: 'clear', intensity: 0 });
    update(11);
    expect(display()).toBeGreaterThan(0);
    expect(display()).toBeLessThan(covered);
    expect(weather.state.cells[index]!.runoff).toBeGreaterThan(0);
    renderer.dispose();
  });

  it('presents denser local blizzard snow and clears severity when the camera leaves', () => {
    const config = configWith({ seed: 'blizzard-presentation', world: { size: 24 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const renderer = new WeatherRenderer(world, new TerrainSurface(world), config.seed);
    const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 200);
    camera.position.set(0, 25, 20);
    camera.lookAt(0, 0, 0);
    for (const cell of weather.state.cells) {
      cell.kind = 'heavy-snow'; cell.precipitation = 'snow'; cell.intensity = 1; cell.blizzard = 0;
    }
    renderer.update(1, 1, camera);
    const ordinary = renderer.report.snow;
    expect(ordinary).toBeGreaterThan(0);
    expect(renderer.report.blizzard).toBe(0);
    for (const cell of weather.state.cells) cell.blizzard = 1;
    const before = JSON.stringify(weather.state);
    renderer.update(1, 2, camera);
    expect(renderer.report.snow).toBeGreaterThan(ordinary);
    expect(renderer.report.snow).toBeLessThanOrEqual(renderer.report.budget);
    expect(renderer.report.blizzard).toBeGreaterThan(0.5);
    camera.position.set(1000, 20, 1000);
    camera.lookAt(1000, 0, 980);
    renderer.update(1, 3, camera);
    renderer.update(1, 4, camera);
    expect(renderer.report.blizzard).toBeLessThan(0.05);
    expect(renderer.report.snow).toBe(0);
    expect(JSON.stringify(weather.state)).toBe(before);
    renderer.dispose();
  });

  it('keeps complete headless history identical with renderer updates and different step chunk sizes', () => {
    const config = { seed: 'tornado-aftermath', startingPopulation: 40, world: { size: 20 }, settlementCount: [2, 2] as const };
    const observed = new Simulation(config);
    const headless = new Simulation(config);
    for (const simulation of [observed, headless]) {
      for (const cell of simulation.state.world.cells) cell.temperature = 0.45;
      simulation.state.weather.fronts = Array.from({ length: 4 }, (_, index) => ({
        id: `replay-winter-${index}`, kind: 'heavy-rain', x: 0, z: 0, radius: 1000,
        directionX: 1, directionZ: 0, velocity: 0, intensity: 1, wind: 0.9,
        lifespan: 3, ageMonths: 0, precipitation: 'rain', severity: 1,
      }));
    }
    expect(headless.state.settlements.length).toBeGreaterThan(0);
    const renderer = new WeatherRenderer(observed.state.world, new TerrainSurface(observed.state.world), config.seed);
    const camera = new THREE.PerspectiveCamera();
    for (let month = 0; month < 12; month += 1) {
      observed.step();
      if (month === 0) expect(observed.state.weather.cells.some((cell) => cell.snowpack > 0)).toBe(true);
      renderer.update(0.25, month, camera);
      renderer.update(1, month + 0.5, camera);
    }
    headless.step(12);
    expect(observed.state).toEqual(headless.state);
    renderer.dispose();
  });

  it('binds snow to upward-facing roofs and moves a funnel along authoritative paths', () => {
    const config = configWith({ seed: 'roof-funnel', world: { size: 20 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const renderer = new WeatherRenderer(world, new TerrainSurface(world), config.seed);
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial();
    const roof = new THREE.Mesh(new THREE.BoxGeometry(), material);
    roof.userData['weatherSurface'] = true;
    scene.add(roof);
    renderer.bindScene(scene);
    const callback = material.onBeforeCompile;
    renderer.bindScene(scene);
    expect(material.onBeforeCompile).toBe(callback);
    const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>' } as unknown as Parameters<typeof callback>[0];
    callback(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('weatherUp');
    expect(shader.fragmentShader).toContain('snowCover');
    expect(shader.fragmentShader).toContain('weatherUp * (1.0 - immersion)');
    weather.state.tornadoes.push({ id: 'funnel', frontId: 'storm', month: 0, intensity: 0.8, width: 1, speed: 10,
      lifetimeHours: 1, direction: { x: 1, z: 0 }, path: [{ x: -5, z: 0 }, { x: 5, z: 0 }] });
    const before = JSON.stringify(weather.state);
    const camera = new THREE.PerspectiveCamera();
    renderer.update(0.1, 0, camera);
    const funnel = renderer.group.getObjectByName('tornado-funnel')!;
    const firstX = funnel.position.x;
    renderer.update(0.1, 4, camera);
    expect(funnel.position.x).toBeGreaterThan(firstX);
    expect(funnel.visible).toBe(true);
    renderer.update(0.1, 9, camera);
    expect(funnel.visible).toBe(false);
    expect(JSON.stringify(weather.state)).toBe(before);
    renderer.dispose();
    roof.geometry.dispose();
    material.dispose();
  });

  it('keeps a bounded local pool, excludes off-camera precipitation, and never mutates simulation state', () => {
    const config = configWith({ seed: 'weather-pool', world: { size: 24 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const renderer = new WeatherRenderer(world, new TerrainSurface(world), config.seed);
    const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 200);
    camera.position.set(0, 25, 20);
    camera.lookAt(0, 0, 0);
    for (const cell of weather.state.cells) {
      cell.kind = 'rain'; cell.precipitation = 'rain'; cell.intensity = 1;
    }
    const before = JSON.stringify(weather.state);
    renderer.update(1, 1, camera);
    expect(renderer.report.rain).toBeGreaterThan(0);
    expect(renderer.report.rain + renderer.report.snow).toBeLessThanOrEqual(renderer.report.budget);
    camera.position.set(1000, 20, 1000);
    camera.lookAt(1000, 0, 980);
    renderer.update(1, 2, camera);
    expect(renderer.report.rain + renderer.report.snow).toBe(0);
    expect(JSON.stringify(weather.state)).toBe(before);
    renderer.dispose();
  });
});
