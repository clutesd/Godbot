import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { ConstructionRuntime } from '../src/render/construction/ConstructionRuntime';
import type { DevelopmentProject } from '../src/sim/development/types';
import { CREW, WOOD_KNOWLEDGE, processingWorld, runFacilityMonth, stock } from './fixtures/processingFacilities';
import { learn } from './fixtures/settlementDevelopment';
import { facilitiesOf, ensureProcessingAuthority } from '../src/sim/processing/FacilitySystem';
import { beginUpgrade } from '../src/sim/processing/FacilityConstruction';

function replay(withPresentation: boolean) {
  const sim = new Simulation({ seed: 'construction-runtime-live', startingPopulation: 24, settlementCount: [2, 2], world: { size: 20 } });
  const runtime = new ConstructionRuntime();
  if (withPresentation) runtime.sync(sim.state);
  const trace: unknown[] = [];
  for (let month = 0; month < 180; month++) {
    sim.step();
    if (withPresentation) {
      runtime.sync(sim.state);
      for (const person of sim.state.people) runtime.person(person);
    }
    trace.push(sim.state.settlements.map(s => ({ stock: { ...s.resources }, materials: { ...s.localMaterials },
      project: structuredClone(s.development?.project),
      completed: (s.structurePlots ?? []).map(p => structuredClone(p.development?.constructionWork)) })));
  }
  return { sim, runtime, trace };
}

describe('paid simulation construction runtime', () => {
  it('connects real processing-facility bills, construction and upgrades to the same worker presentation', () => {
    const w = processingWorld('paid-facility-presentation');
    learn(w.s, ...WOOD_KNOWLEDGE);
    stock(w.s, { timber: 40, iron: 20 });
    ensureProcessingAuthority(w.state);
    const runtime = new ConstructionRuntime(); runtime.sync(w.state);
    runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 0.4 });
    runtime.sync(w.state);
    const f = facilitiesOf(w.s, 'wood')[0]!;
    expect(f.constructionWork!.progress).toBe(f.progress);
    expect(f.constructionWork!.labourSpent).toBe(f.labourSpent);
    const active = runtime.settlement(w.s).development!.project!;
    expect(active.plotId).toBe(f.plotId);
    expect(active.workerIds!.length).toBeGreaterThan(0);
    const worker = w.state.people.find(p => active.workerIds!.includes(p.id))!;
    expect(worker.occupation).toBe('builder');
    expect(runtime.person(worker).navigation?.destinationId).toBe(f.plotId);
    for (let month = 0; month < 6 && f.progress < 1; month++) {
      runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 5 }); runtime.sync(w.state);
    }
    const plot = w.s.structurePlots!.find(p => p.id === f.plotId)!;
    expect(plot.development!.constructionWork).toBe(f.constructionWork);
    expect(active.progress).toBe(1);
    expect(runtime.holds(f.plotId)).toBe(true);
    expect(f.spent.timber).toBeCloseTo(4);
    runtime.finish(w.s, active);
    beginUpgrade(w.state, f, 2);
    for (let month = 0; month < 10 && f.upgrade; month++) {
      runFacilityMonth(w.state, w.s, CREW, w.random, { infrastructure: 3 }); runtime.sync(w.state);
    }
    const upgrade = runtime.settlement(w.s).development!.project!;
    expect(upgrade).not.toBe(active);
    expect(upgrade.response.facilityTier).toBe(2);
    expect(upgrade.response.level).toBe(2);
    expect(upgrade.progress).toBe(1);
    expect(upgrade.workerIds!.length).toBeGreaterThan(0);
    expect(runtime.holds(f.plotId)).toBe(true);
  });
  it('preserves deterministic paid progress and every stock/material payment while linking real economic workers', () => {
    const plain = replay(false), shown = replay(true);
    expect(shown.trace).toEqual(plain.trace);
    const completed = shown.sim.state.settlements.flatMap(s => (s.structurePlots ?? []).flatMap(p => p.development?.constructionWork ? [p.development.constructionWork] : []));
    expect(completed.length).toBeGreaterThan(0);
    expect(completed.every(p => p.progress === 1 && p.workerIds!.length > 0)).toBe(true);
    expect(completed.every(p => p.labourSpent! > 0 && p.lastWorkMonth! > p.startedMonth)).toBe(true);
  }, 15000);

  it('shows established archive buildings immediately and only replays newly paid/observed work', () => {
    const { sim } = replay(false);
    const fresh = new ConstructionRuntime(); fresh.sync(sim.state);
    for (const s of sim.state.settlements) for (const plot of s.structurePlots ?? []) {
      if (plot.development?.constructionWork && s.development?.project?.plotId !== plot.id) expect(fresh.holds(plot.id)).toBe(false);
    }
  });

  it('never recasts emergencies, migration, displacement, illness or unrecorded residents as builders', () => {
    const { sim, runtime } = replay(true);
    const view = sim.state.settlements.map(s => runtime.settlement(s)).find(s => s.development?.project?.workerIds?.length);
    expect(view).toBeDefined();
    const project = view!.development!.project as DevelopmentProject;
    const person = sim.state.people.find(p => project.workerIds!.includes(p.id))!;
    expect(runtime.person(person).navigation?.destinationId).toBe(project.plotId);
    for (const changes of [{ activity: 'flee' as const }, { activity: 'migrate' as const }, { health: 0.1 }, { displacedSinceMonth: sim.state.month }]) {
      const unsafe = { ...person, ...changes };
      expect(runtime.person(unsafe)).toBe(unsafe);
    }
    const unrecorded = { ...person, id: 'not-in-the-paid-receipt' };
    expect(runtime.person(unrecorded)).toBe(unrecorded);
  });

  it('records a visible construction cast for the actual founding adaptation occupation allocation', () => {
    const sim = new Simulation({ seed: 'founding-loop-audit', startMode: 'arrival', world: { size: 32 } });
    sim.advanceArrival(80); sim.beginHistory();
    let captured = 0;
    for (let month = 0; month < 12; month++) {
      sim.step();
      for (const settlement of sim.state.settlements) {
        const project = settlement.development?.project;
        if (!project?.response.adaptation || project.lastWorkMonth !== sim.state.month) continue;
        expect(project.workerIds!.length).toBeGreaterThan(0);
        for (const id of project.workerIds!) {
          const person = sim.state.people.find(p => p.id === id)!;
          expect(settlement.survival!.establishment!.constructionByOccupation[person.occupation]).toBeGreaterThan(0);
        }
        captured++;
      }
    }
    expect(captured).toBeGreaterThan(0);
  }, 15000);
});
