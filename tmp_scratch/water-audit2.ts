import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater } from '../src/render/terrain/WaterSystem';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';
import { elevationToY } from '../src/sim/terrain/SurfaceGeometry';

const seed = process.argv[2] ?? 'audit-a';
const sim = new Simulation({ seed, startingPopulation: 30, world: { size: 40 }, settlementCount: [2, 3] });
const world = sim.state.world; const f = world.terrain;
console.log('cellSize', world.cellSize, 'step', f.step, 'res', f.resolution, 'origin', f.originX, f.originZ, 'extent', (f.resolution-1)*f.step);
const mesh = buildInlandWater(world)!;
const p = mesh.geometry.getAttribute('position');
const ground = renderedGroundSampler(world);
const key = (i: number) => `${p.getX(i).toFixed(4)}:${p.getZ(i).toFixed(4)}`;
const edges = new Map<string, { n: number; a: number; b: number }>();
for (let t = 0; t < p.count / 3; t++) for (let e = 0; e < 3; e++) {
  const a = t * 3 + e, b = t * 3 + (e + 1) % 3; const ka = key(a), kb = key(b);
  const k = ka < kb ? ka + '|' + kb : kb + '|' + ka; const c = edges.get(k); if (c) c.n++; else edges.set(k, { n: 1, a, b });
}
const ext = (f.resolution - 1) * f.step;
const cls: Record<string, number> = {}; const ex: Record<string, string[]> = {};
const bump = (c: string, s: string) => { cls[c] = (cls[c] ?? 0) + 1; (ex[c] ??= []).length < 3 && ex[c]!.push(s); };
for (const e of edges.values()) {
  if (e.n !== 1) continue;
  const ax = p.getX(e.a), az = p.getZ(e.a), bx = p.getX(e.b), bz = p.getZ(e.b);
  const d1 = p.getY(e.a) - ground(ax, az), d2 = p.getY(e.b) - ground(bx, bz);
  if (Math.max(d1, d2) <= 0.01) { bump('grounded', ''); continue; }
  const border = [ax, bx].some(x => x < f.originX + 0.01 || x > f.originX + ext - 0.01) || [az, bz].some(z => z < f.originZ + 0.01 || z > f.originZ + ext - 0.01);
  if (border) { bump('field-border', `${ax.toFixed(2)},${az.toFixed(2)}`); continue; }
  // find adjacent dry sample terrain
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const wy = (p.getY(e.a) + p.getY(e.b)) / 2;
  // outward probe: sample ground 0.25 step in 4 directions, take the lowest dry
  let worst = 1e9; let dryNeighbourLower = 0;
  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const gx = mx + dx * f.step * 0.3, gz = mz + dz * f.step * 0.3;
    worst = Math.min(worst, ground(gx, gz));
  }
  const fx = Math.round((mx - f.originX) / f.step), fz = Math.round((mz - f.originZ) / f.step);
  // is there a wet sample within 1 whose neighbouring dry sample is lower than wy?
  const stepY = wy - worst;
  bump(stepY > 0.02 ? 'perched-bank(lower ground beside water)' : 'other-high', `${mx.toFixed(2)},${mz.toFixed(2)} lip=${(Math.max(d1,d2)).toFixed(3)} lowerBankBy=${stepY.toFixed(3)} kind=${f.river[fz*f.resolution+fx]?'river':f.lake[fz*f.resolution+fx]?'lake':'?'}`);
}
console.log(cls); console.log(JSON.stringify(ex, null, 1));
// sample the hydrology cause: wet samples with lower dry neighbour ground than water level
let perchedWet = 0, wetN = 0; let maxPerch = 0;
for (let z = 1; z < f.resolution - 1; z++) for (let x = 1; x < f.resolution - 1; x++) {
  const i = z * f.resolution + x; if (f.waterLevel[i]! < 0 || f.height[i]! < world.seaLevel) continue; wetN++;
  const wy = elevationToY(f.waterLevel[i]!, world.seaLevel);
  for (const o of [-1, 1, -f.resolution, f.resolution]) { const j = i + o; if (f.waterLevel[j]! >= 0) continue; const gy = elevationToY(f.height[j]!, world.seaLevel); if (gy < wy - 0.02) { perchedWet++; maxPerch = Math.max(maxPerch, wy - gy); break; } }
}
console.log({ wetN, perchedWet, maxPerch });
