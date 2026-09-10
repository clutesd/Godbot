import { Simulation } from '../Simulation';
import type { HistoricalEvent, Settlement, SimulationState, War } from '../types';
import { deriveMilitaryProfile, militaryEventContext, militaryProfileForWar, type MilitaryCapabilityProfile } from './MilitaryCapability';
import { assessMilitaryCombat, militaryLogisticsBurden, militaryReplacement, militarySupplyCosts, type MilitaryCombatAssessment } from './MilitaryCombat';

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

interface RuntimeSimulation {
  state: SimulationState;
  runWars(): void;
  militaryStrength(settlement: Settlement): number;
  campaignDispatch(war: War, attacker: Settlement, defender: Settlement, dispatch: string, summary: string, causes: string[]): void;
}

interface PreparedWar {
  war: War;
  attacker: Settlement;
  defender: Settlement;
  militaryA: MilitaryCapabilityProfile;
  militaryB: MilitaryCapabilityProfile;
  assessment: MilitaryCombatAssessment;
  rawStrengthA: number;
  rawStrengthB: number;
  battleCount: number;
  historyLength: number;
}

let installed = false;

function profileFor(war: War, settlement: Settlement, side: 'attacker' | 'defender'): MilitaryCapabilityProfile {
  return militaryProfileForWar(war, side) ?? deriveMilitaryProfile(settlement);
}

function representedScale(state: SimulationState, settlement: Settlement): number {
  if (state.advanced.scale !== 'modern-statistical') return 1;
  const city = state.advanced.cities.find(candidate => candidate.settlementId === settlement.id);
  const represented = Math.max(1, city?.population ?? 1);
  const named = state.people.filter(person => person.alive && person.homeId === settlement.id).length;
  return named / represented;
}

function consumeMateriel(state: SimulationState, settlement: Settlement, profile: MilitaryCapabilityProfile, strength: number, phase: War['phase']): void {
  const costs = militarySupplyCosts(profile);
  const phaseRate = phase === 'battle' ? 0.014 : phase === 'marching' ? 0.009 : phase === 'mobilizing' ? 0.005 : 0.003;
  const demand = strength * representedScale(state, settlement) * phaseRate;
  settlement.resources.goods = Math.max(0, settlement.resources.goods - demand * costs.goods);
  settlement.resources.minerals = Math.max(0, settlement.resources.minerals - demand * costs.minerals);
  settlement.resources.wealth = Math.max(0, settlement.resources.wealth - demand * costs.wealth);
}

function readinessMultiplier(profile: MilitaryCapabilityProfile, casualtyPressureInflicted: number, defensiveWorks = 1): number {
  const pressure = Math.sqrt(clamp(casualtyPressureInflicted, 0.42, 3.2));
  return clamp((0.82 + (profile.overall * 0.12)) * pressure * defensiveWorks, 0.68, 2.25);
}

function augmentWarEvent(event: HistoricalEvent, prepared: PreparedWar): void {
  Object.assign(event.context, militaryEventContext(prepared.war), {
    engagementMode: prepared.assessment.engagementMode,
    militaryRangeA: Number(prepared.assessment.rangeA.toFixed(4)),
    militaryRangeB: Number(prepared.assessment.rangeB.toFixed(4)),
    militaryLethalityA: Number(prepared.assessment.lethalityA.toFixed(4)),
    militaryLethalityB: Number(prepared.assessment.lethalityB.toFixed(4)),
    militaryExposureA: Number(prepared.assessment.exposureA.toFixed(4)),
    militaryExposureB: Number(prepared.assessment.exposureB.toFixed(4)),
    militaryMismatchA: Number(prepared.assessment.mismatchA.toFixed(4)),
    militaryMismatchB: Number(prepared.assessment.mismatchB.toFixed(4)),
    defenderWorks: Number(prepared.assessment.defenderWorks.toFixed(4)),
    defenderWorksMultiplier: Number(prepared.assessment.defenderWorksMultiplier.toFixed(4)),
    attackerBreach: Number(prepared.assessment.breachA.toFixed(4)),
  });
}

/**
 * Installs the Step-2 conventional-war layer once the Simulation class has finished module
 * initialization. Campaign creation is the first safe call site in the existing dependency graph.
 * The wrapper deliberately preserves the established war state machine and RNG draw sequence:
 * it changes the physical meaning of strength/sustainment around each tick, then restores raw
 * manpower strength afterwards. This keeps the campaign system users already like intact while
 * making equipment, range, protection, logistics and technological mismatch consequential.
 */
export function installMilitaryCombatRuntime(): void {
  if (installed) return;
  installed = true;

  const prototype = Simulation.prototype as unknown as RuntimeSimulation;
  const legacyRunWars = prototype.runWars;
  if (typeof legacyRunWars !== 'function') throw new Error('Military combat integration could not locate Simulation.runWars');

  prototype.runWars = function capabilityDrivenRunWars(this: RuntimeSimulation): void {
    const prepared: PreparedWar[] = [];

    for (const war of this.state.wars.filter(candidate => candidate.active && candidate.resolvedMonth === undefined)) {
      const attacker = this.state.settlements.find(settlement => settlement.id === war.attacker);
      const defender = this.state.settlements.find(settlement => settlement.id === war.defender);
      if (!attacker?.alive || !defender?.alive) continue;

      const militaryA = profileFor(war, attacker, 'attacker');
      const militaryB = profileFor(war, defender, 'defender');
      const assessment = assessMilitaryCombat(militaryA, militaryB, defender);
      const currentA = deriveMilitaryProfile(attacker);
      const currentB = deriveMilitaryProfile(defender);
      const burdenA = militaryLogisticsBurden(militaryA);
      const burdenB = militaryLogisticsBurden(militaryB);
      // Advanced armies have more capability but also more systems that can fail when the home
      // economy can no longer replace equipment, ammunition and powered logistics.
      war.campaign.exhaustionA = clamp(war.campaign.exhaustionA + burdenA * (1 - militaryReplacement(currentA)) * 0.0025);
      war.campaign.exhaustionB = clamp(war.campaign.exhaustionB + burdenB * (1 - militaryReplacement(currentB)) * 0.0025);

      consumeMateriel(this.state, attacker, militaryA, war.strengthA, war.phase);
      consumeMateriel(this.state, defender, militaryB, war.strengthB, war.phase);

      const rawStrengthA = war.strengthA;
      const rawStrengthB = war.strengthB;
      // The legacy resolver reads one strength value for battlefield balance and casualty pressure.
      // Fold Step-2 lethality/protection into that temporary operational strength, then restore the
      // raw manpower-based value after the tick. Defender works are reduced by siege/artillery/air.
      war.strengthA = rawStrengthA * clamp(assessment.effectivenessA * readinessMultiplier(militaryA, assessment.casualtyPressureB), 0.62, 2.6);
      war.strengthB = rawStrengthB * clamp(assessment.effectivenessB * readinessMultiplier(militaryB, assessment.casualtyPressureA, assessment.defenderWorksMultiplier), 0.62, 2.75);

      prepared.push({
        war,
        attacker,
        defender,
        militaryA,
        militaryB,
        assessment,
        rawStrengthA,
        rawStrengthB,
        battleCount: war.campaign.battleCount,
        historyLength: this.state.history.length,
      });
    }

    legacyRunWars.call(this);

    for (const item of prepared) {
      const battleOccurred = item.war.campaign.battleCount > item.battleCount;
      // Legacy battle resolution may have removed real people/represented population. Recompute
      // raw strength only after such a loss; otherwise restore the exact pre-tick value.
      item.war.strengthA = battleOccurred && item.attacker.alive ? this.militaryStrength(item.attacker) : item.rawStrengthA;
      item.war.strengthB = battleOccurred && item.defender.alive ? this.militaryStrength(item.defender) : item.rawStrengthB;

      for (const event of this.state.history.slice(item.historyLength)) {
        if (!event.actors.includes(item.war.id)) continue;
        augmentWarEvent(event, item);
      }

      const mismatch = Math.max(item.assessment.mismatchA, item.assessment.mismatchB);
      if (mismatch > 0.28 && item.war.phase === 'battle' && !item.war.campaign.dispatches.includes('capability-mismatch')) {
        const advantaged = item.assessment.mismatchA >= item.assessment.mismatchB ? item.attacker : item.defender;
        const profile = advantaged.id === item.attacker.id ? item.militaryA : item.militaryB;
        this.campaignDispatch(
          item.war,
          item.attacker,
          item.defender,
          'capability-mismatch',
          `${advantaged.name}'s ${profile.regime.replaceAll('-', ' ')} force holds a material advantage in reach, protection, firepower or coordination.`,
          ['military-capability-gap'],
        );
        const dispatch = this.state.history.at(-1);
        if (dispatch?.actors.includes(item.war.id)) augmentWarEvent(dispatch, item);
      }
    }
  };
}
