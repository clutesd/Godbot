import { describe, expect, it } from 'vitest';
import { InteractiveTickBudget } from '../src/sim/InteractiveTickBudget';

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

  it('recovers its estimate gradually after cheaper ticks', () => {
    const budget = new InteractiveTickBudget(4);
    budget.observe(8);
    const afterSpike = budget.estimatedTickMs;
    budget.observe(0.5);
    expect(budget.estimatedTickMs).toBeLessThan(afterSpike);
    expect(budget.estimatedTickMs).toBeGreaterThan(0.5);
  });
});
