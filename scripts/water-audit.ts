import { Simulation } from '../src/sim/Simulation';
import { GODBOX_CONFIG } from '../godbox.config';
import { buildInlandWater } from '../src/render/terrain/WaterSystem';
import { elevationToY } from '../src/sim/terrain/SurfaceGeometry';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';

const seed = process.argv[2] ?? GODBOX_CONFIG.seed ?? 'witness-the-saffron-river';
const sim = new Simulation({ ...GODBOX_CONFIG, startMode: 'arrival', seed });
const world = sim.state.world;
const t = world.terrain;
const water = buildInlandWater(world)!;
// Surface and skirt are welded together for watertightness, but slope is only meaningful on the
// surface: a skirt wall is vertical by design.
const surfaceOnly = water.geometry.getAttribute('position');
const parts = [water, ...(water.children as import('three').Mesh[])];
const flat: number[] = [];
for (const part of parts) {
  const attribute = part.geometry.getAttribute('position');
  for (let i = 0; i < attribute.count; i++) flat.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
}
const p = { count: flat.length / 3, getX: (i: number) => flat[i * 3]!, getY: (i: number) => flat[i * 3 + 1]!, getZ: (i: number) => flat[i * 3 + 2]! };
const ground = renderedGroundSampler(world);
const key = (i: number) => `${p.getX(i).toFixed(5)}:${p.getZ(i).toFixed(5)}:${p.getY(i).toFixed(4)}`;
const keyXZ = (i: number) => `${p.getX(i).toFixed(5)}:${p.getZ(i).toFixed(5)}`;
const edges = new Map<string, { n: number; a: number; b: number }>();
const tri = p.count / 3;
for (let f = 0; f < tri; f++) for (let e = 0; e < 3; e++) {
  const a = f * 3 + e, b = f * 3 + (e + 1) % 3;
  const ka = key(a), kb = key(b);
  const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  const r = edges.get(k); if (r) r.n++; else edges.set(k, { n: 1, a, b });
}
let boundary = 0, shore = 0, interior = 0; const bad: string[] = [];
for (const { n, a, b } of edges.values()) {
  if (n !== 1) continue; boundary++;
  const da = p.getY(a) - ground(p.getX(a), p.getZ(a));
  const db = p.getY(b) - ground(p.getX(b), p.getZ(b));
  if ((da < 0.004 && db < 0.004) || Math.max(p.getY(a), p.getY(b)) < 0.06) shore++; else { interior++; if (bad.length < 12) bad.push(`(${p.getX(a).toFixed(2)},${p.getZ(a).toFixed(2)})->(${p.getX(b).toFixed(2)},${p.getZ(b).toFixed(2)}) y ${p.getY(a).toFixed(3)}/${p.getY(b).toFixed(3)} depth ${da.toFixed(3)}/${db.toFixed(3)}`); }
}
// XZ-position height disagreement (cracks between triangles sharing a point)
const yAt = new Map<string, number>(); let crack = 0; let maxCrack = 0;
for (let i = 0; i < p.count; i++) { const k = keyXZ(i); const y = yAt.get(k); if (y === undefined) yAt.set(k, p.getY(i)); else if (Math.abs(y - p.getY(i)) > 1e-4) { crack++; maxCrack = Math.max(maxCrack, Math.abs(y - p.getY(i))); } }
// steep water triangles
let steep = 0, maxSlope = 0;
for (let f = 0; f * 3 + 2 < surfaceOnly.count; f++) {
  const ys = [0, 1, 2].map(i => surfaceOnly.getY(f * 3 + i)); const span = Math.max(...ys) - Math.min(...ys);
  const h = Math.max(...[[0, 1], [1, 2], [2, 0]].map(([i, j]) => Math.hypot(surfaceOnly.getX(f * 3 + i!) - surfaceOnly.getX(f * 3 + j!), surfaceOnly.getZ(f * 3 + i!) - surfaceOnly.getZ(f * 3 + j!))));
  if (h < 1e-12) continue;
  maxSlope = Math.max(maxSlope, span / h); if (span / h > 0.6) steep++;
}
// wet-mask coverage holes: dense samples where hydrology says wet with depth but no triangle covers xz
const cell = t.step / 4; const grid = new Map<number, number[]>(); const gk = (x: number, z: number) => Math.floor(x / cell) * 100003 + Math.floor(z / cell);
for (let f = 0; f < tri; f++) {
  const xs = [0, 1, 2].map(i => p.getX(f * 3 + i)), zs = [0, 1, 2].map(i => p.getZ(f * 3 + i));
  for (let gx = Math.floor(Math.min(...xs) / cell); gx <= Math.floor(Math.max(...xs) / cell); gx++) for (let gz = Math.floor(Math.min(...zs) / cell); gz <= Math.floor(Math.max(...zs) / cell); gz++) { const k = gx * 100003 + gz; (grid.get(k) ?? grid.set(k, []).get(k)!).push(f); }
}
const covered = (x: number, z: number): boolean => {
  for (const f of grid.get(gk(x, z)) ?? []) {
    const [ax, az, bx, bz, cx, cz] = [0, 1, 2].flatMap(i => [p.getX(f * 3 + i), p.getZ(f * 3 + i)]) as number[];
    const d = (bz! - cz!) * (ax! - cx!) + (cx! - bx!) * (az! - cz!); if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bz! - cz!) * (x - cx!) + (cx! - bx!) * (z - cz!)) / d, l2 = ((cz! - az!) * (x - cx!) + (ax! - cx!) * (z - cz!)) / d, l3 = 1 - l1 - l2;
    if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return true;
  } return false;
};
let uncovered = 0, tested = 0; const holes: string[] = [];
for (let z = t.originZ; z < t.originZ + t.resolution * t.step; z += cell * 0.5) for (let x = t.originX; x < t.originX + t.resolution * t.step; x += cell * 0.5) {
  const fx = (x - t.originX) / t.step, fz = (z - t.originZ) / t.step; const ix = Math.round(fx), iz = Math.round(fz);
  if (ix < 0 || iz < 0 || ix >= t.resolution || iz >= t.resolution) continue;
  const idx = iz * t.resolution + ix;
  // conservative interior: nearest sample wet and all 8 neighbours wet with level >= ground+margin
  let inside = true; for (let dz = -1; dz <= 1 && inside; dz++) for (let dx = -1; dx <= 1; dx++) { const jx = ix + dx, jz = iz + dz; if (jx < 0 || jz < 0 || jx >= t.resolution || jz >= t.resolution || t.waterLevel[jz * t.resolution + jx]! < 0 || t.height[jz * t.resolution + jx]! < world.seaLevel) { inside = false; break; } }
  if (!inside || t.height[idx]! < world.seaLevel) continue;
  { const L = t.waterLevel[idx]!; let minL = L; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) minL = Math.min(minL, t.waterLevel[(iz + dz) * t.resolution + ix + dx]!); if (elevationToY(minL, world.seaLevel) - ground(x, z) < 0.02) continue; }
  tested++; if (!covered(x, z)) { uncovered++; if (holes.length < 12) holes.push(`(${x.toFixed(2)},${z.toFixed(2)})`); }
}
// Water standing above the surface hydrology gave it: a spike or slab reads instantly to the eye.
let spike = 0, spikes = 0;
for (let i = 0; i < surfaceOnly.count; i++) {
  const x = surfaceOnly.getX(i), z = surfaceOnly.getZ(i);
  const ix = Math.round((x - t.originX) / t.step), iz = Math.round((z - t.originZ) / t.step);
  let highest = -Infinity;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const jx = ix + dx, jz = iz + dz;
    if (jx < 0 || jz < 0 || jx >= t.resolution || jz >= t.resolution) continue;
    const level = t.waterLevel[jz * t.resolution + jx]!;
    if (level >= 0) highest = Math.max(highest, elevationToY(level, world.seaLevel));
  }
  if (!Number.isFinite(highest)) continue;
  const excess = surfaceOnly.getY(i) - highest;
  if (excess > spike) spike = excess;
  if (excess > 0.2) spikes++;
}
console.log(JSON.stringify({ seed, maxSpike: +spike.toFixed(3), spikeVerts: spikes, tris: tri, boundaryEdges: boundary, shore, interiorBoundary: interior, crackVerts: crack, maxCrack, steepTris: steep, maxSlope: +maxSlope.toFixed(2), tested, uncovered }, null, 1));
console.log('interior boundary samples:', bad); console.log('uncovered samples:', holes);
