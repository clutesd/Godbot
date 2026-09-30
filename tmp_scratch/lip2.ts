import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater } from '../src/render/terrain/WaterSystem';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';
import { elevationToY } from '../src/sim/terrain/SurfaceGeometry';
const seed = process.argv[2]!;
const sim = new Simulation({ seed, startingPopulation: 30, world: { size: 40 }, settlementCount: [2, 3] });
const world = sim.state.world; const f = world.terrain; const ground = renderedGroundSampler(world);
const p = buildInlandWater(world)!.geometry.getAttribute('position');
const key = (i: number) => `${p.getX(i).toFixed(4)}:${p.getZ(i).toFixed(4)}`;
const edges = new Map<string, { n: number; a: number; b: number }>();
for (let t = 0; t < p.count / 3; t++) for (let e = 0; e < 3; e++) { const a=t*3+e,b=t*3+(e+1)%3; const ka=key(a),kb=key(b); const k=ka<kb?ka+'|'+kb:kb+'|'+ka; const c=edges.get(k); if(c)c.n++; else edges.set(k,{n:1,a,b}); }
const cls: Record<string, number> = {}; const ex: Record<string, string[]> = {};
const wetAt=(x:number,z:number)=>{const i=z*f.resolution+x; return x>=0&&z>=0&&x<f.resolution&&z<f.resolution&&f.waterLevel[i]!>=0&&f.height[i]!>=world.seaLevel;};
for (const e of edges.values()) { if (e.n!==1) continue;
  const ax=p.getX(e.a),az=p.getZ(e.a),bx=p.getX(e.b),bz=p.getZ(e.b); const mx=(ax+bx)/2,mz=(az+bz)/2;
  const lip=Math.max(p.getY(e.a)-ground(ax,az),p.getY(e.b)-ground(bx,bz)); if (lip<0.03) continue;
  const fx=(mx-f.originX)/f.step, fz=(mz-f.originZ)/f.step; const cx=Math.round(fx), cz=Math.round(fz);
  // local level range among wet samples within 1
  let lo=1e9,hi=-1e9, dryMin=1e9, lvl=NaN;
  for (let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++){ const x=cx+dx,z=cz+dz; if(x<0||z<0||x>=f.resolution||z>=f.resolution) continue; const i=z*f.resolution+x; if (wetAt(x,z)){const y=elevationToY(f.waterLevel[i]!,world.seaLevel); lo=Math.min(lo,y);hi=Math.max(hi,y);lvl=y;} else dryMin=Math.min(dryMin, ground(f.originX+x*f.step,f.originZ+z*f.step)); }
  const c = hi-lo>0.25 ? 'cascade(level step>0.25)' : (dryMin<1e8 && dryMin < lvl-0.03) ? 'perched-not-fixed' : dryMin<1e8 ? 'bank-above-level(bed deep)' : 'no-dry-neighbour';
  cls[c]=(cls[c]??0)+1; (ex[c]??=[]).length<3&&ex[c]!.push(`${mx.toFixed(2)},${mz.toFixed(2)} lip=${lip.toFixed(3)} lvl=${lvl.toFixed(2)} range=${(hi-lo).toFixed(2)} dryMin=${dryMin.toFixed(2)}`);
}
console.log(seed, cls, JSON.stringify(ex,null,1));
