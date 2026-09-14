import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { planForest } from '../src/render/vegetation/ForestPlanner';
import { buildTreeLibrary, TREE_LOD_FAR, TREE_LOD_NEAR } from '../src/render/vegetation/TreeLibrary';
import { resolveTreePhenology, treeFoliageColour } from '../src/render/vegetation/TreePhenology';

describe('Birch tree family', () => {
  it('appears as a bounded mixed-stand component in generated worlds', () => {
    const seeds = ['witness-the-saffron-river', 'river', 'archipelago', 'birch-boreal-mix', 'northern-lake'];
    let birch = 0;
    let total = 0;
    let worldsWithBirch = 0;

    for (const seed of seeds) {
      const simulation = new Simulation({ seed, startingPopulation: 32, world: { size: 32 }, settlementCount: [2, 2] });
      const surface = new TerrainSurface(simulation.state.world);
      const plan = planForest(simulation.state.world, surface, seed, 3500, 3);
      birch += plan.byFamily.birch;
      total += plan.trees.length;
      if (plan.byFamily.birch > 0) worldsWithBirch += 1;
      expect(plan.byFamily.birch).toBeLessThan(plan.trees.length * 0.42 + 1);
    }

    expect(total).toBeGreaterThan(0);
    expect(birch).toBeGreaterThan(0);
    expect(worldsWithBirch).toBeGreaterThanOrEqual(2);
    expect(birch / total).toBeLessThan(0.28);
  });

  it('keeps birch deterministic and identity-matched across near/far tiers', () => {
    const near = buildTreeLibrary('birch-lod', 5, TREE_LOD_NEAR).get('birch') ?? [];
    const far = buildTreeLibrary('birch-lod', 5, TREE_LOD_FAR).get('birch') ?? [];
    expect(near).toHaveLength(5);
    expect(far).toHaveLength(5);
    for (let index = 0; index < near.length; index += 1) {
      expect(far[index]!.height).toBeCloseTo(near[index]!.height, 8);
      expect(far[index]!.radius).toBeCloseTo(near[index]!.radius, 8);
      expect(far[index]!.bark.getIndex()!.count).toBeLessThan(near[index]!.bark.getIndex()!.count);
      expect(far[index]!.foliage.getIndex()!.count).toBeLessThan(near[index]!.foliage.getIndex()!.count);
    }
  });

  it('is deciduous, fresh green in summer, and strongly golden in autumn', () => {
    const cell = { temperature: 0.46, moisture: 0.62 };
    expect(resolveTreePhenology(11, cell, { temperature: 0.2 }, 'birch').canopy).toBe(0);

    const summerPhase = resolveTreePhenology(5, cell, { temperature: 0.58 }, 'birch', 0.5);
    const autumnPhase = resolveTreePhenology(9, cell, { temperature: 0.48 }, 'birch', 0.5);
    const summer = treeFoliageColour('birch', summerPhase, 0.5, new THREE.Color(), cell.moisture);
    const autumn = treeFoliageColour('birch', autumnPhase, 0.5, new THREE.Color(), cell.moisture);
    expect(summer.g).toBeGreaterThan(summer.r);
    expect(autumn.r + autumn.g).toBeGreaterThan(autumn.b * 2.6);
    expect(autumn.r).toBeGreaterThan(autumn.b * 1.5);
  });
});
