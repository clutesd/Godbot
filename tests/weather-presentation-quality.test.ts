import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { WeatherRenderer } from '../src/render/atmosphere/WeatherRenderer';

function cameraOverWorld(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 200);
  camera.position.set(0, 25, 20);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

describe('World-class weather presentation', () => {
  it('keeps precipitation bounded while using distinct depth layers for rain and snow', () => {
    const config = configWith({ seed: 'layered-weather', world: { size: 24 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const renderer = new WeatherRenderer(world, new TerrainSurface(world), config.seed);
    const camera = cameraOverWorld();

    for (const cell of weather.state.cells) {
      cell.kind = 'heavy-rain';
      cell.precipitation = 'rain';
      cell.intensity = 1;
      cell.wind = 0.65;
      cell.windX = 0.8;
      cell.windZ = 0.2;
    }
    renderer.update(1, 1, camera);
    expect(renderer.report.rain).toBeGreaterThan(0);
    expect(renderer.report.rain + renderer.report.snow).toBeLessThanOrEqual(renderer.report.budget);
    for (let layer = 0; layer < 3; layer += 1) expect(renderer.group.getObjectByName(`rain-layer-${layer}`)).toBeTruthy();

    for (const cell of weather.state.cells) {
      cell.kind = 'heavy-snow';
      cell.precipitation = 'snow';
      cell.intensity = 1;
      cell.blizzard = 0;
    }
    renderer.update(1, 2, camera);
    expect(renderer.report.snow).toBeGreaterThan(0);
    expect(renderer.report.rain + renderer.report.snow).toBeLessThanOrEqual(renderer.report.budget);
    const nearSnow = renderer.group.getObjectByName('snow-layer-0') as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    const midSnow = renderer.group.getObjectByName('snow-layer-1') as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    const farSnow = renderer.group.getObjectByName('snow-layer-2') as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    expect(nearSnow.material.size).toBeGreaterThan(midSnow.material.size);
    expect(midSnow.material.size).toBeGreaterThan(farSnow.material.size);
    renderer.dispose();
  });

  it('makes blizzards turbulent and prevents fog from ratcheting upward frame after frame', () => {
    const config = configWith({ seed: 'bounded-blizzard-fog', world: { size: 24 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const renderer = new WeatherRenderer(world, new TerrainSurface(world), config.seed);
    const camera = cameraOverWorld();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#899b91');
    scene.fog = new THREE.FogExp2('#93a5a4', 0.0072);
    renderer.bindScene(scene);

    for (const cell of weather.state.cells) {
      cell.kind = 'heavy-snow';
      cell.precipitation = 'snow';
      cell.intensity = 1;
      cell.wind = 0.95;
      cell.windX = 1;
      cell.windZ = 0;
      cell.blizzard = 1;
    }
    const before = JSON.stringify(weather.state);
    let peakDensity = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      renderer.update(0.1, frame * 0.1, camera);
      // Mirror GodboxRenderer's existing post-weather blizzard veil. WeatherRenderer must
      // rebase the next frame so this additive presentation cannot accumulate without bound.
      scene.fog.density += renderer.report.blizzard * 0.035;
      peakDensity = Math.max(peakDensity, scene.fog.density);
    }
    expect(renderer.report.blizzard).toBeGreaterThan(0.9);
    expect(peakDensity).toBeLessThan(0.065);
    expect(JSON.stringify(weather.state)).toBe(before);

    for (const cell of weather.state.cells) {
      cell.kind = 'clear';
      cell.precipitation = 'none';
      cell.intensity = 0;
      cell.blizzard = 0;
    }
    for (let frame = 0; frame < 12; frame += 1) renderer.update(1, 20 + frame, camera);
    expect(renderer.report.blizzard).toBeLessThan(0.01);
    expect(scene.fog.density).toBeCloseTo(0.0072, 3);
    renderer.dispose();
  });

  it('emits intermittent thunderstorm lightning without mutating simulation state and recovers cleanly', () => {
    const config = configWith({ seed: 'restrained-lightning', world: { size: 24 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const renderer = new WeatherRenderer(world, new TerrainSurface(world), config.seed);
    const camera = cameraOverWorld();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#899b91');
    scene.fog = new THREE.FogExp2('#93a5a4', 0.0072);
    renderer.bindScene(scene);

    for (const cell of weather.state.cells) {
      cell.kind = 'thunderstorm';
      cell.precipitation = 'rain';
      cell.intensity = 1;
      cell.wind = 0.85;
      cell.windX = 0.8;
      cell.windZ = 0.3;
    }
    const before = JSON.stringify(weather.state);
    let maximumFlash = 0;
    let flashFrames = 0;
    for (let frame = 0; frame <= 1200; frame += 1) {
      renderer.update(0.05, frame * 0.05, camera);
      maximumFlash = Math.max(maximumFlash, renderer.report.lightningFlash);
      if (renderer.report.lightningFlash > 0.03) flashFrames += 1;
    }
    expect(renderer.report.storm).toBeGreaterThan(0.9);
    expect(maximumFlash).toBeGreaterThan(0.5);
    expect(maximumFlash).toBeLessThanOrEqual(1);
    expect(flashFrames).toBeGreaterThan(0);
    expect(flashFrames).toBeLessThan(180);
    expect(JSON.stringify(weather.state)).toBe(before);

    for (const cell of weather.state.cells) {
      cell.kind = 'rain';
      cell.precipitation = 'rain';
      cell.intensity = 0.35;
    }
    for (let frame = 0; frame < 12; frame += 1) renderer.update(1, 70 + frame, camera);
    expect(renderer.report.storm).toBeLessThan(0.01);
    expect(renderer.report.lightningFlash).toBe(0);
    expect(renderer.group.getObjectByName('lightning-bolt')?.visible).toBe(false);
    renderer.dispose();
  });
});
