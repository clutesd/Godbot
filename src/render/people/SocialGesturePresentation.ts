import type { Person } from '../../sim/types';
import type { LocalActivityState, SocialEncounterPresentation } from './LocalActivityPresentation';
import type { PersonVisualState } from './PeopleVisualState';
import type { AnimationPose } from '../animation/AnimationController';

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

const pulse = (time: number, start: number, duration: number): number => {
  const t = (time - start) / duration;
  return t > 0 && t < 1 ? Math.sin(Math.PI * t) ** 2 : 0;
};

/** Speech has preparation, emphasis and recovery, followed by space for a response.
 * Partner snapshots share the phrase clock; listeners answer the emphasis after a short delay.
 * Only the upper body is layered, leaving foot contacts and locomotion in control. */
export function applyConversationGesture(pose: AnimationPose, personId: string,
  local: Readonly<LocalActivityState> | undefined, peer: Readonly<LocalActivityState> | undefined,
  visual: Readonly<PersonVisualState>, expressiveness: number): void {
  if (!local || local.phase !== 'action' || visual.traveling || visual.speed >= 0.05
    || local.encounter?.ready === false || local.encounter?.beat === 0 && local.encounter.greeting
    || !['converse', 'converse-warm', 'converse-quiet', 'converse-teach', 'converse-tense'].includes(local.animation)) return;
  const paired = peer?.encounter?.partnerId === personId && peer.encounter.beat === local.encounter?.beat;
  const seconds = paired ? Math.min(local.seconds, peer.seconds) : local.seconds;
  const speaker = local.animation !== 'converse-quiet';
  const tense = local.encounter?.tone === 'tense' || local.animation === 'converse-tense';
  const teaching = local.encounter?.tone === 'mentoring' || local.animation === 'converse-teach';
  const phase = seconds % (tense ? 4.1 : teaching ? 6.2 : 5.4);
  const emphasis = pulse(phase, 0.35, 1.25) + 0.6 * pulse(phase, 1.8, 0.85);
  const response = pulse(phase, 1.25, 0.55) + 0.65 * pulse(phase, 2.55, 0.65);
  const blend = ease(seconds / 0.45) * ease((local.hold - local.seconds) / 0.45);
  let hash = 0;
  for (let i = 0; i < personId.length; i++) hash = Math.imul(hash, 31) + personId.charCodeAt(i) | 0;
  const leftLead = (hash & 1) === 0;
  const strength = 0.65 + Math.max(0, Math.min(1, expressiveness)) * 0.5;
  const gesture = speaker ? emphasis * strength : 0;
  const leadShoulder = 0.045 + gesture * (teaching ? 0.40 : tense ? 0.24 : 0.29);
  const leadElbow = 0.20 + gesture * (tense ? 0.85 : 0.65);
  const supportShoulder = 0.015 + gesture * 0.065;
  const supportElbow = 0.16 + gesture * 0.15;
  const mix = (a: number, b: number) => a + (b - a) * blend;
  pose.leftShoulderRotation = mix(pose.leftShoulderRotation, leftLead ? leadShoulder : supportShoulder);
  pose.rightShoulderRotation = mix(pose.rightShoulderRotation, leftLead ? supportShoulder : leadShoulder);
  pose.leftElbowRotation = mix(pose.leftElbowRotation, leftLead ? leadElbow : supportElbow);
  pose.rightElbowRotation = mix(pose.rightElbowRotation, leftLead ? supportElbow : leadElbow);
  pose.spineTwist = mix(pose.spineTwist ?? 0, (leftLead ? -1 : 1) * gesture * 0.055);
  pose.spineRotation = mix(pose.spineRotation, (tense ? 0.035 : 0.012) + gesture * 0.028);
  pose.headPitch = mix(pose.headPitch ?? 0, speaker ? emphasis * 0.024 : response * 0.095);
  // Long quiet glances replace constant independent head oscillation while addressing someone.
  pose.headRotation = mix(pose.headRotation, pulse(phase, 3.3, 1.1) * (leftLead ? -0.10 : 0.10));
}
