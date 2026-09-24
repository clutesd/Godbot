import { Simulation } from '../src/sim/Simulation';
import { settlementLabour } from '../src/sim/people/HumanCapital';

const seed = process.argv[2] ?? 'founding-loop-audit';
const simulation = new Simulation({ seed, startMode: 'arrival', world: { size: 64 } });
simulation.advanceArrival(80);
const samples: unknown[] = [];
for (let month = 1; month <= 60; month++) {
  simulation.step(1);
  if (month <= 12 || month % 12 === 0) samples.push({ month, settlements: simulation.state.settlements.map(s => ({
    name: s.name, population: simulation.state.people.filter(p => p.alive && p.homeId === s.id).length,
    builders: settlementLabour(simulation.state, s).economy.builder,
    buildings: s.buildings, food: s.resources.food, timber: s.localMaterials.timber,
    cold: s.survival?.cold, project: s.development?.project && { name: s.development.project.response.name, progress: s.development.project.progress },
    attempt: s.development?.lastAttempt,
  })) });
}
console.log(JSON.stringify({ seed, samples }, null, 2));
