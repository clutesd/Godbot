import { clamp01, fbmSeeded, octaveSeeds } from '../terrain/noise';
import type { WorldCell } from '../types';
import type { Geology, RockFamily } from './types';

/** The same broad crustal field shapes relief and supplies the persistent parent rock. */
export function geologySampler(seed: string) {
  const crust = octaveSeeds(seed, 'parent-rock', 3);
  const mineral = octaveSeeds(seed, 'mineral-province', 3);
  return (x: number, z: number): { family: RockFamily; uplift: number; enrichment: number } => {
    const field = fbmSeeded(crust, x * 0.095, z * 0.095);
    const family: RockFamily = field < 0.36 ? 'limestone' : field < 0.47 ? 'sedimentary'
      : field < 0.56 ? 'metamorphic' : field < 0.65 ? 'volcanic' : 'granite';
    return { family, uplift: (field - 0.46) * 0.22,
      enrichment: clamp01((fbmSeeded(mineral, x * 0.13 + 17, z * 0.13 - 29) - 0.25) * 1.8) };
  };
}

export function parentGeology(cell: WorldCell, sample: ReturnType<ReturnType<typeof geologySampler>>): Geology {
  const { family, enrichment: e } = sample;
  const sediment = clamp01((1 - cell.slope * 2) * (cell.flow * 0.6 + (cell.landform === 'basin' ? 0.35 : 0.08)));
  const exposure = clamp01(cell.rockiness * 0.65 + cell.slope * 0.55 + cell.relief - sediment * 0.2 + 0.06);
  return { family, exposure, sediment, potential: {
    stone: clamp01(0.25 + exposure * 0.7),
    'copper-ore': family === 'volcanic' || family === 'metamorphic' ? e : 0,
    'tin-ore': family === 'granite' ? e : 0,
    'iron-ore': family === 'metamorphic' || family === 'sedimentary' ? e : 0,
    clay: clamp01(sediment + (family === 'sedimentary' ? 0.4 : 0)),
    sand: clamp01(sediment * 0.5 + (cell.coast ? 0.5 : 0)),
    gravel: clamp01(cell.flow * cell.slope * 3 + cell.relief),
    coal: family === 'sedimentary' ? e * sediment : 0,
    rare: family === 'granite' && e > 0.78 ? (e - 0.78) / 0.22 : 0,
  } };
}
