import type { Vec2, WorldState } from '../../sim/types';
import { elevationToY } from '../../sim/terrain/SurfaceGeometry';

export interface HydraulicVisualSite {
  riverX: number;
  riverZ: number;
  bankX: number;
  bankZ: number;
  waterY: number;
  flowX: number;
  flowZ: number;
  /** +1 means the selected bank lies on local +X when local +Z follows downstream. */
  bankSide: 1 | -1;
  flow: number;
  index: number;
}

function pointForIndex(world: WorldState, index: number): Vec2 {
  const field = world.terrain;
  return {
    x: field.originX + index % field.resolution * field.step,
    z: field.originZ + Math.floor(index / field.resolution) * field.step,
  };
}

function flowDirection(world: WorldState, index: number): readonly [number, number] {
  const field = world.terrain;
  const next = field.drainage?.downstream[index] ?? -1;
  if (next >= 0 && next !== index && field.river[next]) {
    const from = pointForIndex(world, index);
    const to = pointForIndex(world, next);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length > 1e-6) return [dx / length, dz / length];
  }

  // Older archives may not carry the drainage graph. Prefer the locally lower river neighbour.
  const x0 = index % field.resolution;
  const z0 = Math.floor(index / field.resolution);
  let best = -1;
  let bestHeight = Number.POSITIVE_INFINITY;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue;
      const x = x0 + dx, z = z0 + dz;
      if (x < 0 || z < 0 || x >= field.resolution || z >= field.resolution) continue;
      const candidate = z * field.resolution + x;
      if (!field.river[candidate]) continue;
      const height = field.waterLevel[candidate] ?? field.height[candidate] ?? 1;
      if (height < bestHeight) { best = candidate; bestHeight = height; }
    }
  }
  if (best >= 0) {
    const from = pointForIndex(world, index), to = pointForIndex(world, best);
    const dx = to.x - from.x, dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length > 1e-6) return [dx / length, dz / length];
  }
  return [0, 1];
}

/**
 * Renderer-only hydraulic siting. It reads canonical fine hydrology and never changes simulation
 * placement or invents water. The nearest strong river sample wins, with discharge as a mild tie-break.
 */
export function planHydraulicVisualSite(
  world: WorldState,
  origin: Vec2,
  maxDistance = Math.max(world.cellSize * 5, 12),
): HydraulicVisualSite | undefined {
  const field = world.terrain;
  const centerX = Math.round((origin.x - field.originX) / field.step);
  const centerZ = Math.round((origin.z - field.originZ) / field.step);
  const radius = Math.max(1, Math.ceil(maxDistance / field.step));
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let dz = -radius; dz <= radius; dz += 1) {
    const z = centerZ + dz;
    if (z < 0 || z >= field.resolution) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = centerX + dx;
      if (x < 0 || x >= field.resolution) continue;
      const index = z * field.resolution + x;
      if (!field.river[index] || (field.waterLevel[index] ?? -1) < 0) continue;
      const point = pointForIndex(world, index);
      const distance = Math.hypot(point.x - origin.x, point.z - origin.z);
      if (distance > maxDistance) continue;
      const discharge = Math.max(0, field.flow[index] ?? 0);
      const score = distance - discharge * field.step * 1.8;
      if (score < bestScore) { bestScore = score; bestIndex = index; }
    }
  }
  if (bestIndex < 0) return undefined;

  const river = pointForIndex(world, bestIndex);
  const [flowX, flowZ] = flowDirection(world, bestIndex);
  const acrossX = -flowZ, acrossZ = flowX;
  const towardOrigin = (origin.x - river.x) * acrossX + (origin.z - river.z) * acrossZ;
  const bankSide: 1 | -1 = towardOrigin >= 0 ? 1 : -1;
  const bankOffset = field.step * 1.15;
  const waterLevel = field.waterLevel[bestIndex] ?? world.seaLevel;
  return {
    riverX: river.x,
    riverZ: river.z,
    bankX: river.x + acrossX * bankOffset * bankSide,
    bankZ: river.z + acrossZ * bankOffset * bankSide,
    waterY: elevationToY(waterLevel, world.seaLevel),
    flowX,
    flowZ,
    bankSide,
    flow: Math.max(0, field.flow[bestIndex] ?? 0),
    index: bestIndex,
  };
}

/** Local +Z follows downstream and local +X points to the selected bank. */
export function hydraulicRotationY(site: HydraulicVisualSite): number {
  const downstreamYaw = Math.atan2(site.flowX, site.flowZ);
  return site.bankSide > 0 ? downstreamYaw : downstreamYaw + Math.PI;
}
