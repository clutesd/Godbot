import type { ResourceWorkMotion } from '../animation/ResourceWorkMotion';
import type { ConstructionChoreographyProfile } from './ConstructionChoreography';

export interface ConstructionGesture {
  kind: 'strike' | 'place' | 'pack' | 'finish' | 'pickup' | 'carry' | 'handoff' | 'receive' | 'prepare' | 'quiet';
  /** Person-space offsets from the true contact, never offsets of the workface itself. */
  lift: number;
  pullback: number;
  side: number;
  reach: number;
  loadPlacement: number;
  brace: boolean;
  stance: number;
  headPitch: number;
  weight: number;
}

/** Positive X pitch tips an upright torso toward local +Z, our work-facing axis. */
export function constructionBodyPitch(motion: ResourceWorkMotion, blend: number): number {
  return Math.max(-0.25, Math.min(0.62, motion.lean * Math.max(0, Math.min(1, blend))));
}

const smooth = (t: number) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); };

/** Slow anticipation, fast contact, a short compression hold, then recovery. No clock or RNG. */
export function constructionStroke(p: number): { retreat: number; impact: number; drive: number } {
  const t = Math.max(0, Math.min(1, p));
  const retreat = t < 0.3 ? smooth(t / 0.3)
    : t < 0.375 ? 1 - smooth((t - 0.3) / 0.075)
      : t < 0.455 ? 0
        : t < 0.78 ? smooth((t - 0.455) / 0.325) * 0.3
          : (1 - smooth((t - 0.78) / 0.22)) * 0.3;
  const impact = t >= 0.375 && t <= 0.455 ? Math.sin((t - 0.375) / 0.08 * Math.PI) : 0;
  return { retreat, impact, drive: smooth((t - 0.28) / 0.12) * (1 - smooth((t - 0.48) / 0.25)) };
}

/** Animation only: the existing playback/arrival/material authority chooses which gesture exists. */
export function sampleConstructionGesture(
  kind: ConstructionGesture['kind'], p: number, profile: ConstructionChoreographyProfile, out: ResourceWorkMotion,
): void {
  const t = Math.max(0, Math.min(1, p));
  const stroke = constructionStroke(t);
  const low = profile.stageName === 'foundation';
  const finish = profile.finishing;
  const placement = smooth((t - 0.08) / 0.32);
  const gesture: ConstructionGesture = {
    kind, lift: 0, pullback: 0, side: 0, reach: 0, loadPlacement: 0, brace: false,
    stance: 0.09, headPitch: 0.04, weight: 0,
  };
  if (kind === 'strike' || kind === 'prepare') {
    const effort = finish ? 0.55 : 1;
    const fit = profile.assemblyMotion === 'fit' ? 0.78 : 1;
    gesture.lift = stroke.retreat * 0.8 * effort * fit;
    gesture.pullback = stroke.retreat * 0.38 * effort * fit;
    gesture.side = stroke.retreat * 0.12;
    gesture.reach = 1;
    gesture.brace = kind === 'strike';
    gesture.loadPlacement = placement;
    gesture.stance = 0.16;
    gesture.weight = -stroke.retreat * 0.06 + stroke.drive * 0.055;
    gesture.headPitch = low ? 0.28 : -0.08 + stroke.drive * 0.12;
    out.crouch = (low ? 0.16 : 0.035) + stroke.drive * 0.055;
    out.lean = -stroke.retreat * 0.16 + stroke.drive * 0.32 + (low ? 0.22 : 0.05);
    out.twist = -stroke.retreat * 0.27 + stroke.drive * 0.19;
    out.toolAngle = 1.55 - stroke.retreat * 1.35;
    out.impact = stroke.impact * effort;
  } else if (kind === 'place' || kind === 'pack' || kind === 'finish') {
    const heavy = profile.material === 'masonry' ? 1.25 : 1;
    const press = smooth((t - 0.32) / 0.1) * (1 - smooth((t - 0.65) / 0.27));
    const aligned = placement * (1 - smooth((t - 0.76) / 0.24));
    gesture.reach = aligned;
    gesture.pullback = kind === 'pack' ? stroke.retreat * 0.13 : (1 - aligned) * 0.3;
    gesture.lift = kind === 'pack' ? stroke.retreat * 0.32 : (1 - aligned) * 0.18;
    gesture.side = kind === 'finish' ? Math.sin(t * Math.PI * 2) * 0.12 : 0;
    gesture.loadPlacement = placement;
    gesture.stance = 0.14 * heavy;
    gesture.headPitch = low ? 0.3 : 0.16;
    gesture.weight = press * 0.07;
    out.crouch = (low ? 0.19 : 0.055) + press * 0.08 * heavy;
    out.lean = 0.08 + press * 0.31 * heavy;
    out.twist = Math.sin(t * Math.PI * 2) * 0.07;
    out.impact = kind === 'pack' ? stroke.impact * 0.8 : stroke.impact * 0.6;
  } else if (kind === 'pickup') {
    const bend = smooth(t / 0.3) * (1 - smooth((t - 0.64) / 0.36));
    gesture.reach = bend;
    gesture.headPitch = bend * 0.4;
    gesture.stance = 0.14;
    out.crouch = bend * 0.26;
    out.lean = bend * 0.48;
    out.handY = 0.48 - bend * 0.34;
    out.handZ = 0.22 + bend * 0.22;
  } else if (kind === 'handoff' || kind === 'receive') {
    const extend = smooth(t / 0.35) * (1 - smooth((t - 0.73) / 0.27));
    gesture.reach = extend;
    gesture.loadPlacement = extend;
    gesture.stance = 0.12;
    gesture.headPitch = 0.16;
    out.handY = 0.5;
    out.handZ = 0.23 + extend * 0.3;
    out.lean = extend * 0.22;
    out.crouch = extend * 0.045;
  } else if (kind === 'carry') {
    out.lean = 0.12;
    out.handY = 0.45;
    out.handZ = 0.25;
    gesture.headPitch = 0.08;
  }
  out.construction = gesture;
}
