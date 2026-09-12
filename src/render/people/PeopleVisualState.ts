import type { Vec2 } from '../../sim/types';

/**
 * PeopleVisualState.ts
 *
 * Renderer-side continuity for represented people. The simulation remains the sole authority over
 * where a person *is*; this layer only decides where the character is *drawn* on the way there.
 *
 * A person keeps a previous visual position, a visual destination, a route-aware journey polyline
 * and a bounded travel duration. Simulation months advance far faster than a person can plausibly
 * walk, so journeys are compressed rather than simulated: the goal is continuity, not temporal
 * literalism. Visual state always converges back on the authoritative position, and genuinely
 * impossible jumps snap instead of dragging a character across the world.
 */

/** World units per second of unhurried visual travel. Sets the top of the journey-length band. */
const VISUAL_TRAVEL_SPEED = 0.9;
const MIN_JOURNEY_SECONDS = 0.25;
const MAX_JOURNEY_SECONDS = 8;
/** Beyond this the move is a teleport, not a journey; interpolating it would mislead. */
export const SNAP_DISTANCE = 16;
/** Past this lag the journey is shortened so the character catches up with authoritative state. */
const CATCHUP_DISTANCE = 6;
/** Destination changes smaller than this are noise, not a retarget. */
const RETARGET_EPSILON = 0.02;
/** Radians per second. Characters turn, they do not flip. */
const TURN_RATE = 5.2;
/** Below this visual speed a character is standing, not walking. */
export const WALK_SPEED_THRESHOLD = 0.05;
/** Above this visual speed the compressed journey reads as a run. */
export const RUN_SPEED_THRESHOLD = 1.8;

export interface PersonVisualTarget {
  /** Authoritative simulation position, already adjusted for grouping and clearance. */
  destination: Vec2;
  /** Route the simulation used, if any. Passed waypoints become the visual journey's spine. */
  waypoints?: readonly Vec2[];
  waypointIndex?: number;
  /** Facing to adopt while standing still, e.g. turning toward a shrine or a conversation. */
  restFacing?: number;
}

export interface PersonVisualGround {
  /** Rendered terrain height at a visual position. */
  heightAt(x: number, z: number): number;
  /** Whether a visual position is dry, gentle ground a character may stand on. */
  isStandable(x: number, z: number): boolean;
}

export interface PersonVisualState {
  readonly id: string;
  /** Drawn position for this frame. */
  x: number;
  z: number;
  /** Sole anchor: rendered terrain height at (x, z). The character is built upward from here. */
  footY: number;
  /** Where the current journey began. */
  originX: number;
  originZ: number;
  destinationX: number;
  destinationZ: number;
  /** 0..1 along the current journey polyline. */
  progress: number;
  /** Bounded presentation duration for the current journey, in real seconds. */
  duration: number;
  /** Smoothed facing in radians, matching the direction of visual travel. */
  facing: number;
  /** Visual world units per second. Drives walk/run selection, not simulation speed. */
  speed: number;
  traveling: boolean;
  /** True on the frame the character was repositioned instead of interpolated. */
  snapped: boolean;
  /** Route-aware journey polyline, origin first and destination last. */
  path: Vec2[];
  lastGroundX: number;
  lastGroundZ: number;
  /** Real seconds accumulated since the simulation last moved this person. */
  sinceRetarget: number;
  /** Smoothed real-time length of one simulation month, as observed for this person. */
  monthSeconds: number;
  /** Authoritative moves seen so far; the pace estimate is only trusted after the first. */
  retargets: number;
  /** Facing the character is easing toward, held after movement stops. */
  desiredFacing: number;
  lastFrame: number;
}

export class PeopleVisualStateStore {
  private readonly states = new Map<string, PersonVisualState>();
  private frame = 0;

  get size(): number {
    return this.states.size;
  }

  get(personId: string): PersonVisualState | undefined {
    return this.states.get(personId);
  }

  beginFrame(): void {
    this.frame += 1;
  }

  /** Drops visual state for anyone not resolved during the current frame (dead or off-budget). */
  prune(onRemove?: (personId: string) => void): void {
    for (const [id, state] of this.states) {
      if (state.lastFrame === this.frame) continue;
      this.states.delete(id);
      onRemove?.(id);
    }
  }

  clear(): void {
    this.states.clear();
  }

  resolve(personId: string, target: PersonVisualTarget, deltaSeconds: number, ground: PersonVisualGround): PersonVisualState {
    const existing = this.states.get(personId);
    const state = existing ?? this.spawn(personId, target.destination, ground);
    if (!existing) this.states.set(personId, state);
    state.lastFrame = this.frame;
    state.snapped = !existing;
    state.sinceRetarget += Math.max(0, deltaSeconds);

    const moved = Math.hypot(target.destination.x - state.destinationX, target.destination.z - state.destinationZ);
    if (moved > RETARGET_EPSILON) {
      const jump = Math.hypot(target.destination.x - state.x, target.destination.z - state.z);
      if (jump > SNAP_DISTANCE) this.reset(state, target.destination, ground);
      else this.retarget(state, target);
      state.sinceRetarget = 0;
    }

    this.advance(state, deltaSeconds, target.restFacing, ground);
    return state;
  }

  private spawn(personId: string, at: Vec2, ground: PersonVisualGround): PersonVisualState {
    return {
      id: personId,
      x: at.x,
      z: at.z,
      footY: ground.heightAt(at.x, at.z),
      originX: at.x,
      originZ: at.z,
      destinationX: at.x,
      destinationZ: at.z,
      progress: 1,
      duration: MIN_JOURNEY_SECONDS,
      facing: 0,
      speed: 0,
      traveling: false,
      snapped: true,
      path: [{ x: at.x, z: at.z }],
      lastGroundX: at.x,
      lastGroundZ: at.z,
      sinceRetarget: 0,
      monthSeconds: 0,
      retargets: 0,
      desiredFacing: 0,
      lastFrame: this.frame,
    };
  }

  private reset(state: PersonVisualState, at: Vec2, ground: PersonVisualGround): void {
    state.x = at.x;
    state.z = at.z;
    state.originX = at.x;
    state.originZ = at.z;
    state.destinationX = at.x;
    state.destinationZ = at.z;
    state.path = [{ x: at.x, z: at.z }];
    state.progress = 1;
    state.speed = 0;
    state.traveling = false;
    state.snapped = true;
    state.footY = ground.heightAt(at.x, at.z);
    if (ground.isStandable(at.x, at.z)) {
      state.lastGroundX = at.x;
      state.lastGroundZ = at.z;
    }
  }

  /**
   * Smoothly aims the character at a new authoritative position, starting from wherever it is
   * currently drawn. Route waypoints the simulation already consumed become the spine of the
   * journey, so the walk follows roads and settlement paths rather than cutting through houses.
   *
   * The duration is bounded by an unhurried travel speed *and* by the observed real-time length of
   * a simulation month. GODBOX runs history at anything from 0.3 to 50 months per second; a
   * journey that outlasts the next authoritative update would only ever fall further behind.
   */
  private retarget(state: PersonVisualState, target: PersonVisualTarget): void {
    const from = { x: state.x, z: state.z };
    const path = routeAwarePath(from, target.destination, target.waypoints, target.waypointIndex);
    const length = polylineLength(path);
    const lag = Math.hypot(target.destination.x - state.x, target.destination.z - state.z);
    const catchup = lag > CATCHUP_DISTANCE ? Math.max(0.35, CATCHUP_DISTANCE / lag) : 1;
    const observed = state.sinceRetarget > 0
      ? (state.monthSeconds > 0 ? state.monthSeconds * 0.6 + state.sinceRetarget * 0.4 : state.sinceRetarget)
      : state.monthSeconds;
    state.monthSeconds = observed;
    state.retargets += 1;
    const unhurried = length / VISUAL_TRAVEL_SPEED;
    // The first move has no pace sample yet; walking it out beats guessing from a single frame.
    const budget = state.retargets > 1 && observed > 0 ? Math.min(unhurried, observed) : unhurried;
    state.path = path;
    state.originX = from.x;
    state.originZ = from.z;
    state.destinationX = target.destination.x;
    state.destinationZ = target.destination.z;
    state.duration = Math.min(MAX_JOURNEY_SECONDS, Math.max(MIN_JOURNEY_SECONDS, budget)) * catchup;
    state.progress = length > 0.0001 ? 0 : 1;
    state.traveling = state.progress < 1;
  }

  private advance(state: PersonVisualState, deltaSeconds: number, restFacing: number | undefined, ground: PersonVisualGround): void {
    const previousX = state.x;
    const previousZ = state.z;
    if (state.progress < 1 && deltaSeconds > 0) {
      state.progress = Math.min(1, state.progress + deltaSeconds / Math.max(0.0001, state.duration));
      const point = samplePolyline(state.path, state.progress);
      state.x = point.x;
      state.z = point.z;
    }
    state.traveling = state.progress < 1;

    if (!ground.isStandable(state.x, state.z)) {
      // Never leave a character half-submerged or pinned to a cliff: fall back to the last
      // position the rendered terrain actually accepted.
      state.x = state.lastGroundX;
      state.z = state.lastGroundZ;
    } else {
      state.lastGroundX = state.x;
      state.lastGroundZ = state.z;
    }
    state.footY = ground.heightAt(state.x, state.z);

    const stepX = state.x - previousX;
    const stepZ = state.z - previousZ;
    const step = Math.hypot(stepX, stepZ);
    state.speed = deltaSeconds > 0 ? step / deltaSeconds : 0;
    if (state.speed > WALK_SPEED_THRESHOLD) state.desiredFacing = Math.atan2(stepX, stepZ);
    else if (restFacing !== undefined) state.desiredFacing = restFacing;
    // Keep easing after the journey ends, so a character never freezes mid-turn.
    state.facing = turnToward(state.facing, state.desiredFacing, TURN_RATE * Math.max(0, deltaSeconds));
  }
}

/**
 * Builds the visual journey. Waypoints the person has already passed describe the corridor the
 * simulation actually used; keeping only those that make monotonic progress toward the destination
 * yields an ordered, road-following polyline without running a second pathfinder.
 */
export function routeAwarePath(from: Vec2, to: Vec2, waypoints: readonly Vec2[] | undefined, waypointIndex = 0): Vec2[] {
  const path: Vec2[] = [{ x: from.x, z: from.z }];
  if (waypoints && waypoints.length > 0) {
    const passed = waypoints.slice(0, Math.max(0, Math.min(waypointIndex, waypoints.length)));
    const startDistance = Math.hypot(to.x - from.x, to.z - from.z);
    const ahead = passed
      .map((point) => ({ point, remaining: Math.hypot(to.x - point.x, to.z - point.z) }))
      .filter((entry) => entry.remaining < startDistance - 0.05 && entry.remaining > 0.05)
      .sort((a, b) => b.remaining - a.remaining);
    for (const entry of ahead) path.push({ x: entry.point.x, z: entry.point.z });
  }
  path.push({ x: to.x, z: to.z });
  return path;
}

export function polylineLength(path: readonly Vec2[]): number {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]!;
    const b = path[index]!;
    length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return length;
}

export function samplePolyline(path: readonly Vec2[], progress: number): Vec2 {
  const last = path[path.length - 1];
  if (!last) return { x: 0, z: 0 };
  if (path.length === 1 || progress >= 1) return { x: last.x, z: last.z };
  const wanted = polylineLength(path) * Math.max(0, progress);
  let travelled = 0;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]!;
    const b = path[index]!;
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    if (travelled + segment >= wanted) {
      const t = segment > 0.0001 ? (wanted - travelled) / segment : 1;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    travelled += segment;
  }
  return { x: last.x, z: last.z };
}

/** Shortest-arc rotation with a bounded rate, so a reversal reads as a turn. */
export function turnToward(current: number, desired: number, maxStep: number): number {
  let delta = (desired - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  if (maxStep <= 0) return current;
  return current + Math.max(-maxStep, Math.min(maxStep, delta));
}
