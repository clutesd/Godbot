import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildTreeLibrary, TREE_LOD_NEAR, type TreeFamily } from '../src/render/vegetation/TreeLibrary';
import { resolveTreePhenology, treeFoliageColour } from '../src/render/vegetation/TreePhenology';

const FAMILIES: readonly TreeFamily[] = ['cherry', 'broadleaf', 'birch', 'conifer', 'dry', 'riverbank', 'alpine', 'ancient'];

function foliageValueRange(geometry: THREE.BufferGeometry): { min: number; max: number } {
  const colour = geometry.getAttribute('color');
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < colour.count; index += 1) {
    const value = (colour.getX(index) + colour.getY(index) + colour.getZ(index)) / 3;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function distance(a: THREE.Color, b: THREE.Color): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

describe('Tree colour and canopy depth', () => {
  it('encodes strong interior-to-edge value depth without adding geometry', () => {
    const library = buildTreeLibrary('canopy-depth', 4, TREE_LOD_NEAR);
    for (const family of FAMILIES) {
      for (const tree of library.get(family) ?? []) {
        const range = foliageValueRange(tree.foliage);
        expect(range.min).toBeGreaterThanOrEqual(0.45);
        expect(range.max).toBeLessThanOrEqual(1.081);
        expect(range.max - range.min).toBeGreaterThan(0.16);
      }
    }
  });

  it('keeps summer species palettes recognizably separate instead of converging on generic green', () => {
    const cell = { temperature: 0.5, moisture: 0.62 };
    const colours = new Map<TreeFamily, THREE.Color>();
    for (const family of FAMILIES) {
      const phase = resolveTreePhenology(5, cell, { temperature: 0.58 }, family, 0.5);
      colours.set(family, treeFoliageColour(family, phase, 0.5, new THREE.Color(), cell.moisture).clone());
    }

    expect(new Set([...colours.values()].map(colour => colour.getHexString())).size).toBe(FAMILIES.length);
    expect(distance(colours.get('dry')!, colours.get('conifer')!)).toBeGreaterThan(0.08);
    expect(distance(colours.get('riverbank')!, colours.get('broadleaf')!)).toBeGreaterThan(0.025);
    expect(distance(colours.get('cherry')!, colours.get('ancient')!)).toBeGreaterThan(0.04);
    expect(distance(colours.get('birch')!, colours.get('broadleaf')!)).toBeGreaterThan(0.035);
  });

  it('retains seasonal readability and gives birch a predominantly golden autumn', () => {
    const cell = { temperature: 0.46, moisture: 0.6 };
    const cherry = (month: number) => treeFoliageColour('cherry',
      resolveTreePhenology(month, cell, { temperature: 0.6 }, 'cherry'), 0.5, new THREE.Color(), cell.moisture);
    expect(cherry(2.2).r).toBeGreaterThan(cherry(2.2).g);
    expect(cherry(5).g).toBeGreaterThan(cherry(5).r);
    expect(cherry(9).r).toBeGreaterThan(cherry(9).g);

    const birchSummer = treeFoliageColour('birch', resolveTreePhenology(5, cell, { temperature: 0.6 }, 'birch'),
      0.5, new THREE.Color(), cell.moisture);
    const birchAutumn = treeFoliageColour('birch', resolveTreePhenology(9, cell, { temperature: 0.5 }, 'birch'),
      0.5, new THREE.Color(), cell.moisture);
    expect(birchSummer.g).toBeGreaterThan(birchSummer.r);
    expect(birchAutumn.r).toBeGreaterThan(birchAutumn.g * 0.95);
    expect(birchAutumn.g).toBeGreaterThan(birchAutumn.b * 1.45);
  });
});
