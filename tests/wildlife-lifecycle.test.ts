import { describe, expect, it } from 'vitest';
import { wildlifeLife, WildlifeHarvestLedger, WILDLIFE_PROFILES, type WildlifeTarget } from '../src/sim/wildlife/WildlifeLifecycle';
import { seedHash } from '../src/sim/prng';

describe('wildlife lifecycle and harvest boundary', () => {
  for (const species of Object.keys(WILDLIFE_PROFILES) as (keyof typeof WILDLIFE_PROFILES)[]) {
    it(`${species}: grows, ages, dies, and recruits a distinct generation`, () => {
      const profile = WILDLIFE_PROFILES[species];
      const cycle = profile.lifespan + profile.recovery;
      const birth = cycle - seedHash('slot') % profile.lifespan;
      expect(wildlifeLife('slot', species, birth).stage).toBe('young');
      expect(wildlifeLife('slot', species, birth).scale).toBeCloseTo(0.38);
      expect(wildlifeLife('slot', species, birth + profile.maturity).stage).toBe('adult');
      expect(wildlifeLife('slot', species, birth + profile.lifespan - 1).stage).toBe('elder');
      expect(wildlifeLife('slot', species, birth + profile.lifespan).stage).toBe('dead');
      expect(wildlifeLife('slot', species, birth + cycle).id).not.toBe(wildlifeLife('slot', species, birth).id);
    });
  }
  it('requires matching tools, adult live targets, finite coordinates and range', () => {
    const ledger = new WildlifeHarvestLedger();
    const target: WildlifeTarget = { id: 'fish@0', species: 'fish', stage: 'adult', x: 2, z: 0 };
    expect(ledger.harvest(target, 'hunt', { x: 0, z: 0 }, 3)).toBeUndefined();
    expect(ledger.harvest(target, 'fish', { x: 0, z: 0 }, 1)).toBeUndefined();
    expect(ledger.harvest({ ...target, stage: 'young' }, 'fish', target, 3)).toBeUndefined();
    expect(ledger.harvest({ ...target, stage: 'dead' }, 'fish', target, 3)).toBeUndefined();
    expect(ledger.harvest(target, 'fish', { x: NaN, z: 0 }, 3)).toBeUndefined();
    expect(ledger.harvest(target, 'fish', target, 3)?.food).toBeGreaterThan(0);
    expect(ledger.harvest(target, 'fish', target, 3)).toBeUndefined();
    expect(new WildlifeHarvestLedger(ledger.snapshot()).has(target.id)).toBe(true);
    expect(ledger.harvest({ ...target, id: 'fish@1' }, 'fish', target, 3)).toBeDefined();
  });
});
