import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildLandAnimalGeometry,
  LandWildlifeRenderer,
  planLandWildlife,
  wildlifeHabitatScore,
  type LandAnimalPlan,
  type LandAnimalSpecies,
} from '../src/render/wildlife/LandWildlifeRenderer';
import { vegetationFixture } from './fixtures/vegetation';

function temperateWildlifeWorld(seed = 'land-wildlife') {
  const fixture = vegetationFixture(seed);
  for (const cell of fixture.world.cells) {
    cell.biome = cell.x % 3 === 0 ? 'grassland' : 'forest';
    cell.water = false;
    cell.river = false;
    cell.lake = false;
    cell.wood = cell.biome === 'forest' ? 0.82 : 0.42;
    cell.moisture = 0.58;
    cell.slope = 0.04;
    cell.movementCost = 1;
  }
  return fixture;
}

function manualPlan(species: LandAnimalSpecies, x: number): LandAnimalPlan {
  return {
    id: `${species}-test`,
    species,
    route: [{ x, z: 0 }, { x: x + 2, z: 1 }, { x: x + 1, z: 3 }],
    scale: 1,
    speed: 0.05,
    phase: 0,
    gaitPhase: 0,
    offsetX: 0,
    offsetZ: 0,
    coat: 1,
  };
}

describe('ambient land wildlife presentation', () => {
  it('removes a harvested generation from rendering and camera targets', () => {
    const { world, surface } = temperateWildlifeWorld('harvest-adapter');
    const renderer = new LandWildlifeRenderer(world, surface, 'harvest-adapter', [], [manualPlan('elk', 0)]);
    const target = renderer.harvestTargets(0)[0]!;
    expect(target.stage).not.toBe('young');
    expect(renderer.harvest.harvest(target, 'hunt', target, 1)).toBeDefined();
    renderer.update(0);
    expect(renderer.report.visible).toBe(0);
    expect(renderer.cameraSubjects(0)).toHaveLength(0);
    renderer.dispose();
  });
  it('plans deterministic visual-only elk, fox and bear populations from habitat', () => {
    const { world, surface } = temperateWildlifeWorld();
    const before = JSON.stringify(world.cells);
    const first = planLandWildlife(world, surface, 'land-wildlife');
    const second = planLandWildlife(world, surface, 'land-wildlife');

    expect(first).toEqual(second);
    expect(new Set(first.map(plan => plan.species))).toEqual(new Set(['elk', 'fox', 'bear', 'squirrel']));
    expect(first.every(plan => plan.route.length >= 3)).toBe(true);
    expect(first.every(plan => plan.route.every(point => Number.isFinite(point.x) && Number.isFinite(point.z)))).toBe(true);
    expect(JSON.stringify(world.cells)).toBe(before);
  });

  it('keeps species habitat preferences distinct without creating simulation ecology', () => {
    const { world } = temperateWildlifeWorld('wildlife-habitat');
    const forest = world.cells.find(cell => cell.biome === 'forest')!;
    const meadow = world.cells.find(cell => cell.biome === 'grassland')!;
    expect(wildlifeHabitatScore('bear', forest)).toBeGreaterThan(wildlifeHabitatScore('bear', meadow));
    expect(wildlifeHabitatScore('elk', meadow)).toBeGreaterThan(0.45);
    expect(wildlifeHabitatScore('fox', meadow)).toBeGreaterThan(0.45);
  });

  it('uses properly separated silhouettes and world scale for elk, bears and foxes', () => {
    const heights: Record<LandAnimalSpecies, number> = { elk: 0, bear: 0, fox: 0, squirrel: 0 };
    for (const species of ['elk', 'bear', 'fox'] as const) {
      const geometry = buildLandAnimalGeometry(species);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      heights[species] = box.max.y - box.min.y;
      expect(box.max.z - box.min.z).toBeGreaterThan(0.15);
      expect(geometry.getAttribute('color')).toBeDefined();
      geometry.dispose();
    }
    // Canonical adults are ~0.30 world units tall. Elk antlers rise above a person, a bear is
    // lower and broad, and foxes remain unmistakably small rather than being distance-scaled props.
    expect(heights.elk).toBeGreaterThan(0.40);
    expect(heights.elk).toBeLessThan(0.60);
    expect(heights.bear).toBeGreaterThan(0.18);
    expect(heights.bear).toBeLessThan(0.28);
    expect(heights.fox).toBeGreaterThan(0.09);
    expect(heights.fox).toBeLessThan(0.15);
  });

  it('exposes the same presentation-only animal motion to the camera', () => {
    const { world, surface } = temperateWildlifeWorld('wildlife-camera');
    const plans = [manualPlan('elk', 0)];
    const renderer = new LandWildlifeRenderer(world, surface, 'wildlife-camera', [], plans);
    const before = JSON.stringify(world.cells);

    const first = renderer.cameraSubjects(0);
    const later = renderer.cameraSubjects(8);

    expect(first).toHaveLength(1);
    expect(first[0]?.species).toBe('elk');
    expect(later[0]?.x).not.toBe(first[0]?.x);
    expect(JSON.stringify(world.cells)).toBe(before);

    renderer.setExclusionZones([{ x: later[0]!.x, z: later[0]!.z, radius: 1 }]);
    expect(renderer.cameraSubjects(8)).toHaveLength(0);
    renderer.dispose();
  });

  it('grounds and animates presentation without mutating world state', () => {
    const { world, surface } = temperateWildlifeWorld('wildlife-render');
    const plans = [manualPlan('elk', -3), manualPlan('fox', 0), manualPlan('bear', 3)];
    const before = JSON.stringify({
      cells: world.cells,
      terrain: Array.from(world.terrain.waterLevel),
      revision: world.environmentRevision,
    });
    const renderer = new LandWildlifeRenderer(world, surface, 'wildlife-render', [], plans);
    renderer.setCamera(new THREE.Vector3(0, 4, 2));
    renderer.update(0);
    const firstMatrices = (renderer.group.children as THREE.InstancedMesh[])
      .map(mesh => Array.from((mesh.instanceMatrix.array as Float32Array).slice(0, 16)));

    expect(renderer.report.visible).toBe(3);
    expect(renderer.report.drawCalls).toBe(3);
    expect(renderer.group.userData['presentationOnly']).toBe(true);

    renderer.update(8);
    const secondMatrices = (renderer.group.children as THREE.InstancedMesh[])
      .map(mesh => Array.from((mesh.instanceMatrix.array as Float32Array).slice(0, 16)));
    expect(secondMatrices).not.toEqual(firstMatrices);
    expect(JSON.stringify({
      cells: world.cells,
      terrain: Array.from(world.terrain.waterLevel),
      revision: world.environmentRevision,
    })).toBe(before);
    renderer.dispose();
  });
});
