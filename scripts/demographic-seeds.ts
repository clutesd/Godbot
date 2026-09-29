import { Simulation } from '../src/sim/Simulation';
import { representedPopulation } from '../src/sim/Population';

export const DEMOGRAPHIC_SEEDS = ['founding-loop-audit', 'founding-woodland', 'founding-cold-frontier', 'demography-river', 'demography-stone', 'demography-wind'];

/** Full simulation, no replenishment or forced workers. Collect events each month before archival pruning. */
export function demographicSeed(seed: string, years = 40, configure?: (sim: Simulation) => void) {
  const sim = new Simulation({ seed, startMode: 'arrival', world: { size: 64 } });
  sim.advanceArrival(80); sim.beginHistory();
  configure?.(sim);
  const initial = representedPopulation(sim.state);
  const founders = new Set(sim.state.people.map(p => p.id));
  const children = new Set(sim.state.people.filter(p => p.ageMonths < 18 * 12).map(p => p.id));
  const adults = new Set<string>();
  const causes: Record<string, number> = {};
  const born = new Set<string>();
  let childDeaths = 0, firstBirth: number | null = null;
  const founding = sim.state.arrival!.pods.map(p => ({ id: p.settlementId!, foundersYear1: 0, foundersYear5: 0, residentsYear5: 0 }));
  const checkpoints: Array<{ year: number; population: number; births: number; deaths: number; net: number; livingSettlements: number;
    founders: number; childrenReachingAdulthood: number; childDeaths: number; causes: Record<string, number> }> = [];
  for (let month = 1; month <= years * 12; month++) {
    sim.step();
    for (let i = sim.state.history.length - 1; i >= 0; i--) {
      const event = sim.state.history[i]!;
      if (event.month < month) break;
      if (event.type === 'birth') { firstBirth ??= month; born.add(event.actors[0]!); children.add(event.actors[0]!); }
      if (event.type === 'death') {
        const cause = event.causes[0] ?? 'unknown'; causes[cause] = (causes[cause] ?? 0) + 1;
        if (Number(event.context.age) < 18) childDeaths++;
      }
    }
    for (const p of sim.state.people) if (p.alive && children.has(p.id) && p.ageMonths >= 18 * 12) adults.add(p.id);
    if (month === 12 || month === 60) for (const row of founding) {
      const pod = sim.state.arrival!.pods.find(p => p.settlementId === row.id)!;
      const survivors = sim.state.people.filter(p => p.alive && pod.personIds.includes(p.id)).length;
      if (month === 12) row.foundersYear1 = survivors;
      else { row.foundersYear5 = survivors; row.residentsYear5 = sim.state.people.filter(p => p.alive && p.homeId === row.id).length; }
    }
    if ([5, 10, 20, 30, 40, years].includes(month / 12)) checkpoints.push({ year: month / 12,
      population: representedPopulation(sim.state), births: sim.state.stats.births, deaths: sim.state.stats.deaths,
      net: representedPopulation(sim.state) - initial, livingSettlements: sim.state.settlements.filter(s => s.alive).length,
      founders: sim.state.people.filter(p => p.alive && founders.has(p.id)).length,
      childrenReachingAdulthood: adults.size, childDeaths, causes: { ...causes } });
  }
  return { seed, initial, firstBirth, founding, checkpoints, born: born.size,
    descendantsReachingAdulthood: [...adults].filter(id => born.has(id)).length,
    finalHealth: sim.state.people.filter(p => p.alive).reduce((n, p) => n + p.health, 0) / Math.max(1, sim.population) };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/demographic-seeds.ts')) {
  for (const seed of process.argv.slice(2).length ? process.argv.slice(2) : DEMOGRAPHIC_SEEDS) console.log(JSON.stringify(demographicSeed(seed)));
}
