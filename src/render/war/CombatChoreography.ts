import type { Vec2 } from '../../sim/types';
import type { MilitaryVisualStyle } from './MilitaryVisualLanguage';

/** World-space distances, independent of campaign route length. */
export function engagementGap(styles: readonly MilitaryVisualStyle[], mode?: unknown): number {
  if (mode === 'stand-off' || mode === 'combined-arms') return 3.2;
  if (mode === 'bombardment') return 2.8;
  return Math.max(...styles.map(s => s.weapon === 'automatic' ? 2.6 : s.weapon === 'rifle' ? 2.2 : s.weapon === 'bow' ? 1.6 : s.weapon === 'spear' ? 0.5 : 0.36));
}

export function figurePosition(front: Vec2, yaw: number, gap: number, style: MilitaryVisualStyle, side: number, slot: number): Vec2 {
  const rank = Math.floor(slot / style.rankWidth);
  // Stable slots: losses never recenter all the remaining soldiers.
  const lateral = (slot % style.rankWidth - (style.rankWidth - 1) / 2) * Math.max(0.22, style.lateralSpacing);
  const depth = (side === 0 ? -1 : 1) * (gap / 2 + rank * Math.max(0.28, style.depthSpacing));
  return { x: front.x + Math.cos(yaw) * lateral + Math.sin(yaw) * depth,
    z: front.z - Math.sin(yaw) * lateral + Math.cos(yaw) * depth };
}

function attackPeriod(style: MilitaryVisualStyle): number {
  return style.weapon === 'automatic' ? 0.72 : style.weapon === 'rifle' ? (style.doctrine === 'line' ? 3.2 : 1.6) : style.weapon === 'bow' ? 2.4 : 1.8;
}

function attackOffset(style: MilitaryVisualStyle, slot: number, side: number): number {
  return (style.doctrine === 'line' ? Math.floor(slot / style.rankWidth) * 0.22 : slot * 0.137) + side * 0.5;
}

/** First weapon contact in the event's local presentation clock. */
export function attackMoment(style: MilitaryVisualStyle, slot: number, side: number): number {
  return ((0.38 - attackOffset(style, slot, side)) % 1 + 1) % 1 * attackPeriod(style);
}

/** A bounded local pose; no random draws, integration, or simulation writes. */
export function combatPose(style: MilitaryVisualStyle, slot: number, side: number, time: number, active: boolean, reducedMotion: boolean) {
  const ranged = style.weapon === 'rifle' || style.weapon === 'automatic' || style.weapon === 'bow';
  const period = attackPeriod(style);
  const phase = ((time / period + attackOffset(style, slot, side)) % 1 + 1) % 1;
  const attack = active && !reducedMotion ? Math.max(0, 1 - Math.abs(phase - 0.38) / 0.13) : 0;
  const recoil = ranged ? attack : 0;
  return {
    attack, recoil, ranged,
    flash: active && !reducedMotion && style.weapon !== 'bow' && ranged && phase >= 0.36 && phase < 0.41,
    flight: active && !reducedMotion && ranged && phase >= 0.41 && phase < 0.65 ? (phase - 0.41) / 0.24 : -1,
    advance: ranged ? -recoil * 0.025 : attack * 0.035,
    lean: ranged ? -recoil * 0.13 : attack * 0.16 - (active && !reducedMotion && phase > 0.7 ? 0.06 : 0),
    pitch: style.weapon === 'spear' ? Math.PI / 2 - 0.08 : style.weapon === 'club' ? -0.8 + attack * 1.8 : style.weapon === 'bow' ? attack * 0.18 : -recoil * 0.12,
    reach: style.weapon === 'spear' ? 0.07 + attack * 0.12 : 0.07 + attack * 0.045,
  };
}
