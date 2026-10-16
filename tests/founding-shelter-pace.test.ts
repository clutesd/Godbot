import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { shelterCapacity } from '../src/sim/development/Shelter';
import { planEstablishment } from '../src/sim/development/SettlementDevelopmentSystem';
import { publishBulkStocks } from '../src/sim/resources/Inventory';
import { resourceWorkAssignments } from '../src/sim/resources/ResourceWorkAssignments';
import type { Settlement, SimulationState } from '../src/sim/types';

/**
 * Survival expectations for the first year of an arrival founding. They are derived from the physical economy, not
 * from a historical deadline: a camp that cannot roof itself must be explained by missing timber, labour or food,
 * and every roof must be paid for in materials and work.
 */
function arrival(seed: string) {
  const sim = new Simulation({ seed, startMode: 'arrival', world: { size: 64 } });
  sim.advanceArrival(80);
  if (!sim.beginHistory()) throw new Error('Expected founding orientation to release into history');
  return sim;
}
const camp = (state: SimulationState, index: number): Settlement => state.settlements.find(s => s.id === state.arrival!.pods[index]!.settlementId!)!;
const timberDeposits = (state: SimulationState, s: Settlement) => state.world.resourceDeposits.filter(d => d.resourceId === 'timber'
  && Math.hypot(d.worldX - s.position.x, d.worldZ - s.position.z) / state.world.cellSize <= 7);
const timberExtracted = (state: SimulationState, s: Settlement) => resourceWorkAssignments(state)
  .filter(a => a.settlementId === s.id && a.resourceId === 'timber').reduce((n, a) => n + a.amountExtracted, 0);

describe('founding shelter pace', () => {
  // This camp has no timber within two cells of its landing, which used to leave it waiting for a ~3%/month discovery roll.
  const WOODS_FAR = ['founding-woodland', 4] as const;

  it('scouts the surrounding woods for roofing timber instead of waiting for chance discovery', () => {
    const sim = arrival(WOODS_FAR[0]), s = camp(sim.state, WOODS_FAR[1]);
    const near = timberDeposits(sim.state, s);
    expect(near.length).toBeGreaterThan(0);
    expect(near.every(d => Math.hypot(d.worldX - s.position.x, d.worldZ - s.position.z) / sim.state.world.cellSize > 2)).toBe(true);
    expect(s.discoveredDeposits.some(id => near.some(d => d.id === id))).toBe(false);
    sim.step(1);
    expect(s.discoveredDeposits.some(id => near.some(d => d.id === id))).toBe(true);
    // Discovery alone yields nothing: timber must actually be cut with labour from a standing deposit.
    expect(timberExtracted(sim.state, s)).toBeGreaterThan(0);
    const cut = near.reduce((n, d) => n + (d.extracted ?? 0), 0);
    expect(cut).toBeCloseTo(timberExtracted(sim.state, s), 6);
  });

  it('puts the time reserved for a material-stalled roof into fetching materials, then returns it to the site', () => {
    const sim = arrival(WOODS_FAR[0]), s = camp(sim.state, WOODS_FAR[1]);
    sim.step(1);
    const e = s.survival!.establishment!;
    expect(s.development!.project!.progress).toBe(0);
    expect(e.gatheringLabour).toBeGreaterThan(e.constructionLabour * 2);
    // Once timber is on hand the same camp builds with most of its time.
    s.localMaterials.timber = 5; s.localMaterials['plant-fiber'] = 1; publishBulkStocks(s);
    sim.step(1);
    expect(e.constructionLabour).toBeGreaterThan(0);
    expect(s.development!.project!.progress).toBeGreaterThan(0);
  });

  it('pays for a roof with real timber and labour, and has usable protection within the first season', () => {
    const sim = arrival(WOODS_FAR[0]), s = camp(sim.state, WOODS_FAR[1]);
    const pod = shelterCapacity(s, sim.state).pod;
    let first: number | null = null, extracted = 0, spentTimber = 0, labour = 0;
    for (let month = 1; month <= 8 && first === null; month++) {
      sim.step(1);
      extracted += timberExtracted(sim.state, s);
      if (shelterCapacity(s, sim.state).capacity > pod) first = month;
    }
    expect(first, 'first roof month').not.toBeNull();
    expect(first!).toBeLessThanOrEqual(6);
    for (const e of sim.state.history.filter(e => e.locationId === s.id && e.type === 'response-resolved' && e.tags.includes('shelter'))) {
      const spent = JSON.parse(String(e.context?.materialsSpent ?? '{}')) as Record<string, number>;
      spentTimber += spent.timber ?? 0; labour += Number(e.context?.labourSpent ?? 0);
    }
    expect(spentTimber).toBeGreaterThan(0.5);
    expect(labour).toBeGreaterThan(1);
    // Conservation: no more timber was built into the roof than was cut and carried in.
    expect(spentTimber).toBeLessThanOrEqual(extracted + 1e-6);
  });

  it('does not choose earth-and-stone walls where no stone can be quarried, and reconsiders an untouched earth shelter sooner than a hut', () => {
    // founding-cold-frontier's third landing has mineral-rich ground but no walkable route to any stone.
    const sim = arrival('founding-cold-frontier'), s = camp(sim.state, 2);
    sim.step(1);
    expect(s.development!.project!.response.adaptation).toBe('lean-to');

    // An untouched earth shelter with timber enough for a lean-to is redesigned after two idle months, not six.
    const p = s.development!.project!;
    p.response = { ...p.response, adaptation: 'earth-shelter', name: 'earth and stone shelter', labor: 5, temporary: true, material: 'earth' };
    p.materialRequirements = [
      { id: 'frame', amount: 0.25, options: ['timber', 'lumber'], reason: 'frame-and-roof' },
      { id: 'cover', amount: 0.12, options: ['plant-fiber', 'textile'], reason: 'roof-and-binding' },
      { id: 'foundation', amount: 1.8, options: ['stone'], reason: 'foundation-and-walls' },
    ];
    p.progress = 0; p.lastWorkMonth = undefined; p.startedMonth = sim.state.month;
    s.localMaterials = { timber: 6, 'plant-fiber': 1 }; publishBulkStocks(s);
    s.survival!.establishment!.fuelTarget = 0;
    const plan = () => planEstablishment(sim.state, s, sim.state.people.filter(x => x.alive && x.homeId === s.id));
    sim.state.month = p.startedMonth + 1;
    expect(plan().some(e => e.causes?.includes('material-shortage-replanned'))).toBe(false);
    expect(p.response.adaptation).toBe('earth-shelter');
    sim.state.month = p.startedMonth + 2;
    expect(plan().some(e => e.causes?.includes('material-shortage-replanned'))).toBe(true);
    expect(p.response.adaptation).toBe('lean-to');
  });

  it('survives a total timber famine without free materials, and recovers when the woods are workable again', () => {
    const sim = arrival(WOODS_FAR[0]), s = camp(sim.state, WOODS_FAR[1]);
    const woods = timberDeposits(sim.state, s);
    // A rival band holds every wood in reach, so this camp may not cut there (renewable stands would otherwise regrow).
    const rival = sim.state.settlements.find(x => x.id !== s.id)!, rivalPolity = rival.polityId;
    rival.polityId = 'rival-band';
    for (const d of woods) d.controlledBy = rival.id;
    for (let month = 0; month < 4; month++) sim.step(1);
    const stalled = s.development!.project!;
    // Hardship is real: nothing is conjured, the project is held, and the cause is named.
    expect(stalled.progress).toBe(0);
    expect(s.localMaterials.timber ?? 0).toBe(0);
    expect(shelterCapacity(s, sim.state).capacity).toBe(shelterCapacity(s, sim.state).pod);
    expect(stalled.blockedReasons?.some(r => r.startsWith('missing:timber'))).toBe(true);
    expect(sim.state.world.resourceDeposits.filter(d => woods.includes(d)).every(d => (d.extracted ?? 0) === 0)).toBe(true);

    rival.polityId = rivalPolity;
    for (const d of woods) d.controlledBy = undefined;
    for (let month = 0; month < 5; month++) sim.step(1);
    expect(s.development!.project?.progress ?? 1, 'project resumed rather than being abandoned').toBeGreaterThan(0);
    expect(shelterCapacity(s, sim.state).capacity).toBeGreaterThan(shelterCapacity(s, sim.state).pod);
  });

  // A spread of landings, not one lucky seed. A lean-to is a few timber loads and a few weeks of labour, so most camps are
  // under cover in a season. The slower tail has named causes (hunger, or an earth shelter waiting on quarried stone) and
  // is bounded rather than excluded.
  it.each(['founding-loop-audit', 'founding-woodland', 'founding-cold-frontier', 'founding-sample-a', 'founding-sample-b', 'alpha-river', 'basalt-coast'])(
    'roofs the landings of %s before the first winter closes in', seed => {
      const sim = arrival(seed);
      const pods = sim.state.arrival!.pods.map(pod => ({ id: pod.settlementId!, first: null as number | null, winter: 0 }));
      for (let month = 1; month <= 12; month++) {
        sim.step(1);
        for (const row of pods) {
          const s = sim.state.settlements.find(x => x.id === row.id)!;
          const shelter = shelterCapacity(s, sim.state);
          const population = sim.state.people.filter(p => p.alive && p.homeId === s.id).length;
          if (row.first === null && shelter.capacity > shelter.pod) row.first = month;
          if (month === 10) row.winter = Math.min(1, shelter.capacity / Math.max(1, population));
        }
      }
      for (const row of pods) {
        expect(row.first, `${row.id} had no roof by month 12`).not.toBeNull();
        expect(row.first!, row.id).toBeLessThanOrEqual(8);
        expect(row.winter, row.id).toBeGreaterThan(0.45);
      }
      expect(pods.filter(row => row.first! <= 6).length, JSON.stringify(pods)).toBeGreaterThanOrEqual(4);
    });
});
