import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { committedMonth, monthInFlight } from '../src/sim/MonthAuthority';
import { resourceWorkAssignmentsForWorld } from '../src/sim/resources/ResourceWorkAssignments';

const config = {
  seed: 'time-sliced-month',
  startMode: 'established' as const,
  startingPopulation: 60,
  settlementCount: [2, 2] as const,
  world: { size: 20 },
  simulation: { populationSoftCap: 120, historyLimit: 5_000 },
};

/** Advances one month pausing at every safe boundary; returns how many slices it took. */
function advanceFullySliced(simulation: Simulation): number {
  let slices = 1;
  while (!simulation.advanceMonthSliced(-Infinity)) slices += 1;
  return slices;
}

describe('time-sliced months', () => {
  it('produces exactly the history of atomic steps, including annual and quarterly months', () => {
    const atomic = new Simulation(config);
    const sliced = new Simulation(config);
    atomic.step(26);
    for (let month = 0; month < 26; month += 1) advanceFullySliced(sliced);
    expect(sliced.monthInFlight).toBe(false);
    expect(sliced.state).toEqual(atomic.state);
  });

  it('pauses mid-month and hides the month from committed-month consumers until it commits', () => {
    const simulation = new Simulation(config);
    simulation.step(3);
    const workBefore = resourceWorkAssignmentsForWorld(simulation.state.world);

    expect(simulation.advanceMonthSliced(-Infinity)).toBe(false);
    expect(simulation.monthInFlight).toBe(true);
    expect(monthInFlight(simulation.state)).toBe(true);
    expect(simulation.state.month).toBe(4);
    expect(committedMonth(simulation.state)).toBe(3);

    // Run into the resource phase: presentation still sees the last complete work ledger.
    for (let slice = 0; slice < 12; slice += 1) simulation.advanceMonthSliced(-Infinity);
    expect(simulation.monthInFlight).toBe(true);
    expect(resourceWorkAssignmentsForWorld(simulation.state.world)).toBe(workBefore);

    while (!simulation.advanceMonthSliced(-Infinity)) { /* finish */ }
    expect(monthInFlight(simulation.state)).toBe(false);
    expect(committedMonth(simulation.state)).toBe(4);
    expect(resourceWorkAssignmentsForWorld(simulation.state.world).every(work => work.month === 4)).toBe(true);
  });

  it('commits an in-flight month before a direct step so months never interleave', () => {
    const atomic = new Simulation(config);
    const mixed = new Simulation(config);
    atomic.step(14);
    mixed.step(5);
    mixed.advanceMonthSliced(-Infinity);
    mixed.advanceMonthSliced(-Infinity);
    mixed.step(8);
    expect(mixed.monthInFlight).toBe(false);
    expect(mixed.state).toEqual(atomic.state);
  });

  it('runs a whole month in one call when the deadline allows, and finishMonthInFlight drains', () => {
    const simulation = new Simulation(config);
    expect(simulation.advanceMonthSliced(Infinity)).toBe(true);
    expect(simulation.state.month).toBe(1);

    simulation.advanceMonthSliced(-Infinity);
    simulation.finishMonthInFlight();
    expect(simulation.monthInFlight).toBe(false);
    expect(simulation.state.month).toBe(2);
  });

  it('profiles sliced months by work time, not by the wall time spent paused between frames', () => {
    const simulation = new Simulation(config);
    simulation.setTickProfiling(true);
    const startedAt = performance.now();
    let paused = 0;
    while (!simulation.advanceMonthSliced(-Infinity)) {
      // Stand-in for rendered frames while the month waits.
      const before = performance.now();
      while (performance.now() - before < 2) { /* busy frame */ }
      paused += performance.now() - before;
    }
    const wall = performance.now() - startedAt;
    const tick = simulation.tickPerformance();
    expect(tick.tickCount).toBe(1);
    expect(paused).toBeGreaterThan(10);
    expect(tick.total.meanMs).toBeLessThan(wall - paused * 0.9);
  });
});
