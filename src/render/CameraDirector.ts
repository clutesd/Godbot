import * as THREE from 'three';
import { campaignFocus } from '../sim/war/Campaign';
import type { GodboxConfig } from '../config';
import type { Historian } from '../historian/Historian';
import type { AudioCategory, HistorianStatement, ObservationCandidate, ObservationKind } from '../historian/types';
import type { SimulationState } from '../sim/types';

export interface CurrentObservation {
  label: string;
  detail: string;
  kind: ObservationKind;
  interest: number;
  audioCategory: AudioCategory;
  revision: number;
  statement?: HistorianStatement;
  eventType?: SimulationState['history'][number]['type'];
  eventMonth?: number;
}

interface Framing {
  radius: readonly [number, number];
  height: readonly [number, number];
  targetHeight: number;
  durationScale: number;
}

type CameraMotion = 'hold' | 'drift' | 'truck' | 'dolly-in' | 'dolly-out' | 'crane' | 'orbit' | 'follow' | 'pullback';

const FRAMING: Record<ObservationKind, Framing> = {
  'world-establishing': { radius: [46, 62], height: [42, 58], targetHeight: 1, durationScale: 1.25 },
  'regional-travel': { radius: [22, 31], height: [19, 28], targetHeight: 0.8, durationScale: 1.15 },
  'settlement-approach': { radius: [15, 22], height: [12, 19], targetHeight: 1.2, durationScale: 1 },
  'street-observation': { radius: [8, 13], height: [6, 10], targetHeight: 0.8, durationScale: 1.1 },
  'worker-follow': { radius: [8, 12], height: [6, 9], targetHeight: 0.6, durationScale: 1.12 },
  'traveler-follow': { radius: [10, 15], height: [8, 12], targetHeight: 0.7, durationScale: 1.08 },
  'institution-exterior': { radius: [10, 16], height: [8, 13], targetHeight: 1.2, durationScale: 1.24 },
  'discovery-scene': { radius: [8, 13], height: [6, 10], targetHeight: 0.9, durationScale: 1.35 },
  'battle-overview': { radius: [24, 34], height: [21, 31], targetHeight: 1, durationScale: 1.3 },
  'aftermath-pullback': { radius: [30, 42], height: [27, 39], targetHeight: 0.7, durationScale: 1.4 },
  'city-growth-timelapse': { radius: [20, 29], height: [17, 25], targetHeight: 1.4, durationScale: 1.35 },
  'night-transition': { radius: [27, 38], height: [24, 34], targetHeight: 0.8, durationScale: 1.18 },
  'infrastructure-scene': { radius: [9, 15], height: [7, 12], targetHeight: 0.8, durationScale: 1.25 },
  'landscape-pause': { radius: [30, 44], height: [28, 40], targetHeight: 0.6, durationScale: 1.18 },
  'atomic-threshold': { radius: [12, 18], height: [9, 14], targetHeight: 1.1, durationScale: 1.55 },
  'orbital-establishing': { radius: [48, 66], height: [48, 68], targetHeight: 0.6, durationScale: 1.55 },
  'civilization-ending': { radius: [46, 64], height: [42, 60], targetHeight: 0.7, durationScale: 1.7 },
  'historian-context': { radius: [32, 45], height: [30, 43], targetHeight: 0.8, durationScale: 1.3 },
};

const DOCUMENTARY_BREAK_TYPES = new Set([
  'discovery', 'knowledge-lost', 'knowledge-rediscovered', 'knowledge-adopted', 'technology-transformation', 'industrialization-stage', 'industrialization', 'infrastructure-built', 'archive-destroyed',
  'institution-formed', 'alliance-formed', 'alliance-ended', 'political-transition', 'leadership-succession', 'war-declared', 'war-campaign', 'battle', 'war-ended',
  'settlement-founded', 'settlement-abandoned', 'major-migration', 'first-contact', 'harvest-crisis', 'recovery', 'cultural-shift',
  'statistical-transition', 'atomic-threshold', 'nuclear-energy', 'nuclear-weapons-developed', 'nuclear-restraint', 'nuclear-crisis',
  'nuclear-use', 'nuclear-exchange', 'pandemic', 'ecological-crisis', 'climate-crisis', 'resource-crisis', 'autonomous-weapons-crisis',
  'machine-intelligence-transition', 'first-orbit', 'offworld-settlement', 'interplanetary-transition', 'fermi-question',
  'natural-catastrophe', 'civilization-collapse', 'planetary-stability', 'post-biological-transition', 'observation-lost', 'outcome-classified',
]);

/**
 * Documentary camera controller. Historical state remains authoritative; this class only decides
 * how the observer glides between and within scenes.
 */
export class CameraDirector {
  readonly observation: CurrentObservation = { label: 'The known world', detail: 'A new history begins.', kind: 'world-establishing', interest: 0.1, audioCategory: 'ambient-wilderness', revision: 0 };
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly shotBasePosition = new THREE.Vector3();
  private readonly shotBaseTarget = new THREE.Vector3();
  private readonly trackedFocus = new THREE.Vector3();
  private readonly workingDirection = new THREE.Vector3();
  private readonly workingTangent = new THREE.Vector3();
  private shotAge = 0;
  private shotDuration = 12;
  private currentScene?: ObservationCandidate;
  private currentMotion: CameraMotion = 'hold';
  private shotAzimuth = 0;
  private trackingInitialized = false;
  private readonly acknowledgedMajorEventIds = new Set<string>();
  private latestMajorEvent?: SimulationState['history'][number];
  private lastScannedHistoryLength = -1;
  private lastScannedMonth = -1;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly config: GodboxConfig, private readonly historian: Historian) {
    this.camera.position.set(38, 48, 52);
    this.lookTarget.set(0, 0, 0);
    this.camera.lookAt(this.lookTarget);
  }

  update(deltaSeconds: number, elapsedSeconds: number, state: SimulationState, elevationAt: (x: number, z: number) => number): void {
    this.shotAge += deltaSeconds;
    const majorEvent = this.findMajorEvent(state);
    const mayInterrupt = this.shotAge >= Math.max(6, this.config.camera.transitionSeconds * 1.1);
    if (!this.currentScene || (majorEvent && mayInterrupt)) {
      if (majorEvent) this.acknowledgedMajorEventIds.add(majorEvent.id);
      if (this.acknowledgedMajorEventIds.size > 2048) {
        const oldest = this.acknowledgedMajorEventIds.values().next().value as string | undefined;
        if (oldest) this.acknowledgedMajorEventIds.delete(oldest);
      }
      this.chooseShot(state, elevationAt, majorEvent?.id);
    } else if (this.shotAge >= this.shotDuration) {
      this.chooseShot(state, elevationAt);
    }

    this.animateShot(deltaSeconds, elapsedSeconds, state, elevationAt);

    // Critically damped-feeling exponential smoothing. Camera movement is tied to wall-clock time,
    // never simulation months, so deep historical acceleration does not make the camera race.
    const transitionRate = 3.15 / Math.max(0.5, this.config.camera.transitionSeconds);
    const positionSmoothing = 1 - Math.exp(-deltaSeconds * transitionRate);
    const targetSmoothing = 1 - Math.exp(-deltaSeconds * transitionRate * 1.22);
    this.camera.position.lerp(this.desiredPosition, positionSmoothing);
    this.lookTarget.lerp(this.desiredTarget, targetSmoothing);
    this.camera.position.y = Math.max(this.camera.position.y, elevationAt(this.camera.position.x, this.camera.position.z) + 2.6);
    this.lookTarget.y = Math.max(this.lookTarget.y, elevationAt(this.lookTarget.x, this.lookTarget.z) + 0.35);
    this.camera.lookAt(this.lookTarget);
  }

  current(): ObservationCandidate | undefined {
    return this.currentScene;
  }

  private chooseShot(state: SimulationState, elevationAt: (x: number, z: number) => number, focusEventId?: string): void {
    const scene = this.historian.chooseScene(state, focusEventId);
    this.currentScene = scene;
    this.shotAge = 0;
    this.trackingInitialized = false;
    const framing = FRAMING[scene.kind];
    const baseDuration = this.config.camera.shotSeconds[0] + (this.config.camera.shotSeconds[1] - this.config.camera.shotSeconds[0]) * (0.28 + scene.score * 0.45);
    this.currentMotion = this.motionFor(scene);
    const motionDurationScale = this.currentMotion === 'hold' ? 1.12 : this.currentMotion === 'pullback' ? 1.08 : 1;
    this.shotDuration = baseDuration * framing.durationScale * motionDurationScale;

    this.observation.label = scene.title;
    this.observation.detail = scene.statement.text;
    this.observation.kind = scene.kind;
    this.observation.interest = scene.interest;
    this.observation.audioCategory = scene.audioCategory;
    this.observation.statement = scene.statement;
    if (scene.event) {
      this.observation.eventType = scene.event.type;
      this.observation.eventMonth = scene.event.month;
    } else {
      delete this.observation.eventType;
      delete this.observation.eventMonth;
    }
    this.observation.revision += 1;

    const ground = elevationAt(scene.position.x, scene.position.z);
    this.shotAzimuth = this.stableAzimuth(scene.id);
    const radius = this.interpolate(framing.radius, 0.36 + scene.score * 0.4);
    const height = this.interpolate(framing.height, 0.42 + scene.interest * 0.32);
    this.shotBaseTarget.set(scene.position.x, ground + framing.targetHeight, scene.position.z);
    this.shotBasePosition.set(scene.position.x + Math.cos(this.shotAzimuth) * radius, ground + height, scene.position.z + Math.sin(this.shotAzimuth) * radius);
    this.desiredTarget.copy(this.shotBaseTarget);
    this.desiredPosition.copy(this.shotBasePosition);
    this.raiseForTerrain(elevationAt);
    this.shotBasePosition.copy(this.desiredPosition);
  }

  private animateShot(deltaSeconds: number, elapsedSeconds: number, state: SimulationState, elevationAt: (x: number, z: number) => number): void {
    const scene = this.currentScene;
    if (!scene) return;

    this.desiredPosition.copy(this.shotBasePosition);
    this.desiredTarget.copy(this.shotBaseTarget);

    const progress = Math.max(0, Math.min(1, this.shotAge / Math.max(0.001, this.shotDuration)));
    const eased = this.smoothstep(progress);

    const war = scene.statement.claims.warId ? state.wars.find(w => w.id === scene.statement.claims.warId) : undefined;
    if (war) {
      const a = state.settlements.find(s => s.id === war.attacker);
      const b = state.settlements.find(s => s.id === war.defender);
      if (a && b) {
        const focus = campaignFocus(war, a.position, b.position);
        const ground = elevationAt(focus.x, focus.z);
        this.smoothFocus(focus.x, ground + 0.5, focus.z, deltaSeconds, 1.6);
        const aftermath = war.resolvedMonth !== undefined;
        const baseRadius = aftermath ? 17 : war.phase === 'marching' ? 15 : 12;
        const radius = baseRadius + (aftermath ? eased * 7 : 0);
        const angle = this.shotAzimuth + (eased - 0.5) * (aftermath ? 0.16 : 0.26);
        this.desiredTarget.copy(this.trackedFocus);
        this.desiredPosition.set(
          this.trackedFocus.x + Math.cos(angle) * radius,
          Math.max(this.trackedFocus.y + (aftermath ? 16 + eased * 3 : 10), elevationAt(this.trackedFocus.x + Math.cos(angle) * radius, this.trackedFocus.z + Math.sin(angle) * radius) + 3),
          this.trackedFocus.z + Math.sin(angle) * radius,
        );
        this.raiseForTerrain(elevationAt);
        return;
      }
    }

    if (scene.kind === 'worker-follow' || scene.kind === 'traveler-follow' || scene.kind === 'discovery-scene') {
      const person = state.people.find((candidate) => candidate.alive && candidate.id === scene.subjectId);
      if (person) {
        const ground = elevationAt(person.position.x, person.position.z);
        this.smoothFocus(person.position.x, ground + 0.65, person.position.z, deltaSeconds, scene.kind === 'traveler-follow' ? 1.45 : 1.75);
        const followingDistance = scene.kind === 'traveler-follow' ? 12 : 9;
        const angle = this.shotAzimuth + Math.sin(elapsedSeconds * 0.11 + this.shotAzimuth) * 0.035;
        const x = this.trackedFocus.x + Math.cos(angle) * followingDistance;
        const z = this.trackedFocus.z + Math.sin(angle) * followingDistance;
        this.desiredTarget.copy(this.trackedFocus);
        this.desiredPosition.set(x, Math.max(this.trackedFocus.y + 6.2, elevationAt(x, z) + 2.8), z);
        this.raiseForTerrain(elevationAt);
        return;
      }
    }

    if (scene.kind === 'regional-travel') {
      const route = state.tradeRoutes.find((candidate) => candidate.id === scene.subjectId);
      const a = route ? state.settlements.find((settlement) => settlement.id === route.a) : undefined;
      const b = route ? state.settlements.find((settlement) => settlement.id === route.b) : undefined;
      if (route && a && b) {
        // Travel now moves monotonically through the shot instead of oscillating back and forth.
        const travelProgress = 0.08 + eased * 0.84;
        const x = THREE.MathUtils.lerp(a.position.x, b.position.x, travelProgress);
        const z = THREE.MathUtils.lerp(a.position.z, b.position.z, travelProgress);
        const ground = elevationAt(x, z);
        this.smoothFocus(x, ground + 0.65, z, deltaSeconds, 1.35);
        const angle = this.shotAzimuth;
        const cameraX = this.trackedFocus.x + Math.cos(angle) * 18;
        const cameraZ = this.trackedFocus.z + Math.sin(angle) * 18;
        this.desiredTarget.copy(this.trackedFocus);
        this.desiredPosition.set(cameraX, Math.max(this.trackedFocus.y + 14.5, elevationAt(cameraX, cameraZ) + 3), cameraZ);
        this.raiseForTerrain(elevationAt);
        return;
      }
    }

    this.applyCinematicMotion(this.currentMotion, eased, elapsedSeconds);
    this.raiseForTerrain(elevationAt);
  }

  private applyCinematicMotion(motion: CameraMotion, progress: number, elapsedSeconds: number): void {
    this.workingDirection.copy(this.shotBasePosition).sub(this.shotBaseTarget);
    const radius = Math.max(0.001, Math.hypot(this.workingDirection.x, this.workingDirection.z));
    this.workingDirection.normalize();
    this.workingTangent.set(-this.workingDirection.z, 0, this.workingDirection.x).normalize();

    switch (motion) {
      case 'hold': {
        // Almost still, with just enough organic breathing to avoid a frozen surveillance camera.
        const breath = Math.sin(elapsedSeconds * 0.16 + this.shotAzimuth) * 0.14;
        this.desiredPosition.addScaledVector(this.workingTangent, breath);
        break;
      }
      case 'drift': {
        const offset = (progress - 0.5) * 2.6;
        this.desiredPosition.addScaledVector(this.workingTangent, offset);
        this.desiredTarget.addScaledVector(this.workingTangent, offset * 0.18);
        break;
      }
      case 'truck': {
        const offset = (progress - 0.5) * 5.2;
        this.desiredPosition.addScaledVector(this.workingTangent, offset);
        this.desiredTarget.addScaledVector(this.workingTangent, offset * 0.28);
        break;
      }
      case 'dolly-in': {
        this.desiredPosition.addScaledVector(this.workingDirection, 3.2 - progress * 5.1);
        this.desiredPosition.y += (1 - progress) * 0.9;
        break;
      }
      case 'dolly-out': {
        this.desiredPosition.addScaledVector(this.workingDirection, progress * 5.8);
        this.desiredPosition.y += progress * 1.7;
        break;
      }
      case 'crane': {
        this.desiredPosition.y += (progress - 0.5) * 5;
        this.desiredPosition.addScaledVector(this.workingDirection, (progress - 0.5) * 1.6);
        break;
      }
      case 'orbit': {
        const angle = this.shotAzimuth + (progress - 0.5) * 0.32;
        this.desiredPosition.x = this.shotBaseTarget.x + Math.cos(angle) * radius;
        this.desiredPosition.z = this.shotBaseTarget.z + Math.sin(angle) * radius;
        break;
      }
      case 'pullback': {
        this.desiredPosition.addScaledVector(this.workingDirection, progress * 8.5);
        this.desiredPosition.y += progress * 3.6;
        break;
      }
      case 'follow':
        // Subject-follow shots are handled by their authoritative subject branches above.
        break;
    }
  }

  private smoothFocus(x: number, y: number, z: number, deltaSeconds: number, responsiveness: number): void {
    if (!this.trackingInitialized) {
      this.trackedFocus.set(x, y, z);
      this.trackingInitialized = true;
      return;
    }
    const amount = 1 - Math.exp(-deltaSeconds * responsiveness);
    this.trackedFocus.lerp(new THREE.Vector3(x, y, z), amount);
  }

  private motionFor(scene: ObservationCandidate): CameraMotion {
    const variation = this.stableUnit(`${scene.id}:motion`);
    switch (scene.kind) {
      case 'world-establishing': return variation < 0.55 ? 'drift' : 'orbit';
      case 'regional-travel': return 'follow';
      case 'settlement-approach': return 'dolly-in';
      case 'street-observation': return variation < 0.62 ? 'hold' : 'truck';
      case 'worker-follow':
      case 'traveler-follow':
      case 'discovery-scene': return 'follow';
      case 'institution-exterior': return variation < 0.55 ? 'hold' : 'truck';
      case 'battle-overview': return 'orbit';
      case 'aftermath-pullback': return 'pullback';
      case 'city-growth-timelapse': return variation < 0.5 ? 'crane' : 'orbit';
      case 'night-transition': return 'drift';
      case 'infrastructure-scene': return variation < 0.58 ? 'dolly-in' : 'drift';
      case 'landscape-pause': return variation < 0.7 ? 'hold' : 'drift';
      case 'atomic-threshold': return variation < 0.5 ? 'hold' : 'dolly-out';
      case 'orbital-establishing': return 'orbit';
      case 'civilization-ending': return 'pullback';
      case 'historian-context': return variation < 0.5 ? 'hold' : 'crane';
    }
  }

  /**
   * Keeps the camera above the ground and keeps the sightline clear. With real mountains between
   * the lens and the subject, clearing only the camera's own footprint is not enough.
   */
  private raiseForTerrain(elevationAt: (x: number, z: number) => number): void {
    this.desiredPosition.y = Math.max(this.desiredPosition.y, elevationAt(this.desiredPosition.x, this.desiredPosition.z) + 3);
    const samples = 8;
    for (let index = 1; index < samples; index += 1) {
      const amount = index / samples;
      const x = THREE.MathUtils.lerp(this.desiredPosition.x, this.desiredTarget.x, amount);
      const z = THREE.MathUtils.lerp(this.desiredPosition.z, this.desiredTarget.z, amount);
      const sight = THREE.MathUtils.lerp(this.desiredPosition.y, this.desiredTarget.y, amount);
      const clearance = elevationAt(x, z) + 1.6;
      if (clearance > sight) this.desiredPosition.y += (clearance - sight) / Math.max(0.15, 1 - amount);
    }
  }

  private findMajorEvent(state: SimulationState): SimulationState['history'][number] | undefined {
    if (this.lastScannedHistoryLength === state.history.length && this.lastScannedMonth === state.month) {
      return this.latestMajorEvent && !this.acknowledgedMajorEventIds.has(this.latestMajorEvent.id) ? this.latestMajorEvent : undefined;
    }

    this.latestMajorEvent = undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    const memoryMonths = Math.max(6, this.config.presentation.eventMemoryMonths);

    // Scan the whole presentation memory window. At high tick rates multiple authoritative months
    // can pass between rendered frames; a three-month window could otherwise skip a major event.
    for (let index = state.history.length - 1; index >= 0; index -= 1) {
      const event = state.history[index];
      if (!event) continue;
      const age = state.month - event.month;
      if (age > memoryMonths) break;
      if (event.month > state.month || event.significance < 0.72 || !DOCUMENTARY_BREAK_TYPES.has(event.type) || this.acknowledgedMajorEventIds.has(event.id)) continue;
      const recency = 1 - age / Math.max(1, memoryMonths);
      const score = event.significance * 1.6 + recency * 0.28;
      if (score > bestScore) {
        bestScore = score;
        this.latestMajorEvent = event;
      }
    }

    this.lastScannedHistoryLength = state.history.length;
    this.lastScannedMonth = state.month;
    return this.latestMajorEvent;
  }

  private smoothstep(value: number): number {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  private stableUnit(id: string): number {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) hash = Math.imul(31, hash) + id.charCodeAt(index) | 0;
    return (hash >>> 0) / 4_294_967_296;
  }

  private stableAzimuth(id: string): number {
    return this.stableUnit(id) * Math.PI * 2;
  }

  private interpolate(range: readonly [number, number], amount: number): number {
    return THREE.MathUtils.lerp(range[0], range[1], Math.max(0, Math.min(1, amount)));
  }
}
