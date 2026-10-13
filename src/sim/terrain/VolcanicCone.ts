import { stableHash } from '../prng';
import type { RawHeightfield } from './Heightfield';
import type { Hydrology } from './Hydrology';

/** Where the world's volcano was sculpted, in world units and raw 0..1 elevation. */
export interface VolcanicVent {
  readonly worldX: number;
  readonly worldZ: number;
  readonly craterRadius: number;
  readonly coneRadius: number;
  readonly rimElevation: number;
  readonly floorElevation: number;
}

const CRATER_RADIUS = 4.5;
const CONE_RADIUS = 19;
const RIM_RAISE = 0.03;
const CRATER_DEPTH = 0.085;
const CONE_DROP = 0.34;

const smoothMax = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};

/**
 * Turns the world's highest viable dry summit into a stratovolcano: a steep, concave cone with a summit
 * crater, written into the heightfield itself so terrain, vegetation, people and the camera all
 * agree on its shape. Runs after hydrology so the crater stays a dry bowl for lava rather than
 * being pit-filled into a lake, and only raises dry ground so rivers and lakes keep their beds.
 */
export function sculptVolcano(raw: RawHeightfield, hydrology: Hydrology, seed: string, seaLevel: number): VolcanicVent | undefined {
  const { height, resolution, step, originX, originZ } = raw;
  const margin = Math.ceil(CONE_RADIUS / step) + 1;
  const dryCrater = Math.ceil(CRATER_RADIUS * 1.15 / step);
  const hasDryCrater = (x: number, z: number): boolean => {
    for (let dz = -dryCrater; dz <= dryCrater; dz++) for (let dx = -dryCrater; dx <= dryCrater; dx++) {
      if (Math.hypot(dx, dz) * step > CRATER_RADIUS * 1.15) continue;
      if ((hydrology.waterLevel[(z + dz) * resolution + x + dx] ?? -1) >= 0) return false;
    }
    return true;
  };
  let summit = -1;
  let fallback = -1;
  for (let z = margin; z < resolution - margin; z += 1) {
    for (let x = margin; x < resolution - margin; x += 1) {
      const index = z * resolution + x;
      if ((hydrology.waterLevel[index] ?? -1) >= 0) continue;
      if (fallback < 0 || height[index]! > height[fallback]!) fallback = index;
      if ((summit < 0 || height[index]! > height[summit]!) && hasDryCrater(x, z)) summit = index;
    }
  }
  // Compact worlds may have no entirely dry crater-sized disk. Keep a dry vent at their
  // highest summit and preserve the nearby water samples, as the skirt does below.
  if (summit < 0) summit = fallback;
  if (summit < 0 || height[summit]! <= seaLevel + CRATER_DEPTH - RIM_RAISE + 0.02) return undefined;

  const cx = summit % resolution;
  const cz = (summit / resolution) | 0;
  const rimElevation = height[summit]! + RIM_RAISE;
  const floorElevation = rimElevation - CRATER_DEPTH;
  const phase = stableHash(`${seed}:volcano:gullies`) * Math.PI * 2;
  const reach = Math.ceil(CONE_RADIUS / step);
  const bankBlend = Math.ceil(2.4 / step);

  for (let dz = -reach; dz <= reach; dz += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const radius = Math.hypot(dx, dz) * step;
      if (radius > CONE_RADIUS) continue;
      const index = (cz + dz) * resolution + (cx + dx);
      if ((hydrology.waterLevel[index] ?? -1) >= 0) continue;
      const ground = height[index]!;
      const angle = Math.atan2(dz, dx);
      if (radius < CRATER_RADIUS) {
        const bowl = Math.min(1, Math.max(0, (radius / CRATER_RADIUS - 0.3) / 0.7));
        height[index] = floorElevation + (rimElevation - floorElevation) * bowl * bowl * (3 - 2 * bowl);
        continue;
      }
      const t = (radius - CRATER_RADIUS) / (CONE_RADIUS - CRATER_RADIUS);
      // Concave flanks: steep below the rim, flattening into the mountain's own slopes.
      const gullies = (Math.sin(angle * 9 + phase) * 0.6 + Math.sin(angle * 23 + phase * 1.7) * 0.4) * 0.012 * Math.sqrt(t);
      const lip = 0.01 * Math.exp(-(((radius - CRATER_RADIUS) / (CRATER_RADIUS * 0.35)) ** 2));
      const cone = rimElevation - CONE_DROP * t ** 0.62 + gullies + lip;
      // Fade the cone's influence to zero at its skirt so it always meets the ground without a step.
      const fade = t > 0.7 ? (t - 0.7) / 0.3 : 0;
      // Preserving a water sample alone creates sheer, one-sample walls beside rivers. Ease
      // the raised skirt into the original banks while leaving all actual water beds intact.
      let waterDistance = 2.4;
      for (let wz = -bankBlend; wz <= bankBlend; wz++) for (let wx = -bankBlend; wx <= bankBlend; wx++) {
        const x = cx + dx + wx, z = cz + dz + wz;
        if (x < 0 || z < 0 || x >= resolution || z >= resolution) continue;
        if ((hydrology.waterLevel[z * resolution + x] ?? -1) >= 0) waterDistance = Math.min(waterDistance, Math.hypot(wx, wz) * step);
      }
      const bank = Math.min(1, waterDistance / 2.4);
      const influence = (1 - fade * fade * (3 - 2 * fade)) * bank * bank * (3 - 2 * bank);
      height[index] = ground + (smoothMax(ground, cone, 0.025) - ground) * influence;
    }
  }

  return {
    worldX: originX + cx * step,
    worldZ: originZ + cz * step,
    craterRadius: CRATER_RADIUS,
    coneRadius: CONE_RADIUS,
    rimElevation,
    floorElevation,
  };
}
