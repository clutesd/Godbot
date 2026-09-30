import { SeededRandom } from '../../src/sim/prng';
import { ResourceSystem } from '../../src/sim/resources/ResourceSystem';
import { addMaterial, publishBulkStocks } from '../../src/sim/resources/Inventory';
import type { ExtractionAccessibility } from '../../src/sim/resources/ExtractionAccessibility';
import { advanceProcessingFacilities, ensureProcessingAuthority, establishFacility } from '../../src/sim/processing/FacilitySystem';
import type { FacilityFamilyId, ProcessingFacility } from '../../src/sim/processing/types';
import type { LabourBudget } from '../../src/sim/resources/Processing';
import type { Settlement, SimulationState } from '../../src/sim/types';
import { infrastructureLabourBudget } from '../../src/sim/people/HumanCapital';
import { learn, societyFixture } from './settlementDevelopment';

/** Knowledge that opens every recipe the wood and metallurgy ladders run. */
export const WOOD_KNOWLEDGE = ['stone-composites', 'fire-control'] as const;
export const METAL_KNOWLEDGE = ['material-testing', 'combustion-dynamics', 'metal-smelting', 'iron-working', 'high-temperature-ceramics'] as const;
export const INDUSTRIAL_KNOWLEDGE = ['rotary-machinery', 'mechanical-power', 'precision-manufacturing', 'industrial-chemistry'] as const;

/** One isolated, fully staffed settlement with an empty store, ready to be enrolled in facility authority. */
export function processingWorld(seed = 'processing-facilities') {
  const { state, settlements } = societyFixture();
  const s = settlements[0]!;
  state.world.resourceDeposits = [];
  for (const town of settlements) {
    town.alive = town === s; town.localMaterials = {}; town.materialEconomy = undefined;
    town.discoveredDeposits = []; town.workedDeposits = []; town.knownRecipes = [];
    publishBulkStocks(town);
  }
  // Storage is not what these scenarios measure.
  s.buildings = 30;
  const random = new SeededRandom(seed);
  const system = new ResourceSystem(random);
  return { state, s, settlements, random, system };
}

export function stock(s: Settlement, materials: Record<string, number>): void {
  for (const [id, amount] of Object.entries(materials)) addMaterial(s, id, amount);
}

/** Advances one month of the real resource pipeline for the isolated settlement. */
export function step(state: SimulationState, system: ResourceSystem, months = 1): void {
  for (let i = 0; i < months; i++) {
    state.month += 1;
    ensureProcessingAuthority(state);
    system.advanceMonth(state);
  }
}

/** Places a finished facility and gives it the tools of its tier's trade; nothing is stocked. */
export function placeFacility(state: SimulationState, s: Settlement, family: FacilityFamilyId, tier: number): ProcessingFacility {
  ensureProcessingAuthority(state);
  learn(s, ...WOOD_KNOWLEDGE, ...METAL_KNOWLEDGE, ...INDUSTRIAL_KNOWLEDGE);
  const facility = establishFacility(state, s, family, tier, { origin: 'placed' });
  if (!facility) throw new Error('facility site unavailable');
  return facility;
}

/**
 * Runs exactly one month of the facility pipeline against an explicit crew, with the yards and
 * power state the scenario prepared. Bypasses extraction so a scenario controls every input.
 */
export function runFacilityMonth(
  state: SimulationState, s: Settlement, budget: LabourBudget, random: SeededRandom,
  options: { resolver?: ExtractionAccessibility; infrastructure?: number } = {},
) {
  state.month += 1;
  // Construction worker-months come from the shared infrastructure budget, fresh each month.
  infrastructureLabourBudget(state, s).remaining = options.infrastructure ?? 0;
  return advanceProcessingFacilities(state, s, { ...budget }, random, options.resolver);
}

export const CREW: LabourBudget = { artisan: 20, builder: 20, carrier: 20, forager: 10 };
