/**
 * ArchitecturalPeriod.ts
 *
 * A finer historical grain for architecture than the simulation's six presentation eras.
 *
 * `Era` stays authoritative: it is what the simulation and the rest of the renderer agree on,
 * and nothing here can move a settlement outside the band its era allows. But six eras cannot
 * tell a medieval threshing barn from an early-modern bank barn, so architecture resolves one
 * level finer by reading the two other authoritative signals the simulation already publishes:
 * how far a local response has actually been developed, and which capabilities it was observed
 * to be practising when it was built.
 *
 * The mapping is monotone and total: a period is only ever pulled *up* from the era's floor
 * toward the era's ceiling, never past it. That keeps a 5,000-year run's architecture ordered —
 * no settlement regresses because a single building happened to be cheap.
 */

import type { Era } from '../materials/MaterialPalette';

export const ARCHITECTURAL_PERIODS = [
  'neolithic',
  'bronzeIron',
  'classical',
  'medieval',
  'earlyModern',
  'industrial',
  'modern',
  'contemporary',
] as const;

export type ArchitecturalPeriod = (typeof ARCHITECTURAL_PERIODS)[number];

const PERIOD_RANK: Record<ArchitecturalPeriod, number> = {
  neolithic: 0,
  bronzeIron: 1,
  classical: 2,
  medieval: 3,
  earlyModern: 4,
  industrial: 5,
  modern: 6,
  contemporary: 7,
};

export function periodRank(period: ArchitecturalPeriod): number {
  return PERIOD_RANK[period];
}

export function periodAtLeast(period: ArchitecturalPeriod, floor: ArchitecturalPeriod): boolean {
  return PERIOD_RANK[period] >= PERIOD_RANK[floor];
}

export function periodFromRank(rank: number): ArchitecturalPeriod {
  const clamped = Math.max(0, Math.min(ARCHITECTURAL_PERIODS.length - 1, Math.round(rank)));
  return ARCHITECTURAL_PERIODS[clamped]!;
}

/** Human-facing label and approximate real-world dating, for debug overlays and documentation. */
export const PERIOD_LABELS: Record<ArchitecturalPeriod, { label: string; approx: string }> = {
  neolithic: { label: 'Neolithic / early settlement', approx: 'c. 9000–3000 BCE' },
  bronzeIron: { label: 'Bronze & Iron Age', approx: 'c. 3000–500 BCE' },
  classical: { label: 'Classical', approx: 'c. 500 BCE–500 CE' },
  medieval: { label: 'Medieval', approx: 'c. 500–1500 CE' },
  earlyModern: { label: 'Early modern', approx: 'c. 1500–1800' },
  industrial: { label: 'Industrial', approx: 'c. 1800–1914' },
  modern: { label: 'Modern', approx: 'c. 1914–1980' },
  contemporary: { label: 'Contemporary', approx: 'c. 1980–present' },
};

/**
 * The band of periods each presentation era may express.
 *
 * `floor` is what an undeveloped level-1 response looks like; `ceiling` is the most advanced
 * architecture the era can justify however rich the settlement becomes. The overlap between
 * consecutive eras is deliberate: it is what lets a wealthy pre-industrial settlement build
 * early-modern fabric while a poor industrial one is still putting up early-modern sheds.
 */
const ERA_BAND: Record<Era, { floor: ArchitecturalPeriod; ceiling: ArchitecturalPeriod }> = {
  primitive: { floor: 'neolithic', ceiling: 'neolithic' },
  early: { floor: 'neolithic', ceiling: 'bronzeIron' },
  village: { floor: 'bronzeIron', ceiling: 'classical' },
  preIndustrial: { floor: 'classical', ceiling: 'earlyModern' },
  industrial: { floor: 'earlyModern', ceiling: 'industrial' },
  advanced: { floor: 'modern', ceiling: 'contemporary' },
};

export function eraPeriodFloor(era: Era): ArchitecturalPeriod {
  return ERA_BAND[era].floor;
}

export function eraPeriodCeiling(era: Era): ArchitecturalPeriod {
  return ERA_BAND[era].ceiling;
}

/**
 * Capabilities that, once a settlement is observed practising them, evidence a floor on the
 * architecture it can put up. These are construction-bearing capabilities only: knowing how to
 * navigate by stars says nothing about how you roof a barn.
 *
 * This is evidence, not permission. The era ceiling still clamps the result, so a village that
 * stumbles onto iron-working does not start raising industrial sheds.
 */
const CAPABILITY_PERIOD_FLOOR: Record<string, ArchitecturalPeriod> = {
  'pottery-firing': 'bronzeIron',
  'stone-composites': 'bronzeIron',
  'metal-smelting': 'bronzeIron',
  'material-testing': 'classical',
  'iron-working': 'classical',
  leverage: 'classical',
  'high-temperature-ceramics': 'medieval',
  'precision-tools': 'earlyModern',
  'mechanical-power': 'earlyModern',
  'standardized-parts': 'industrial',
  thermodynamics: 'industrial',
  'rotary-machinery': 'industrial',
  'industrial-chemistry': 'industrial',
  'rail-transport': 'industrial',
  'precision-manufacturing': 'modern',
  'electrical-generation': 'modern',
  'electric-grid': 'modern',
  automation: 'contemporary',
  computation: 'contemporary',
};

export interface ArchitecturalPeriodContext {
  /** Authoritative presentation era. Always clamps the result. */
  era: Era;
  /** Development level of the local response, 1..3. Undeveloped fabric sits at the era floor. */
  developmentLevel?: number;
  /** Capability ids the simulation observed in practice when the response was selected. */
  capabilities?: readonly string[];
}

/**
 * Resolve the architectural period for one structure.
 *
 * Deterministic and side-effect free: the same context always yields the same period, which is
 * what lets the asset cache key on it.
 */
export function architecturalPeriod(context: ArchitecturalPeriodContext): ArchitecturalPeriod {
  const band = ERA_BAND[context.era];
  const floor = PERIOD_RANK[band.floor];
  const ceiling = PERIOD_RANK[band.ceiling];
  if (ceiling <= floor) return band.floor;

  // Development level walks the era's own band: level 1 sits at the floor, level 3 at the ceiling.
  const level = Math.max(1, Math.min(3, Math.round(context.developmentLevel ?? 1)));
  const span = ceiling - floor;
  let rank = floor + Math.round(((level - 1) / 2) * span);

  // Observed construction capability can only raise the floor, and never past the era ceiling.
  for (const capability of context.capabilities ?? []) {
    const evidenced = CAPABILITY_PERIOD_FLOOR[capability];
    if (evidenced === undefined) continue;
    rank = Math.max(rank, Math.min(ceiling, PERIOD_RANK[evidenced]));
  }

  return periodFromRank(Math.max(floor, Math.min(ceiling, rank)));
}
