import fs from 'fs';
const p='src/render/terrain/WaterSystem.ts';
let s=fs.readFileSync(p,'utf8');
const a=s.indexOf('/**\n * Deepest the surface may be at a position');
const b=s.indexOf('interface InlandVertex {');
const replacement=`/**
 * How far the surface must sit below its canonical level at a position because lower dry ground
 * lies beside the wet footprint. Depth may grow away from the footprint contour only at the
 * meniscus slope, and the correction never exceeds the real drop to that dry ground, so basin lakes
 * with steep shores and valley rivers keep their canonical level (limit is then Infinity).
 */
function bankDepthLimit(
  world: WorldState,
  groundAt: (x: number, z: number) => number,
  x: number,
  z: number,
  levelY: number,
): { depth: number; maxDrop: number } {
  const { terrain } = world;
  const cx = Math.round((x - terrain.originX) / terrain.step);
  const cz = Math.round((z - terrain.originZ) / terrain.step);
  const radius = WATER_BANK_SCAN_SAMPLES;
  const release = (radius - 0.5) * terrain.step;
  let depth = Number.POSITIVE_INFINITY;
  let maxDrop = 0;
  for (let dz = -radius; dz <= radius; dz += 1) for (let dx = -radius; dx <= radius; dx += 1) {
    const sx = cx + dx, sz = cz + dz;
    if (sx < 0 || sz < 0 || sx >= terrain.resolution || sz >= terrain.resolution) continue;
    if (inlandWetSample(world, sz * terrain.resolution + sx)) continue;
    const worldX = terrain.originX + sx * terrain.step;
    const worldZ = terrain.originZ + sz * terrain.step;
    // The footprint contour lies half a sample from the dry sample; depth is measured from it.
    const fromContour = Math.max(0, Math.hypot(worldX - x, worldZ - z) - terrain.step * 0.5);
    if (fromContour >= release) continue;
    const drop = levelY - groundAt(worldX, worldZ);
    if (drop <= WATER_BANK_PERCHED_TOLERANCE_Y) continue;
    const share = fromContour / release;
    const limit = SHORELINE_RENDER_DEPTH + WATER_BANK_MENISCUS_SLOPE * fromContour + WATER_BANK_RELEASE_DEPTH * share * share;
    if (limit < depth) { depth = limit; maxDrop = drop; }
  }
  return { depth, maxDrop };
}

/**
 * The single presented water height for a wet position. It equals the canonical level except where
 * (a) bed relief inside the channel core would otherwise puncture the surface, or (b) the level
 * would hang above lower dry bank ground. Both adjustments are pure functions of position, so every
 * triangle that touches a position agrees on its height.
 */
export function presentedWaterSurface(
  world: WorldState,
  groundAt: (x: number, z: number) => number,
  x: number,
  z: number,
  levelY: number,
  coverage: number,
): { y: number; depth: number } {
  const ground = groundAt(x, z);
  let y = levelY;
  let depth = levelY - ground;
  const core = smoothstep01(0.5, 0.78, coverage);
  const filmDepth = SHORELINE_RENDER_DEPTH + (WATER_FILM_DEPTH - SHORELINE_RENDER_DEPTH) * core;
  if (depth < filmDepth && filmDepth - depth <= WATER_FILM_DEPTH + WATER_FILM_ABSORB_Y * core) {
    depth = filmDepth;
    y = ground + depth;
  }
  const bank = bankDepthLimit(world, groundAt, x, z, levelY);
  if (depth > bank.depth) {
    y = Math.max(ground + Math.max(SHORELINE_RENDER_DEPTH, bank.depth), levelY - bank.maxDrop);
    depth = y - ground;
  }
  return { y, depth };
}

`;
s=s.slice(0,a)+replacement+s.slice(b);
s=s.replace('const WATER_BANK_PERCHED_TOLERANCE_Y = 0.01;','const WATER_BANK_PERCHED_TOLERANCE_Y = 0.002;');
fs.writeFileSync(p,s);
