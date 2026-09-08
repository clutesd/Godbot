import { Simulation } from './src/sim/Simulation';
const s = new Simulation({seed:'lineage-test',startingPopulation:240});
console.time('run'); s.step(960); console.timeEnd('run');
console.log(JSON.stringify({trades:s.state.stats.trades,routes:s.state.tradeRoutes.map(r=>({a:r.a,b:r.b,path:!!r.transport?.path,trip:r.transport?.trip?.status,projects:r.transport?.projectIds})),segments:Object.values(s.state.transportation.segments).reduce<Record<string,number>>((n,e)=>(n[e.status]=(n[e.status]??0)+1,n),{}),wealth:s.state.settlements.map(t=>[t.id,t.alive,t.resources.wealth,t.foodSecurity])}));
