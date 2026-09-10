import type { Settlement } from '../types';
import { deriveMilitaryProfile, type MilitaryCapabilityProfile, type MilitaryRegime } from './MilitaryCapability';

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

export type EngagementMode = 'close' | 'ranged' | 'bombardment' | 'combined-arms' | 'stand-off';

export interface MilitaryCombatAssessment {
  engagementMode: EngagementMode;
  effectivenessA: number;
  effectivenessB: number;
  casualtyPressureA: number;
  casualtyPressureB: number;
  rangeA: number;
  rangeB: number;
  lethalityA: number;
  lethalityB: number;
  exposureA: number;
  exposureB: number;
  mismatchA: number;
  mismatchB: number;
  defenderWorks: number;
  defenderWorksMultiplier: number;
  breachA: number;
  replacementA: number;
  replacementB: number;
}

export interface MilitarySupplyCosts {
  food: number;
  goods: number;
  minerals: number;
  wealth: number;
}

const REGIME_RANK: Record<MilitaryRegime, number> = {
  improvised: 0,
  'organized-melee': 1,
  siege: 2,
  gunpowder: 3,
  industrial: 4,
  modern: 5,
};

export function militaryRange(profile: MilitaryCapabilityProfile): number {
  return clamp(
    profile.ranged * 0.24
    + profile.firearms * 0.2
    + profile.artillery * 0.26
    + profile.airPower * 0.16
    + profile.missile * 0.28,
  );
}

export function militaryLethality(profile: MilitaryCapabilityProfile): number {
  return clamp(
    0.24
    + profile.melee * 0.16
    + profile.ranged * 0.16
    + profile.firearms * 0.25
    + profile.artillery * 0.28
    + profile.airPower * 0.2
    + profile.missile * 0.18,
    0.22,
    1.35,
  );
}

export function militaryReplacement(profile: MilitaryCapabilityProfile): number {
  return clamp(profile.production * 0.46 + profile.sustainment * 0.32 + profile.energy * 0.14 + profile.institutionalSupport * 0.08);
}

export function militaryLogisticsBurden(profile: MilitaryCapabilityProfile): number {
  return clamp(
    0.08
    + profile.firearms * 0.12
    + profile.artillery * 0.18
    + profile.mobility * 0.12
    + profile.airPower * 0.24
    + profile.missile * 0.26,
  );
}

/**
 * Applies the current home economy to equipment frozen at mobilization. Knowledge can survive a
 * shortage; the ability to feed, fuel, repair and replace a sophisticated force cannot. Dependency
 * grows with the force's logistics burden, so low-tech formations degrade gently while aircraft,
 * artillery and guided systems can lose operational availability quickly after industrial collapse.
 */
export function militaryOperationalSupply(
  settlement: Settlement,
  mobilized: MilitaryCapabilityProfile,
  legacySupply: number,
): number {
  const current = deriveMilitaryProfile(settlement);
  const burden = militaryLogisticsBurden(mobilized);
  const currentSupport = clamp(current.sustainment * 0.48 + current.production * 0.26 + current.energy * 0.18 + current.communications * 0.08);
  const dependencyPenalty = clamp(burden * Math.max(0, 0.88 - currentSupport) * 1.35, 0, 0.68);
  const coordination = 0.94 + mobilized.communications * 0.05 + mobilized.institutionalSupport * 0.03;
  return clamp(legacySupply * coordination * (1 - dependencyPenalty), 0.04, 1);
}

/** Primitive columns stay near the old pace; roads, engines and communications make later forces faster. */
export function militaryMarchMultiplier(profile: MilitaryCapabilityProfile): number {
  return clamp(0.92 + profile.mobility * 0.34 + profile.communications * 0.12, 0.9, 1.34);
}

/**
 * Documentary resource demand. Food remains universal; industrial forces additionally consume
 * goods, minerals and wealth as proxies for ammunition, fuel, maintenance and replacement parts.
 * GODBOX does not yet carry a separate liquid-fuel stock, so this intentionally avoids inventing one.
 */
export function militarySupplyCosts(profile: MilitaryCapabilityProfile): MilitarySupplyCosts {
  const industrialBurden = clamp(
    profile.firearms * 0.22
    + profile.artillery * 0.28
    + profile.mobility * 0.18
    + profile.airPower * 0.34
    + profile.missile * 0.38,
  );
  return {
    food: 1,
    goods: industrialBurden * 0.38,
    minerals: industrialBurden * 0.2,
    wealth: industrialBurden * 0.12,
  };
}

function militaryIndex(profile: MilitaryCapabilityProfile): number {
  return clamp(
    profile.melee * 0.08
    + profile.ranged * 0.1
    + profile.protection * 0.1
    + profile.firearms * 0.13
    + profile.artillery * 0.14
    + profile.mobility * 0.1
    + profile.communications * 0.1
    + profile.airPower * 0.1
    + profile.missile * 0.08
    + profile.sustainment * 0.07,
  );
}

function engagementMode(a: MilitaryCapabilityProfile, b: MilitaryCapabilityProfile): EngagementMode {
  const missile = Math.max(a.missile, b.missile);
  const air = Math.max(a.airPower, b.airPower);
  const artillery = Math.max(a.artillery, b.artillery);
  const firearms = Math.max(a.firearms, b.firearms);
  const ranged = Math.max(a.ranged, b.ranged);
  if (missile > 0.48) return 'stand-off';
  if (air > 0.44 && (artillery > 0.3 || firearms > 0.4)) return 'combined-arms';
  if (artillery > 0.4) return 'bombardment';
  if (firearms > 0.32 || ranged > 0.34) return 'ranged';
  return 'close';
}

/**
 * Converts equipment into bounded battlefield consequences. The mismatch term is intentionally
 * nonlinear: a large capability gap changes the character of a battle rather than becoming a
 * small linear technology bonus. It is still capped so a single draw never guarantees annihilation.
 */
export function assessMilitaryCombat(
  a: MilitaryCapabilityProfile,
  b: MilitaryCapabilityProfile,
  defender: Settlement,
): MilitaryCombatAssessment {
  const rangeA = militaryRange(a);
  const rangeB = militaryRange(b);
  const lethalityA = militaryLethality(a);
  const lethalityB = militaryLethality(b);
  const replacementA = militaryReplacement(a);
  const replacementB = militaryReplacement(b);
  const indexA = militaryIndex(a);
  const indexB = militaryIndex(b);
  const regimeGap = REGIME_RANK[a.regime] - REGIME_RANK[b.regime];
  const capabilityGap = indexA - indexB;
  const mismatchA = Math.max(0, Math.tanh(capabilityGap * 2.2) * 0.55 + Math.max(0, regimeGap) * 0.09);
  const mismatchB = Math.max(0, Math.tanh(-capabilityGap * 2.2) * 0.55 + Math.max(0, -regimeGap) * 0.09);

  const exposureA = clamp(
    1 - a.protection * 0.28 - a.mobility * 0.08 - a.communications * 0.06 - Math.max(0, rangeA - rangeB) * 0.18,
    0.42,
    1.08,
  );
  const exposureB = clamp(
    1 - b.protection * 0.28 - b.mobility * 0.08 - b.communications * 0.06 - Math.max(0, rangeB - rangeA) * 0.18,
    0.42,
    1.08,
  );

  const defenderWorks = clamp(
    0.08
    + Math.min(1, defender.buildings / 42) * 0.17
    + defender.urbanization * 0.13
    + defender.infrastructure.workshops * 0.13
    + b.protection * 0.2
    + b.institutionalSupport * 0.16,
  );
  const breachA = clamp(a.siege * 0.3 + a.artillery * 0.34 + a.airPower * 0.2 + a.missile * 0.16);
  const defenderWorksMultiplier = 1 + defenderWorks * 0.42 * (1 - breachA * 0.86);

  const combinedA = clamp(a.communications * 0.2 + a.mobility * 0.18 + a.artillery * 0.18 + a.airPower * 0.18 + a.sustainment * 0.14 + a.institutionalSupport * 0.12);
  const combinedB = clamp(b.communications * 0.2 + b.mobility * 0.18 + b.artillery * 0.18 + b.airPower * 0.18 + b.sustainment * 0.14 + b.institutionalSupport * 0.12);
  const effectivenessA = clamp(0.84 + indexA * 0.46 + combinedA * 0.18 + mismatchA * 0.42, 0.82, 1.72);
  const effectivenessB = clamp(0.84 + indexB * 0.46 + combinedB * 0.18 + mismatchB * 0.42, 0.82, 1.72);

  // These values multiply the existing bounded casualty draw. Near-peer primitive fighting stays
  // close to legacy severity; firearms, artillery, air power and major mismatches raise it sharply.
  const casualtyPressureA = clamp(
    (0.62 + lethalityB * 0.72 + Math.max(0, rangeB - rangeA) * 0.7 + mismatchB * 0.82) * exposureA,
    0.42,
    3.2,
  );
  const casualtyPressureB = clamp(
    (0.62 + lethalityA * 0.72 + Math.max(0, rangeA - rangeB) * 0.7 + mismatchA * 0.82) * exposureB,
    0.42,
    3.2,
  );

  return {
    engagementMode: engagementMode(a, b),
    effectivenessA,
    effectivenessB,
    casualtyPressureA,
    casualtyPressureB,
    rangeA,
    rangeB,
    lethalityA,
    lethalityB,
    exposureA,
    exposureB,
    mismatchA,
    mismatchB,
    defenderWorks,
    defenderWorksMultiplier,
    breachA,
    replacementA,
    replacementB,
  };
}
