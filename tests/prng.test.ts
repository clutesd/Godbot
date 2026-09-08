import { describe, expect, it } from 'vitest';
import { SeededRandom, stableHash } from '../src/sim/prng';

describe('SeededRandom', () => {
  it('replays the same sequence from the same seed', () => {
    const first = new SeededRandom('sakura-river');
    const second = new SeededRandom('sakura-river');
    expect(Array.from({ length: 32 }, () => first.float())).toEqual(Array.from({ length: 32 }, () => second.float()));
  });

  it('produces independent deterministic forks', () => {
    const root = new SeededRandom('woven-sun');
    const first = root.fork('climate');
    const second = root.fork('climate');
    const other = root.fork('names');
    expect(first.getState()).toBe(second.getState());
    expect(Array.from({ length: 8 }, () => first.float())).toEqual(Array.from({ length: 8 }, () => second.float()));
    expect(other.getState()).not.toBe(second.getState());
  });

  it('keeps spatial hashes stable and coordinate-sensitive', () => {
    expect(stableHash('terrain', 4, 9)).toBe(stableHash('terrain', 4, 9));
    expect(stableHash('terrain', 4, 9)).not.toBe(stableHash('terrain', 5, 9));
  });
});
