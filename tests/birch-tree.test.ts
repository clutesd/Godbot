import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { planForest } from '../src/render/vegetation/ForestPlanner';
import { buildTreeLibrary, TREE_LOD_FAR, TREE_LOD_NEAR } from '../src/render/vegetation/TreeLibrary';
import { resolveTreePhenology, treeFoliageColour } from '../src/render/vegetation/TreePhenology';

function verticalBounds(geometry: THREE.BufferGeometry): { min: number; max: number } {
  const position = geometry.getAttribute('position');
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < position.count; index += 1) {
    min = Math.min(min, position.getY(index));
    max = Math.max(max, position.getY(index));
  }
  return { min, max };
}

function lowerBoleRadius(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const { min, max } = verticalBounds(geometry);
  const cutoff = min + (max - min) * 0.42;
  let radius = 0;
  for (let index = 0; index < position.count; index += 1) {
    if (position.getY(index) > cutoff) continue;
    radius = Math.max(radius, Math.hypot(position.getX(index), position.getZ(index)));
  }
  return radius;
}

function barkValues(geometry: THREE.BufferGeometry, lowerOnly = false): { average: number; min: number; max: number } {
  const colour = geometry.getAttribute('color');
  const position = geometry.getAttribute('position');
  const { min: minY, max: maxY } = verticalBounds(geometry);
  const cutoff = minY + (maxY - minY) * 0.5;
  let total = 0;
  let samples = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < colour.count; index += 1) {
    if (lowerOnly && position.getY(index) > cutoff) continue;
    const value = (colour.getX(index) + colour.getY(index) + colour.getZ(index)) / 3;
    total += value;
    samples += 1;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { average: total / Math.max(1, samples), min, max };
}

function exposedBoleFraction(bark: THREE.BufferGeometry, foliage: THREE.BufferGeometry): number {
  const barkBounds = verticalBounds(bark);
  const foliageBounds = verticalBounds(foliage);
  return (foliageBounds.min - barkBounds.min) / Math.max(1e-6, barkBounds.max - barkBounds.min);
}

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

  it('preserves an unmistakable pale bole when switching to the far tier', () => {
    const near = buildTreeLibrary('birch-visibility', 5, TREE_LOD_NEAR).get('birch') ?? [];
    const far = buildTreeLibrary('birch-visibility', 5, TREE_LOD_FAR).get('birch') ?? [];
    expect(near).toHaveLength(5);
    expect(far).toHaveLength(5);
    for (let index = 0; index < near.length; index += 1) {
      const nearRadius = lowerBoleRadius(near[index]!.bark);
      const farRadius = lowerBoleRadius(far[index]!.bark);
      expect(farRadius).toBeGreaterThan(nearRadius * 1.05);
      expect(farRadius).toBeLessThan(nearRadius * 1.3);

      const allBark = barkValues(far[index]!.bark);
      const lowerBole = barkValues(far[index]!.bark, true);
      expect(allBark.average).toBeGreaterThan(0.6);
      expect(allBark.max - allBark.min).toBeGreaterThan(0.2);
      expect(lowerBole.average).toBeGreaterThan(allBark.average * 1.04);
      expect(lowerBole.max).toBeGreaterThan(0.9);
    }
  });

  it('keeps more of the defining trunk exposed than an ordinary broadleaf crown', () => {
    const library = buildTreeLibrary('birch-exposed-bole', 6, TREE_LOD_NEAR);
    const birch = library.get('birch') ?? [];
    const broadleaf = library.get('broadleaf') ?? [];
    expect(birch).toHaveLength(6);
    expect(broadleaf).toHaveLength(6);
    const birchExposure = birch.map(tree => exposedBoleFraction(tree.bark, tree.foliage));
    const broadleafExposure = broadleaf.map(tree => exposedBoleFraction(tree.bark, tree.foliage));
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(birchExposure)).toBeGreaterThan(mean(broadleafExposure) + 0.035);
  });

  it('is deciduous, fresh green in summer, thins early in late autumn, and turns clear gold', () => {
    const cell = { temperature: 0.46, moisture: 0.62 };
    expect(resolveTreePhenology(11, cell, { temperature: 0.2 }, 'birch').canopy).toBe(0);

    const summerPhase = resolveTreePhenology(5, cell, { temperature: 0.58 }, 'birch', 0.5);
    const birchAutumn = resolveTreePhenology(9, cell, { temperature: 0.48 }, 'birch', 0.5);
    const broadleafAutumn = resolveTreePhenology(9, cell, { temperature: 0.48 }, 'broadleaf', 0.5);
    const summer = treeFoliageColour('birch', summerPhase, 0.5, new THREE.Color(), cell.moisture);
    const autumn = treeFoliageColour('birch', birchAutumn, 0.5, new THREE.Color(), cell.moisture);
    expect(summer.g).toBeGreaterThan(summer.r * 1.08);
    expect(birchAutumn.canopy).toBeLessThan(broadleafAutumn.canopy * 0.8);
    expect(birchAutumn.leafFall).toBeGreaterThan(0.6);
    expect(autumn.r + autumn.g).toBeGreaterThan(autumn.b * 2.8);
    expect(autumn.r).toBeGreaterThan(autumn.b * 1.65);
  });
});
