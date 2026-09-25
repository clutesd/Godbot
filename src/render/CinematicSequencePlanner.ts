import type { ObservationCandidate, ObservationKind } from '../historian/types';
import type { SimulationState } from '../sim/types';

export type CinematicBeatRole = 'establish' | 'approach' | 'detail' | 'context' | 'release';

export interface CinematicPlannedShot {
  readonly scene: ObservationCandidate;
  readonly role: CinematicBeatRole;
  readonly sequenceId: string;
  readonly ordinal: number;
  readonly total: number;
}

interface SequenceScoredCandidate {
  scene: ObservationCandidate;
  role: CinematicBeatRole;
  score: number;
}

const WIDE_KINDS = new Set<ObservationKind>([
  'world-establishing', 'regional-travel', 'settlement-approach', 'battle-overview',
  'aftermath-pullback', 'city-growth-timelapse', 'landscape-pause', 'historian-context',
  'orbital-establishing', 'civilization-ending',
]);

const PERSONAL_KINDS = new Set<ObservationKind>([
  'street-observation', 'worker-follow', 'traveler-follow', 'discovery-scene',
]);

const CONTEXT_KINDS = new Set<ObservationKind>([
  'institution-exterior', 'infrastructure-scene', 'city-growth-timelapse',
  'historian-context', 'landscape-pause',
]);

const RELEASE_KINDS = new Set<ObservationKind>([
  'regional-travel', 'landscape-pause', 'aftermath-pullback', 'historian-context',
]);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function distance(a: ObservationCandidate, b: ObservationCandidate): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}

function roleFor(kind: ObservationKind): CinematicBeatRole {
  if (PERSONAL_KINDS.has(kind)) return 'detail';
  if (RELEASE_KINDS.has(kind)) return 'release';
  if (CONTEXT_KINDS.has(kind)) return 'context';
  if (WIDE_KINDS.has(kind)) return kind === 'settlement-approach' ? 'approach' : 'establish';
  return 'context';
}

function kindContrast(previous: ObservationKind | undefined, next: ObservationKind): number {
  if (!previous) return 0.5;
  const previousPersonal = PERSONAL_KINDS.has(previous);
  const nextPersonal = PERSONAL_KINDS.has(next);
  const previousWide = WIDE_KINDS.has(previous);
  const nextWide = WIDE_KINDS.has(next);
  if (previousPersonal !== nextPersonal) return 1;
  if (previousWide !== nextWide) return 0.82;
  return previous === next ? 0.1 : 0.46;
}

function rolePreference(role: CinematicBeatRole, kind: ObservationKind): number {
  switch (role) {
    case 'establish':
      return WIDE_KINDS.has(kind) ? 1 : CONTEXT_KINDS.has(kind) ? 0.58 : 0.16;
    case 'approach':
      return kind === 'settlement-approach' ? 1
        : kind === 'institution-exterior' || kind === 'infrastructure-scene' ? 0.78
          : PERSONAL_KINDS.has(kind) ? 0.45 : 0.22;
    case 'detail':
      return PERSONAL_KINDS.has(kind) ? 1
        : kind === 'institution-exterior' || kind === 'infrastructure-scene' ? 0.48 : 0.12;
    case 'context':
      return CONTEXT_KINDS.has(kind) ? 1
        : WIDE_KINDS.has(kind) ? 0.56 : 0.28;
    case 'release':
      return RELEASE_KINDS.has(kind) ? 1
        : WIDE_KINDS.has(kind) ? 0.68 : 0.18;
  }
}

function targetRoles(anchor: ObservationCandidate): readonly CinematicBeatRole[] {
  if (anchor.event?.type === 'battle' || anchor.kind === 'battle-overview') {
    return ['establish', 'detail', 'context', 'release'];
  }
  if (PERSONAL_KINDS.has(anchor.kind)) {
    return ['approach', 'detail', 'context', 'release'];
  }
  if (anchor.kind === 'settlement-approach' || anchor.kind === 'institution-exterior' || anchor.kind === 'infrastructure-scene') {
    return ['establish', 'approach', 'detail', 'release'];
  }
  return ['establish', 'approach', 'detail', 'context', 'release'];
}

/**
 * Presentation-only multi-shot planner.
 *
 * The planner never creates facts or mutates simulation state. It only chooses an ordered subset
 * from already-grounded Historian candidates so the camera can tell a short visual story instead
 * of selecting every shot in isolation.
 */
export class CinematicSequencePlanner {
  private queue: CinematicPlannedShot[] = [];
  private sequenceCounter = 0;
  private recentSceneIds: string[] = [];

  clear(): void {
    this.queue = [];
  }

  hasPlannedShot(): boolean {
    return this.queue.length > 0;
  }

  takePlannedShot(): CinematicPlannedShot | undefined {
    const next = this.queue.shift();
    if (next) this.remember(next.scene);
    return next;
  }

  plan(
    state: SimulationState,
    anchor: ObservationCandidate,
    candidates: readonly ObservationCandidate[],
    previous?: ObservationCandidate,
  ): CinematicPlannedShot {
    this.queue = [];
    const sequenceId = `sequence:${state.month}:${this.sequenceCounter++}:${anchor.id}`;
    const roles = targetRoles(anchor);
    const selected: SequenceScoredCandidate[] = [];
    const usedIds = new Set<string>();

    const chooseForRole = (role: CinematicBeatRole, prior: ObservationCandidate | undefined): ObservationCandidate | undefined => {
      let best: SequenceScoredCandidate | undefined;
      for (const scene of candidates) {
        if (usedIds.has(scene.id)) continue;
        if (this.recentSceneIds.includes(scene.id) && scene.id !== anchor.id) continue;

        const geographicDistance = prior ? distance(prior, scene) : previous ? distance(previous, scene) : 0;
        const travelScore = 1 - clamp01(geographicDistance / Math.max(18, state.world.size * 0.72));
        const anchorDistance = distance(anchor, scene);
        const locality = 1 - clamp01(anchorDistance / Math.max(14, state.world.size * 0.55));
        const continuity = scene.subjectId === anchor.subjectId ? 1
          : scene.position && anchor.position ? locality : 0.4;
        const contrast = kindContrast(prior?.kind ?? previous?.kind, scene.kind);
        const roleFit = rolePreference(role, scene.kind);
        const narrative = clamp01(scene.score * 0.68 + scene.interest * 0.32);
        const anchorBonus = scene.id === anchor.id ? 0.26 : 0;
        const eventCoherence = anchor.event && scene.event?.id === anchor.event.id ? 0.18 : 0;
        const repetitionPenalty = this.recentSceneIds.includes(scene.id) ? 0.35 : 0;
        const score = roleFit * 0.34
          + narrative * 0.23
          + continuity * 0.17
          + travelScore * 0.12
          + contrast * 0.08
          + anchorBonus
          + eventCoherence
          - repetitionPenalty;

        if (!best || score > best.score) best = { scene, role, score };
      }
      return best?.scene;
    };

    let prior = previous;
    for (const role of roles) {
      let scene = chooseForRole(role, prior);
      if (!scene && !usedIds.has(anchor.id)) scene = anchor;
      if (!scene) continue;
      usedIds.add(scene.id);
      selected.push({ scene, role, score: 0 });
      prior = scene;
    }

    if (!usedIds.has(anchor.id)) {
      const insertAt = Math.min(2, selected.length);
      selected.splice(insertAt, 0, { scene: anchor, role: roleFor(anchor.kind), score: 0 });
    }

    const compact: SequenceScoredCandidate[] = [];
    for (const item of selected) {
      const previousItem = compact[compact.length - 1];
      if (previousItem?.scene.id === item.scene.id) continue;
      compact.push(item);
      if (compact.length >= 5) break;
    }

    const total = compact.length;
    const planned = compact.map((item, index): CinematicPlannedShot => ({
      scene: item.scene,
      role: item.role,
      sequenceId,
      ordinal: index,
      total,
    }));

    const first = planned.shift() ?? {
      scene: anchor,
      role: roleFor(anchor.kind),
      sequenceId,
      ordinal: 0,
      total: 1,
    };
    this.queue = planned;
    this.remember(first.scene);
    return first;
  }

  interrupt(): void {
    this.queue = [];
  }

  private remember(scene: ObservationCandidate): void {
    this.recentSceneIds.push(scene.id);
    if (this.recentSceneIds.length > 10) this.recentSceneIds.splice(0, this.recentSceneIds.length - 10);
  }
}
