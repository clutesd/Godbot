import type { AgriculturalField, CropArchetype } from './types';
import type { Settlement, SimulationState, WeatherCellState, WorldCell } from '../types';
import { farmGeometries, type FarmGeometry } from '../../shared/FarmGeometry';
import { cellAt } from '../world';
import { practical } from '../knowledge/KnowledgeSystem';
import { clamp01 } from '../terrain/noise';
import { modifyLand, disturbForest, forestRecoveryTarget } from '../environment/EnvironmentalModificationSystem';
import { FREEZING } from '../weather/Precipitation';
import { resourceVisualUnit } from '../resources/ResourceWorkPresentation';

/** Coarse archetypes, normalized temperature/moisture units, monthly phenology; no plant agents. */
export const CROPS: Record<CropArchetype, { thermal: number; moisture: number; frost: number; heat: number; drought: number; waterlogging: number }> = {
  cereal: { thermal: 0.55, moisture: 0.46, frost: 0.36, heat: 0.79, drought: 1, waterlogging: 1 },
  root: { thermal: 0.65, moisture: 0.53, frost: 0.33, heat: 0.75, drought: 0.85, waterlogging: 1.25 },
  legume: { thermal: 0.5, moisture: 0.45, frost: 0.37, heat: 0.78, drought: 1.1, waterlogging: 1.1 },
  dryland: { thermal: 0.5, moisture: 0.32, frost: 0.38, heat: 0.9, drought: 0.55, waterlogging: 1.3 },
};

export function createField(id: string, cell: WorldCell, cellIndex: number, month: number): AgriculturalField {
  return { id, cellIndex, crop: 'cereal', stage: 'fallow', action: 'prepare', evaluatedMonth: month - 1,
    fallowSince: month, fallowMonths: 0, totalFallowMonths: 0, lastFallowMonths: 0, cultivationMonths: 0, cycles: 0, thermalTime: 0, biomass: 0,
    yieldPotential: 1, health: 1, soilMoisture: cell.moisture, fertility: cell.fertility,
    droughtStress: 0, waterlogging: 0, frostDamage: 0, heatDamage: 0, stormDamage: 0,
    irrigationDemand: 0, irrigationReceived: 0, harvestRemaining: 0, production: 0, labour: 0 };
}

export function fieldHarvestable(field: AgriculturalField): boolean {
  return field.stage === 'mature' && field.harvestRemaining > 1e-8 && field.health > 0.05
    && field.waterlogging < 0.65;
}

/** Reconcile only built plot geometry. Empty fields deliberately suppress legacy synthetic farms. */
export function ensureFields(state: SimulationState, settlement: Settlement): void {
  settlement.fields ??= [];
  const ids = new Set(settlement.fields.map(f => f.id));
  for (const geometry of farmGeometries(settlement).filter(g => g.source === 'plot' && g.workable)) {
    if (ids.has(geometry.id)) continue;
    const cell = cellAt(state.world, geometry.center.x, geometry.center.z) ?? state.world.cells[settlement.cellIndex]!;
    const index = state.world.cells.indexOf(cell);
    settlement.fields.push(createField(geometry.id, cell, index, state.month));
  }
}

function selectCrop(s: Settlement, f: AgriculturalField, cell: WorldCell): CropArchetype {
  if (practical(s, 'crop-selection') < 0.1) return 'cereal';
  if (f.previousCrop !== 'legume' && (cell.fertility < 0.5 || f.cycles % 3 === 2)) return 'legume';
  if (cell.moisture < 0.4) return 'dryland';
  if (cell.temperature < 0.48 && (cell.soil?.drainage ?? 0.5) > 0.5) return 'root';
  return 'cereal';
}

/** One crop/root-zone step. Reads weather's already infiltrated soil moisture, runoff and snow:
 * rain/melt are NOT added twice. Retention/drainage govern exchange with that soil reservoir. */
export function advanceField(f: AgriculturalField, cell: WorldCell, weather: WeatherCellState | undefined,
  s: Settlement, month: number, labour: number, area: number, waterBudget: number, workable = true): void {
  if (f.evaluatedMonth === month) return;
  f.evaluatedMonth = month; f.production = 0; f.labour = workable ? labour : 0;
  const crop = CROPS[f.crop];
  const temperature = weather?.temperature ?? cell.temperature;
  const soil = cell.soil;
  const drainage = soil?.drainage ?? 0.5, retention = soil?.retention ?? 0.5;
  const activeCrop = !['fallow', 'prepared', 'stubble'].includes(f.stage);
  const flood = weather?.floodDepth ?? 0;
  f.soilMoisture = clamp01(f.soilMoisture + (cell.moisture - f.soilMoisture) * (0.25 + drainage * 0.45)
    + flood * (1 - drainage) - (activeCrop ? 0.025 : 0.005) * (1 - retention * 0.7));
  f.irrigationDemand = activeCrop ? Math.max(0, crop.moisture - f.soilMoisture) : 0;
  f.irrigationReceived = workable && labour > 0 && practical(s, 'irrigation') > 0 && temperature > FREEZING
    && (weather?.snowpack ?? 0) < 0.12 && flood < 0.035 && (weather?.wind ?? 0) < 0.72 ? Math.min(f.irrigationDemand, Math.max(0, waterBudget)) : 0;
  f.soilMoisture = clamp01(f.soilMoisture + f.irrigationReceived);
  f.droughtStress = activeCrop ? clamp01((crop.moisture - f.soilMoisture) / crop.moisture) : 0;
  f.waterlogging = clamp01(Math.max(0, f.soilMoisture - 0.72) * (1 - drainage) * 4
    + flood * (1 - drainage) * 3);
  const safe = workable && labour > 0 && (weather?.snowpack ?? 0) < 0.12 && flood < 0.035
    && (weather?.wind ?? 0) < 0.8 && (weather?.blizzard ?? 0) < 0.5;
  const observation = practical(s, 'seasonal-observation') + practical(s, 'scientific-method') * 0.5;
  const warming = f.previousTemperature === undefined || temperature >= f.previousTemperature - 0.01;
  f.previousTemperature = temperature;
  const warm = temperature > FREEZING + (observation >= 0.1 ? 0.025 : 0.005);
  const suitable = warm && (observation < 0.1 || warming && f.soilMoisture >= crop.moisture * 0.65 && f.waterlogging < 0.3);
  const recovering = f.stage === 'fallow' || f.stage === 'stubble';
  // Area-weighted nutrient cycling writes existing soil authority; annual erosion stays in Environment.
  const share = Math.min(0.12, area / 100);
  if (recovering) {
    f.fallowMonths++; f.totalFallowMonths++; f.fallowSince ??= month;
    cell.fertility = clamp01(cell.fertility + Math.max(0, (soil?.parentFertility ?? 0.6) - cell.fertility) * 0.025 * share);
    f.action = 'recover';
    const rotationRest = practical(s, 'agrarian-surplus') > 0.15 && f.cycles % 3 === 0 ? 3 : 1;
    if (safe && suitable && f.fallowMonths >= rotationRest && cell.fertility > 0.2) {
      f.crop = selectCrop(s, f, cell); f.stage = 'prepared'; f.action = 'prepare';
      modifyLand(cell, 'farmland', share, month, s.id);
      const target = forestRecoveryTarget(cell);
      if (cell.wood > target) { disturbForest(cell, (cell.wood - target) / Math.max(0.01, cell.forestCapacity ?? 1), month); cell.wood = target; }
    } else if (safe && suitable) f.action = 'prepare';
  } else if (f.stage === 'prepared') {
    f.action = 'sow';
    if (safe && suitable) {
      f.stage = 'sown'; f.plantedMonth = month; f.fallowSince = undefined;
      f.lastFallowMonths = f.fallowMonths; f.fallowMonths = 0;
      f.thermalTime = 0; f.biomass = 0.025; f.health = 1; f.yieldPotential = 1;
      f.frostDamage = 0; f.heatDamage = 0; f.stormDamage = 0; f.harvestRemaining = 0;
    }
  } else {
    f.cultivationMonths++;
    const resilience = practical(s, 'crop-selection') * 0.12 + practical(s, 'biotechnology') * 0.3;
    const sensitive = f.stage === 'flowering' ? 2.5 : f.stage === 'sown' || f.stage === 'emerging' ? 1.3 : 0.7;
    const frost = Math.max(0, crop.frost - temperature) * (f.stage === 'flowering' ? 3 : 1.5);
    const heat = Math.max(0, temperature - crop.heat) * sensitive;
    const storm = ['windstorm', 'thunderstorm', 'hurricane', 'tornado'].includes(weather?.kind ?? '')
      ? Math.max(0, (weather?.wind ?? 0) - 0.55) * (weather?.intensity ?? 0) * (['filling', 'mature'].includes(f.stage) ? 0.65 : 0.2) : 0;
    f.frostDamage = clamp01(f.frostDamage + frost); f.heatDamage = clamp01(f.heatDamage + heat);
    f.stormDamage = clamp01(f.stormDamage + storm);
    const damage = (f.droughtStress * crop.drought * 0.12 * sensitive + f.waterlogging * crop.waterlogging * 0.18 + frost + heat + storm) * (1 - resilience);
    f.health = clamp01(f.health - damage);
    // Reproductive losses persist even after rain returns; no generic random crop damage.
    f.yieldPotential *= Math.max(0, 1 - damage * (f.stage === 'flowering' ? 1.8 : 0.65));
    const effort = Math.min(1, labour / Math.max(1, area * 1.5));
    if (temperature > FREEZING && (weather?.snowpack ?? 0) < 0.12) {
      f.thermalTime += 0.06 + Math.max(0, temperature - FREEZING) * 1.5;
      f.biomass = clamp01(f.biomass + 0.24 * f.health * (0.4 + cell.fertility * 0.6) * effort);
    }
    cell.fertility = clamp01(cell.fertility + share * (f.crop === 'legume' ? 0.008 : -0.004)
      * effort + share * practical(s, 'animal-husbandry') * effort * 0.002);
    // Chemical nutrients require existing goods, and consume them; no parallel inventory.
    const nutrients = Math.min(s.resources.goods, practical(s, 'industrial-chemistry') * effort * share * 0.05);
    s.resources.goods -= nutrients; cell.fertility = clamp01(cell.fertility + nutrients * 0.1);
    const wasMature = f.stage === 'mature';
    if (!wasMature) {
      const progress = f.thermalTime / crop.thermal;
      f.stage = progress < 0.12 ? 'emerging' : progress < 0.45 ? 'vegetative' : progress < 0.65 ? 'flowering' : progress < 1 ? 'filling' : 'mature';
      if (f.stage === 'mature') {
        f.matureMonth = month;
        f.harvestRemaining = area * 960 * f.biomass * f.health * f.yieldPotential;
      }
    }
    f.action = fieldHarvestable(f) ? 'harvest' : f.irrigationDemand > 0.03 && practical(s, 'irrigation') > 0.1 ? 'irrigate' : 'tend';
    if (wasMature) f.harvestRemaining *= Math.max(0, 1 - damage);
    if (wasMature && safe && fieldHarvestable(f)) {
      const machinery = practical(s, 'mechanical-power') * Math.min(1, s.materialEconomy?.energySupplied ?? 0);
      const capacity = labour * (12 + machinery * 8 + practical(s, 'animal-husbandry') * 2);
      const collected = Math.min(f.harvestRemaining, capacity);
      f.harvestRemaining -= collected;
      // Coordination protects collected crops in transit to the existing storage system.
      f.production = collected * (0.88 + practical(s, 'agrarian-surplus') * 0.1);
      if (f.harvestRemaining <= 1e-8) {
        f.stage = 'stubble'; f.harvestedMonth = month; f.previousCrop = f.crop;
        f.cycles++; f.fallowMonths = 0; f.fallowSince = month; f.action = 'recover';
      }
    } else if (wasMature) f.harvestRemaining *= Math.max(0, 0.95 - damage);
    if (f.health <= 0.05 || month - (f.plantedMonth ?? month) > 18) {
      f.stage = 'fallow'; f.harvestRemaining = 0; f.fallowSince = month; f.fallowMonths = 0; f.action = 'recover';
    }
    modifyLand(cell, 'farmland', share, month, s.id);
  }
  f.fertility = cell.fertility;
}

export function summarizeAgriculture(s: Settlement, month: number, labour: number): NonNullable<Settlement['agriculture']> {
  const fields = (s.fields ?? []).filter(f => f.evaluatedMonth === month);
  const allocated = fields.reduce((sum, f) => sum + f.labour, 0);
  const gatheringLabour = Math.max(0, labour - allocated);
  labour = allocated;
  const production = fields.reduce((sum, f) => sum + f.production, 0);
  return s.agriculture = { month, labour, gatheringLabour, production, yieldPerWorker: labour > 0 ? production / labour : 0,
    irrigation: fields.reduce((sum, f) => sum + f.irrigationReceived, 0) / Math.max(1, fields.length) };
}

export function advanceAgriculture(state: SimulationState, s: Settlement, labour: number): number {
  ensureFields(state, s);
  const geometries = farmGeometries(s);
  const workable = geometries.filter(g => g.workable);
  const weight = workable.reduce((sum, g) => sum + g.width * g.depth, 0);
  const water = s.development?.water;
  // One settlement delivery budget shared among fields, not a full allowance per plot.
  let budget = practical(s, 'irrigation') * (water?.irrigation ?? 0) * (water?.reliability ?? 0) * 0.4;
  for (const f of [...s.fields!].sort((a, b) => a.id.localeCompare(b.id))) {
    const geometry = geometries.find(g => g.id === f.id);
    const area = geometry ? geometry.width * geometry.depth : 1;
    const active = s.alive && !!geometry?.workable;
    if (!geometry || geometry.status !== 'active') {
      f.stage = 'fallow'; f.harvestRemaining = 0; f.fallowSince ??= state.month;
    }
    const need = fieldHarvestable(f) ? f.harvestRemaining / 12
      : ['fallow', 'stubble', 'prepared'].includes(f.stage) ? area * 0.4 : area * 1.5;
    const workers = active ? Math.min(need, labour * area / Math.max(0.01, weight)) : 0;
    const cell = state.world.cells[f.cellIndex]!;
    const weather = state.weather.cells[f.cellIndex];
    const plotFlood = s.structurePlots?.find(p => p.id === f.id)?.floodDepth ?? 0;
    const conditions = weather && plotFlood > weather.floodDepth ? { ...weather, floodDepth: plotFlood } : weather;
    advanceField(f, cell, conditions, s, state.month, workers, area, budget, active);
    budget = Math.max(0, budget - f.irrigationReceived);
  }
  // Fields sharing a soil cell all expose the final authoritative fertility.
  for (const f of s.fields!) f.fertility = state.world.cells[f.cellIndex]!.fertility;
  summarizeAgriculture(s, state.month, labour);
  return Math.max(0, labour - s.fields!.reduce((sum, f) => sum + f.labour, 0));
}

/** Stable assignment spreads farmers over equally urgent fields and prioritizes actual needs. */
export function farmerField(s: Settlement, personId: string): FarmGeometry | undefined {
  const geometries = farmGeometries(s).filter(g => g.workable);
  if (!s.fields) return geometries[0];
  const priority = (id: string): number => {
    const f = s.fields!.find(f => f.id === id);
    return !f ? -1 : fieldHarvestable(f) ? 5 : f.action === 'irrigate' ? 4 : f.action === 'sow' ? 3 : f.action === 'prepare' ? 2 : f.action === 'tend' ? 1 : 0;
  };
  const best = Math.max(-1, ...geometries.map(g => priority(g.id)));
  const candidates = geometries.filter(g => priority(g.id) === best && best >= 0).sort((a, b) => a.id.localeCompare(b.id));
  return candidates[Math.floor(resourceVisualUnit(`${personId}:field-assignment`) * candidates.length)];
}
