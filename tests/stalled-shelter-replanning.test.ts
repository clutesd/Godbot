import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { planEstablishment } from '../src/sim/development/SettlementDevelopmentSystem';
import { consumeConstructionMaterials } from '../src/sim/resources/MaterialUse';
import { publishBulkStocks } from '../src/sim/resources/Inventory';

function fixture(adaptation: 'hut' | 'earth-shelter' = 'hut') {
  const sim = new Simulation({ seed: 'founding-loop-audit', startMode: 'arrival', world: { size: 64 } });
  sim.advanceArrival(80); sim.beginHistory(); sim.step();
  const s = sim.state.settlements[0]!;
  const p = s.development!.project!;
  p.response = { ...p.response, adaptation, name: adaptation, labor: adaptation === 'hut' ? 18 : 5,
    temporary: adaptation !== 'hut', material: adaptation === 'hut' ? 'timber' : 'earth' };
  p.materialRequirements = [
    { id: 'frame', amount: adaptation === 'hut' ? 3.2 : 0.25, options: ['timber', 'lumber'], reason: 'frame-and-roof' },
    { id: 'cover', amount: 0.25, options: ['plant-fiber', 'textile'], reason: 'roof-and-binding' },
    { id: 'foundation', amount: adaptation === 'hut' ? 0.6 : 1.8, options: ['stone'], reason: 'foundation-and-walls' },
  ];
  s.localMaterials = { timber: 10, 'plant-fiber': 1 };
  publishBulkStocks(s);
  s.survival!.establishment!.fuelTarget = 0;
  const plot = s.structurePlots!.find(plot => plot.id === p.plotId)!;
  plot.condition = 1; plot.floodDepth = 0; plot.fire = undefined; plot.accessRestricted = false;
  sim.state.month = p.startedMonth + 6;
  const plan = () => planEstablishment(sim.state, s, sim.state.people.filter(p => p.alive && p.homeId === s.id));
  return { sim, s, p, plan };
}

describe('material-stalled founding shelter replanning', () => {
  it('revises the remaining hut bill without granting progress, stock or labour, and charges the full alternative bill', () => {
    const { s, p, plan } = fixture();
    p.progress = 0.25; p.labourSpent = 4.5; p.materialSpent = { timber: 0.8, stone: 0.15, 'plant-fiber': 0.0625 };
    const before = structuredClone({ progress: p.progress, labour: p.labourSpent, spent: p.materialSpent, stock: s.localMaterials });
    expect(plan().some(e => e.causes?.includes('material-shortage-replanned'))).toBe(true);
    expect({ progress: p.progress, labour: p.labourSpent, spent: p.materialSpent, stock: s.localMaterials }).toEqual(before);
    expect(p.materialRequirements!.map(r => r.id)).toEqual(['frame', 'cover']);
    expect(p.materialRequirements![0]!.amount).toBeCloseTo(4.4);
    consumeConstructionMaterials(s, p, 0.75, 7);
    expect(s.localMaterials.timber).toBeCloseTo(6.7);
    expect(p.materialSpent!.timber).toBeCloseTo(4.1);
    expect(p.materialSpent!.stone).toBe(0.15);
    expect(plan().some(e => e.causes?.includes('material-shortage-replanned'))).toBe(false);
  });

  it.each(['recent-work', 'stone-arrived', 'insufficient-timber', 'fuel-reserve', 'missing-cover'] as const)('does not redesign for %s', reason => {
    const { sim, s, p, plan } = fixture();
    if (reason === 'recent-work') p.lastWorkMonth = sim.state.month - 5;
    if (reason === 'stone-arrived') s.localMaterials.stone = 1;
    if (reason === 'insufficient-timber') s.localMaterials.timber = 4;
    if (reason === 'fuel-reserve') s.survival!.establishment!.fuelTarget = 6;
    if (reason === 'missing-cover') s.localMaterials['plant-fiber'] = 0;
    const bill = structuredClone(p.materialRequirements);
    expect(plan().some(e => e.causes?.includes('material-shortage-replanned'))).toBe(false);
    expect(p.materialRequirements).toEqual(bill);
  });

  it('can replace an untouched earth shelter, but does not turn paid earth walls into timber', () => {
    const { p, plan } = fixture('earth-shelter');
    p.progress = 0.1;
    plan(); expect(p.response.adaptation).toBe('earth-shelter');
    p.progress = 0;
    plan(); expect(p.response.adaptation).toBe('lean-to');
    expect(p.response.labor).toBe(3);
    expect(p.response.material).toBe('timber');
    expect(p.materialRequirements![0]!.amount).toBe(1.2);
  });

  // A standing building at an arbitrary month is not evidence: fires and floods may later remove it. The durable record is
  // the completion event the development system emits when paid construction finishes.
  it.each(['founding-loop-audit', 'founding-cold-frontier', 'founding-woodland'])('every stone-stalled hut replanned in the first five years of %s is later completed', seed => {
    const sim = new Simulation({ seed, startMode: 'arrival', world: { size: 64 } });
    sim.advanceArrival(80); sim.beginHistory();
    for (let month = 0; month < 60; month++) sim.step();
    let replanned = 0;
    for (const s of sim.state.settlements.slice(0, 5)) {
      const events = sim.state.history.filter(e => e.locationId === s.id);
      const hutReplans = events.filter(e => e.type === 'response-attempted' && e.causes?.includes('material-shortage-replanned')
        && e.context?.previousName === 'simple permanent hut');
      for (const replan of hutReplans) {
        replanned++;
        const completed = events.some(e => e.type === 'infrastructure-built' && e.context?.need === 'housing' && e.context.temporary === false
          && e.month > replan.month);
        expect(completed, `${s.id} replanned its hut in month ${replan.month} but never completed a permanent dwelling`).toBe(true);
      }
    }
    // The fixtures differ in terrain: this seed set must still exercise the replanning path overall, not only in one camp.
    if (seed === 'founding-loop-audit') expect(replanned).toBeGreaterThan(0);
  });
});
