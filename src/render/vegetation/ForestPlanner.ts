import { SeededRandom } from '../../sim/prng';
import { clamp01, fbm, smoothstep } from '../../sim/terrain/noise';
import type { WorldState } from '../../sim/types';
import type { TerrainSurface } from '../terrain/TerrainSurface';
import type { TreeFamily } from './TreeLibrary';

export interface TreePlacement {
  /** Only the rare, culturally meaningful trees receive a stable individual identity. */
  id?: string;
  /** Settlement that intentionally planted this tree. Managed trees survive that settlement's clearing. */
  managedBy?: string;
  worldX: number;
  worldZ: number;
  y: number;
  family: TreeFamily;
  variant: number;
  scale: number;
  rotation: number;
  /** 0..1 seeded visual maturity/size bias; chronological age is derived from establishedYear. */
  age: number;
  /** Year in which this tree's current stand established. Age is derived, never ticked. */
  establishedYear: number;
  /** Deterministic mortality threshold in years; significant trees deliberately outlive it. */
  lifespanYears: number;
  /** 0..1 local capacity to re-establish after clearance. */
  regrowth: number;
}

export type TreeLifecycleStage = 'sapling' | 'young' | 'mature' | 'old' | 'declining' | 'dead-standing' | 'fallen';

export interface ResolvedTreeLifecycle {
  stage: TreeLifecycleStage;
  scale: number;
  foliageVisible: boolean;
  fallen: boolean;
}

export type ForestSuccessionStage = 'cleared' | 'regrowth' | 'young-woodland' | 'mature-forest';
export type TreeSeason = 'winter' | 'spring' | 'summer' | 'autumn';

export function treeSeason(month: number): TreeSeason {
  const normalized = ((month % 12) + 12) % 12;
  if (normalized >= 1 && normalized <= 3) return 'spring';
  if (normalized >= 4 && normalized <= 6) return 'summer';
  if (normalized >= 7 && normalized <= 9) return 'autumn';
  return 'winter';
}

const DEAD_STANDING_YEARS = 22;
const MIN_REESTABLISH_YEARS = 4;
const MAX_REESTABLISH_YEARS = 18;

/**
 * Resolves the infrequent visible lifecycle class from immutable placement data and a simulation
 * year. Ordinary forest slots represent successive generations: once deadwood has lain long enough,
 * suitable ground deterministically starts a new sapling instead of remaining a permanent graveyard.
 * Stable significant-tree identities are not recycled into a different individual.
 */
export function resolveTreeLifecycle(tree: TreePlacement, year: number, disturbed = false): ResolvedTreeLifecycle {
  const chronologicalAge = Math.max(0, year - tree.establishedYear);
  const lifespan = tree.lifespanYears;
  const significant = tree.id !== undefined;
  const mortalityAge = disturbed && !significant ? Math.min(lifespan, 18 + Math.round((1 - tree.regrowth) * 20)) : lifespan;
  const reestablishYears = Math.round(MIN_REESTABLISH_YEARS + (1 - clamp01(tree.regrowth)) * (MAX_REESTABLISH_YEARS - MIN_REESTABLISH_YEARS));
  const generationSpan = mortalityAge + DEAD_STANDING_YEARS + reestablishYears;
  const ageYears = !significant && chronologicalAge >= generationSpan ? chronologicalAge % generationSpan : chronologicalAge;

  if (ageYears >= mortalityAge + DEAD_STANDING_YEARS) return { stage: 'fallen', scale: tree.scale * 0.72, foliageVisible: false, fallen: true };
  if (ageYears >= mortalityAge) return { stage: 'dead-standing', scale: tree.scale * 0.82, foliageVisible: false, fallen: false };
  if (ageYears >= mortalityAge * 0.82) return { stage: 'declining', scale: tree.scale * 1.03, foliageVisible: true, fallen: false };
  if (ageYears >= 90 || (significant && ageYears >= 55)) return { stage: 'old', scale: tree.scale * 1.2, foliageVisible: true, fallen: false };
  if (ageYears >= 35) return { stage: 'mature', scale: tree.scale, foliageVisible: true, fallen: false };
  if (ageYears >= 15) return { stage: 'young', scale: tree.scale * 0.7, foliageVisible: true, fallen: false };
  return { stage: 'sapling', scale: tree.scale * 0.34, foliageVisible: true, fallen: false };
}

/** Coarse stand succession: a regional rule, never an individual sapling simulation. */
export function resolveForestSuccession(yearsSinceDisturbance: number, suitability: number): ForestSuccessionStage {
  if (suitability < 0.2 || yearsSinceDisturbance <= 0) return 'cleared';
  const adjustedYears = yearsSinceDisturbance * (0.45 + clamp01(suitability));
  if (adjustedYears < 12) return 'regrowth';
  if (adjustedYears < 42) return 'young-woodland';
  return 'mature-forest';
}

export interface ForestPlan {
  trees: TreePlacement[];
  byFamily: Record<TreeFamily, number>;
}

const EMPTY_COUNTS = (): Record<TreeFamily, number> => ({
  cherry: 0, broadleaf: 0, conifer: 0, dry: 0, riverbank: 0, alpine: 0, ancient: 0,
});

/** Unit-height trees are grown at scale 1; this is what makes them read as trees beside people. */
const TREE_SCALE = 2.5;

const LIFESPAN_YEARS: Record<TreeFamily, readonly [number, number]> = {
  cherry: [65, 115], broadleaf: [110, 210], conifer: [130, 280], dry: [90, 175],
  riverbank: [70, 135], alpine: [120, 240], ancient: [500, 900],
};

interface Ecology {
  density: number;
  family: TreeFamily;
}

/**
 * Where the forest wants to be. Density comes from woodland resource, moisture and slope, then a
 * low-frequency patch field carves cores, edges and clearings so stands have rhythm instead of
 * uniform scatter.
 */
function ecologyAt(
  world: WorldState,
  surface: TerrainSurface,
  seed: string,
  worldX: number,
  worldZ: number,
  cultivated: number,
): Ecology {
  const sample = surface.sample(worldX, worldZ);
  const { mountainLevel, seaLevel } = world;

  const patch = fbm(`${seed}:forest-patch`, worldX * 0.052, worldZ * 0.052, 4);
  const clearing = fbm(`${seed}:forest-clearing`, worldX * 0.14 + 41, worldZ * 0.14 - 17, 3);
  const canopy = smoothstep(0.12, 0.46, sample.wood) * smoothstep(0.18, 0.42, sample.moisture);
  const standing = smoothstep(0.82, 0.36, sample.slope);
  const treeline = smoothstep(mountainLevel + 0.16, mountainLevel - 0.1, sample.elevation);
  const aboveTide = smoothstep(seaLevel - 0.004, seaLevel + 0.012, sample.elevation);
  const density = clamp01(canopy * standing * treeline * aboveTide * smoothstep(0.34, 0.62, patch) * smoothstep(0.92, 0.62, clearing));

  let family: TreeFamily = 'broadleaf';
  if (sample.elevation > mountainLevel - 0.06) family = 'alpine';
  else if (sample.temperature < 0.34 || sample.elevation > mountainLevel - 0.2) family = 'conifer';
  else if (sample.flow > 0.34) family = 'riverbank';
  else if (sample.moisture < 0.4) family = 'dry';
  else {
    // Blossom groves are deliberately scarce. In the wild they cluster where a culture would have
    // planted them anyway: sheltered, watered, gentle ground. Near a town a second mask breaks the
    // planting into orchard rows so the approach is lined rather than smothered.
    const grove = fbm(`${seed}:blossom-grove`, worldX * 0.028 - 63, worldZ * 0.028 + 29, 3);
    const orchard = cultivated > 0.5 && fbm(`${seed}:orchard`, worldX * 0.1, worldZ * 0.1, 3) > 0.63;
    if ((grove > 0.73 || orchard) && sample.moisture > 0.4 && sample.temperature > 0.4 && sample.slope < 0.36) family = 'cherry';
  }
  return { density, family };
}

/**
 * Lays out the whole forest once. Trees are scattered per simulation cell so density follows the
 * ecology, and every attribute is drawn from a seeded stream so a replay grows the same wood.
 */
export function planForest(
  world: WorldState,
  surface: TerrainSurface,
  seed: string,
  budget: number,
  variantsPerFamily: number,
  anchors: readonly { x: number; z: number }[] = [],
): ForestPlan {
  const random = new SeededRandom(`${seed}:forest`);
  const trees: TreePlacement[] = [];
  const byFamily = EMPTY_COUNTS();
  const land = world.cells.filter((cell) => !cell.water && cell.wood > 0.18);
  if (land.length === 0) return { trees, byFamily };

  /** Ceremonial planting: a ring of managed ground around a settlement, not the settlement itself. */
  const cultivationAt = (worldX: number, worldZ: number): number => {
    let best = 0;
    for (const anchor of anchors) {
      const distance = Math.hypot(worldX - anchor.x, worldZ - anchor.z);
      best = Math.max(best, smoothstep(4, 8, distance) * smoothstep(18, 11, distance));
    }
    return best;
  };

  const perCell = budget / land.length;
  const half = world.cellSize * 0.5;
  for (const cell of land) {
    let quota = perCell * (0.6 + cell.wood * 1.8);
    let attempts = Math.ceil(quota) + 1;
    while (attempts > 0 && trees.length < budget) {
      attempts -= 1;
      if (quota < 1 && !random.chance(quota)) break;
      quota -= 1;
      const worldX = cell.worldX + random.range(-half, half);
      const worldZ = cell.worldZ + random.range(-half, half);
      const cultivated = cultivationAt(worldX, worldZ);
      const ecology = ecologyAt(world, surface, seed, worldX, worldZ, cultivated);
      if (!random.chance(ecology.density)) continue;
      const waterY = surface.waterYAt(worldX, worldZ);
      const y = surface.heightAt(worldX, worldZ);
      if (Number.isFinite(waterY) && waterY > y - 0.05) continue;
      const age = random.float() ** 1.7;
      const ancient = ecology.family !== 'alpine' && ecology.family !== 'dry' && random.chance(0.005);
      const family = ancient ? 'ancient' : ecology.family;
      const lifespan = LIFESPAN_YEARS[family];
      const lifespanYears = random.int(lifespan[0], lifespan[1] + 1);
      const establishedYear = ancient ? -random.int(110, 420) : -Math.round(age * Math.min(80, lifespanYears * 0.7));
      trees.push({
        id: ancient ? `tree:${seed}:${trees.length}` : undefined,
        worldX,
        worldZ,
        y,
        family,
        variant: random.int(0, variantsPerFamily),
        scale: TREE_SCALE * (ancient ? 1.75 : 1) * (0.62 + age * 0.75) * random.range(0.86, 1.16),
        rotation: random.range(0, Math.PI * 2),
        age: ancient ? 1 : age,
        establishedYear,
        lifespanYears,
        regrowth: ecology.density,
      });
      byFamily[family] += 1;
    }
  }
  return { trees, byFamily };
}
