import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater } from '../src/render/terrain/WaterSystem';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';
for (const seed of process.argv.slice(2)) {
  const sim = new Simulation({ seed, startingPopulation: 30, world: { size: 40 }, settlementCount: [2, 3] });
  const world = sim.state.world; const f = world.terrain; const ground = renderedGroundSampler(world);
  const p = buildInlandWater(world)!.geometry.getAttribute('position');
  const key = (i: number) => `${p.getX(i).toFixed(4)}:${p.getZ(i).toFixed(4)}`;
  const edges = new Map<string, { n: number; a: number; b: number }>();
  for (let t = 0; t < p.count / 3; t++) for (let e = 0; e < 3; e++) {
    const a = t*3+e, b = t*3+(e+1)%3; const ka = key(a), kb = key(b); const k = ka<kb?ka+'|'+kb:kb+'|'+ka; const c = edges.get(k); if (c) c.n++; else edges.set(k,{n:1,a,b});
  }
  const ext = (f.resolution-1)*f.step; const h: Record<string, number> = {}; const ex: string[] = [];
  let total = 0;
  for (const e of edges.values()) { if (e.n !== 1) continue;
    const ax=p.getX(e.a),az=p.getZ(e.a),bx=p.getX(e.b),bz=p.getZ(e.b);
    if ([ax,bx].some(x=>x<f.originX+.01||x>f.originX+ext-.01)||[az,bz].some(z=>z<f.originZ+.01||z>f.originZ+ext-.01)) { h['fieldBorder']=(h['fieldBorder']??0)+1; continue; }
    total++;
    const d = Math.max(p.getY(e.a)-ground(ax,az), p.getY(e.b)-ground(bx,bz));
    const b = d<0.002?'grounded<0.002':d<0.01?'0.002-0.01':d<0.03?'0.01-0.03':d<0.1?'0.03-0.1':'>0.1';
    h[b]=(h[b]??0)+1; if (d>=0.03 && ex.length<6) ex.push(`${((ax+bx)/2).toFixed(2)},${((az+bz)/2).toFixed(2)} lip=${d.toFixed(3)} y=${p.getY(e.a).toFixed(3)}`);
  }
  console.log(seed, total, JSON.stringify(h), ex);
}
