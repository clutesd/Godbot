import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater } from '../src/render/terrain/WaterSystem';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';

const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['audit-a', 'audit-b', 'audit-c'];
for (const seed of seeds) {
  const t0 = Date.now();
  const sim = new Simulation({ seed, startingPopulation: 30, world: { size: 40 }, settlementCount: [2, 3] });
  const world = sim.state.world;
  const f = world.terrain;
  const wet = (() => { let n = 0, r = 0, l = 0; for (let i = 0; i < f.height.length; i++) if (f.waterLevel[i]! >= 0 && f.height[i]! >= world.seaLevel) { n++; if (f.river[i]) r++; if (f.lake[i]) l++; } return [n, r, l]; })();
  const mesh = buildInlandWater(world);
  if (!mesh) { console.log(seed, 'no inland water', wet); continue; }
  const p = mesh.geometry.getAttribute('position');
  const ground = renderedGroundSampler(world);
  const tri = p.count / 3;
  const key = (i: number) => `${p.getX(i).toFixed(4)}:${p.getZ(i).toFixed(4)}`;
  const edgeCount = new Map<string, { n: number; a: number; b: number }>();
  let degenerate = 0, sliver = 0, nan = 0, submerged = 0, minDepth = 1e9, floatingTri = 0;
  const depthHist: Record<string, number> = {};
  const vertexUse = new Map<string, number[]>();
  for (let t = 0; t < tri; t++) {
    const ids = [t * 3, t * 3 + 1, t * 3 + 2];
    const ks = ids.map(key);
    for (const i of ids) if (!Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))) nan++;
    const ax = p.getX(ids[0]!), az = p.getZ(ids[0]!), bx = p.getX(ids[1]!), bz = p.getZ(ids[1]!), cx = p.getX(ids[2]!), cz = p.getZ(ids[2]!);
    const area = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
    if (area < 1e-9) degenerate++;
    const longest = Math.max(Math.hypot(bx - ax, bz - az), Math.hypot(cx - bx, cz - bz), Math.hypot(ax - cx, az - cz));
    if (area > 0 && area / (longest * longest) < 0.004) sliver++;
    let allShallow = true;
    for (const i of ids) {
      const d = p.getY(i) - ground(p.getX(i), p.getZ(i));
      minDepth = Math.min(minDepth, d);
      if (d < -1e-4) submerged++;
      if (d > 0.02) allShallow = false;
      const b = d < 0.001 ? '<0.001' : d < 0.01 ? '<0.01' : d < 0.05 ? '<0.05' : d < 0.2 ? '<0.2' : '>=0.2';
      depthHist[b] = (depthHist[b] ?? 0) + 1;
    }
    for (let e = 0; e < 3; e++) {
      const a = ks[e]!, b = ks[(e + 1) % 3]!;
      const k = a < b ? a + '|' + b : b + '|' + a;
      const cur = edgeCount.get(k);
      if (cur) cur.n++; else edgeCount.set(k, { n: 1, a: ids[e]!, b: ids[(e + 1) % 3]! });
    }
    for (let e = 0; e < 3; e++) { const arr = vertexUse.get(ks[e]!) ?? []; arr.push(ids[e]!); vertexUse.set(ks[e]!, arr); }
  }
  // boundary edges and their depth
  let boundary = 0, boundaryHigh = 0, boundaryHighLen = 0, nonManifold = 0;
  const highSamples: string[] = [];
  const boundaryVerts = new Set<string>();
  for (const [k, v] of edgeCount) {
    if (v.n > 2) nonManifold++;
    if (v.n !== 1) continue;
    boundary++;
    const d1 = p.getY(v.a) - ground(p.getX(v.a), p.getZ(v.a));
    const d2 = p.getY(v.b) - ground(p.getX(v.b), p.getZ(v.b));
    boundaryVerts.add(key(v.a)); boundaryVerts.add(key(v.b));
    if (Math.max(d1, d2) > 0.01) {
      boundaryHigh++;
      boundaryHighLen += Math.hypot(p.getX(v.a) - p.getX(v.b), p.getZ(v.a) - p.getZ(v.b));
      if (highSamples.length < 4) highSamples.push(`${p.getX(v.a).toFixed(2)},${p.getZ(v.a).toFixed(2)} d=${d1.toFixed(3)}/${d2.toFixed(3)}`);
    }
  }
  // T-junctions: boundary vertex lying strictly inside another boundary edge
  const bEdges = [...edgeCount.values()].filter(v => v.n === 1);
  let tjunc = 0;
  const cellHash = new Map<string, typeof bEdges>();
  const cs = f.step;
  for (const e of bEdges) {
    const minx = Math.min(p.getX(e.a), p.getX(e.b)), maxx = Math.max(p.getX(e.a), p.getX(e.b));
    const minz = Math.min(p.getZ(e.a), p.getZ(e.b)), maxz = Math.max(p.getZ(e.a), p.getZ(e.b));
    for (let gx = Math.floor(minx / cs); gx <= Math.floor(maxx / cs); gx++) for (let gz = Math.floor(minz / cs); gz <= Math.floor(maxz / cs); gz++) {
      const kk = gx + ':' + gz; const arr = cellHash.get(kk) ?? []; arr.push(e); cellHash.set(kk, arr);
    }
  }
  const tj: string[] = [];
  for (const vk of boundaryVerts) {
    const [sx, sz] = vk.split(':').map(Number) as [number, number];
    const arr = cellHash.get(Math.floor(sx / cs) + ':' + Math.floor(sz / cs)) ?? [];
    for (const e of arr) {
      const ax = p.getX(e.a), az = p.getZ(e.a), bx = p.getX(e.b), bz = p.getZ(e.b);
      const dx = bx - ax, dz = bz - az; const len2 = dx * dx + dz * dz; if (len2 < 1e-12) continue;
      const t = ((sx - ax) * dx + (sz - az) * dz) / len2;
      if (t <= 0.02 || t >= 0.98) continue;
      const dist = Math.abs((sx - ax) * dz - (sz - az) * dx) / Math.sqrt(len2);
      if (dist < 2e-4) { tjunc++; if (tj.length < 3) tj.push(`${sx.toFixed(2)},${sz.toFixed(2)}`); break; }
    }
  }
  // duplicate-position vertices with different Y (cracks)
  let crack = 0, crackMax = 0;
  for (const ids of vertexUse.values()) { let lo = 1e9, hi = -1e9; for (const i of ids) { lo = Math.min(lo, p.getY(i)); hi = Math.max(hi, p.getY(i)); } if (hi - lo > 5e-4) { crack++; crackMax = Math.max(crackMax, hi - lo); } }
  // dry islands / holes: wet samples whose surrounding coverage has no triangle
  console.log(JSON.stringify({ seed, ms: Date.now() - t0, res: f.resolution, wet, tri, degenerate, sliver, nan, submerged, minDepth: +minDepth.toFixed(4), boundary, boundaryHigh, boundaryHighLen: +boundaryHighLen.toFixed(2), highSamples, nonManifold, tjunc, tj, crack, crackMax: +crackMax.toFixed(3), depthHist }));
}
