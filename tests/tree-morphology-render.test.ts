import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VegetationRenderer } from '../src/render/vegetation/VegetationRenderer';
import { disposeVegetation, vegetationFixture } from './fixtures/vegetation';

describe('Tree morphology renderer hardening', () => {
  it('does not give naturally fallen deadwood an uprooted root plate', () => {
    const { world, surface, camera } = vegetationFixture();
    const renderer = new VegetationRenderer(world, surface, 'natural-deadwood', 1200);
    world.weather!.month = 12_000;
    world.weather!.forestScars = [];
    for (const cell of world.weather!.cells) {
      cell.treeDamage = 0;
      cell.lastWindthrowMonth = -1;
    }
    renderer.setEcologyYear(1000);
    renderer.setSeason(5);
    renderer.updateLod(camera);
    const roots = renderer.group.getObjectByName('tree-uprooted-root-plates') as THREE.InstancedMesh;
    expect(roots.count).toBe(0);
    disposeVegetation(renderer.group);
  });

  it('uses root plates selectively for fresh disturbance failures rather than every fallen tree', () => {
    const { world, surface, camera } = vegetationFixture();
    const renderer = new VegetationRenderer(world, surface, 'storm-uprooting', 1500);
    world.weather!.month = 120;
    world.weather!.forestScars = [];
    for (const cell of world.weather!.cells) {
      cell.treeDamage = 1;
      cell.lastWindthrowMonth = 120;
    }
    renderer.setEcologyYear(10);
    renderer.setSeason(5);
    renderer.updateLod(camera);
    const roots = renderer.group.getObjectByName('tree-uprooted-root-plates') as THREE.InstancedMesh;
    expect(roots.count).toBeGreaterThan(0);
    expect(roots.count).toBeLessThan(renderer.report.trees);
    disposeVegetation(renderer.group);
  });
});
