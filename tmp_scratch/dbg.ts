import { Simulation } from '../src/sim/Simulation';
import { buildInlandWater, presentedWaterSurface } from '../src/render/terrain/WaterSystem';
import { renderedGroundSampler } from '../src/render/terrain/WaterGround';
import { elevationToY } from '../src/sim/terrain/SurfaceGeometry';
const sim = new Simulation({ seed: 'audit-c', startingPopulation: 30, world: { size: 40 }, settlementCount: [2, 3] });
const world = sim.state.world; const f = world.terrain; const ground = renderedGroundSampler(world);
for (const [x, z] of [[-0.65,-37.40],[15.35,-35.20],[0.10,-35.10]] as const) {
  const fx=(x-f.originX)/f.step, fz=(z-f.originZ)/f.step; const i0=Math.floor(fz)*f.resolution+Math.floor(fx);
  console.log('pt',x,z,'sample',Math.round(fx),Math.round(fz));
  for (const o of [0,1,f.resolution,f.resolution+1]) { const i=i0+o; console.log('  s',i%f.resolution,Math.floor(i/f.resolution),'lvl',f.waterLevel[i]!>=0?elevationToY(f.waterLevel[i]!,world.seaLevel).toFixed(3):'dry','gnd',ground(f.originX+(i%f.resolution)*f.step,f.originZ+Math.floor(i/f.resolution)*f.step).toFixed(3),'river',f.river[i],'fall',f.fall[i]!.toFixed(2)); }
}
