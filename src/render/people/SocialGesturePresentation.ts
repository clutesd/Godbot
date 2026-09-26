import type { Person } from '../../sim/types';
import type { LocalActivityState, SocialEncounterPresentation } from './LocalActivityPresentation';
import type { PersonVisualState } from './PeopleVisualState';

export type SocialGreeting = 'wave' | 'bow' | 'handshake' | 'hug';
export const SOCIAL_GREETING_SECONDS: Record<SocialGreeting, number> = { wave: 2.2, bow: 2.4, handshake: 2.8, hug: 3.4 };
export const SOCIAL_GREETING_DISTANCE: Record<SocialGreeting, number> = { wave: 0.46, bow: 0.5, handshake: 0.19, hug: 0.108 };

/** Existing relationships justify contact; this never creates a bond or a social outcome. */
export function socialGreetingFor(a: Person, b: Person, encounter: SocialEncounterPresentation): SocialGreeting | undefined {
  if (encounter.tone === 'tense' || encounter.tone === 'supportive') return undefined;
  if (encounter.tone === 'formal' || encounter.tone === 'mentoring') return 'bow';
  const handsFree = [a, b].every(p => !p.appearance?.carriedItem || p.appearance.carriedItem === 'none');
  const adults = a.ageMonths >= 168 && b.ageMonths >= 168;
  if (!handsFree) return 'bow';
  if (adults && encounter.tone === 'warm' && ['friend', 'family'].includes(encounter.relationshipKind ?? '')
    && encounter.strength >= 0.78 && encounter.trust >= 0.78) return 'hug';
  if (adults && encounter.tone === 'collaborative' && encounter.trust >= 0.55) return 'handshake';
  return 'wave';
}

export interface SocialGestureFrame {
  kind: SocialGreeting;
  partnerId: string;
  progress: number;
  weight: number;
  contact: boolean;
}

/** Both actors use the earlier shared beat time. Approach, turning, interruption and unequal
 * beats cannot produce contact. Snapshot inputs make the result independent of render order. */
export function socialGestureFrame(personId: string, local: Readonly<LocalActivityState> | undefined,
  peer: Readonly<LocalActivityState> | undefined, visual: Readonly<PersonVisualState> | undefined,
  other: Readonly<PersonVisualState> | undefined): SocialGestureFrame | undefined {
  const encounter = local?.encounter, greeting = encounter?.greeting;
  if (!greeting || encounter.beat !== 0 || !visual || !other || !peer?.encounter
    || peer.encounter.partnerId !== personId || peer.encounter.greeting !== greeting || peer.encounter.beat !== 0
    || local?.phase !== 'action' || peer.phase !== 'action' || visual.speed >= 0.05 || other.speed >= 0.05
    || visual.traveling || other.traveling) return undefined;
  const dx = other.x - visual.x, dz = other.z - visual.z;
  const distance = Math.hypot(dx, dz);
  if (distance > SOCIAL_GREETING_DISTANCE[greeting] + 0.045 || distance < 0.085
    || Math.cos(Math.atan2(dx, dz) - visual.facing) < 0.9
    || Math.cos(Math.atan2(-dx, -dz) - other.facing) < 0.9) return undefined;
  const seconds = Math.min(local.seconds, peer.seconds);
  const duration = SOCIAL_GREETING_SECONDS[greeting];
  // The receiver answers the wave/bow a moment after noticing it.
  const delay = (greeting === 'wave' || greeting === 'bow') && personId > encounter.partnerId ? 0.22 : 0;
  const progress = Math.max(0, Math.min(1, (seconds - delay) / (duration - delay)));
  const weight = ease(progress / 0.23) * ease((1 - progress) / 0.25);
  return { kind: greeting, partnerId: encounter.partnerId, progress, weight,
    contact: (greeting === 'hug' || greeting === 'handshake') && weight > 0.94 };
}

function ease(t: number): number { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); }
