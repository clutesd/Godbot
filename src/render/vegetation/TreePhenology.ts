import * as THREE from 'three';
import type { WeatherCellState, WorldCell } from '../../sim/types';
import { seasonalFoliage, type SeasonalFoliage } from '../../sim/weather/SeasonalState';
import { smoothstep } from '../../sim/terrain/noise';
import { speciesFoliageColour, type TreeFamily } from './TreeLibrary';

export interface TreePhenology extends SeasonalFoliage {
  blossom: number;
}

const SUMMER: Record<TreeFamily, THREE.Color> = {
  cherry: speciesFoliageColour('cherry'), broadleaf: speciesFoliageColour('broadleaf'),
  conifer: speciesFoliageColour('conifer'), dry: speciesFoliageColour('dry'),
  riverbank: speciesFoliageColour('riverbank'), alpine: speciesFoliageColour('alpine'),
  ancient: speciesFoliageColour('ancient'),
};
const SPRING = new THREE.Color('#91aa5b');
const BLOSSOM = new THREE.Color('#efb6c9');
const AUTUMN_GOLD = new THREE.Color('#c6a04f');
const AUTUMN_RUST = new THREE.Color('#b65c39');
const EMERALD = new THREE.Color('#368368');
const BLUE_GREEN = new THREE.Color('#397b81');
const VIOLET_LEAF = new THREE.Color('#7b698c');
const PALE_SAGE = new THREE.Color('#a8ac76');

/** Local climate and the shared calendar govern both leaves and the short cherry bloom. */
export function resolveTreePhenology(month: number, cell: Pick<WorldCell, 'temperature' | 'moisture'>,
  weather: Pick<WeatherCellState, 'temperature'>, family: TreeFamily, variation = 0.5): TreePhenology {
  const foliage = seasonalFoliage(month, cell, weather, family === 'conifer' || family === 'alpine', variation);
  const phase = ((month + (variation - 0.5) * 0.7 + (cell.temperature - 0.46) * 1.5) % 12 + 12) % 12;
  const blossom = family === 'cherry'
    ? smoothstep(1.1, 2, phase) * smoothstep(3.9, 2.6, phase) * smoothstep(0.2, 0.42, weather.temperature)
    : 0;
  return { ...foliage, canopy: Math.max(foliage.canopy, blossom * 0.95), blossom };
}

/** Absolute leaf colors: pink geometry must never multiply a summer green back into muddy pink. */
export function treeFoliageColour(family: TreeFamily, phase: TreePhenology, variation: number, target: THREE.Color, moisture = 0.5): THREE.Color {
  target.copy(SUMMER[family]).lerp(SPRING, phase.growth * 0.32);
  // Stable individual variation within a species. Wet woodland carries cool waxy foliage;
  // a small minority of broadleaf relatives express violet pigments, never entire neon biomes.
  if (family === 'dry' || family === 'alpine') target.lerp(PALE_SAGE, variation * 0.38);
  else {
    target.lerp(variation > 0.62 ? BLUE_GREEN : EMERALD, (0.12 + variation * 0.38) * smoothstep(0.2, 0.7, moisture));
    if (family !== 'cherry' && family !== 'conifer') target.lerp(VIOLET_LEAF, smoothstep(0.88, 1, variation) * 0.72);
  }
  if (phase.autumn > 0) {
    // Two successive blends keep this allocation-free at forest scale.
    target.lerp(AUTUMN_GOLD, phase.autumn);
    target.lerp(AUTUMN_RUST, phase.autumn * variation * 0.8);
  }
  return target.lerp(BLOSSOM, phase.blossom);
}
