import { fieldHarvestable } from '../../sim/agriculture/AgricultureSystem';
import type { CropArchetype, FieldAction } from '../../sim/agriculture/types';
import type { Person, Settlement, WeatherCellState } from '../../sim/types';
import { farmAnchor, farmDestinationMatches, type FarmGeometry } from '../../shared/FarmGeometry';
import { resourceVisualUnit } from '../../sim/resources/ResourceWorkPresentation';
import type { ResourceWorkMotion } from '../animation/ResourceWorkMotion';
import { workInterruption, type PhysicalActionPresentation } from '../people/PhysicalActionPresentation';

export type FarmStage = 'dormant' | 'prepared' | 'planted' | 'young' | 'growing' | 'mature' | 'harvest' | 'stubble' | 'damaged' | 'flooded' | 'snow';
export interface FarmPresentationState {
  stage: FarmStage;
  productive: boolean;
  harvestable: boolean;
  health: number;
  density: number;
  height: number;
  irrigation: number;
  output: number;
  blockedReason?: string;
  action?: FieldAction;
  crop?: CropArchetype;
  droughtStress?: number;
  stormDamage?: number;
}

/** Read-only projection of crop authority. The calendar fallback is exclusively for legacy
 * un-enrolled snapshots; fields (including an empty array) always take precedence. */
export function farmPresentationState(settlement: Settlement, month: number, weather?: WeatherCellState, fieldId?: string): FarmPresentationState {
  if (settlement.fields !== undefined) {
    const field = settlement.fields.find(f => f.id === fieldId) ?? (fieldId ? undefined : settlement.fields[0]);
    if (!field) return { stage: 'dormant', productive: false, harvestable: false, health: 1, density: 0, height: 0, irrigation: 0, output: 0, blockedReason: 'no-field-state' };
    const stages: Record<typeof field.stage, FarmStage> = { fallow: 'dormant', prepared: 'prepared', sown: 'planted',
      emerging: 'young', vegetative: 'growing', flowering: 'growing', filling: 'mature', mature: 'harvest', stubble: 'stubble' };
    let stage = stages[field.stage];
    if (field.health < 0.45 || field.droughtStress > 0.45 || field.stormDamage > 0.25) stage = 'damaged';
    if (field.waterlogging > 0.3 || (weather?.floodDepth ?? 0) > 0.035) stage = 'flooded';
    if ((weather?.snowpack ?? 0) > 0.12) stage = 'snow';
    const blockedReason = stage === 'snow' ? 'snow-covered' : stage === 'flooded' ? 'flooded-field'
      : (weather?.wind ?? 0) > 0.72 || (weather?.blizzard ?? 0) > 0.5 ? 'unsafe-weather' : undefined;
    const harvestable = fieldHarvestable(field) && !blockedReason;
    const height = field.stage === 'stubble' ? 0.018 : field.stage === 'sown' ? 0.01
      : Math.min(0.11, 0.015 + field.biomass * 0.095) * (1 - field.stormDamage * 0.75);
    return { stage, productive: settlement.alive && field.labour > 0, harvestable,
      health: field.health, density: ['fallow', 'prepared'].includes(field.stage) ? 0 : field.stage === 'stubble' ? 0.4 : field.biomass * field.health,
      height: stage === 'snow' || field.stage === 'fallow' || field.stage === 'prepared' ? 0 : height * (field.crop === 'root' ? 0.65 : field.crop === 'legume' ? 0.8 : 1),
      irrigation: field.irrigationReceived, output: field.production, blockedReason,
      action: field.action, crop: field.crop, droughtStress: field.droughtStress, stormDamage: field.stormDamage };
  }
  const agriculture = settlement.agriculture;
  const current = agriculture?.month === month;
  const output = current ? agriculture.production : 0;
  const health = Math.max(0, 1 - (weather?.cropDamage ?? 0));
  const productive = settlement.alive && current && agriculture.labour > 0.01 && output > 0.01;
  const yieldStrength = current ? Math.min(1, agriculture.yieldPerWorker / 1.5) : 0;
  const seasonal: FarmStage[] = ['dormant', 'prepared', 'planted', 'young', 'growing', 'mature', 'harvest', 'harvest', 'stubble', 'stubble', 'dormant', 'dormant'];
  let stage = seasonal[((month % 12) + 12) % 12]!;
  let blockedReason: string | undefined;
  if (!productive) { stage = 'dormant'; blockedReason = current ? 'no-farm-output' : 'no-current-agriculture'; }
  if (health < 0.45 || current && agriculture.yieldPerWorker < 0.15) stage = 'damaged';
  if ((weather?.snowpack ?? 0) > 0.12) { stage = 'snow'; blockedReason = 'snow-covered'; }
  if ((weather?.floodDepth ?? 0) > 0.035) { stage = 'flooded'; blockedReason = 'flooded-field'; }
  if (weather && (weather.wind > 0.72 || weather.blizzard > 0.5)) blockedReason = 'unsafe-weather';
  const harvestable = productive && stage === 'harvest' && health >= 0.65 && yieldStrength >= 0.25 && !blockedReason;
  const height = ({ dormant: 0, prepared: 0, planted: 0.01, young: 0.035, growing: 0.065, mature: 0.11,
    harvest: 0.11, stubble: 0.018, damaged: 0.025, flooded: 0.012, snow: 0 } satisfies Record<FarmStage, number>)[stage];
  return { stage, productive, harvestable, health, density: productive ? Math.min(health, yieldStrength) : 0,
    height, irrigation: agriculture?.irrigation ?? 0, output, blockedReason };
}

export function farmerCanPresent(person: Person, field: FarmGeometry, state: FarmPresentationState, weather?: WeatherCellState): boolean {
  return !workInterruption(person, weather) && person.activity === 'farm' && person.occupation === 'farmer'
    && person.role !== 'guard' && person.role !== 'soldier' && farmDestinationMatches(person, field)
    && state.productive && !state.blockedReason && (state.action !== undefined || state.stage !== 'dormant' && state.stage !== 'stubble');
}

/** Local time starts at approach; presentation clock is held during travel and orientation. */
export function sampleFarmAction(person: Person, field: FarmGeometry, state: FarmPresentationState, seconds: number,
  motion: ResourceWorkMotion): PhysicalActionPresentation {
  const duration = 4.8 + resourceVisualUnit(`${person.id}:farm-cadence`) * 1.8;
  const cycle = Math.max(0, seconds) / duration;
  const p = cycle % 1;
  const point = farmAnchor(field, person.id, Math.floor(cycle));
  const harvest = state.harvestable;
  const sow = state.action === 'sow' || !state.action && state.stage === 'planted';
  const irrigate = state.action === 'irrigate';
  const till = state.action === 'prepare' || !state.action && state.stage === 'prepared';
  const bend = smooth(p / 0.25) * (1 - smooth((p - 0.75) / 0.25));
  const reach = smooth((p - 0.18) / 0.22) * (1 - smooth((p - 0.5) / 0.22));
  const transfer = harvest ? smooth((p - 0.55) / 0.13) * (1 - smooth((p - 0.78) / 0.16)) : 0;
  motion.crouch = bend * (till ? 0.06 : 0.16);
  motion.lean = bend * 0.22; motion.twist = transfer * 0.2;
  motion.handY = 0.52 - reach * (till ? 0.12 : 0.4);
  motion.handZ = 0.2 + reach * 0.23;
  motion.toolAngle = 1.1 + reach * 1.15;
  motion.impact = p >= 0.4 && p < 0.48 ? Math.sin((p - 0.4) / 0.08 * Math.PI) : 0;
  motion.basket = irrigate ? reach : transfer; motion.reposition = p >= 0.96;
  return { personId: person.id, authoritativeActivity: person.activity, sourceAuthority: state.action ? 'settlement.fields + field destination' : 'settlement.agriculture + field destination',
    actionKind: harvest ? 'farm-harvest' : state.action === 'irrigate' ? 'farm-irrigate' : state.action === 'recover' ? 'farm-recover' : sow ? 'farm-sow' : till ? 'farm-prepare' : 'farm-tend',
    targetId: field.id, targetKind: 'field-row', interactionAnchor: point.target, locomotionTarget: point.anchor,
    phase: p < 0.18 ? 'prepare' : p < 0.4 ? 'reach' : p < 0.48 ? 'contact' : p < 0.8 ? harvest ? 'transfer' : 'cover' : 'recover',
    phaseProgress: p, activeTool: irrigate ? 'watering-vessel' : till || !sow && !harvest ? 'hoe' : 'none',
    carriedObject: irrigate ? 'water' : harvest && p >= 0.48 && p < 0.8 ? 'crop' : undefined, contactStrength: motion.impact };
}

function smooth(t: number): number { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); }
