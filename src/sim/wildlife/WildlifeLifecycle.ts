import { seedHash } from '../prng';

export type WildlifeSpecies = 'elk' | 'bear' | 'fox' | 'squirrel' | 'bird' | 'fish';
export type LifeStage = 'young' | 'adult' | 'elder' | 'dead';
export const WILDLIFE_PROFILES = {
  elk: { maturity: 24, lifespan: 216, recovery: 12, food: 90, hide: 16 },
  bear: { maturity: 48, lifespan: 300, recovery: 24, food: 120, hide: 22 },
  fox: { maturity: 12, lifespan: 84, recovery: 12, food: 8, hide: 4 },
  squirrel: { maturity: 8, lifespan: 60, recovery: 6, food: 1, hide: 0.2 },
  bird: { maturity: 6, lifespan: 48, recovery: 6, food: 1, hide: 0 },
  fish: { maturity: 12, lifespan: 96, recovery: 6, food: 2, hide: 0 },
} as const;

/** A bounded habitat slot, with distinct identities for successive generations. Months are
 * simulation time, never frame time. Replacement is recruitment, not resurrection. */
export function wildlifeLife(id: string, species: WildlifeSpecies, month: number) {
  const profile = WILDLIFE_PROFILES[species];
  const cycle = profile.lifespan + profile.recovery;
  const clock = Math.max(0, Number.isFinite(month) ? month : 0)
    + seedHash(id) % profile.lifespan;
  const generation = Math.floor(clock / cycle);
  const age = clock % cycle;
  const stage: LifeStage = age >= profile.lifespan ? 'dead'
    : age < profile.maturity ? 'young' : age > profile.lifespan * 0.8 ? 'elder' : 'adult';
  return { id: `${id}@${generation}`, generation, age, stage,
    scale: stage === 'young' ? 0.38 + 0.62 * age / profile.maturity : 1,
    breeding: stage === 'adult' && Math.floor(month) % 12 >= 2 && Math.floor(month) % 12 <= 4 };
}

export interface WildlifeTarget {
  id: string;
  species: WildlifeSpecies;
  stage: LifeStage;
  x: number;
  z: number;
}

/** Serializable depletion ledger; an eventual simulation owner can persist this with its save.
 * Render adapters consume the same ledger. No resource credit happens in presentation code. */
export class WildlifeHarvestLedger {
  private readonly taken: Set<string>;
  constructor(saved: readonly string[] = []) { this.taken = new Set(saved); }
  has(id: string): boolean { return this.taken.has(id); }
  snapshot(): string[] { return [...this.taken].sort(); }
  harvest(target: WildlifeTarget, method: 'hunt' | 'fish', actor: { x: number; z: number }, range: number) {
    if (!Number.isFinite(range) || range < 0 || !Number.isFinite(actor.x) || !Number.isFinite(actor.z)
      || !Number.isFinite(target.x) || !Number.isFinite(target.z)
      || target.stage === 'dead' || target.stage === 'young' || this.taken.has(target.id)
      || (target.species === 'fish') !== (method === 'fish')
      || Math.hypot(actor.x - target.x, actor.z - target.z) > range) return undefined;
    this.taken.add(target.id);
    const { food, hide } = WILDLIFE_PROFILES[target.species];
    return { targetId: target.id, species: target.species, food, hide };
  }
}
