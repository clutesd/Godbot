import type { Vec2 } from '../../sim/types';
import type { MilitaryVisualStyle } from './MilitaryVisualLanguage';
import { attackPeriod, combatPose, figurePosition } from './CombatChoreography';

export const MAX_FORMATION_FIGURES = 20;
export const formationCount = (strength: number): number => strength > 0 ? Math.min(MAX_FORMATION_FIGURES, Math.max(3, Math.ceil(Math.sqrt(strength) * 3))) : 0;
export function presentationHash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  value = Math.imul(value ^ (value >>> 16), 2246822507);
  value = Math.imul(value ^ (value >>> 13), 3266489909);
  return (value ^ (value >>> 16)) >>> 0;
}
export type ExchangePhase = 'approach' | 'windup' | 'contact' | 'recoil' | 'recover';
export interface CombatExchange {
  readonly id: string;
  readonly slots: readonly [number, number];
  readonly initiative: 0 | 1;
  readonly delay: number;
  readonly offset: Vec2;
}
export interface CombatExchangePlan {
  readonly eventId: string;
  readonly front: Vec2;
  readonly yaw: number;
  readonly gap: number;
  readonly styles: readonly [MilitaryVisualStyle, MilitaryVisualStyle];
  readonly counts: readonly [number, number];
  readonly exchanges: readonly CombatExchange[];
}
export type WeaponPose = ReturnType<typeof combatPose>;
export interface CombatFigurePose {
  position: Vec2;
  yaw: number;
  pose: WeaponPose;
  targetDistance: number;
  exchangeId?: string;
}
const ranged = (style: MilitaryVisualStyle) => ['bow', 'rifle', 'automatic'].includes(style.weapon);

/** Stable one-to-one nearest-lane partners. Melee reserves never strike through front ranks.
 * No per-frame assignment, RNG, simulation entities, or world mutations. */
export function createCombatExchanges(eventId: string, front: Vec2, yaw: number, gap: number,
  styles: readonly [MilitaryVisualStyle, MilitaryVisualStyle], counts: readonly [number, number]): CombatExchangePlan {
  const exchanges: CombatExchange[] = [];
  const used = new Set<number>();
  const limits = styles.map((style, side) => Math.min(MAX_FORMATION_FIGURES, counts[side]!,
    ranged(styles[0]) && ranged(styles[1]) ? MAX_FORMATION_FIGURES : style.rankWidth));
  for (let a = 0; a < limits[0]!; a++) {
    const origin = figurePosition(front, yaw, gap, styles[0], 0, a);
    let target = -1, nearest = Infinity;
    for (let b = 0; b < limits[1]!; b++) {
      if (used.has(b)) continue;
      const point = figurePosition(front, yaw, gap, styles[1], 1, b);
      const distance = Math.hypot(point.x - origin.x, point.z - origin.z);
      if (distance < nearest) { nearest = distance; target = b; }
    }
    if (target < 0) break;
    used.add(target);
    const id = `${eventId}:exchange:${a}:${target}`;
    const seed = presentationHash(id);
    const lateral = ((seed >>> 8) % 101 / 100 - 0.5) * 0.04;
    const depth = ((seed >>> 16) % 101 / 100 - 0.5) * 0.04;
    exchanges.push({ id, slots: [a, target], initiative: (seed % 2) as 0 | 1, delay: (seed % 701) / 1000,
      offset: { x: Math.cos(yaw) * lateral + Math.sin(yaw) * depth, z: -Math.sin(yaw) * lateral + Math.cos(yaw) * depth } });
  }
  return { eventId, front: { ...front }, yaw, gap, styles, counts, exchanges };
}

export function exchangePhase(plan: CombatExchangePlan, exchange: CombatExchange, time: number) {
  const first = exchange.initiative, second = (1 - first) as 0 | 1;
  const firstDuration = attackPeriod(plan.styles[first]);
  const secondDuration = attackPeriod(plan.styles[second]);
  const local = Math.max(0, time - exchange.delay) % (firstDuration + secondDuration);
  const attacker = local < firstDuration ? first : second;
  const phaseTime = local < firstDuration ? local / firstDuration : (local - firstDuration) / secondDuration;
  const contact = ranged(plan.styles[attacker]) ? 0.65 : 0.38;
  const phase: ExchangePhase = phaseTime < 0.15 ? 'approach' : phaseTime < 0.3 ? 'windup'
    : phaseTime <= contact + 0.04 ? 'contact' : phaseTime < 0.82 ? 'recoil' : 'recover';
  return { attacker, target: (1 - attacker) as 0 | 1, phaseTime, phase, waiting: time < exchange.delay };
}

export function exchangeImpactAt(plan: CombatExchangePlan, exchange: CombatExchange, targetSide: number): number {
  const attacker = (1 - targetSide) as 0 | 1;
  return exchange.delay + (attacker === exchange.initiative ? 0 : attackPeriod(plan.styles[exchange.initiative]))
    + attackPeriod(plan.styles[attacker]) * (ranged(plan.styles[attacker]) ? 0.65 : 0.38);
}

export function exchangeFigurePose(plan: CombatExchangePlan, side: number, slot: number, time: number,
  active: boolean, reducedMotion: boolean): CombatFigurePose {
  const style = plan.styles[side]!;
  const position = figurePosition(plan.front, plan.yaw, plan.gap, style, side, slot);
  let yaw = plan.yaw + side * Math.PI;
  const exchange = plan.exchanges.find(item => item.slots[side] === slot);
  let pose = combatPose(style, slot, side, 0, false, reducedMotion);
  let targetDistance = plan.gap;
  if (exchange) {
    const targetSide = 1 - side;
    const target = figurePosition(plan.front, plan.yaw, plan.gap, plan.styles[targetSide]!, targetSide, exchange.slots[targetSide]!);
    position.x += exchange.offset.x; position.z += exchange.offset.z;
    target.x += exchange.offset.x; target.z += exchange.offset.z;
    yaw = Math.atan2(target.x - position.x, target.z - position.z);
    targetDistance = Math.hypot(target.x - position.x, target.z - position.z);
    const state = exchangePhase(plan, exchange, time);
    const attacking = active && !state.waiting && state.attacker === side && (ranged(style) || targetDistance <= (style.weapon === 'spear' ? 0.62 : 0.5));
    pose = combatPose(style, 0, 0, state.phaseTime * attackPeriod(style), attacking, reducedMotion);
    // A defender reacts only to this partner's threat, not an unrelated slot's clock.
    const threatStyle = plan.styles[state.attacker];
    const threatening = active && !state.waiting && state.attacker !== side && (ranged(threatStyle) || targetDistance <= (threatStyle.weapon === 'spear' ? 0.62 : 0.5));
    const brace = threatening && !reducedMotion ? Math.max(0, 1 - Math.abs(state.phaseTime - 0.38) / 0.2) : 0;
    pose.brace = brace;
    if (state.attacker !== side) { pose.lean = -brace * 0.15; pose.advance = -brace * 0.012; }
    if (attacking && !pose.ranged && !reducedMotion) {
      pose.advance += 0.012 * Math.min(1, state.phaseTime / 0.15) * Math.min(1, (1 - state.phaseTime) / 0.18);
      const tipLength = style.weapon === 'spear' ? 0.25 * Math.sin(pose.pitch) : 0.12 * Math.sin(pose.pitch);
      // Contact ends at the defender's shield/body surface, never at an arbitrary distance.
      const contactReach = Math.min(0.28, Math.max(0.07, targetDistance - 0.065 - tipLength - pose.advance));
      pose.reach = 0.07 + (contactReach - 0.07) * pose.attack;
    }
    // combatPose's generic opponent reaction is replaced by the paired threat above.
    if (state.attacker === side && !pose.ranged) pose.lean = pose.attack * 0.16;
  }
  position.x += Math.sin(yaw) * pose.advance;
  position.z += Math.cos(yaw) * pose.advance;
  return { position, yaw, pose, targetDistance, exchangeId: exchange?.id };
}
