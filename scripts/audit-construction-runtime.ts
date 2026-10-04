import { Simulation } from '../src/sim/Simulation';
import { ConstructionRuntime } from '../src/render/construction/ConstructionRuntime';

const sim = new Simulation({ seed: 'construction-runtime-live', startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 } });
sim.state.arrival = undefined;
const runtime = new ConstructionRuntime();
runtime.sync(sim.state);
let paid = 0, empty = 0, completed = 0, scheduleMismatch = 0;
for (let month = 0; month < Number(process.argv[2] ?? 48); month++) {
  sim.step(); runtime.sync(sim.state);
  for (const settlement of sim.state.settlements) {
    const projects = [settlement.development?.project, ...(settlement.structurePlots ?? []).map(p => p.development?.constructionWork)];
    for (const project of projects) {
      if (!project || project.lastWorkMonth !== sim.state.month) continue;
      paid++; if (!project.workerIds?.length) empty++;
      if (project.progress === 1) completed++;
      const crew = sim.state.people.filter(p => project.workerIds?.includes(p.id));
      scheduleMismatch += crew.filter(p => p.activity !== 'construct').length;
      if (paid <= 6) console.log(JSON.stringify({ month: sim.state.month, plot: project.plotId,
        progress: project.progress, workerIds: project.workerIds, activities: crew.map(p => p.activity) }));
    }
  }
}
console.log(JSON.stringify({ paid, empty, completed, scheduleMismatch }));
