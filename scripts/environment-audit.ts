import { Simulation } from '../src/sim/Simulation';
import { RESOURCE_CATALOG } from '../src/sim/resources/catalog';

const seed = process.argv[2] ?? 'environment-audit';
const years = Number(process.argv[3] ?? 100);
const start = performance.now();
const sim = new Simulation({ seed, startingPopulation: 160, world: { size: 28 }, settlementCount: [4, 4] });
const generated = performance.now();
const initial = RESOURCE_CATALOG.map(r => ({ resource: r.id,
  provinces: sim.state.world.resourceDeposits.filter(d => d.resourceId === r.id).length,
  quantity: sim.state.world.resourceDeposits.filter(d => d.resourceId === r.id).reduce((n, d) => n + d.capacity, 0) }));
sim.step(years * 12);
console.log(JSON.stringify({ seed, years, engine: sim.state.engineVersion,
  generationMs: Math.round(generated - start), simulationMs: Math.round(performance.now() - generated), initial,
  settlements: sim.state.settlements.map(s => ({ name: s.name, alive: s.alive, specialization: s.specialization,
    discovered: s.discoveredDeposits.length, worked: s.workedDeposits.length, gathered: s.materialEconomy?.experience,
    materials: s.materials, waterAccess: sim.state.world.cells[s.cellIndex]?.soil?.waterAccess })),
  changedCells: sim.state.world.cells.filter(c => c.modifications).length,
  resourceEvents: sim.state.history.filter(e => e.tags.includes('resource')).map(e => ({ month: e.month, type: e.type, summary: e.summary })),
}, null, 2));
