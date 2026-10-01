import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { GODBOX_CONFIG } from '../godbox.config';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { WaterSystem } from '../src/render/terrain/WaterSystem';
import { auditWaterGeometry, type WaterGeometryAudit } from '../src/render/terrain/WaterGeometryAudit';
import { computeHydrology, DynamicHydrology } from '../src/sim/terrain/Hydrology';
import { elevationToY } from '../src/sim/terrain/SurfaceGeometry';

function sane(audit: WaterGeometryAudit): void {
  const details = JSON.stringify(audit);
  for (const key of ['invalidValues', 'duplicateFaces', 'stackedSamples', 'hangingEdges',
    'interiorHoles', 'brokenRiverSamples', 'buriedSamples', 'extremeFaces', 'unsupportedPeaks'] as const) {
    expect(audit[key], `${key}: ${details}`).toBe(0);
  }
  expect(audit.maxDepthExcess, details).toBeLessThan(0.0003);
}

describe('the entire rendered water group', () => {
  it.each(['world-8we87g1lgnchc', 'world-ggg777', 'witness-the-saffron-river',
    'mountain-lakes', 'cone-guard', 'cone-guard-2', 'spike-guard'])(
    'has physically supported geometry and every D8 river span on %s', seed => {
      const world = new Simulation({ ...GODBOX_CONFIG, seed, startMode: 'arrival' }).state.world;
      const levels = world.terrain.waterLevel.slice(), heights = world.terrain.height.slice();
      const system = new WaterSystem(world, new TerrainSurface(world), seed);
      const audit = auditWaterGeometry(world, system.group);
      sane(audit);
      expect(audit.riverSamples).toBeGreaterThan(100);
      expect(audit.meshes['ocean-water']).toBeGreaterThan(0);
      expect(world.terrain.waterLevel).toEqual(levels);
      expect(world.terrain.height).toEqual(heights);
      expect(system.group.getObjectByName('inland-water-skirt')).toBeUndefined();
      system.dispose();
    });

  it('keeps rainfall, drought and recession rebuilds finite, supported and mass-balanced', () => {
    const world = new Simulation({ ...GODBOX_CONFIG, seed: 'world-ggg777', startMode: 'arrival' }).state.world;
    const system = new WaterSystem(world, new TerrainSurface(world), 'dynamic-water');
    const hydrology = new DynamicHydrology(world);
    for (const runoff of [0.03, 0.09, 0, 0, 0.02]) {
      world.weather!.cells.forEach((cell, i) => { cell.runoff = runoff * (1 + i % 3); });
      hydrology.advance(world.weather!.cells);
      world.environmentRevision = (world.environmentRevision ?? 0) + 1;
      system.syncHydrology(); system.update(100);
      sane(auditWaterGeometry(world, system.group));
      expect(Math.abs(hydrology.lastBudget.massError)).toBeLessThan(1e-8);
      const t = world.terrain;
      for (let i = 0; i < t.height.length; i++) {
        const next = t.drainage!.downstream[i]!;
        if (t.river[i] && next >= 0 && t.waterLevel[i]! >= 0 && t.waterLevel[next]! >= 0)
          expect(t.waterLevel[i]! + 1e-7).toBeGreaterThanOrEqual(t.waterLevel[next]!);
      }
    }
    system.dispose();
  });

  it('detects a screenshot-scale cone in a transformed child with more than 400,000 vertices', () => {
    const world = new Simulation({ seed: 'injected-cone', world: { size: 12 }, startingPopulation: 12, settlementCount: [1, 1] }).state.world;
    const t = world.terrain;
    t.height.fill(world.seaLevel + 0.01); t.waterLevel.fill(world.seaLevel + 0.02);
    t.lake.fill(1); t.river.fill(0); t.fall.fill(0);
    const system = new WaterSystem(world, new TerrainSurface(world), 'injected-cone');
    const y = elevationToY(world.seaLevel + 0.02, world.seaLevel);
    const data = new Float32Array(400005 * 3);
    data.set([-0.5, y, 0, 0, y + 8, 0.05, 0.5, y, 0], 400002 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
    geometry.setIndex([400002, 400003, 400004]);
    const spike = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    spike.name = 'unrecognized-water-child'; spike.position.set(2, 0, 2);
    const nested = new THREE.Group(); nested.add(spike); system.group.add(nested);
    const audit = auditWaterGeometry(world, system.group);
    expect(audit.meshes[spike.name]).toBe(1);
    expect(audit.maxDepthExcess).toBeGreaterThan(7);
    expect(audit.extremeFaces).toBeGreaterThan(0);
    expect(audit.unsupportedPeaks).toBeGreaterThan(0);
    system.dispose();
  });

  it('detects missing river faces, an overlapping coastline sheet, and invalid attributes', () => {
    const world = new Simulation({ ...GODBOX_CONFIG, seed: 'world-ggg777', startMode: 'arrival' }).state.world;
    const system = new WaterSystem(world, new TerrainSurface(world), 'damaged-water');
    const inland = system.group.getObjectByName('inland-water') as THREE.Mesh;
    const duplicate = new THREE.Mesh(inland.geometry.clone(), new THREE.MeshBasicMaterial());
    duplicate.name = 'stacked-sheet'; duplicate.position.y = 0.0001;
    system.group.add(duplicate);
    const corrupted = duplicate.geometry.getAttribute('position'); corrupted.setX(0, NaN);
    const audit = auditWaterGeometry(world, system.group);
    expect(audit.invalidValues).toBeGreaterThan(0);
    expect(audit.hangingEdges).toBeGreaterThan(0);
    // Removing the actual inland skin must fail route coverage, even with the ocean still present.
    system.group.remove(inland, duplicate);
    expect(auditWaterGeometry(world, system.group).brokenRiverSamples).toBeGreaterThan(100);
    system.dispose();
  });
});

describe('hydrology supplies a realizable water surface', () => {
  it('keeps an enclosed below-sea depression in its lake instead of punching ocean through it', () => {
    const n = 9, sea = 0.34, height = new Float32Array(n * n).fill(sea + 0.1);
    for (let i = 0; i < n; i++) { height[i] = sea - 0.1; height[(n - 1) * n + i] = sea - 0.1; height[i * n] = sea - 0.1; height[i * n + n - 1] = sea - 0.1; }
    for (let z = 3; z <= 5; z++) for (let x = 3; x <= 5; x++) height[z * n + x] = sea - 0.04;
    const h = computeHydrology({ height, resolution: n, step: 0.75, originX: 0, originZ: 0 }, { seaLevel: sea, verticalScale: 17.5, riverThreshold: 24 });
    expect(h.lake[4 * n + 4]).toBe(1);
    expect(h.waterLevel[4 * n + 4]).toBeGreaterThan(sea + 0.09);
    expect(h.waterLevel[0]).toBeCloseTo(sea, 6);
  });

  it('provides actual shallow channel depth before rendering and keeps routed stages descending', () => {
    const world = new Simulation({ ...GODBOX_CONFIG, seed: 'world-8we87g1lgnchc', startMode: 'arrival' }).state.world;
    const t = world.terrain;
    for (let i = 0; i < t.height.length; i++) {
      if (!t.river[i] || t.waterLevel[i]! <= world.seaLevel + 1e-7) continue;
      expect(t.waterLevel[i]! - t.height[i]!).toBeGreaterThanOrEqual(0.00199);
      const next = t.drainage!.downstream[i]!;
      if (next >= 0 && t.waterLevel[next]! >= 0) expect(t.waterLevel[i]).toBeGreaterThanOrEqual(t.waterLevel[next]!);
    }
  });
});
