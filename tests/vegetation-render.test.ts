import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FlowerField } from '../src/render/vegetation/FlowerField';
import { planForest } from '../src/render/vegetation/ForestPlanner';
import { buildTreeLibrary, TREE_LOD_FAR, TREE_LOD_NEAR } from '../src/render/vegetation/TreeLibrary';
import { resolveTreePhenology, treeFoliageColour } from '../src/render/vegetation/TreePhenology';
import { VegetationRenderer } from '../src/render/vegetation/VegetationRenderer';
import { insideVegetationTerrain } from '../src/render/vegetation/VegetationPlacement';
import { disposeVegetation, instanceMeshes, vegetationFixture } from './fixtures/vegetation';
import { Simulation } from '../src/sim/Simulation';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';

describe('Rendered vegetation contracts', () => {
  it('renders all planned variants, including every ancient tree, in either LOD tier', () => {
    const { world, surface, camera } = vegetationFixture();
    const renderer = new VegetationRenderer(world, surface, 'ancient-variants', 4000);
    renderer.setSeason(5);
    renderer.updateLod(camera);
    expect(renderer.report.trees).toBeGreaterThan(0);
    expect(renderer.report.byFamily.ancient).toBeGreaterThan(0);
    expect(renderer.report.near + renderer.report.far).toBe(renderer.report.trees);
    renderer.updateLod(new THREE.Vector3(200, 20, 200));
    expect(renderer.report.far).toBe(renderer.report.trees);
    expect(renderer.report.near).toBe(0);
    disposeVegetation(renderer.group);
  });

  it('preserves the seeded skeleton and crown dimensions across cheaper distance tiers', () => {
    const near = buildTreeLibrary('lod-identity', 3, TREE_LOD_NEAR);
    const far = buildTreeLibrary('lod-identity', 3, TREE_LOD_FAR);
    for (const [family, variants] of near) for (const [index, source] of variants.entries()) {
      const distant = far.get(family)![index]!;
      expect(distant.height).toBe(source.height);
      expect(distant.radius).toBe(source.radius);
      source.foliage.computeBoundingBox(); distant.foliage.computeBoundingBox();
      expect(Math.abs(source.foliage.boundingBox!.max.y - distant.foliage.boundingBox!.max.y)).toBeLessThan(source.height * 0.25);
      expect(distant.foliage.index!.count).toBeLessThan(source.foliage.index!.count);
      expect(distant.bark.index!.count).toBeLessThan(source.bark.index!.count);
      for (const geometry of [source.bark, source.foliage, distant.bark, distant.foliage]) {
        expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
        geometry.dispose();
      }
    }
  });

  it('has pink spring cherries, green summer leaves, warm autumn color, and cold winter branches', () => {
    const cell = { temperature: 0.46, moisture: 0.6 };
    const color = (month: number) => treeFoliageColour('cherry', resolveTreePhenology(month, cell, { temperature: 0.6 }, 'cherry'), 0.5, new THREE.Color());
    expect(color(2.2).r).toBeGreaterThan(color(2.2).g);
    expect(color(5).g).toBeGreaterThan(color(5).r);
    expect(color(9).r).toBeGreaterThan(color(9).g);
    expect(resolveTreePhenology(11, cell, { temperature: 0.2 }, 'cherry').canopy).toBe(0);
    expect(resolveTreePhenology(2, cell, { temperature: 0.1 }, 'cherry').blossom).toBe(0);
    expect(resolveTreePhenology(11, cell, { temperature: 0.2 }, 'conifer').canopy).toBe(1);
  });

  it('keeps planning deterministic, bounded, on terrain, and independent of simulation randomness', () => {
    const { simulation, world, surface } = vegetationFixture();
    const before = JSON.stringify(simulation.state);
    const first = planForest(world, surface, 'placement', 300, 3);
    expect(first).toEqual(planForest(world, surface, 'placement', 300, 3));
    expect(first.trees.length).toBeLessThanOrEqual(300);
    for (const tree of first.trees) {
      expect(insideVegetationTerrain(world, tree.worldX, tree.worldZ)).toBe(true);
      expect(tree.y).toBe(surface.heightAt(tree.worldX, tree.worldZ));
      expect(surface.waterYAt(tree.worldX, tree.worldZ)).toBeLessThan(tree.y);
    }
    expect(JSON.stringify(simulation.state)).toBe(before);
  });

  it('counts actual flower passes, retains autumn seed heads, and hides flowers in winter', () => {
    const { world, surface, camera } = vegetationFixture();
    const flowers = new FlowerField(world, surface, 'flower-render', 200, []);
    const seedHeads = flowers.group.getObjectByName('seasonal-flower-seed-heads') as THREE.InstancedMesh;
    flowers.update(camera, 5, []);
    expect(flowers.report.visible).toBeGreaterThan(100);
    expect(flowers.report.drawCalls).toBe(6);
    flowers.update(camera, 9.4, []);
    expect(seedHeads.count).toBeGreaterThan(0);
    expect((flowers.group.getObjectByName('seasonal-flower-blooms') as THREE.InstancedMesh).count).toBe(0);
    for (const month of [0, 10, 11, 12]) {
      flowers.update(camera, month, []);
      expect(flowers.report.visible).toBe(0);
      expect(['seasonal-flower-stems', 'seasonal-flower-blooms', 'seasonal-flower-seed-heads']
        .every(name => (flowers.group.getObjectByName(name) as THREE.InstancedMesh).count === 0)).toBe(true);
    }
    disposeVegetation(flowers.group);
  });

  it('suppresses flowers on occupied ground, under snow, in frost, under floodwater, and far away', () => {
    const { world, surface, camera } = vegetationFixture();
    const flowers = new FlowerField(world, surface, 'flower-weather', 160, []);
    const check = () => { flowers.update(camera, 5, []); return flowers.report.visible; };
    expect(check()).toBeGreaterThan(0);
    flowers.update(camera, 5, [{ x: 0, z: 0, radius: 100 }]);
    expect(flowers.report.visible).toBe(0);
    for (const cell of world.weather!.cells) cell.snowpack = 0.2;
    expect(check()).toBe(0);
    for (const cell of world.weather!.cells) { cell.snowpack = 0; cell.temperature = 0.1; }
    expect(check()).toBe(0);
    for (const cell of world.weather!.cells) cell.temperature = 0.6;
    world.terrain.waterLevel.fill(world.seaLevel + 0.3);
    expect(check()).toBe(0);
    world.terrain.waterLevel.fill(-1);
    expect(check()).toBeGreaterThan(0);
    flowers.update(new THREE.Vector3(200, 20, 200), 5, []);
    expect(flowers.report.visible).toBe(0);
    disposeVegetation(flowers.group);
  });

  it('honors a zero flower budget and the rendered terrain edge', () => {
    const { world, surface, camera } = vegetationFixture();
    const empty = new FlowerField(world, surface, 'empty', 0, []);
    empty.update(camera, 5, []);
    expect(empty.report.placements).toBe(0);
    const flowers = new FlowerField(world, surface, 'edge', 200, []);
    flowers.update(camera, 5, []);
    const stems = flowers.group.getObjectByName('seasonal-flower-stems') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < stems.count; index++) {
      stems.getMatrixAt(index, matrix);
      const position = new THREE.Vector3().setFromMatrixPosition(matrix);
      expect(insideVegetationTerrain(world, position.x, position.z)).toBe(true);
      expect(position.y).toBeCloseTo(surface.heightAt(position.x, position.z) + 0.004, 5);
    }
    disposeVegetation(empty.group); disposeVegetation(flowers.group);
  });

  it('renders winter immediately on resume and after accelerated calendar jumps', () => {
    const { world, surface, camera } = vegetationFixture();
    const renderer = new VegetationRenderer(world, surface, 'calendar', 200);
    renderer.setSeason(12005);
    renderer.updateLod(camera);
    expect(renderer.report.flowers.visible).toBeGreaterThan(0);
    renderer.setSeason(24010);
    renderer.updateLod(camera);
    expect(renderer.report.flowers.visible).toBe(0);
    disposeVegetation(renderer.group);
  });

  it('clears new building footprints even around managed cherry plantings', () => {
    const { simulation, world, surface, camera } = vegetationFixture();
    const renderer = new VegetationRenderer(world, surface, 'managed', 400);
    const settlement = simulation.state.settlements[0]!;
    settlement.position = { x: 0, z: 0 }; settlement.structurePlots = [];
    renderer.setDisturbance([settlement]); renderer.setSeason(5); renderer.updateLod(camera);
    const before = renderer.report;
    expect(before.byFamily.cherry).toBeGreaterThan(0);
    settlement.structurePlots.push({ id: 'expanded-precinct', worldX: 0, worldZ: 0, radius: 100,
      width: 100, depth: 100, height: 1, condition: 1, foundedMonth: 0 });
    renderer.setDisturbance([settlement]); renderer.updateLod(camera);
    expect(renderer.report.near + renderer.report.far).toBe(0);
    expect(renderer.report.flowers.visible).toBe(0);
    disposeVegetation(renderer.group);
  });

  it('leaves simulation state untouched by camera, season, lifecycle, and planting updates', () => {
    const { simulation, world, surface, camera } = vegetationFixture();
    const before = JSON.stringify(simulation.state);
    const renderer = new VegetationRenderer(world, surface, 'readonly', 300);
    for (const year of [0, 20, 100, 1000]) {
      renderer.setEcologyYear(year); renderer.setDisturbance(simulation.state.settlements);
      renderer.setSeason(year * 12 + 5); renderer.updateLod(camera); renderer.updateLeaves(year + 1);
    }
    expect(JSON.stringify(simulation.state)).toBe(before);
    disposeVegetation(renderer.group);
  });

  it('keeps windthrow damage after weather scars disappear', () => {
    const { world, surface, camera } = vegetationFixture();
    const renderer = new VegetationRenderer(world, surface, 'windthrow', 500);
    const matrices = () => instanceMeshes(renderer.group).filter(mesh => mesh.name.startsWith('tree-bark:'))
      .map(mesh => Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)));
    renderer.setEcologyYear(10); renderer.setSeason(125); renderer.updateLod(camera);
    const healthy = matrices();
    world.weather!.month = 120;
    for (const cell of world.weather!.cells) { cell.treeDamage = 1; cell.lastWindthrowMonth = 120; }
    renderer.updateLod(camera);
    const fallen = matrices();
    expect(fallen).not.toEqual(healthy);
    for (const cell of world.weather!.cells) cell.treeDamage = 0;
    world.weather!.forestScars = [];
    renderer.updateLod(camera);
    expect(matrices()).toEqual(fallen);
    disposeVegetation(renderer.group);
  });

  it('keeps a surviving ancient tree intact when abandoned ground enters succession', () => {
    const { simulation, world, surface, camera } = vegetationFixture();
    const seed = 'ancient-variants';
    const ancient = planForest(world, surface, seed, 4000, 3).trees.find(tree => tree.id)!;
    const renderer = new VegetationRenderer(world, surface, seed, 4000);
    const settlement = simulation.state.settlements[0]!;
    settlement.buildings = 1; settlement.urbanization = 0; settlement.structurePlots = [];
    settlement.position = { x: ancient.worldX - 3, z: ancient.worldZ };
    renderer.setDisturbance([settlement]); renderer.setSeason(5); renderer.updateLod(camera);
    const transform = () => {
      for (const mesh of instanceMeshes(renderer.group).filter(mesh => mesh.name === `tree-bark:ancient:${ancient.variant}`)) {
        for (let index = 0; index < mesh.count; index++) {
          const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix);
          if (Math.abs(matrix.elements[12]! - ancient.worldX) < 0.001 && Math.abs(matrix.elements[14]! - ancient.worldZ) < 0.001) return matrix.elements;
        }
      }
      return undefined;
    };
    const surviving = transform();
    expect(surviving).toBeDefined();
    settlement.alive = false;
    renderer.setDisturbance([settlement]); renderer.updateLod(camera);
    expect(transform()).toEqual(surviving);
    disposeVegetation(renderer.group);
  });

  it.each(['witness-the-saffron-river', 'river', 'archipelago'])('plants valid visible trees on generated world %s', seed => {
    const simulation = new Simulation({ seed, startingPopulation: 32, world: { size: 32 }, settlementCount: [2, 2] });
    const surface = new TerrainSurface(simulation.state.world);
    const renderer = new VegetationRenderer(simulation.state.world, surface, seed, 1500);
    renderer.setDisturbance(simulation.state.settlements); renderer.setSeason(5);
    renderer.updateLod(new THREE.Vector3(0, 6, 10));
    const report = renderer.report;
    expect(report.trees).toBeGreaterThan(0);
    expect(report.underwater).toBe(0);
    expect(report.near + report.far + report.cleared).toBe(report.trees);
    disposeVegetation(renderer.group);
  });
});
