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

export class CameraDirector {
  readonly observation: CurrentObservation = { label: 'The known world', detail: 'A new history begins.', kind: 'world-establishing', interest: 0.1, audioCategory: 'ambient-wilderness', revision: 0 };
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly pullbackDirection = new THREE.Vector3();
  private shotAge = 0;
  private shotDuration = 12;
  private orbitPhase = 0;
  private currentScene?: ObservationCandidate;
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
    this.orbitPhase += deltaSeconds * 0.045;
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
    this.animateShot(elapsedSeconds, state, elevationAt);
    const transitionRate = 3.2 / Math.max(0.5, this.config.camera.transitionSeconds);
    const positionSmoothing = 1 - Math.exp(-deltaSeconds * transitionRate);
    const targetSmoothing = 1 - Math.exp(-deltaSeconds * transitionRate * 1.28);
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
    const framing = FRAMING[scene.kind];
    const baseDuration = this.config.camera.shotSeconds[0] + (this.config.camera.shotSeconds[1] - this.config.camera.shotSeconds[0]) * (0.28 + scene.score * 0.45);
    this.shotDuration = baseDuration * framing.durationScale;
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
    this.desiredTarget.set(scene.position.x, ground + framing.targetHeight, scene.position.z);
    const azimuth = this.stableAzimuth(scene.id);
    const radius = this.interpolate(framing.radius, 0.36 + scene.score * 0.4);
    const height = this.interpolate(framing.height, 0.42 + scene.interest * 0.32);
    this.desiredPosition.set(scene.position.x + Math.cos(azimuth) * radius, ground + height, scene.position.z + Math.sin(azimuth) * radius);
    this.raiseForTerrain(elevationAt);
  }

  private animateShot(elapsedSeconds: number, state: SimulationState, elevationAt: (x: number, z: number) => number): void {
    const scene = this.currentScene;
    if (!scene) return;
    const war = scene.statement.claims.warId ? state.wars.find(w => w.id === scene.statement.claims.warId) : undefined;
    if (war) {
      const a = state.settlements.find(s => s.id === war.attacker);
      const b = state.settlements.find(s => s.id === war.defender);
      if (a && b) {
        const focus = campaignFocus(war, a.position, b.position);
        const ground = elevationAt(focus.x, focus.z);
        const phase = this.stableAzimuth(war.id) + this.orbitPhase * 0.16;
        const aftermath = war.resolvedMonth !== undefined;
        const radius = aftermath ? 17 + Math.min(8, this.shotAge * 0.18) : war.phase === 'marching' ? 15 : 12;
        this.desiredTarget.set(focus.x, ground + 0.5, focus.z);
        this.desiredPosition.set(focus.x + Math.cos(phase) * radius, ground + (aftermath ? 16 : 10), focus.z + Math.sin(phase) * radius);
        this.raiseForTerrain(elevationAt);
        return;
      }
    }
    if (scene.kind === 'worker-follow' || scene.kind === 'traveler-follow' || scene.kind === 'discovery-scene') {
      const person = state.people.find((candidate) => candidate.alive && candidate.id === scene.subjectId);
      if (person) {
        const ground = elevationAt(person.position.x, person.position.z);
        const followingDistance = scene.kind === 'traveler-follow' ? 12 : 9;
        this.desiredTarget.set(person.position.x, ground + 0.65, person.position.z);
        this.desiredPosition.set(person.position.x + followingDistance, Math.max(ground + 6.5, elevationAt(person.position.x + followingDistance, person.position.z + followingDistance) + 2.8), person.position.z + followingDistance);
      }
    }
    if (scene.kind === 'regional-travel') {
      const route = state.tradeRoutes.find((candidate) => candidate.id === scene.subjectId);
      const a = route ? state.settlements.find((settlement) => settlement.id === route.a) : undefined;
      const b = route ? state.settlements.find((settlement) => settlement.id === route.b) : undefined;
      if (route && a && b) {
        const progress = (Math.sin(elapsedSeconds * 0.075) + 1) / 2;
        const x = THREE.MathUtils.lerp(a.position.x, b.position.x, progress);
        const z = THREE.MathUtils.lerp(a.position.z, b.position.z, progress);
        const ground = elevationAt(x, z);
        this.desiredTarget.set(x, ground + 0.65, z);
        this.desiredPosition.set(x + 18, Math.max(ground + 15, elevationAt(x + 18, z + 12) + 3), z + 12);
      }
    }
    if (scene.kind === 'city-growth-timelapse' || scene.kind === 'battle-overview' || scene.kind === 'night-transition' || scene.kind === 'orbital-establishing') {
      const framing = FRAMING[scene.kind];
      const radius = this.interpolate(framing.radius, 0.5);
      const ground = elevationAt(scene.position.x, scene.position.z);
      const phase = this.orbitPhase * (scene.kind === 'city-growth-timelapse' ? 0.7 : scene.kind === 'orbital-establishing' ? 0.22 : 0.48);
      this.desiredPosition.x = scene.position.x + Math.cos(phase) * radius;
      this.desiredPosition.z = scene.position.z + Math.sin(phase) * radius;
      this.desiredPosition.y = Math.max(ground + this.interpolate(framing.height, 0.52) + Math.sin(elapsedSeconds * 0.06), elevationAt(this.desiredPosition.x, this.desiredPosition.z) + 3);
    }
    if (scene.kind === 'aftermath-pullback' || scene.kind === 'civilization-ending') {
      const progress = Math.min(1, this.shotAge / Math.max(1, this.shotDuration));
      this.pullbackDirection.copy(this.desiredPosition).sub(this.desiredTarget).normalize();
      this.desiredPosition.addScaledVector(this.pullbackDirection, progress * 0.03);
      this.desiredPosition.y += progress * 0.015;
    }
    this.raiseForTerrain(elevationAt);
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
    for (let index = state.history.length - 1; index >= 0; index -= 1) {
      const event = state.history[index];
      if (!event || state.month - event.month > 3) break;
      if (event.month <= state.month && event.significance >= 0.72 && DOCUMENTARY_BREAK_TYPES.has(event.type) && !this.acknowledgedMajorEventIds.has(event.id)) {
        this.latestMajorEvent = event;
        break;
      }
    }
    this.lastScannedHistoryLength = state.history.length;
    this.lastScannedMonth = state.month;
    return this.latestMajorEvent;
  }

  private stableAzimuth(id: string): number {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) hash = Math.imul(31, hash) + id.charCodeAt(index) | 0;
    return ((hash >>> 0) / 4_294_967_296) * Math.PI * 2;
  }

  private interpolate(range: readonly [number, number], amount: number): number {
    return THREE.MathUtils.lerp(range[0], range[1], Math.max(0, Math.min(1, amount)));
  }
}
