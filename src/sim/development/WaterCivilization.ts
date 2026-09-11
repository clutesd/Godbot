import type { Person, Settlement, SimulationState } from '../types';
import { practical, type KnowledgeEventDraft } from '../knowledge/KnowledgeSystem';
import { nearestIndex } from '../terrain/TerrainField';
import type { SettlementWaterState } from './types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

interface LocalHydrologySignal {
  surfaceAccess: number;
  flowingWater: number;
  standingWater: number;
}

function activeWaterService(settlement: Settlement): number {
  let service = 0;
  for (const plot of settlement.structurePlots ?? []) {
    const structure = plot.development;
    if (!structure || structure.status !== 'active' || plot.accessRestricted) continue;
    service += (structure.services.water ?? 0) * plot.condition;
  }
  return service;
}

function sampleLocalHydrology(state: SimulationState, settlement: Settlement): LocalHydrologySignal {
  const { world } = state;
  const { terrain } = world;
  const radius = world.cellSize * 1.7;
  let freshwater = 0;
  let flowing = 0;
  let standing = 0;
  let samples = 0;
  let maxFlow = 0;

  for (let z = -2; z <= 2; z += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const worldX = settlement.position.x + x / 2 * radius;
      const worldZ = settlement.position.z + z / 2 * radius;
      const index = nearestIndex(terrain, worldX, worldZ);
      samples += 1;
      if (terrain.height[index]! < world.seaLevel || terrain.waterLevel[index]! < 0) continue;
      freshwater += 1;
      const flow = terrain.flow[index]!;
      maxFlow = Math.max(maxFlow, flow);
      if (terrain.river[index]) flowing += 1;
      if (terrain.lake[index]) standing += 1;
    }
  }

  const wetFraction = freshwater / Math.max(1, samples);
  return {
    surfaceAccess: clamp01(wetFraction * 1.8 + maxFlow * 0.55 + standing / Math.max(1, samples) * 0.8),
    flowingWater: clamp01(flowing / Math.max(1, samples) * 3 + maxFlow * 0.65),
    standingWater: clamp01(standing / Math.max(1, samples) * 4),
  };
}

function foodStorageLimit(settlement: Settlement, population: number): number {
  return Math.max(180, population * 6 + settlement.buildings * 24);
}

/**
 * Couples canonical fine hydrology to settlement food, health, ecology and infrastructure demand.
 * This deliberately consumes terrain.waterLevel/flow rather than coarse WorldCell water flags.
 */
export function advanceSettlementWater(
  state: SimulationState,
  settlement: Settlement,
  residents: readonly Person[],
): KnowledgeEventDraft[] {
  if (!settlement.alive || residents.length === 0) return [];
  settlement.development ??= { pressures: {}, unmet: {}, informal: {}, providers: {}, evaluatedMonth: -12, nextAttemptMonth: state.month, revision: 0 };
  const previous = settlement.development.water;
  if (previous?.evaluatedMonth === state.month) return [];

  const cell = state.world.cells[settlement.cellIndex]!;
  const weather = state.weather.cells[settlement.cellIndex];
  const local = sampleLocalHydrology(state, settlement);
  const builtService = activeWaterService(settlement);
  const irrigationKnowledge = practical(settlement, 'irrigation');
  const contagionKnowledge = practical(settlement, 'contagion-patterns');
  const civicCapacity = practical(settlement, 'civic-administration');

  const runoffPulse = clamp01((weather?.runoff ?? 0) * 3.5);
  const soilAvailability = clamp01((cell.moisture - 0.12) / 0.68);
  const availability = clamp01(soilAvailability * 0.52 + local.surfaceAccess * 0.42 + runoffPulse * 0.18);
  const storageResilience = clamp01(builtService / 3.5);
  const reliability = clamp01(availability * 0.58 + local.flowingWater * 0.2 + local.standingWater * 0.12 + storageResilience * 0.34);
  const floodContamination = clamp01((weather?.floodDepth ?? 0) * 1.7 + (weather?.floodMonths ?? 0) * 0.035);
  const sanitationPotential = clamp01(contagionKnowledge * 0.52 + civicCapacity * 0.24 + storageResilience * 0.42);
  const quality = clamp01(0.86 - settlement.pollution * 0.48 - floodContamination * 0.46 + sanitationPotential * 0.32 + local.flowingWater * 0.05);
  const irrigation = clamp01(irrigationKnowledge * (0.36 + reliability * 0.46 + storageResilience * 0.36));
  const sanitation = clamp01(sanitationPotential * (0.55 + quality * 0.45));
  const droughtStress = clamp01(Math.max(0, 0.48 - availability) / 0.48 * 0.6 + Math.max(0, 0.52 - reliability) / 0.52 * 0.7);
  const droughtMonths = droughtStress > 0.38 ? (previous?.droughtMonths ?? 0) + 1 : Math.max(0, (previous?.droughtMonths ?? 0) - 1);

  const water: SettlementWaterState = {
    evaluatedMonth: state.month,
    availability,
    reliability,
    quality,
    irrigation,
    sanitation,
    droughtStress,
    floodContamination,
    surfaceAccess: local.surfaceAccess,
    builtService,
    droughtMonths,
    lastCrisisMonth: previous?.lastCrisisMonth,
    lastRecoveryMonth: previous?.lastRecoveryMonth,
  };
  settlement.development.water = water;

  // Separate productive output from household consumption so irrigation only changes production.
  const baselineConsumption = residents.length * (0.31 + settlement.urbanization * 0.018);
  const estimatedProduction = Math.max(0, settlement.monthlyBalance.food + baselineConsumption);
  const waterYieldFactor = Math.max(0.48, Math.min(1.24,
    0.78 + reliability * 0.15 + irrigation * 0.34 - droughtStress * 0.42 - floodContamination * 0.08));
  const foodDelta = estimatedProduction * (waterYieldFactor - 1);
  settlement.monthlyBalance.food += foodDelta;
  settlement.resources.food = Math.max(0, Math.min(foodStorageLimit(settlement, residents.length), settlement.resources.food + foodDelta));
  const monthsOfFood = settlement.resources.food / Math.max(1, residents.length * 0.31);
  settlement.foodSecurity = clamp01(monthsOfFood / 5 * 0.7 + (settlement.monthlyBalance.food >= 0 ? 0.3 : 0));

  settlement.climateStress = clamp01(settlement.climateStress * 0.9 + droughtStress * 0.2 + floodContamination * 0.06);
  const healthDelta = (quality - 0.62) * 0.003 + sanitation * 0.0015 - droughtStress * 0.0035 - floodContamination * 0.002;
  for (const person of residents) person.health = clamp01(person.health + healthDelta);

  // Drought slowly thins vegetation; reliable riparian water allows gradual recovery.
  if (droughtMonths >= 4 && droughtStress > 0.45) cell.wood = Math.max(0, cell.wood * (1 - droughtStress * 0.0018));
  else if (local.surfaceAccess > 0.35 && quality > 0.45) cell.wood = clamp01(cell.wood + (1 - cell.wood) * local.surfaceAccess * 0.00045);

  const events: KnowledgeEventDraft[] = [];
  if (droughtMonths === 6 && (water.lastCrisisMonth === undefined || state.month - water.lastCrisisMonth >= 60)) {
    water.lastCrisisMonth = state.month;
    events.push({
      type: 'harvest-crisis', location: settlement.position, locationId: settlement.id, actors: [settlement.id],
      causes: ['water-scarcity', 'hydrologic-drought'],
      context: { availability, reliability, droughtStress, droughtMonths, irrigation, builtService, surfaceAccess: local.surfaceAccess },
      outcome: 'Persistent water scarcity reduces harvest reliability and strains household reserves.',
      affectedPopulation: residents.length, magnitude: clamp01(0.45 + droughtStress * 0.45), significance: 0.66,
      tags: ['water', 'drought', 'scarcity', 'migration-pressure'], summary: `${settlement.name} enters a sustained water shortage.`,
    });
  }
  if ((previous?.droughtMonths ?? 0) >= 6 && droughtMonths <= 2 && reliability > 0.55
    && (water.lastRecoveryMonth === undefined || state.month - water.lastRecoveryMonth >= 60)) {
    water.lastRecoveryMonth = state.month;
    events.push({
      type: 'recovery', location: settlement.position, locationId: settlement.id, actors: [settlement.id],
      causes: ['restored-water-supply', storageResilience > 0.3 ? 'water-infrastructure' : 'hydrologic-recovery'],
      context: { availability, reliability, quality, irrigation, sanitation, builtService },
      outcome: 'Water supply stabilizes, easing pressure on crops and households.', affectedPopulation: residents.length,
      magnitude: clamp01(0.35 + reliability * 0.4), significance: 0.58, tags: ['water', 'recovery', 'resilience'],
      summary: `${settlement.name}'s water supply recovers after prolonged scarcity.`,
    });
  }
  return events;
}
