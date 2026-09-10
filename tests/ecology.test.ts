import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ecologicalNight, ecologicalVitality, EcologyField, DEFAULT_ECOLOGY_QUALITY, luminousRefuge } from '../src/render/ecology/EcologyField';
import { BioluminescentFlora } from '../src/render/vegetation/BioluminescentFlora';
import { planForest } from '../src/render/vegetation/ForestPlanner';
import { vegetationFixture, disposeVegetation } from './fixtures/vegetation';

describe('Living ecological presentation', () => {
  it('emerges continuously at dusk and disappears in bright daylight', () => {
    expect(ecologicalNight(1)).toBe(0);
    expect(ecologicalNight(0.6)).toBe(0);
    expect(ecologicalNight(0)).toBe(1);
    for (let i = 1; i <= 100; i++) {
      const before = ecologicalNight((i - 1) / 100);
      const after = ecologicalNight(i / 100);
      expect(before).toBeGreaterThanOrEqual(after);
      expect(before - after).toBeLessThan(0.03);
    }
  });

  it('loses luminous life under drought, freezing, damage and pollution, then recovers from the same habitat', () => {
    const { world } = vegetationFixture();
    const cell = { ...world.cells[0]!, biome: 'forest' as const, wood: 0.8, moisture: 0.7 };
    const weather = { ...world.weather!.cells[0]!, temperature: 0.6, snowpack: 0, treeDamage: 0, wind: 0.1, precipitation: 'none' as const };
    const healthy = ecologicalVitality(cell, weather, 5);
    expect(healthy.flora).toBeGreaterThan(0.6);
    expect(ecologicalVitality({ ...cell, moisture: 0.1 }, weather, 5).flora).toBe(0);
    expect(ecologicalVitality({ ...cell, wood: 0 }, weather, 5).flora).toBe(0);
    expect(ecologicalVitality(cell, { ...weather, temperature: 0.25 }, 5).water).toBe(0);
    expect(ecologicalVitality(cell, { ...weather, treeDamage: 1 }, 5).flora).toBe(0);
    expect(ecologicalVitality(cell, weather, 5, 1).water).toBe(0);
    expect(ecologicalVitality(cell, weather, 5, 0, 1).flora).toBe(0);
    expect(ecologicalVitality(cell, { ...weather, wind: 1, precipitation: 'rain', intensity: 1 }, 5).motes).toBeLessThan(healthy.motes * 0.1);
    expect(ecologicalVitality(cell, weather, 5)).toEqual(healthy);
  });

  it('seeds persistent, regionally coherent rare refuges and varied water strains without touching simulation state', () => {
    let refuges = 0;
    for (let z = 0; z < 100; z++) for (let x = 0; x < 100; x++) {
      const value = luminousRefuge('refuges', x * 5, z * 5);
      expect(luminousRefuge('refuges', x * 5 + 2, z * 5 + 3)).toBe(value);
      refuges += value;
    }
    expect(refuges).toBeGreaterThan(80);
    expect(refuges).toBeLessThan(400);
    const { world, simulation } = vegetationFixture();
    const before = JSON.stringify(simulation.state);
    const a = new EcologyField(world, 'atlas');
    const b = new EcologyField(world, 'atlas');
    const c = new EcologyField(world, 'another-atlas');
    a.animate(45, 0); a.sync(simulation.state.settlements, 5);
    b.sync(simulation.state.settlements, 5);
    expect(a.texture.image.data).toEqual(b.texture.image.data);
    expect(a.texture.image.data).not.toEqual(c.texture.image.data);
    expect(JSON.stringify(simulation.state)).toBe(before);
    a.dispose(); b.dispose(); c.dispose();
  });

  it('caps instanced ecology, clears occupied ground, retires distant colonies, and restores them', () => {
    const { world, surface, camera } = vegetationFixture();
    world.cells.forEach(c => { c.biome = 'forest'; });
    const field = new EcologyField(world, 'flora');
    const trees = planForest(world, surface, 'flora', 240, 3, []).trees;
    const flora = new BioluminescentFlora(world, surface, 'flora', trees, field, DEFAULT_ECOLOGY_QUALITY);
    flora.updateLod(camera, 5, []);
    const count = flora.report.flora;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(1800);
    expect(flora.report.motes).toBeLessThanOrEqual(1400);
    expect(flora.report.drawCalls).toBeLessThanOrEqual(4);
    flora.updateLod(camera, 5, [{ x: 0, z: 0, radius: 500 }]);
    expect(flora.report.flora).toBe(0);
    expect(flora.report.motes).toBe(0);
    flora.updateLod(new THREE.Vector3(1000, 1000, 1000), 5, []);
    expect(flora.report.flora).toBe(0);
    flora.updateLod(camera, 5, []);
    expect(flora.report.flora).toBe(count);
    const disabled = new BioluminescentFlora(world, surface, 'flora', trees, field,
      { ...DEFAULT_ECOLOGY_QUALITY, bioluminescenceDensity: 0, particleDensity: 0 });
    disabled.updateLod(camera, 5, []);
    expect(disabled.report.drawCalls).toBe(0);
    disposeVegetation(disabled.group); disposeVegetation(flora.group); field.dispose();
  });
});
