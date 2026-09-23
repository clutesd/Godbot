import { describe, expect, it } from 'vitest';
import { InteractiveTickBudget } from '../src/sim/InteractiveTickBudget';
import { FramePacingProfiler } from '../src/render/FramePacingProfiler';

describe('interactive tick budget', () => {
  it('always permits the first due atomic tick and defers catch-up that is unlikely to fit', () => {
    const budget = new InteractiveTickBudget(4);
    const deadline = budget.deadline(100);
    expect(deadline).toBe(104);
    expect(budget.canStart(103.9, deadline, 0)).toBe(true);

    budget.observe(3.5);
    expect(budget.estimatedTickMs).toBeGreaterThan(1);
    expect(budget.canStart(102.5, deadline, 1)).toBe(false);
  });

  it('defers a due tick briefly when recent non-simulation frame work already consumes the budget', () => {
    const budget = new InteractiveTickBudget(4);
    budget.observe(3);
    budget.observeFrame(15);

    const deadline = budget.deadline(100);
    expect(deadline).toBeLessThan(104);
    expect(budget.estimatedFrameMs).toBe(15);
    expect(budget.canStart(100, deadline, 0)).toBe(false);
    expect(budget.canStart(100, deadline, 0)).toBe(false);
    // A sustained slow renderer cannot starve authoritative history forever.
    expect(budget.canStart(100, deadline, 0)).toBe(true);
  });

  it('restores catch-up headroom gradually after rendering becomes cheaper', () => {
    const budget = new InteractiveTickBudget(4);
    budget.observeFrame(15);
    const constrained = budget.deadline(100) - 100;
    for (let frame = 0; frame < 30; frame++) budget.observeFrame(5);
    const recovered = budget.deadline(100) - 100;

    expect(budget.estimatedFrameMs).toBeLessThan(15);
    expect(recovered).toBeGreaterThan(constrained);
    expect(recovered).toBeLessThanOrEqual(4);
  });

  it('recovers its estimate gradually after cheaper ticks', () => {
    const budget = new InteractiveTickBudget(4);
    budget.observe(8);
    const afterSpike = budget.estimatedTickMs;
    budget.observe(0.5);
    expect(budget.estimatedTickMs).toBeLessThan(afterSpike);
    expect(budget.estimatedTickMs).toBeGreaterThan(0.5);
  });
});


describe('frame pacing profiler', () => {
  it('reports rolling frame percentiles and isolates Arrival hitches', () => {
    const profiler = new FramePacingProfiler(60);
    for (let frame = 0; frame < 50; frame++) profiler.observe(8 + frame * 0.05, frame < 30);
    profiler.observe(24, true);
    profiler.observe(40, true);

    const snapshot = profiler.snapshot();
    expect(snapshot.sampleCount).toBe(52);
    expect(snapshot.p50Ms).toBeGreaterThanOrEqual(8);
    expect(snapshot.p95Ms).toBeLessThan(20);
    expect(snapshot.maxMs).toBe(40);
    expect(snapshot.hitches20Ms).toBe(2);
    expect(snapshot.hitches33Ms).toBe(1);
    expect(snapshot.arrival.frames).toBe(32);
    expect(snapshot.arrival.hitches20Ms).toBe(2);
    expect(snapshot.arrival.hitches33Ms).toBe(1);

    profiler.reset();
    expect(profiler.snapshot().sampleCount).toBe(0);
  });
});
