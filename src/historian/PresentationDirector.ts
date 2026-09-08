import type { GodboxConfig } from '../config';
import type { HistoricalEventType, SimulationState } from '../sim/types';
import type { ObservationKind } from './types';

interface PresentationObservation {
  interest: number;
  kind: ObservationKind;
  eventType?: HistoricalEventType;
  eventMonth?: number;
}

export type PresentationMode = 'ordinary-life' | 'city-life' | 'major-event' | 'accelerated-quiet';

export interface PresentationTelemetry {
  readonly monthsPerSecond: number;
  readonly yearsPerRealMinute: number;
  readonly mode: PresentationMode;
  readonly viewingSeconds: Readonly<Record<PresentationMode, number>>;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const MOMENTOUS_EVENTS = new Set<HistoricalEventType>([
  'war-declared', 'battle', 'harvest-crisis', 'atomic-threshold', 'nuclear-crisis', 'nuclear-use', 'nuclear-exchange',
  'pandemic', 'ecological-crisis', 'climate-crisis', 'natural-catastrophe', 'civilization-collapse',
  'civilization-recovery', 'interplanetary-transition', 'post-biological-transition', 'observation-lost',
]);

const SIGNIFICANT_EVENTS = new Set<HistoricalEventType>([
  'settlement-founded', 'major-migration', 'first-contact', 'leadership-succession', 'political-transition',
  'institution-formed', 'alliance-formed', 'alliance-ended', 'war-ended', 'discovery', 'knowledge-adopted',
  'technology-transformation', 'technology-widespread', 'industrialization-stage', 'industrialization', 'infrastructure-built',
  'knowledge-lost', 'knowledge-rediscovered', 'recovery', 'cultural-shift', 'statistical-transition',
  'nuclear-energy', 'nuclear-medicine', 'nuclear-weapons-developed', 'nuclear-restraint', 'nuclear-disarmament',
  'machine-intelligence-transition', 'first-orbit', 'offworld-settlement', 'planetary-stability',
]);

const PERSONAL_KINDS = new Set<ObservationKind>(['worker-follow', 'traveler-follow', 'street-observation', 'discovery-scene']);
const CITY_KINDS = new Set<ObservationKind>(['street-observation', 'settlement-approach', 'city-growth-timelapse', 'institution-exterior', 'infrastructure-scene']);
const MOMENTOUS_KINDS = new Set<ObservationKind>(['battle-overview', 'aftermath-pullback', 'atomic-threshold', 'civilization-ending']);
const SIGNIFICANT_KINDS = new Set<ObservationKind>(['discovery-scene', 'infrastructure-scene', 'orbital-establishing']);

/** Controls presentation cadence only. It never mutates authoritative simulation state. */
export class PresentationDirector {
  monthsPerSecond: number;
  mode: PresentationMode = 'ordinary-life';
  private targetMonthsPerSecond: number;
  private quietSeconds = 0;
  private readonly viewingSeconds: Record<PresentationMode, number> = { 'ordinary-life': 0, 'city-life': 0, 'major-event': 0, 'accelerated-quiet': 0 };

  constructor(private readonly config: GodboxConfig) {
    this.monthsPerSecond = config.presentation.ordinaryMonthsPerSecond;
    this.targetMonthsPerSecond = this.monthsPerSecond;
  }

  update(deltaSeconds: number, state: SimulationState, observation: PresentationObservation): number {
    const urgency = this.urgency(state, observation);
    if (urgency === 0 && observation.interest < 0.48) this.quietSeconds += deltaSeconds;
    else this.quietSeconds = Math.max(0, this.quietSeconds - deltaSeconds * (urgency >= 2 ? 4 : 2));
    this.targetMonthsPerSecond = this.targetSpeed(state, observation);
    const slowing = this.targetMonthsPerSecond < this.monthsPerSecond;
    const timeConstant = Math.max(0.2, this.config.presentation.transitionSeconds * (slowing ? 0.55 : 1));
    const transition = 1 - Math.exp(-deltaSeconds / timeConstant);
    this.monthsPerSecond += (this.targetMonthsPerSecond - this.monthsPerSecond) * transition;
    this.mode = this.modeFor(observation, this.targetMonthsPerSecond);
    this.viewingSeconds[this.mode] += deltaSeconds;
    return this.monthsPerSecond;
  }

  targetSpeed(state: SimulationState, observation: PresentationObservation): number {
    const urgency = this.urgency(state, observation);
    if (urgency >= 2) return this.config.presentation.momentousMonthsPerSecond;
    if (urgency >= 1) return this.config.presentation.significantMonthsPerSecond;
    if (PERSONAL_KINDS.has(observation.kind)) return Math.min(this.config.presentation.personalMonthsPerSecond, this.config.presentation.ordinaryMonthsPerSecond);
    const quietRamp = this.config.presentation.quietRampSeconds <= 0 ? 1 : clamp(this.quietSeconds / this.config.presentation.quietRampSeconds, 0, 1);
    const quietness = clamp((0.5 - observation.interest) / 0.5, 0, 1);
    const base = this.config.presentation.ordinaryMonthsPerSecond
      + (this.config.presentation.quietMonthsPerSecond - this.config.presentation.ordinaryMonthsPerSecond) * quietRamp * quietness;
    // Adaptive temporal resolution: quiet, structurally simple worlds (a few foraging bands, no
    // wars, polities, industry, or recent milestones) move through deep historical time quickly;
    // complex periods fall back to fine observer-time steps. The boost only applies to genuinely
    // quiet scenes, so an interesting city view never masquerades as accelerated deep time.
    // Simulation rules never change here.
    const depthBoost = 1 + (this.deepTimeFactor(state) - 1) * quietness;
    return Math.min(
      this.config.presentation.quietMonthsPerSecond * this.config.presentation.deepTimeAcceleration,
      base * depthBoost,
    );
  }

  /** 0 = a quiet handful of foraging bands; 1 = wars, milestones, polities, and industry interacting. */
  structuralComplexity(state: SimulationState): number {
    const living = state.settlements.filter((settlement) => settlement.alive);
    const activeWars = state.wars.filter((war) => war.active).length;
    const industrial = living.filter((settlement) => settlement.industry.active).length;
    let recentMilestones = 0;
    for (let index = state.history.length - 1; index >= 0; index -= 1) {
      const event = state.history[index];
      if (!event || state.month - event.month > 24) break;
      if (event.significance >= 0.5) recentMilestones += 1;
    }
    return clamp(
      activeWars * 0.3
      + recentMilestones * 0.18
      + industrial * 0.25
      + state.polities.length * 0.1
      + Math.max(0, living.length - 4) * 0.04
      + clamp(state.advanced.machine.capability, 0, 1) * 0.2,
      0,
      1,
    );
  }

  /** Quiet worlds may run more months per frame; complex worlds get finer, smaller steps. */
  tickBudget(state: SimulationState): number {
    const base = Math.max(1, this.config.simulation.maxTicksPerFrame);
    const headroom = 1 + (1 - this.structuralComplexity(state)) * (Math.max(1, this.config.presentation.deepTimeAcceleration) - 1) * 0.5;
    return Math.max(2, Math.round(base * headroom));
  }

  private deepTimeFactor(state: SimulationState): number {
    const multiplier = Math.max(1, this.config.presentation.deepTimeAcceleration);
    return 1 + (multiplier - 1) * (1 - this.structuralComplexity(state));
  }

  telemetry(): PresentationTelemetry {
    return {
      monthsPerSecond: Number(this.monthsPerSecond.toFixed(3)),
      yearsPerRealMinute: Number((this.monthsPerSecond * 5).toFixed(2)),
      mode: this.mode,
      viewingSeconds: { ...this.viewingSeconds },
    };
  }

  private urgency(state: SimulationState, observation: PresentationObservation): number {
    if (MOMENTOUS_KINDS.has(observation.kind)) return 2;
    if (SIGNIFICANT_KINDS.has(observation.kind)) return 1;
    const eventType = observation.eventType;
    const eventAge = state.month - (observation.eventMonth ?? state.month);
    if (eventType && eventAge <= this.config.presentation.eventMemoryMonths) {
      if (MOMENTOUS_EVENTS.has(eventType)) return 2;
      if (SIGNIFICANT_EVENTS.has(eventType)) return 1;
    }
    return 0;
  }

  private modeFor(observation: PresentationObservation, target: number): PresentationMode {
    if (target <= this.config.presentation.significantMonthsPerSecond) return 'major-event';
    if (target > this.config.presentation.ordinaryMonthsPerSecond * 1.15) return 'accelerated-quiet';
    if (CITY_KINDS.has(observation.kind)) return 'city-life';
    return 'ordinary-life';
  }
}
