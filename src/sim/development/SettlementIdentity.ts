import { seedHash, SeededRandom } from '../prng';
import type { CultureStyle, Settlement, SimulationState } from '../types';
import type { StructureMaterial } from './types';
import type { DevelopmentContext } from './SettlementDevelopmentSystem';

/**
 * Deterministic per-settlement architectural drift layered on top of a culture's baseline style.
 * Every field is a bounded nudge, not a replacement: related-culture settlements stay related,
 * but diverge from their own environment, economy and accumulated history.
 */
export interface SettlementArchitecturalIdentity {
  evaluatedMonth: number;
  revision: number;
  roofVariantBias: number;
  eaveDepthDelta: number;
  trimDensityDelta: number;
  materialBiasOverride?: StructureMaterial;
  ornamentBias: number;
  massingCourtyardTendency: number;
  monumentalScaleBias: number;
  footprintBias: number;
  orientationBias: 'water' | 'defense' | 'trade' | 'none';
  plinthSlopeResponsiveness: number;
  dialectKey: string;
}

const clamp = (value: number, min = -1, max = 1): number => Math.max(min, Math.min(max, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);
const bucket = (value: number, max: number): number => Math.max(0, Math.min(max, Math.floor(value)));

/** Mirrors the render layer's culture->material inference without importing it (sim never depends on render). */
function cultureMaterialLean(symbol: CultureStyle['symbol']): StructureMaterial {
  switch (symbol) {
    case 'river-eye': return 'timber';
    case 'mountain-knot': return 'masonry';
    case 'sun-step': return 'ceramic';
    default: return 'timber';
  }
}

function materialBiasOverride(c: DevelopmentContext): StructureMaterial | undefined {
  const lean = cultureMaterialLean(c.culture.style.symbol);
  if (c.localMinerals > c.localWood + 0.3 && lean !== 'masonry') return 'masonry';
  if (c.localWood > c.localMinerals + 0.3 && lean === 'masonry') return 'timber';
  return undefined;
}

function orientationBias(settlement: Settlement, c: DevelopmentContext): SettlementArchitecturalIdentity['orientationBias'] {
  if (c.water && (settlement.specialization === 'exchange' || c.routes > 0)) return 'water';
  if (settlement.conflictPressure > 0.35 || c.culture.memory.frontierViolence > 0.4) return 'defense';
  if (settlement.specialization === 'exchange' || c.routes >= 2) return 'trade';
  return 'none';
}

/**
 * Pure function of read-only simulation state: no PRNG object, no live random stream consumed.
 * Counters are bucketed before hashing so identity drifts in discrete steps as real history
 * accumulates, rather than jittering on every recompute.
 */
export function evaluateSettlementIdentity(state: SimulationState, settlement: Settlement, c: DevelopmentContext): SettlementArchitecturalIdentity {
  const d = c.culture.dimensions;
  const bucketedState = [
    bucket(settlement.disastersSurvived, 5),
    bucket(settlement.droughtsSurvived, 5),
    bucket(settlement.migrationInfluence / 10, 5),
    bucket(settlement.conflictPressure * 5, 4),
    bucket(c.culture.memory.collectiveSuccess * 5, 4),
  ].join('-');
  const random = new SeededRandom(`${settlement.id}:identity:${bucketedState}`);

  return {
    evaluatedMonth: state.month,
    revision: (settlement.architecture?.revision ?? 0) + 1,
    roofVariantBias: clamp(random.range(-1, 1) * 0.7 + (d.curiosity - 0.5) * 0.4 - (d.longTermOrientation - 0.5) * 0.2),
    eaveDepthDelta: clamp(random.range(-1, 1) * 0.6 + (c.water ? 0.15 : -0.05)),
    trimDensityDelta: clamp(random.range(-1, 1) * 0.6 + (settlement.prosperity - 0.5) * 0.6),
    materialBiasOverride: materialBiasOverride(c),
    ornamentBias: clamp(random.range(-1, 1) * 0.5 + (c.institutions.length >= 2 ? 0.15 : 0) + (d.religiousTendency - 0.5) * 0.3),
    massingCourtyardTendency: clamp01(0.3 + random.range(-0.2, 0.2) + (d.hierarchy - 0.5) * 0.3 + settlement.urbanization * 0.2),
    monumentalScaleBias: clamp(random.range(-0.5, 0.5) + Math.min(0.5, c.institutions.length * 0.1)
      + Math.min(0.3, c.capitalReach * 0.05) + Math.max(0, settlement.prosperity - 0.5) * 0.4),
    footprintBias: clamp(random.range(-1, 1) * 0.6 + (c.movement > 3 ? 0.2 : -0.1)),
    orientationBias: orientationBias(settlement, c),
    plinthSlopeResponsiveness: clamp01(0.4 + random.range(-0.2, 0.2) + (settlement.droughtsSurvived > 0 ? 0.1 : 0) + (d.longTermOrientation - 0.5) * 0.2),
    dialectKey: seedHash(`${settlement.id}:${bucketedState}`).toString(36),
  };
}
