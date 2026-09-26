import type { DocumentaryShotScale, ObservationCandidate, ObservationKind } from '../historian/types';
import type { SimulationState } from '../sim/types';

export type CinematicBeatRole = 'establish' | 'approach' | 'observe' | 'detail' | 'reveal' | 'release';

export interface CinematicPlannedShot {
  readonly scene: ObservationCandidate;
  readonly role: CinematicBeatRole;
  readonly scale: DocumentaryShotScale;
  readonly narrate: boolean;
  readonly threadId: string;
  readonly sequenceId: string;
  readonly ordinal: number;
  readonly total: number;
}

interface SequenceScoredCandidate {
  scene: ObservationCandidate;
  role: CinematicBeatRole;
  score: number;
}

interface EditorialMemoryEntry {
  sceneId: string;
  subjectId: string;
  kind: ObservationKind;
  role: CinematicBeatRole;
  scale: DocumentaryShotScale;
  threadId: string;
}

const WIDE_KINDS = new Set<ObservationKind>([
  'world-establishing', 'regional-travel', 'battle-overview', 'aftermath-pullback',
  'city-growth-timelapse', 'landscape-pause', 'historian-context', 'orbital-establishing',
  'civilization-ending',
]);

const MEDIUM_KINDS = new Set<ObservationKind>([
  'settlement-approach', 'institution-exterior', 'infrastructure-scene', 'atomic-threshold',
]);

const HUMAN_KINDS = new Set<ObservationKind>([
  'street-observation', 'traveler-follow',
]);

const DETAIL_KINDS = new Set<ObservationKind>([
  'worker-follow', 'discovery-scene',
]);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function distance(a: ObservationCandidate, b: ObservationCandidate): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}

export function documentaryShotScaleFor(kind: ObservationKind): DocumentaryShotScale {
  if (DETAIL_KINDS.has(kind)) return 'detail';
  if (HUMAN_KINDS.has(kind)) return 'human';
  if (MEDIUM_KINDS.has(kind)) return 'medium';
  return 'wide';
}

function roleFor(kind: ObservationKind): CinematicBeatRole {
  if (kind === 'settlement-approach' || kind === 'regional-travel') return 'approach';
  if (kind === 'street-observation' || kind === 'traveler-follow') return 'observe';
  if (kind === 'worker-follow' || kind === 'discovery-scene') return 'detail';
  if (kind === 'institution-exterior' || kind === 'infrastructure-scene' || kind === 'atomic-threshold'
    || kind === 'city-growth-timelapse') return 'reveal';
  if (kind === 'aftermath-pullback' || kind === 'landscape-pause' || kind === 'night-transition'
    || kind === 'civilization-ending') return 'release';
  return 'establish';
}

function rolePreference(role: CinematicBeatRole, kind: ObservationKind): number {
  const scale = documentaryShotScaleFor(kind);
  switch (role) {
    case 'establish':
      return scale === 'wide' ? 1 : scale === 'medium' ? 0.5 : 0.12;
    case 'approach':
      return kind === 'settlement-approach' || kind === 'regional-travel' ? 1
        : scale === 'medium' ? 0.82 : scale === 'human' ? 0.48 : 0.2;
    case 'observe':
      return kind === 'street-observation' || kind === 'traveler-follow' ? 1
        : scale === 'detail' ? 0.76 : scale === 'medium' ? 0.42 : 0.12;
    case 'detail':
      return scale === 'detail' ? 1 : scale === 'human' ? 0.62 : scale === 'medium' ? 0.3 : 0.08;
    case 'reveal':
      return kind === 'institution-exterior' || kind === 'infrastructure-scene'
        || kind === 'atomic-threshold' || kind === 'city-growth-timelapse' ? 1
        : scale === 'medium' ? 0.72 : scale === 'wide' ? 0.5 : 0.22;
    case 'release':
      return kind === 'aftermath-pullback' || kind === 'landscape-pause' || kind === 'night-transition'
        || kind === 'civilization-ending' ? 1 : scale === 'wide' ? 0.78 : 0.15;
  }
}

function scaleContrast(previous: DocumentaryShotScale | undefined, next: DocumentaryShotScale): number {
  if (!previous) return 0.55;
  if (previous === next) return 0.06;
  const order: Record<DocumentaryShotScale, number> = { wide: 0, medium: 1, human: 2, detail: 3 };
  const delta = Math.abs(order[previous] - order[next]);
  return delta >= 2 ? 1 : 0.66;
}

function canonicalRoles(anchor: ObservationCandidate): readonly CinematicBeatRole[] {
  if (anchor.kind === 'civilization-ending' || anchor.kind === 'aftermath-pullback') {
    return ['establish', 'observe', 'detail', 'reveal', 'release'];
  }
  if (anchor.kind === 'orbital-establishing') {
    return ['establish', 'approach', 'reveal', 'release'];
  }
  return ['establish', 'approach', 'observe', 'detail', 'reveal', 'release'];
}

function threadIdFor(scene: ObservationCandidate): string {
  return scene.editorial?.threadId ?? `subject:${scene.subjectId}`;
}

function narrationFor(scene: ObservationCandidate, role: CinematicBeatRole, isAnchor: boolean): boolean {
  const mode = scene.editorial?.narration ?? 'selective';
  if (mode === 'silent') return false;
  if (mode === 'required') return role === 'observe' || role === 'detail' || role === 'reveal' || isAnchor;
  if (role === 'establish' || role === 'approach' || role === 'release') return false;
  if (scene.interest >= 0.78) return true;
  return isAnchor && scene.score >= 0.72;
}

/**
 * Presentation-only multi-shot planner.
 *
 * The Historian decides why a grounded subject matters. This planner turns that intent into
 * documentary grammar: establish -> approach -> observe -> detail -> reveal -> release. It keeps
 * bounded editorial memory of subjects, scale, roles and threads so autonomous direction does not
 * collapse into repeated aerials or mechanically revisit the same person.
 */
export class CinematicSequencePlanner {
  private queue: CinematicPlannedShot[] = [];
  private sequenceCounter = 0;
  private recent: EditorialMemoryEntry[] = [];

  clear(): void {
    this.queue = [];
  }

  hasPlannedShot(): boolean {
    return this.queue.length > 0;
  }

  takePlannedShot(): CinematicPlannedShot | undefined {
    const next = this.queue.shift();
    if (next) this.remember(next);
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
    const roles = canonicalRoles(anchor);
    const selected: SequenceScoredCandidate[] = [];
    const usedIds = new Set<string>();
    const anchorThread = threadIdFor(anchor);

    const recentScale = this.recent[this.recent.length - 1]?.scale
      ?? (previous ? documentaryShotScaleFor(previous.kind) : undefined);

    const chooseForRole = (role: CinematicBeatRole, prior: ObservationCandidate | undefined): ObservationCandidate | undefined => {
      let best: SequenceScoredCandidate | undefined;
      const previousScale = prior ? documentaryShotScaleFor(prior.kind) : recentScale;
      for (const scene of candidates) {
        if (usedIds.has(scene.id)) continue;
        const recentIndex = this.recent.findIndex(entry => entry.sceneId === scene.id);
        if (recentIndex >= 0 && scene.id !== anchor.id) continue;

        const geographicDistance = prior ? distance(prior, scene) : previous ? distance(previous, scene) : 0;
        const travelScore = 1 - clamp01(geographicDistance / Math.max(18, state.world.size * 0.72));
        const anchorDistance = distance(anchor, scene);
        const locality = 1 - clamp01(anchorDistance / Math.max(14, state.world.size * 0.5));
        const sceneThread = threadIdFor(scene);
        const sameThread = sceneThread === anchorThread;
        const threadContinuity = sameThread ? 1 : locality * 0.58;
        const scale = scene.editorial?.preferredScale ?? documentaryShotScaleFor(scene.kind);
        const contrast = scaleContrast(previousScale, scale);
        const roleFit = rolePreference(role, scene.kind);
        const activityMeaning = clamp01(scene.editorial?.activityMeaning ?? 0.25);
        const narrative = clamp01(scene.score * 0.58 + scene.interest * 0.24 + activityMeaning * 0.18);
        const anchorBonus = scene.id === anchor.id ? 0.34 : 0;
        const eventCoherence = anchor.event && scene.event?.id === anchor.event.id ? 0.2 : 0;

        const subjectSeen = this.recent.filter(entry => entry.subjectId === scene.subjectId).length;
        const scaleSeen = this.recent.slice(-3).filter(entry => entry.scale === scale).length;
        const wideStreak = scale === 'wide'
          ? this.recent.slice(-2).filter(entry => entry.scale === 'wide').length
          : 0;
        const roleSeen = this.recent.slice(-4).filter(entry => entry.role === role).length;
        const repetitionPenalty = subjectSeen * 0.16 + scaleSeen * 0.08 + wideStreak * 0.16 + roleSeen * 0.035;

        const score = roleFit * 0.3
          + narrative * 0.25
          + threadContinuity * 0.2
          + travelScore * 0.1
          + contrast * 0.08
          + locality * 0.07
          + anchorBonus
          + eventCoherence
          - repetitionPenalty;

        if (!best
          || score > best.score + 1e-9
          || (Math.abs(score - best.score) <= 1e-9 && scene.id.localeCompare(best.scene.id) < 0)) {
          best = { scene, role, score };
        }
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
      const desiredRole = roleFor(anchor.kind);
      const replaceAt = Math.max(0, selected.findIndex(item => item.role === desiredRole));
      if (selected.length === 0) selected.push({ scene: anchor, role: desiredRole, score: 0 });
      else selected[Math.min(replaceAt, selected.length - 1)] = { scene: anchor, role: desiredRole, score: 0 };
    }

    const compact: SequenceScoredCandidate[] = [];
    for (const item of selected) {
      const previousItem = compact[compact.length - 1];
      if (previousItem?.scene.id === item.scene.id) continue;
      compact.push(item);
      if (compact.length >= 6) break;
    }

    const total = compact.length;
    const planned = compact.map((item, index): CinematicPlannedShot => ({
      scene: item.scene,
      role: item.role,
      scale: item.scene.editorial?.preferredScale ?? documentaryShotScaleFor(item.scene.kind),
      narrate: narrationFor(item.scene, item.role, item.scene.id === anchor.id),
      threadId: threadIdFor(item.scene),
      sequenceId,
      ordinal: index,
      total,
    }));

    const first = planned.shift() ?? {
      scene: anchor,
      role: roleFor(anchor.kind),
      scale: anchor.editorial?.preferredScale ?? documentaryShotScaleFor(anchor.kind),
      narrate: narrationFor(anchor, roleFor(anchor.kind), true),
      threadId: anchorThread,
      sequenceId,
      ordinal: 0,
      total: 1,
    };
    this.queue = planned;
    this.remember(first);
    return first;
  }

  interrupt(): void {
    this.queue = [];
  }

  recentEditorialMemory(): readonly EditorialMemoryEntry[] {
    return this.recent;
  }

  private remember(shot: CinematicPlannedShot): void {
    this.recent.push({
      sceneId: shot.scene.id,
      subjectId: shot.scene.subjectId,
      kind: shot.scene.kind,
      role: shot.role,
      scale: shot.scale,
      threadId: shot.threadId,
    });
    if (this.recent.length > 18) this.recent.splice(0, this.recent.length - 18);
  }
}
