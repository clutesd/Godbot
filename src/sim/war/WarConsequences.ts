import type { HistoricalEvent, Settlement, SimulationState, StructurePlot, War } from '../types';
import type { MilitaryCombatAssessment } from './MilitaryCombat';
import type { MilitaryCapabilityProfile } from './MilitaryCapability';

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

export interface WarDamageResult {
  damagedStructures: number;
  ruinedStructures: number;
  ignitedStructures: number;
  infrastructureDamage: number;
  severity: number;
}

function hashUnit(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4_294_967_296;
}

function destructiveReach(profile: MilitaryCapabilityProfile): number {
  return clamp(
    profile.siege * 0.16
    + profile.firearms * 0.08
    + profile.artillery * 0.34
    + profile.airPower * 0.25
    + profile.missile * 0.3,
  );
}

function orderedTargets(settlement: Settlement, war: War, battleCount: number): StructurePlot[] {
  return [...(settlement.structurePlots ?? [])]
    .filter(plot => plot.condition > 0.02)
    .sort((a, b) => hashUnit(`${war.id}:${battleCount}:${a.id}`) - hashUnit(`${war.id}:${battleCount}:${b.id}`));
}

function ignite(plot: StructurePlot, state: SimulationState, war: War, battleCount: number, chance: number): boolean {
  if (plot.fire || plot.condition <= 0.08 || hashUnit(`${war.id}:${battleCount}:${plot.id}:fire`) >= chance) return false;
  const fuel = clamp(0.35 + (1 - plot.condition) * 0.25 + hashUnit(`${plot.id}:fuel`) * 0.35, 0.25, 0.95);
  plot.fire = {
    cause: 'attack',
    startedMonth: state.month,
    age: 0,
    stage: 'ignition',
    intensity: clamp(0.22 + chance * 0.42, 0.18, 0.72),
    fuel,
    initialFuel: fuel,
    smoulderMonths: 0,
  };
  return true;
}

function damageInfrastructure(settlement: Settlement, severity: number): number {
  if (severity < 0.16) return 0;
  const infra = settlement.infrastructure;
  const before = infra.roads + infra.ports + infra.bridges + infra.workshops + infra.archives + infra.rail + infra.power + infra.factories;
  const soft = clamp(1 - severity * 0.08, 0.82, 1);
  const hard = clamp(1 - severity * 0.15, 0.68, 1);
  infra.roads *= soft;
  infra.ports *= soft;
  infra.bridges *= hard;
  infra.workshops *= hard;
  infra.archives *= clamp(1 - severity * 0.06, 0.86, 1);
  infra.rail *= hard;
  infra.power *= hard;
  infra.factories *= hard;
  const after = infra.roads + infra.ports + infra.bridges + infra.workshops + infra.archives + infra.rail + infra.power + infra.factories;
  return Math.max(0, before - after);
}

/**
 * Applies deterministic, simulation-owned physical consequences after an actual battle.
 * The renderer may visualize these fields, but never invents damage itself.
 */
export function applyBattlePhysicalConsequences(
  state: SimulationState,
  war: War,
  attacker: Settlement,
  defender: Settlement,
  militaryA: MilitaryCapabilityProfile,
  militaryB: MilitaryCapabilityProfile,
  assessment: MilitaryCombatAssessment,
): WarDamageResult {
  const battleCount = war.campaign.battleCount;
  const attackReach = destructiveReach(militaryA);
  const defenderReach = destructiveReach(militaryB);
  const combatIntensity = clamp((assessment.lethalityA + assessment.lethalityB) * 0.42 + battleCount * 0.035, 0.08, 1);
  const breach = clamp(assessment.breachA * 0.55 + attackReach * 0.7, 0, 1);
  const severity = clamp(combatIntensity * (0.18 + breach * 0.82), 0.04, 0.9);

  // Conventional campaigns concentrate damage around the defended settlement. Counter-fire can
  // scar the attacker too, but at a much smaller scale because the current campaign model does not
  // yet represent remote strategic bombing as an independent war phase.
  const targets = orderedTargets(defender, war, battleCount);
  const targetCount = Math.min(targets.length, Math.max(1, Math.round(targets.length * severity * 0.32)));
  let damagedStructures = 0;
  let ruinedStructures = 0;
  let ignitedStructures = 0;

  for (const plot of targets.slice(0, targetCount)) {
    const variance = 0.72 + hashUnit(`${war.id}:${battleCount}:${plot.id}:damage`) * 0.56;
    const loss = clamp(severity * variance * 0.48, 0.025, 0.58);
    const before = plot.condition;
    plot.condition = clamp(plot.condition - loss);
    plot.damagedMonth = state.month;
    plot.scorch = clamp((plot.scorch ?? 0) + severity * 0.35);
    if (plot.condition < before) damagedStructures += 1;
    if (before > 0.08 && plot.condition <= 0.08) ruinedStructures += 1;

    const incendiaryChance = clamp(
      0.025 + attackReach * 0.12 + militaryA.artillery * 0.08 + militaryA.airPower * 0.07 + militaryA.missile * 0.05,
      0,
      0.34,
    );
    if (ignite(plot, state, war, battleCount, incendiaryChance * severity)) ignitedStructures += 1;
  }

  // A limited amount of reciprocal damage represents camps, frontier structures and counter-fire.
  if (defenderReach > 0.18 && attacker.structurePlots?.length) {
    const reciprocal = orderedTargets(attacker, war, battleCount)[0];
    if (reciprocal && hashUnit(`${war.id}:${battleCount}:counterfire`) < defenderReach * combatIntensity * 0.18) {
      reciprocal.condition = clamp(reciprocal.condition - defenderReach * 0.12);
      reciprocal.damagedMonth = state.month;
      reciprocal.scorch = clamp((reciprocal.scorch ?? 0) + defenderReach * 0.12);
    }
  }

  const infrastructureDamage = damageInfrastructure(defender, severity);
  defender.prosperity = clamp(defender.prosperity - severity * 0.035);
  defender.conflictPressure = clamp(defender.conflictPressure + severity * 0.08);

  return { damagedStructures, ruinedStructures, ignitedStructures, infrastructureDamage, severity };
}

export function attachWarDamageContext(event: HistoricalEvent, damage: WarDamageResult): void {
  Object.assign(event.context, {
    warDamageSeverity: Number(damage.severity.toFixed(4)),
    warDamagedStructures: damage.damagedStructures,
    warRuinedStructures: damage.ruinedStructures,
    warIgnitedStructures: damage.ignitedStructures,
    warInfrastructureDamage: Number(damage.infrastructureDamage.toFixed(4)),
  });
}
