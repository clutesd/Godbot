import { Simulation } from '../src/sim/Simulation';
import { shelterCapacity } from '../src/sim/development/Shelter';
import { resourceWorkAssignments } from '../src/sim/resources/ResourceWorkAssignments';

export function foundingSeed(seed: string, months = 60) {
  const simulation = new Simulation({ seed, startMode: 'arrival', world: { size: 64 } });
  simulation.advanceArrival(80);
  const reports = simulation.state.arrival!.pods.map(pod => ({ seed, landing: pod.name, id: pod.settlementId!,
    firstShelter: null as number | null, winterCoverage: 0, firstDwelling: null as number | null,
    foundersYear1: 0, foundersYear5: 0, residentsYear5: 0, extractedTimber: 0,
    failures: [] as string[] }));
  for (let month = 1; month <= months; month++) {
    simulation.step(1);
    for (const row of reports) {
      const s = simulation.state.settlements.find(s => s.id === row.id)!;
      const pod = simulation.state.arrival!.pods.find(p => p.settlementId === s.id)!;
      const shelter = shelterCapacity(s, simulation.state);
      const population = simulation.state.people.filter(p => p.alive && p.homeId === s.id).length;
      if (shelter.capacity > shelter.pod && row.firstShelter === null) row.firstShelter = month;
      if (month === 10) row.winterCoverage = Math.min(1, shelter.capacity / Math.max(1, population));
      if (row.firstDwelling === null && s.structurePlots?.some(p => p.development?.status === 'active' && p.development.form === 'dwelling' && !p.development.temporary)) row.firstDwelling = month;
      const survivors = simulation.state.people.filter(p => p.alive && pod.personIds.includes(p.id)).length;
      if (month === 12) row.foundersYear1 = survivors;
      if (month === 60) { row.foundersYear5 = survivors; row.residentsYear5 = population; }
      row.extractedTimber += resourceWorkAssignments(simulation.state).filter(a => a.settlementId === s.id && a.resourceId === 'timber').reduce((n, a) => n + a.amountExtracted, 0);
      if (!s.alive && !row.failures.includes('abandoned')) row.failures.push('abandoned');
      if ((s.survival?.deprivation ?? 0) >= 2 && !row.failures.includes('undernutrition')) row.failures.push('undernutrition');
      if ((s.survival?.exposureDose ?? 0) >= 3 && !row.failures.includes('prolonged exposure')) row.failures.push('prolonged exposure');
      if (month === 60 && row.firstDwelling === null) row.failures.push(`no dwelling: ${s.development?.lastAttempt?.outcome ?? 'no project'}; timber=${(s.localMaterials.timber ?? 0).toFixed(2)}; project=${s.development?.project?.response.name ?? 'none'} ${(s.constructionProgress * 100).toFixed(0)}%`);
    }
  }
  return { simulation, reports };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/founding-seeds.ts')) {
  const seeds = process.argv.slice(2);
  const reports = (seeds.length ? seeds : ['founding-loop-audit', 'founding-woodland', 'founding-cold-frontier']).flatMap(seed => foundingSeed(seed).reports);
  console.log(JSON.stringify(reports, null, 2));
}
