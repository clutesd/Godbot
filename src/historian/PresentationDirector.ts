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
export type CinematicTempo = 'accelerate' | 'observe' | 'focus' | 'linger';

export interface PresentationTelemetry {
  readonly monthsPerSecond: number;
  readonly yearsPerRealMinute: number;
  readonly mode: PresentationMode;
  readonly tempo: CinematicTempo;
  readonly holdSecondsRemaining: number;
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
  'institution-formed', 'alliance-formed', 'alliance-ended', 'war-campaign', 'war-ended', 'discovery', 'knowledge-adopted',
  'technology-transformation', 'technology-widespread', 'industrialization-stage', 'industrialization', 'infrastructure-built',
  'knowledge-lost', 'knowledge-rediscovered', 'recovery', 'cultural-shift', 'statistical-transition',
  'nuclear-energy', 'nuclear-medicine', 'nuclear-weapons-developed', 'nuclear-restraint', 'nuclear-disarmament',
  'machine-intelligence-transition', 'first-orbit', 'offworld-settlement', 'planetary-stability',
]);

const PERSONAL_KINDS = new Set<ObservationKind>(['worker-follow', 'traveler-follow', 'street-observation', 'discovery-scene']);
const CITY_KINDS = new Set<ObservationKind>(['street-observation', 'settlement-approach', 'city-growth-timelapse', 'institution-exterior', 'infrastructure-scene']);
const MOMENTOUS_KINDS = new Set<ObservationKind>(['battle-overview', 'aftermath-pullback', 'atomic-threshold', 'civilization-ending']);
const SIGNIFICANT_KINDS = new Set<ObservationKind>(['discovery-scene', 'infrastructure-scene', 'orbital-establishing']);

/**
 * Controls observer-time only. It never mutates authoritative simulation state.
 *
 * The director deliberately slows quickly and accelerates slowly: important history should feel
 * as though the Watcher noticed it, while quiet centuries are allowed to breathe into timelapse.
 */
export class PresentationDirector {
  monthsPerSecond: number;
  mode: PresentationMode = 'ordinary-life';
  private targetMonthsPerSecond: number;
  private quietSeconds = 0;
  private tempo: CinematicTempo = 'observe';
  private holdSecondsRemaining = 0;
  private lastFocusKey = '';
  private heldUrgency = 0;
  private readonly viewingSeconds: Record<PresentationMode, number> = { 'ordinary-life': 0, 'city-life': 0, 'major-event': 0, 'accelerated-quiet': 0 };

  constructor(private readonly config: GodboxConfig) {
    this.monthsPerSecond = config.presentation.ordinaryMonthsPerSecond;
    this.targetMonthsPerSecond = this.monthsPerSecond;
  }

  update(deltaSeconds: number, state: SimulationState, observation: PresentationObservation): number {
    const urgency = this.urgency(state, observation);
    const focusKey = `${observation.kind}:${observation.eventType ?? 'none'}:${observation.eventMonth ?? -1}`;

    // A new important observation earns a real-time viewing window. The simulation remains free
    // to advance, but presentation does not immediately snap back to deep-time acceleration.
    if (urgency > 0 && focusKey !== this.lastFocusKey) {
      this.lastFocusKey = focusKey;
      this.heldUrgency = urgency;
      this.holdSecondsRemaining = Math.max(this.holdSecondsRemaining, urgency >= 2 ? 11 : 6.5);
    }

    if (urgency === 0 && observation.interest < 0.48 && this.holdSecondsRemaining <= 0) this.quietSeconds += deltaSeconds;
    else this.quietSeconds = Math.max(0, this.quietSeconds - deltaSeconds * (urgency >= 2 ? 5 : 2.5));

    const directTarget = this.targetSpeed(state, observation);
    const heldTarget = this.heldUrgency >= 2
      ? this.config.presentation.momentousMonthsPerSecond
      : this.config.presentation.significantMonthsPerSecond;
    this.targetMonthsPerSecond = this.holdSecondsRemaining > 0
      ? Math.min(directTarget, heldTarget)
      : directTarget;

    this.holdSecondsRemaining = Math.max(0, this.holdSecondsRemaining - deltaSeconds);
    if (this.holdSecondsRemaining === 0 && urgency === 0) this.heldUrgency = 0;

    // Deceleration should feel responsive; returning to fast history should feel deliberate.
    const slowing = this.targetMonthsPerSecond < this.monthsPerSecond;
    const timeConstant = Math.max(
      0.18,
      this.config.presentation.transitionSeconds * (slowing ? 0.34 : 1.35),
    );
    const transition = 1 - Math.exp(-deltaSeconds / timeConstant);
    this.monthsPerSecond += (this.targetMonthsPerSecond - this.monthsPerSecond) * transition;

    this.mode = this.modeFor(observation, this.targetMonthsPerSecond);
    this.tempo = this.tempoFor(urgency, this.targetMonthsPerSecond);
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

    // Quiet, structurally simple worlds can cross deep time quickly. Complexity reduces the boost
    // before an event necessarily becomes the selected scene, producing a subtle anticipatory
    // slowdown around wars, clusters of milestones and mature industrial worlds.
    const depthBoost = 1 + (this.deepTimeFactor(state) - 1) * quietness;
    const accelerated = Math.min(
      this.config.presentation.quietMonthsPerSecond * this.config.presentation.deepTimeAcceleration,
      base * depthBoost,
    );

    const attention = this.attentionPressure(state, observation);
    if (attention <= 0.18) return accelerated;
    const attentiveCeiling = this.config.presentation.ordinaryMonthsPerSecond * (1 - attention * 0.58);
    return Math.max(
      this.config.presentation.significantMonthsPerSecond,
      Math.min(accelerated, attentiveCeiling),
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

  telemetry(): PresentationTelemetry {
    return {
      monthsPerSecond: Number(this.monthsPerSecond.toFixed(3)),
      yearsPerRealMinute: Number((this.monthsPerSecond * 5).toFixed(2)),
      mode: this.mode,
      tempo: this.tempo,
      holdSecondsRemaining: Number(this.holdSecondsRemaining.toFixed(2)),
      viewingSeconds: { ...this.viewingSeconds },
    };
  }

  private deepTimeFactor(state: SimulationState): number {
    const multiplier = Math.max(1, this.config.presentation.deepTimeAcceleration);
    return 1 + (multiplier - 1) * (1 - this.structuralComplexity(state));
  }

  /**
   * Soft pre-event pressure. This never predicts or invents history; it only notices that the
   * current authoritative world is becoming narratively dense before the Historian necessarily
   * selects a specific event shot.
   */
  private attentionPressure(state: SimulationState, observation: PresentationObservation): number {
    const activeWars = state.wars.filter((war) => war.active).length;
    let recentWeight = 0;
    for (let index = state.history.length - 1; index >= 0; index -= 1) {
      const event = state.history[index];
      if (!event) continue;
      // Initial settlement records describe the world at observation start; they are not an
      // approaching narrative beat and should not suppress deep-time acceleration.
      if (state.month === 0 && event.month === 0 && event.type === 'settlement-founded') continue;
      const age = state.month - event.month;
      if (age > Math.max(6, this.config.presentation.eventMemoryMonths)) break;
      if (event.significance >= 0.72) recentWeight += 0.22 * (1 - age / Math.max(1, this.config.presentation.eventMemoryMonths + 1));
    }
    return clamp(
      Math.max(0, observation.interest - 0.58) * 0.9
      + Math.min(0.45, activeWars * 0.18)
      + Math.min(0.55, recentWeight),
      0,
      1,
    );
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

  private tempoFor(urgency: number, target: number): CinematicTempo {
    if (this.holdSecondsRemaining > 0) return 'linger';
    if (urgency > 0 || target <= this.config.presentation.significantMonthsPerSecond * 1.15) return 'focus';
    if (target > this.config.presentation.ordinaryMonthsPerSecond * 1.15) return 'accelerate';
    return 'observe';
  }
}
