import { stableHash } from '../prng';
import type { HistoricalEvent, SimulationState, WorldState } from '../types';
import { ashExposure, lavaExposure, lavaReach, volcanicWind, volcanoChannels } from './VolcanoFootprint';

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const MONTHS_PER_YEAR = 12;
const MIN_REST_YEARS = 200;
const MAX_REST_YEARS = 500;
/** Months of rising tremors and degassing before lava actually breaches the crater. */
const UNREST_MONTHS = 18;
const MIN_ERUPTION_MONTHS = 6;
const MAX_ERUPTION_MONTHS = 30;
/** Months for the crater to settle from peak activity back to dormant background venting. */
const COOLING_MONTHS = 24;
/** Quiet, ever-present degassing: the "semi-constant" smoke and glow the volcano never loses. */
const BASELINE_ACTIVITY = 0.16;
const RECOVERY_MONTHS = 120;

export type VolcanoPhase = 'dormant' | 'unrest' | 'erupting' | 'cooling';

export interface VolcanoState {
  readonly id: string;
  readonly worldX: number;
  readonly worldZ: number;
  readonly craterRadius: number;
  phase: VolcanoPhase;
  /** 0..1 smoothed drive for lava glow, flow speed and smoke/ash volume; never truly zero. */
  activity: number;
  nextEruptionMonth: number;
  eruptionStartMonth?: number;
  eruptionMonths: number;
  lastEruptionMonth?: number;
  totalEruptions: number;
  /** Serializable debt: restore only losses caused by ash, preserving other systems' changes. */
  deposits?: Array<{ cellIndex: number; fertilityLoss: number; habitabilityLoss: number; nutrients: number; months: number }>;
  lastAdvancedMonth?: number;
  coolingActivity?: number;
  affectedSettlementIds?: string[];
}

function restMonths(seed: string, index: number): number {
  const years = MIN_REST_YEARS + stableHash(`${seed}:volcano:rest:${index}`) * (MAX_REST_YEARS - MIN_REST_YEARS);
  return Math.round(years * MONTHS_PER_YEAR);
}

function eruptionMonths(seed: string, index: number): number {
  return Math.round(MIN_ERUPTION_MONTHS + stableHash(`${seed}:volcano:duration:${index}`) * (MAX_ERUPTION_MONTHS - MIN_ERUPTION_MONTHS));
}

/** The volcano lives at the highest viable dry summit chosen by world generation. */
export function createVolcano(world: WorldState, seed: string): VolcanoState | undefined {
  const vent = world.volcanicVent;
  if (!vent) return undefined;
  return {
    id: 'volcano-0',
    worldX: vent.worldX,
    worldZ: vent.worldZ,
    craterRadius: vent.craterRadius,
    phase: 'dormant',
    activity: BASELINE_ACTIVITY,
    nextEruptionMonth: restMonths(seed, 0),
    eruptionMonths: eruptionMonths(seed, 0),
    totalEruptions: 0,
  };
}

type VolcanoEvent = Omit<HistoricalEvent, 'id' | 'month'>;

function applyEruption(state: SimulationState, volcano: VolcanoState, seed: string): void {
  const channels = volcanoChannels(state.world, seed);
  const wind = volcanicWind(state.world, volcano.worldX, volcano.worldZ);
  const reach = lavaReach(volcano.activity);
  const affected = new Set(volcano.affectedSettlementIds ?? []);
  for (const settlement of state.settlements) {
    for (const plot of settlement.structurePlots ?? []) {
      const distance = Math.hypot(plot.worldX - volcano.worldX, plot.worldZ - volcano.worldZ);
      const lava = Math.max(clamp(1 - distance / volcano.craterRadius),
        lavaExposure(channels, plot.worldX, plot.worldZ, reach, plot.radius));
      const ash = ashExposure(plot.worldX - volcano.worldX, plot.worldZ - volcano.worldZ, volcano.craterRadius, wind);
      const damage = (lava * 0.16 + ash * 0.006) * volcano.activity;
      if (damage <= 0) continue;
      affected.add(settlement.id);
      plot.condition = Math.max(0, plot.condition - damage);
      plot.ashDepth = clamp((plot.ashDepth ?? 0) + ash * volcano.activity * 0.06);
      if (lava > 0) plot.scorch = clamp((plot.scorch ?? 0) + lava * volcano.activity * 0.2);
      plot.damagedMonth = state.month;
      if (plot.condition === 0 && plot.development && plot.development.status !== 'ruin') {
        const development = plot.development;
        development.status = 'ruin';
        development.history.push({ month: state.month, action: 'ruined', name: development.name, need: development.need,
          cultureId: development.cultureId, reasons: ['volcanic-eruption'] });
        development.history = development.history.slice(-12);
        development.transitionCount++;
        if (settlement.development) settlement.development.revision++;
      }
    }
  }
  const deposits = volcano.deposits ??= [];
  const byCell = new Map(deposits.map(deposit => [deposit.cellIndex, deposit]));
  for (let cellIndex = 0; cellIndex < state.world.cells.length; cellIndex++) {
    const cell = state.world.cells[cellIndex]!;
    if (cell.water) continue;
    const dose = ashExposure(cell.worldX - volcano.worldX, cell.worldZ - volcano.worldZ, volcano.craterRadius, wind) * volcano.activity;
    if (dose <= 0.001) continue;
    let deposit = byCell.get(cellIndex);
    if (!deposit) {
      deposit = { cellIndex, fertilityLoss: 0, habitabilityLoss: 0, nutrients: 0, months: RECOVERY_MONTHS };
      deposits.push(deposit);
      byCell.set(cellIndex, deposit);
    }
    const fertilityLoss = Math.min(cell.fertility, dose * 0.018);
    const habitabilityLoss = Math.min(cell.habitability, dose * 0.024);
    cell.fertility -= fertilityLoss;
    cell.habitability -= habitabilityLoss;
    deposit.fertilityLoss += fertilityLoss;
    deposit.habitabilityLoss += habitabilityLoss;
    deposit.nutrients = Math.min(0.12, deposit.nutrients + dose * 0.004);
    deposit.months = RECOVERY_MONTHS;
  }
  for (const settlement of state.settlements) {
    if (settlement.alive && byCell.has(settlement.cellIndex)) affected.add(settlement.id);
  }
  volcano.affectedSettlementIds = [...affected];
  state.world.environmentRevision = (state.world.environmentRevision ?? 0) + 1;
}

/** Ten-year recovery and mineral release, without resetting unrelated ecological damage. */
function recoverLand(state: SimulationState, volcano: VolcanoState): void {
  if (!volcano.deposits?.length && (volcano.lastEruptionMonth === undefined
    || state.month - volcano.lastEruptionMonth > RECOVERY_MONTHS)) return;
  for (const deposit of volcano.deposits ?? []) {
    const cell = state.world.cells[deposit.cellIndex];
    if (!cell || deposit.months <= 0) continue;
    const fraction = 1 / deposit.months;
    cell.fertility = clamp(cell.fertility + (deposit.fertilityLoss + deposit.nutrients) * fraction);
    cell.habitability = clamp(cell.habitability + deposit.habitabilityLoss * fraction);
    deposit.fertilityLoss *= 1 - fraction;
    deposit.habitabilityLoss *= 1 - fraction;
    deposit.nutrients *= 1 - fraction;
    deposit.months--;
  }
  if (volcano.deposits?.length) state.world.environmentRevision = (state.world.environmentRevision ?? 0) + 1;
  volcano.deposits = volcano.deposits?.filter(deposit => deposit.months > 0);
  for (const settlement of state.settlements) for (const plot of settlement.structurePlots ?? []) {
    if (plot.ashDepth) plot.ashDepth = Math.max(0, plot.ashDepth - 1 / RECOVERY_MONTHS);
  }
}

function announce(volcano: VolcanoState, significance: number, magnitude: number, tags: string[], summary: string, outcome: string): VolcanoEvent {
  return { type: 'natural-catastrophe', location: { x: volcano.worldX, z: volcano.worldZ }, locationId: volcano.id,
    actors: [volcano.id], causes: ['volcanic-eruption'], significance, magnitude, affectedPopulation: 0,
    context: { volcanoId: volcano.id, phase: volcano.phase, totalEruptions: volcano.totalEruptions },
    tags: ['volcano', ...tags], summary, outcome };
}

/** Runs every month. Dormant months still carry a faint, permanent plume; eruption is the rare spike. */
export function advanceVolcano(state: SimulationState, volcano: VolcanoState, seed: string): VolcanoEvent[] {
  const events: VolcanoEvent[] = [];
  const month = state.month;
  if (volcano.lastAdvancedMonth !== undefined && month <= volcano.lastAdvancedMonth) return events;
  volcano.lastAdvancedMonth = month;

  if (volcano.phase === 'dormant' && month >= volcano.nextEruptionMonth - UNREST_MONTHS) {
    volcano.phase = 'unrest';
    events.push(announce(volcano, 0.35, 0.2, ['unrest'],
      'Tremors ripple through the mountain and its vents thicken with sulfurous smoke.',
      'Rising tremors and thicker venting precede the coming eruption.'));
  }

  if (volcano.phase === 'unrest') {
    const unrestProgress = clamp(1 - (volcano.nextEruptionMonth - month) / UNREST_MONTHS);
    volcano.activity = BASELINE_ACTIVITY + unrestProgress * 0.3;
    if (month >= volcano.nextEruptionMonth) {
      volcano.phase = 'erupting';
      volcano.eruptionStartMonth = month;
      volcano.affectedSettlementIds = [];
      events.push(announce(volcano, 0.95, 0.85, ['eruption-begins'],
        'The volcano erupts, hurling ash skyward and sending lava down its flanks.',
        'Lava damages structures in its path; falling ash reduces soil productivity and habitability.'));
    }
  }
  if (volcano.phase === 'erupting') {
    const elapsed = month - (volcano.eruptionStartMonth ?? month);
    if (elapsed >= volcano.eruptionMonths) {
      volcano.phase = 'cooling';
      volcano.coolingActivity = volcano.activity;
      volcano.lastEruptionMonth = month;
      volcano.totalEruptions += 1;
      volcano.nextEruptionMonth = month + restMonths(seed, volcano.totalEruptions);
      volcano.eruptionMonths = eruptionMonths(seed, volcano.totalEruptions);
      events.push(announce(volcano, 0.7, 0.5, ['eruption-ends'],
        'The eruption subsides, leaving ash-darkened slopes that will enrich the soil for years to come.',
        'The mountain quiets; the surrounding land will recover and, in time, grow more fertile.'));
      for (const settlement of state.settlements) {
        if (settlement.alive && volcano.affectedSettlementIds?.includes(settlement.id)) settlement.disastersSurvived++;
      }
    } else {
      volcano.activity = Math.min(1, 0.54 + elapsed * 0.08);
      applyEruption(state, volcano, seed);
    }
  } else if (volcano.phase === 'cooling') {
    const progress = clamp((month - (volcano.lastEruptionMonth ?? month)) / COOLING_MONTHS);
    volcano.activity = BASELINE_ACTIVITY + ((volcano.coolingActivity ?? 1) - BASELINE_ACTIVITY) * (1 - progress);
    if (progress >= 1) {
      volcano.activity = BASELINE_ACTIVITY;
      volcano.phase = 'dormant';
    }
  } else if (volcano.phase === 'dormant') {
    volcano.activity = BASELINE_ACTIVITY;
  }
  if (volcano.phase !== 'erupting') recoverLand(state, volcano);
  for (const event of events) {
    if (event.tags.includes('unrest')) continue;
    const ids = new Set(volcano.affectedSettlementIds ?? []);
    event.actors.push(...ids);
    event.affectedPopulation = state.advanced.scale === 'modern-statistical'
      ? state.advanced.cities.filter(city => ids.has(city.settlementId)).reduce((sum, city) => sum + city.population, 0)
      : state.people.filter(person => person.alive && ids.has(person.homeId)).length;
    event.context = { ...event.context, affectedSettlements: ids.size };
  }
  return events;
}
