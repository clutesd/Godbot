import type { BattleImpact, BattleWeapon, HistoricalEvent, SimulationState, StructurePlot, Vec2, War } from '../types';
import { stableHash } from '../prng';
import { igniteStructure } from '../fire/StructureFireSystem';
import { militaryProfileForWar, type MilitaryCapabilityProfile } from './MilitaryCapability';
import { nuclearDamageRadius } from './BattleCasualties';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const explosiveWeapon = (weapon: BattleWeapon) => ['shell', 'missile', 'drone', 'nuclear'].includes(weapon);

/** Authored presentation timing in seconds, with no guidance or physical weapon model. */
export function battleImpactAt(weapon: BattleWeapon, side: number, index: number): number {
  if (weapon === 'missile') return 4.3 + side * 1.55 + index * 3.4;
  if (weapon === 'drone') return 5.6 + side * 1.3 + index * 0.68;
  if (weapon === 'nuclear') return side * 2.4 + 0.15;
  return (weapon === 'siege' ? 2.8 : weapon === 'shell' ? 2.2 : 0.65) + side * 0.7 + index * 1.8;
}

export function conventionalWeapon(profile: MilitaryCapabilityProfile | undefined, index = 0): BattleWeapon {
  const kit = profile?.equipment ?? [];
  if (kit.includes('guided-missiles') && (!kit.includes('drone-swarms') || index % 2 === 0)) return 'missile';
  if (kit.includes('drone-swarms')) return 'drone';
  if (kit.some(item => ['artillery', 'cannon', 'aircraft', 'grenades'].includes(item))) return 'shell';
  if (kit.includes('siege-engines')) return 'siege';
  if (kit.some(item => ['rifles', 'automatic-weapons', 'gunpowder-weapons', 'bows'].includes(item))) return 'projectile';
  return 'melee';
}

export function damageBattleStructure(plot: StructurePlot, impact: BattleImpact, eventId: string, month: number): void {
  const before = plot.condition;
  if (before <= 0 || impact.damage <= 0) return;
  plot.condition = impact.vaporized ? 0 : Math.max(0, before - impact.damage);
  if (plot.condition < 0.15) plot.condition = 0;
  impact.damage = before - plot.condition;
  impact.destroyed = plot.condition === 0;
  plot.damagedMonth = month;
  plot.accessRestricted = plot.condition < 0.65;
  plot.char = clamp((plot.char ?? 0) + impact.damage * 0.65);
  plot.scorch = clamp((plot.scorch ?? 0) + impact.damage);
  plot.destruction = { eventId, month, weapon: impact.weapon, beforeCondition: before, impactAt: impact.impactAt, vaporized: impact.vaporized };
  if (impact.vaporized) delete plot.fire;
  else if (impact.weapon !== 'projectile' && impact.weapon !== 'melee') {
    // A collapsed structure still has combustible debris. Ignition must precede its collapse.
    plot.condition = before;
    igniteStructure(plot, month, 'attack', 0.45 + impact.damage * 0.3);
    plot.condition = impact.destroyed ? 0 : before - impact.damage;
    plot.accessRestricted = true;
  }
  if (impact.destroyed && plot.development && plot.development.status !== 'ruin') {
    const d = plot.development;
    d.status = 'ruin'; d.transitionCount++;
    d.history.push({ month, action: 'ruined', name: d.name, need: d.need, cultureId: d.cultureId, reasons: ['war-destruction'] });
    d.history = d.history.slice(-12);
  }
}

/** Resolve once per real battle. Existing combat deaths are attributed, never charged twice. */
export function resolveBattleDestruction(state: SimulationState, war: War, event: HistoricalEvent): void {
  if (event.type !== 'battle' || !event.location || event.impacts) return;
  const impacts: BattleImpact[] = [];
  for (const side of [0, 1] as const) {
    const source = militaryProfileForWar(war, side ? 'defender' : 'attacker');
    const targetSettlement = state.settlements.find(s => s.id === (side ? war.attacker : war.defender));
    if (!targetSettlement) continue;
    const weapon = conventionalWeapon(source);
    const reach = weapon === 'missile' ? 20 : weapon === 'shell' ? 16 : weapon === 'drone' ? 14 : weapon === 'siege' ? 10 : 2;
    const count = weapon === 'missile' || weapon === 'shell' ? 2 : weapon === 'drone' || weapon === 'siege' ? 1 : 0;
    const candidates = (targetSettlement.structurePlots ?? []).filter(p => p.condition > 0 && (!p.development || p.development.status === 'active')
      && Math.hypot(p.worldX - event.location!.x, p.worldZ - event.location!.z) <= reach)
      .sort((a, b) => Math.hypot(a.worldX - event.location!.x, a.worldZ - event.location!.z)
        - Math.hypot(b.worldX - event.location!.x, b.worldZ - event.location!.z) || a.id.localeCompare(b.id));
    const weaponIndices = new Map<BattleWeapon, number>();
    for (const plot of candidates.slice(0, count)) {
      const selected = conventionalWeapon(source, impacts.length);
      const index = weaponIndices.get(selected) ?? 0; weaponIndices.set(selected, index + 1);
      const power = selected === 'missile' ? 0.9 : selected === 'shell' ? 0.65 : selected === 'drone' ? 0.48 : 0.38;
      const impact: BattleImpact = { targetId: plot.id, targetKind: 'structure', position: { x: plot.worldX, z: plot.worldZ }, side,
        weapon: selected, impactAt: battleImpactAt(selected, side, index), damage: power * (0.85 + stableHash(`${event.id}:${plot.id}`) * 0.3), destroyed: false, vaporized: false };
      damageBattleStructure(plot, impact, event.id, state.month); impacts.push(impact);
      if (targetSettlement.development) targetSettlement.development.revision++;
    }
  }
  event.impacts = impacts;
  attributeBattleDeaths(state, war, event);
  event.context.damagedStructures = impacts.filter(i => i.targetKind === 'structure').length;
  event.context.destroyedStructures = impacts.filter(i => i.targetKind === 'structure' && i.destroyed).length;
  const retained = state.aftermathEvents?.find(e => e.id === event.id);
  if (retained) { retained.impacts = structuredClone(impacts); Object.assign(retained.context, event.context); }
}

/** Attribute deaths after the simulation resolves exposure, before publishing the battle. */
export function attributeBattleDeaths(state: SimulationState, war: War, event: HistoricalEvent): void {
  const impacts = event.impacts ??= [];
  for (const side of [0, 1] as const) {
    const source = militaryProfileForWar(war, side ? 'defender' : 'attacker');
    const targetSettlement = state.settlements.find(s => s.id === (side ? war.attacker : war.defender));
    if (!targetSettlement) continue;
    const weaponIndices = new Map<BattleWeapon, number>();
    const victims = (state.bodies ?? []).filter(b => b.cause === 'war' && b.month === event.month
      && b.person.homeId === targetSettlement.id && !b.combatImpact);
    for (const body of victims) {
      const selected = conventionalWeapon(source, impacts.length);
      const index = weaponIndices.get(selected) ?? 0; weaponIndices.set(selected, index + 1);
      const structuralHit = impacts.filter(hit => hit.targetKind === 'structure')
        .find(hit => Math.hypot(hit.position.x - body.person.position.x, hit.position.z - body.person.position.z) < 2.5);
      const impact: BattleImpact = { targetId: body.id, targetKind: 'person', position: { ...body.person.position }, side,
        weapon: structuralHit?.weapon ?? selected, impactAt: structuralHit?.impactAt ?? battleImpactAt(selected, side, index % 3), damage: 1, destroyed: true, vaporized: false };
      body.combatImpact = { ...impact, eventId: event.id }; impacts.push(impact);
    }
  }
}

/** The strategic resolver already owns mortality. These local facts add identified physical
 * destruction and classify only its existing victims near the recorded detonation sites. */
export function resolveNuclearDestruction(state: SimulationState, eventId: string, sites: readonly Vec2[], hydrogen: boolean,
  victimIds?: ReadonlySet<string>): BattleImpact[] {
  const impacts: BattleImpact[] = [];
  const radius = nuclearDamageRadius(hydrogen);
  for (const settlement of state.settlements) for (const plot of settlement.structurePlots ?? []) {
    if (plot.condition <= 0) continue;
    const distances = sites.map(p => Math.hypot(plot.worldX - p.x, plot.worldZ - p.z));
    const distance = Math.min(...distances);
    if (distance > radius) continue;
    const side = (distances.indexOf(distance) % 2) as 0 | 1;
    const impact: BattleImpact = { targetId: plot.id, targetKind: 'structure', position: { x: plot.worldX, z: plot.worldZ }, side,
      weapon: 'nuclear', impactAt: battleImpactAt('nuclear', side, 0) + distance * 0.06,
      damage: Math.max(0.25, 1.4 - distance / radius), destroyed: false, vaporized: distance < radius * 0.3 };
    damageBattleStructure(plot, impact, eventId, state.month); impacts.push(impact);
    if (settlement.development) settlement.development.revision++;
  }
  for (const body of state.bodies ?? []) {
    if (body.month !== state.month || body.cause !== 'civilization-shock' || body.combatImpact) continue;
    if (victimIds && !victimIds.has(body.id)) continue;
    const distances = sites.map(p => Math.hypot(body.person.position.x - p.x, body.person.position.z - p.z));
    const distance = Math.min(...distances);
    if (distance > radius) continue;
    const side = (distances.indexOf(distance) % 2) as 0 | 1;
    const impact: BattleImpact = { targetId: body.id, targetKind: 'person', position: { ...body.person.position }, side,
      weapon: 'nuclear', impactAt: battleImpactAt('nuclear', side, 0) + distance * 0.06,
      damage: 1, destroyed: true, vaporized: distance < radius * 0.3 };
    body.combatImpact = { ...impact, eventId }; impacts.push(impact);
    if (impact.vaporized) body.removed = { month: state.month, reason: 'destruction', eventId };
  }
  return impacts;
}
