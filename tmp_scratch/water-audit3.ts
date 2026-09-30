import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater } from '../src/render/terrain/WaterSystem';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';
import { elevationToY } from '../src/sim/terrain/SurfaceGeometry';

for (const seed of process.argv.slice(2)) {
  const sim = new Simulation({ seed, startingPopulation: 30, world: { size: 40 }, settlementCount: [2, 3] });
  const world = sim.state.world; const f = world.terrain;
  const mesh = buildInlandWater(world)!; const p = mesh.geometry.getAttribute('position');
  const ground = renderedGroundSampler(world);
  // rasterize triangle coverage on a 0.05 grid
  const g = 0.05; const W = Math.ceil(((f.resolution) * f.step) / g); const cover = new Uint8Array(W * W);
  const ox = f.originX - f.step / 2, oz = f.originZ - f.step / 2;
  let area = 0;
  for (let t = 0; t < p.count / 3; t++) {
    const xs = [0,1,2].map(i => p.getX(t*3+i)), zs = [0,1,2].map(i => p.getZ(t*3+i));
    area += Math.abs((xs[1]!-xs[0]!)*(zs[2]!-zs[0]!)-(zs[1]!-zs[0]!)*(xs[2]!-xs[0]!))/2;
    const minx = Math.min(...xs), maxx = Math.max(...xs), minz = Math.min(...zs), maxz = Math.max(...zs);
    for (let gz = Math.floor((minz-oz)/g); gz <= Math.floor((maxz-oz)/g); gz++) for (let gx = Math.floor((minx-ox)/g); gx <= Math.floor((maxx-ox)/g); gx++) {
      const px = ox + (gx+0.5)*g, pz = oz + (gz+0.5)*g;
      const d1 = (px-xs[1]!)*(zs[0]!-zs[1]!)-(xs[0]!-xs[1]!)*(pz-zs[1]!), d2 = (px-xs[2]!)*(zs[1]!-zs[2]!)-(xs[1]!-xs[2]!)*(pz-zs[2]!), d3 = (px-xs[0]!)*(zs[2]!-zs[0]!)-(xs[2]!-xs[0]!)*(pz-zs[0]!);
      const neg = d1<0||d2<0||d3<0, pos = d1>0||d2>0||d3>0;
      if (!(neg&&pos) && gx>=0&&gz>=0&&gx<W&&gz<W) cover[gz*W+gx]=1;
    }
  }
  // expected: point is wet if nearest-sample is wet AND ≥ (bilinear cov >= .5) - use bilinear coverage
  const wet = (x:number,z:number)=>{ if(x<0||z<0||x>=f.resolution||z>=f.resolution) return 0; const i=z*f.resolution+x; return f.waterLevel[i]!>=0&&f.height[i]!>=world.seaLevel?1:0; };
  let coreExpected = 0, coreMissing = 0; let expected = 0, missing = 0, groundAbove = 0, missingAboveLevel = 0; const bigMiss: string[] = [];
  for (let gz = 0; gz < W; gz++) for (let gx = 0; gx < W; gx++) {
    const px = ox + (gx+0.5)*g, pz = oz + (gz+0.5)*g;
    const fx = (px-f.originX)/f.step, fz = (pz-f.originZ)/f.step; const x0=Math.floor(fx), z0=Math.floor(fz), tx=fx-x0, tz=fz-z0;
    const cov = wet(x0,z0)*(1-tx)*(1-tz)+wet(x0+1,z0)*tx*(1-tz)+wet(x0,z0+1)*(1-tx)*tz+wet(x0+1,z0+1)*tx*tz;
    if (cov < 0.5) continue; expected++; const isCore = cov >= 0.8; if (isCore) coreExpected++;
    if (!cover[gz*W+gx]) { missing++; if (isCore) coreMissing++;
      const near = Math.round(fx), nz = Math.round(fz); const li = nz*f.resolution+near; const lvl = f.waterLevel[li]!>=0?elevationToY(f.waterLevel[li]!,world.seaLevel):NaN;
      const gy = ground(px,pz); if (gy > lvl) missingAboveLevel++;
      if (isCore && bigMiss.length<6 && (gx*7+gz*13)%37===0) bigMiss.push(`${px.toFixed(2)},${pz.toFixed(2)} ground-level=${(gy-lvl).toFixed(3)} cov=${cov.toFixed(2)}`);
    }
  }
  console.log(JSON.stringify({ seed, expectedM2: +(expected*g*g).toFixed(2), meshM2: +area.toFixed(2), missingPct: +(100*missing/expected).toFixed(2), coreMissingPct: +(100*coreMissing/Math.max(1,coreExpected)).toFixed(2), coreExpected, missingBecauseGroundAboveLevelPct: +(100*missingAboveLevel/Math.max(1,missing)).toFixed(1), bigMiss }));
}
