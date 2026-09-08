import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { PlacementAcceptanceTests } from '../src/render/placement/PlacementAcceptanceTests';

describe('Placement contract acceptance', () => {
  it('passes the Phase 1.5 placement gate across accelerated seeds', async () => {
    const seeds = ['placement-river', 'placement-steppe', 'placement-archipelago', 'placement-highlands'];

    for (const seed of seeds) {
      const world = generateWorld(configWith({ seed }));
      const tests = new PlacementAcceptanceTests(world);
      const results = await tests.runAllTests();
      const failures = results.filter((result) => !result.passed);

      try {
        expect(failures, `${seed}: ${failures.map((failure) => `${failure.name}: ${failure.details}`).join('; ')}`).toHaveLength(0);
        expect(tests.getSummary().allPassed).toBe(true);
      } finally {
        tests.dispose();
      }
    }
  });
});
