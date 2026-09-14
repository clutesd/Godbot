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
  birch: speciesFoliageColour('birch'), conifer: speciesFoliageColour('conifer'),
  dry: speciesFoliageColour('dry'), riverbank: speciesFoliageColour('riverbank'),
  alpine: speciesFoliageColour('alpine'), ancient: speciesFoliageColour('ancient'),
};
const PIGMENT_ACCENT: Record<TreeFamily, THREE.Color> = {
  cherry: new THREE.Color('#78924f'),
  broadleaf: new THREE.Color('#557d43'),
  birch: new THREE.Color('#96b96a'),
  conifer: new THREE.Color('#3c6650'),
  dry: new THREE.Color('#91905a'),
  riverbank: new THREE.Color('#5d8d63'),
  alpine: new THREE.Color('#526e5a'),
  ancient: new THREE.Color('#486a3d'),
};
const WET_ACCENT: Record<TreeFamily, THREE.Color> = {
  cherry: new THREE.Color('#587c54'),
  broadleaf: new THREE.Color('#426f4a'),
  birch: new THREE.Color('#6f985f'),
  conifer: new THREE.Color('#31594c'),
  dry: new THREE.Color('#76815a'),
  riverbank: new THREE.Color('#4d8263'),
  alpine: new THREE.Color('#466756'),
  ancient: new THREE.Color('#385f43'),
};
const SPRING = new THREE.Color('#91aa5b');
const BIRCH_SPRING = new THREE.Color('#a7c56d');
const BLOSSOM = new THREE.Color('#efb6c9');
const AUTUMN_GOLD = new THREE.Color('#c6a04f');
const BIRCH_AUTUMN_GOLD = new THREE.Color('#e0c657');
const AUTUMN_RUST = new THREE.Color('#b65c39');
const VIOLET_LEAF = new THREE.Color('#756a84');
const PALE_SAGE = new THREE.Color('#a8ac76');

/** Local climate and the shared calendar govern leaves, birch shedding and the short cherry bloom. */
export function resolveTreePhenology(month: number, cell: Pick<WorldCell, 'temperature' | 'moisture'>,
  weather: Pick<WeatherCellState, 'temperature'>, family: TreeFamily, variation = 0.5): TreePhenology {
  const foliage = seasonalFoliage(month, cell, weather, family === 'conifer' || family === 'alpine', variation);
  const phase = ((month + (variation - 0.5) * 0.7 + (cell.temperature - 0.46) * 1.5) % 12 + 12) % 12;
  const blossom = family === 'cherry'
    ? smoothstep(1.1, 2, phase) * smoothstep(3.9, 2.6, phase) * smoothstep(0.2, 0.42, weather.temperature)
    : 0;

  // Birch reveals its defining pale stems before the rest of the deciduous forest is fully bare.
  // A short late-autumn shedding window thins the crown and feeds the existing leaf particles;
  // winter still resolves through the shared seasonal model rather than a special hard switch.
  const birchShedding = family === 'birch'
    ? smoothstep(7.15, 9.15, phase) * (1 - smoothstep(9.75, 10.75, phase))
    : 0;
  const canopy = foliage.canopy * (1 - birchShedding * 0.3);
  const leafFall = Math.max(foliage.leafFall, birchShedding * 0.88);

  return { ...foliage, canopy: Math.max(canopy, blossom * 0.95), leafFall, blossom };
}

/**
 * Absolute leaf colours with family-specific pigment and moisture response. Birch stays a brighter,
 * translucent-looking yellow-green through the growing season and turns predominantly clear gold.
 */
export function treeFoliageColour(family: TreeFamily, phase: TreePhenology, variation: number, target: THREE.Color, moisture = 0.5): THREE.Color {
  target.copy(SUMMER[family]);
  if (family === 'birch') target.lerp(BIRCH_SPRING, phase.growth * 0.38);
  else target.lerp(SPRING, phase.growth * 0.3);

  const individuality = 0.07 + Math.abs(variation - 0.5) * 0.24;
  target.lerp(PIGMENT_ACCENT[family], individuality);
  const wetness = smoothstep(0.28, 0.78, moisture);
  target.lerp(WET_ACCENT[family], wetness * (0.05 + variation * 0.12));

  if (family === 'dry' || family === 'alpine') {
    target.lerp(PALE_SAGE, smoothstep(0.64, 1, variation) * 0.22);
  } else if (family === 'broadleaf' || family === 'riverbank' || family === 'ancient') {
    target.lerp(VIOLET_LEAF, smoothstep(0.94, 1, variation) * 0.28);
  }

  if (phase.autumn > 0) {
    if (family === 'birch') {
      target.lerp(BIRCH_AUTUMN_GOLD, phase.autumn);
      target.lerp(AUTUMN_RUST, phase.autumn * variation * 0.12);
    } else {
      target.lerp(AUTUMN_GOLD, phase.autumn);
      target.lerp(AUTUMN_RUST, phase.autumn * variation * 0.8);
    }
  }
  return target.lerp(BLOSSOM, phase.blossom);
}
