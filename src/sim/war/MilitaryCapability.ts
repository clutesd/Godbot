import { practical } from '../knowledge/KnowledgeSystem';
import type { Settlement, War } from '../types';

export type MilitaryRegime =
  | 'improvised'
  | 'organized-melee'
  | 'siege'
  | 'gunpowder'
  | 'industrial'
  | 'modern';

export type MilitaryPowerBase = 'muscle-fire' | 'workshop' | 'mechanical' | 'combustion' | 'electrical' | 'advanced-grid';

export type MilitaryEquipment =
  | 'clubs'
  | 'stone-spears'
  | 'torches'
  | 'bows'
  | 'shields'
  | 'metal-weapons'
  | 'metal-armour'
  | 'siege-engines'
  | 'gunpowder-weapons'
  | 'cannon'
  | 'rifles'
  | 'grenades'
  | 'artillery'
  | 'automatic-weapons'
  | 'motor-transport'
  | 'aircraft'
  | 'guided-missiles';

/**
 * A mobilization-time snapshot of what a settlement can actually field and sustain.
 * It is deliberately derived from lived knowledge, production, power and institutions rather
 * than from the calendar. Step 1 records capability; later combat passes may consume it.
 */
export interface MilitaryCapabilityProfile {
  regime: MilitaryRegime;
  powerBase: MilitaryPowerBase;
  equipment: MilitaryEquipment[];
  melee: number;
  ranged: number;
  protection: number;
  siege: number;
  firearms: number;
  artillery: number;
  mobility: number;
  communications: number;
  airPower: number;
  missile: number;
  production: number;
  energy: number;
  sustainment: number;
  institutionalSupport: number;
  overall: number;
}

export interface MilitaryCampaignSnapshot {
  militaryA: MilitaryCapabilityProfile;
  militaryB: MilitaryCapabilityProfile;
}

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
const mean = (values: readonly number[]): number => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const stock = (value: number, usefulAt: number): number => clamp(value / usefulAt);
const gate = (...values: number[]): number => values.length === 0 ? 0 : Math.min(...values.map(value => clamp(value)));
const blend = (...values: Array<readonly [number, number]>): number => clamp(values.reduce((sum, [value, weight]) => sum + clamp(value) * weight, 0));

function equipmentThreshold(equipment: MilitaryEquipment, score: number, threshold: number, result: MilitaryEquipment[]): void {
  if (score >= threshold && !result.includes(equipment)) result.push(equipment);
}

/**
 * Military power is not synonymous with electricity. Early armies are powered by bodies, food,
 * wood and workshop heat; mechanized forces become progressively dependent on concentrated power,
 * fuel, factories and grids. This makes advanced capability strong but materially conditional.
 */
export function deriveMilitaryProfile(settlement: Settlement): MilitaryCapabilityProfile {
  const fire = practical(settlement, 'fire-control');
  const stone = practical(settlement, 'stone-composites');
  const leverage = practical(settlement, 'leverage');
  const wheel = practical(settlement, 'wheel-axle');
  const iron = practical(settlement, 'iron-working');
  const records = practical(settlement, 'durable-records');
  const administration = practical(settlement, 'civic-administration');
  const precision = practical(settlement, 'precision-tools');
  const standardized = practical(settlement, 'standardized-parts');
  const chemistry = practical(settlement, 'chemical-reactions');
  const industrialChemistry = practical(settlement, 'industrial-chemistry');
  const precisionManufacturing = practical(settlement, 'precision-manufacturing');
  const mechanical = practical(settlement, 'mechanical-power');
  const improvedRoads = practical(settlement, 'improved-roads');
  const rail = practical(settlement, 'rail-transport');
  const combustion = practical(settlement, 'internal-combustion');
  const electricalGeneration = practical(settlement, 'electrical-generation');
  const electricGrid = practical(settlement, 'electric-grid');
  const massCommunication = practical(settlement, 'mass-communication');
  const computation = practical(settlement, 'computation');
  const automation = practical(settlement, 'automation');
  const aviation = practical(settlement, 'aviation');
  const rocketry = practical(settlement, 'rocketry');
  const satelliteSystems = practical(settlement, 'satellite-systems');
  const nuclearEnergy = practical(settlement, 'nuclear-energy');

  const food = stock(settlement.resources.food, 70);
  const wood = stock(settlement.resources.wood, 45);
  const minerals = stock(settlement.resources.minerals, 45);
  const goods = stock(settlement.resources.goods, 55);
  const wealth = stock(settlement.resources.wealth, 55);
  const workshops = clamp(settlement.infrastructure.workshops);
  const factories = clamp(settlement.infrastructure.factories);
  const grid = clamp(settlement.infrastructure.power);
  const industry = clamp(settlement.industry.intensity);
  const roads = clamp(settlement.infrastructure.roads);
  const railInfrastructure = clamp(settlement.infrastructure.rail);

  // Political power is the persistent, settlement-level evidence that institutions can organize
  // coercion and administration. This avoids inventing a timeless military bureaucracy.
  const institutionalSupport = blend(
    [settlement.politicalPower.military, 0.44],
    [settlement.politicalPower.institutional, 0.24],
    [settlement.politicalPower.council, 0.12],
    [administration, 0.20],
  );

  const workshopProduction = blend([workshops, 0.34], [stone, 0.12], [iron, 0.18], [precision, 0.14], [minerals, 0.1], [goods, 0.12]);
  const industrialProduction = blend([industry, 0.30], [factories, 0.26], [precisionManufacturing, 0.20], [industrialChemistry, 0.10], [goods, 0.08], [minerals, 0.06]);
  const production = clamp(Math.max(workshopProduction * 0.78, industrialProduction));

  const muscleFirePower = blend([settlement.foodSecurity, 0.35], [food, 0.2], [fire, 0.16], [wood, 0.12], [workshops, 0.08], [institutionalSupport, 0.09]);
  const workshopPower = gate(Math.max(fire, mechanical * 0.55), Math.max(workshops, 0.18), Math.max(wood, minerals * 0.7));
  const mechanicalPower = gate(mechanical, Math.max(workshops, factories * 0.8), Math.max(goods, minerals));
  const combustionPower = gate(combustion, Math.max(industry, 0.12), Math.max(goods, wealth * 0.75));
  const electricalPower = gate(Math.max(electricalGeneration, electricGrid), Math.max(grid, 0.08), Math.max(industry, factories));
  const advancedGridPower = gate(Math.max(electricGrid, nuclearEnergy), Math.max(grid, 0.2), Math.max(computation, automation * 0.8));
  const energy = clamp(Math.max(muscleFirePower * 0.62, workshopPower * 0.72, mechanicalPower * 0.82, combustionPower * 0.92, electricalPower, advancedGridPower));

  const powerCandidates: Array<readonly [MilitaryPowerBase, number]> = [
    ['muscle-fire', muscleFirePower],
    ['workshop', workshopPower],
    ['mechanical', mechanicalPower],
    ['combustion', combustionPower],
    ['electrical', electricalPower],
    ['advanced-grid', advancedGridPower],
  ];
  const powerBase = [...powerCandidates].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'muscle-fire';

  const sustainment = blend(
    [settlement.foodSecurity, 0.24],
    [settlement.prosperity, 0.12],
    [food, 0.14],
    [production, 0.16],
    [energy, 0.12],
    [Math.max(roads, improvedRoads), 0.10],
    [Math.max(rail, railInfrastructure), 0.05],
    [institutionalSupport, 0.07],
  );

  const primitiveMelee = blend([stone, 0.52], [wood, 0.16], [institutionalSupport, 0.12], [sustainment, 0.2]);
  const metalMelee = gate(iron, Math.max(minerals, 0.2), Math.max(workshops, 0.12));
  const melee = clamp(Math.max(0.18 + primitiveMelee * 0.54, metalMelee * 0.92 + precision * 0.08));

  const bowCapability = gate(Math.max(stone, 0.18), Math.max(leverage, 0.12), Math.max(wood, 0.2));
  const gunpowderBase = gate(Math.max(chemistry, industrialChemistry * 0.82), Math.max(precision, 0.22), Math.max(iron, 0.18), Math.max(minerals, 0.2), Math.max(workshops, 0.12));
  const industrialSmallArms = gate(precisionManufacturing, industrialChemistry, Math.max(factories, industry * 0.8), Math.max(goods, minerals), Math.max(energy, 0.28));
  const ranged = clamp(Math.max(bowCapability * 0.68, gunpowderBase * 0.8, industrialSmallArms));

  const shields = gate(Math.max(stone, iron * 0.85), Math.max(wood, minerals), Math.max(workshops, 0.08));
  const armour = gate(iron, Math.max(precision, 0.14), Math.max(minerals, 0.24), Math.max(workshops, 0.16));
  const protection = clamp(Math.max(shields * 0.58, armour * 0.94));

  const siege = gate(
    Math.max(leverage, wheel * 0.82),
    Math.max(stone, iron * 0.75),
    Math.max(wood, minerals * 0.72),
    Math.max(institutionalSupport, administration * 0.86),
    Math.max(workshops, 0.15),
  );

  const firearms = clamp(Math.max(gunpowderBase * 0.7, industrialSmallArms));
  const artillery = gate(
    Math.max(gunpowderBase, industrialChemistry),
    Math.max(iron, precisionManufacturing),
    Math.max(mechanical, factories),
    Math.max(production, 0.28),
    Math.max(energy, 0.22),
  );

  const motorMobility = gate(combustion, Math.max(industry, factories), Math.max(roads, improvedRoads), Math.max(goods, 0.25), Math.max(energy, 0.25));
  const railMobility = gate(rail, Math.max(railInfrastructure, 0.12), Math.max(industry, 0.2));
  const mobility = clamp(Math.max(0.12 + roads * 0.28 + wheel * 0.2, motorMobility, railMobility * 0.88));

  const communications = clamp(Math.max(
    records * 0.38 + administration * 0.22,
    massCommunication * 0.78 + electricGrid * 0.16,
    computation * 0.58 + massCommunication * 0.34 + satelliteSystems * 0.08,
  ) * (0.62 + institutionalSupport * 0.38));

  const airPower = gate(
    aviation,
    Math.max(combustion, electricalPower),
    Math.max(precisionManufacturing, 0.26),
    Math.max(industry, factories),
    Math.max(production, 0.28),
  );

  const missile = gate(
    rocketry,
    Math.max(computation, 0.28),
    Math.max(massCommunication, satelliteSystems * 0.86),
    Math.max(precisionManufacturing, 0.32),
    Math.max(electricalPower, advancedGridPower, 0.28),
    Math.max(production, 0.32),
  );

  const equipment: MilitaryEquipment[] = ['clubs'];
  equipmentThreshold('stone-spears', gate(stone, Math.max(wood, 0.18)), 0.15, equipment);
  equipmentThreshold('torches', gate(fire, Math.max(wood, 0.1)), 0.16, equipment);
  equipmentThreshold('bows', bowCapability, 0.22, equipment);
  equipmentThreshold('shields', shields, 0.22, equipment);
  equipmentThreshold('metal-weapons', metalMelee, 0.30, equipment);
  equipmentThreshold('metal-armour', armour, 0.38, equipment);
  equipmentThreshold('siege-engines', siege, 0.35, equipment);
  equipmentThreshold('gunpowder-weapons', gunpowderBase, 0.34, equipment);
  equipmentThreshold('cannon', gate(gunpowderBase, iron, Math.max(mechanical, leverage), Math.max(production, 0.24)), 0.38, equipment);
  equipmentThreshold('rifles', industrialSmallArms, 0.42, equipment);
  equipmentThreshold('grenades', gate(industrialChemistry, precisionManufacturing, Math.max(factories, industry), Math.max(production, 0.34)), 0.4, equipment);
  equipmentThreshold('artillery', artillery, 0.42, equipment);
  equipmentThreshold('automatic-weapons', gate(industrialSmallArms, standardized, Math.max(factories, 0.3), Math.max(energy, 0.34)), 0.44, equipment);
  equipmentThreshold('motor-transport', motorMobility, 0.38, equipment);
  equipmentThreshold('aircraft', airPower, 0.42, equipment);
  equipmentThreshold('guided-missiles', missile, 0.42, equipment);

  const regime: MilitaryRegime = equipment.includes('guided-missiles') || equipment.includes('aircraft') ? 'modern'
    : equipment.includes('automatic-weapons') || equipment.includes('rifles') || equipment.includes('artillery') ? 'industrial'
      : equipment.includes('gunpowder-weapons') || equipment.includes('cannon') ? 'gunpowder'
        : equipment.includes('siege-engines') ? 'siege'
          : equipment.includes('metal-weapons') || equipment.includes('bows') || equipment.includes('shields') ? 'organized-melee'
            : 'improvised';

  // Overall is documentary shorthand only in Step 1. The existing battle technology scalar remains
  // untouched until the dedicated combat-mechanics pass, avoiding an accidental balance rewrite.
  const overall = clamp(mean([melee, ranged, protection, siege, firearms, artillery, mobility, communications, airPower, missile, production, sustainment]));

  return {
    regime,
    powerBase,
    equipment,
    melee,
    ranged,
    protection,
    siege,
    firearms,
    artillery,
    mobility,
    communications,
    airPower,
    missile,
    production,
    energy,
    sustainment,
    institutionalSupport,
    overall,
  };
}

/** Renderer/historian access without making every consumer understand the campaign storage detail. */
export function militaryProfileForWar(war: War, side: 'attacker' | 'defender'): MilitaryCapabilityProfile | undefined {
  const campaign = war.campaign as typeof war.campaign & Partial<MilitaryCampaignSnapshot>;
  return side === 'attacker' ? campaign.militaryA : campaign.militaryB;
}

export function militaryEquipmentSummary(profile: MilitaryCapabilityProfile): string {
  return profile.equipment.join(', ');
}

/** Primitive-only snapshot ready to merge into HistoricalEvent.context in later/adjacent war code. */
export function militaryEventContext(war: War): Record<string, string | number | boolean> {
  const a = militaryProfileForWar(war, 'attacker');
  const b = militaryProfileForWar(war, 'defender');
  if (!a || !b) return {};
  return {
    militaryRegimeA: a.regime,
    militaryRegimeB: b.regime,
    militaryEquipmentA: militaryEquipmentSummary(a),
    militaryEquipmentB: militaryEquipmentSummary(b),
    militaryPowerA: a.powerBase,
    militaryPowerB: b.powerBase,
    militarySustainmentA: a.sustainment,
    militarySustainmentB: b.sustainment,
    militaryProductionA: a.production,
    militaryProductionB: b.production,
  };
}
