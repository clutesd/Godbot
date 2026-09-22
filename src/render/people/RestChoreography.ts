import type { RestPosture } from './RestPresentation';

export type RestStage = 'settling' | 'settled' | 'rising';
export type RestStyle =
  | 'supported-brace-left'
  | 'supported-brace-right'
  | 'supported-knees'
  | 'ground-open'
  | 'ground-side-left'
  | 'ground-side-right';
export type RestPreference = 'supported' | 'ground' | 'mixed';

export const REST_SETTLE_SECONDS = 0.82;
export const REST_RISE_SECONDS = 0.68;

export function restStyleFor(personId: string, posture: RestPosture): RestStyle {
  const value = stableUnit(`${personId}:${posture}:rest-style`);
  if (posture === 'supported-sit') {
    if (value < 0.34) return 'supported-brace-left';
    if (value < 0.68) return 'supported-brace-right';
    return 'supported-knees';
  }
  if (value < 0.42) return 'ground-open';
  if (value < 0.71) return 'ground-side-left';
  return 'ground-side-right';
}

/**
 * Younger residents are more likely to choose the yard/ground; older residents strongly prefer
 * structure support. Adults retain a small deterministic mix so households do not form one pose wall.
 */
export function restPreferenceFor(personId: string, ageMonths: number): RestPreference {
  if (ageMonths < 14 * 12) return 'ground';
  if (ageMonths >= 62 * 12) return 'supported';
  return stableUnit(`${personId}:rest-preference`) < 0.24 ? 'ground' : 'mixed';
}

export function restTransitionSeconds(stage: 'settling' | 'rising', ageMonths: number): number {
  const years = ageMonths / 12;
  const ageFactor = years >= 70 ? 1.32 : years >= 58 ? 1.18 : years < 14 ? 0.86 : 1;
  return (stage === 'settling' ? REST_SETTLE_SECONDS : REST_RISE_SECONDS) * ageFactor;
}

export function restMotionPhase(personId: string, seconds: number): number {
  return seconds * (0.72 + stableUnit(`${personId}:rest-breath-rate`) * 0.16)
    + stableUnit(`${personId}:rest-breath-phase`) * Math.PI * 2;
}

/** A sparse smooth window for occasional seated attention shifts, not constant idle motion. */
export function restAttentionWindow(personId: string, seconds: number): number {
  const cycle = 13.5 + stableUnit(`${personId}:rest-look-cycle`) * 6;
  const phase = ((seconds + stableUnit(`${personId}:rest-look-phase`) * cycle) % cycle) / cycle;
  if (phase >= 0.22) return 0;
  const x = phase / 0.22;
  return Math.sin(x * Math.PI) ** 2;
}

export function stableRestUnit(key: string): number {
  return stableUnit(key);
}

function stableUnit(key: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash / 0xffffffff;
}
