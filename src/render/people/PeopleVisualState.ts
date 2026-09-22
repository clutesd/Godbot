import type { Vec2 } from '../../sim/types';

/** Renderer-owned physical motion. No calendar cadence, catch-up budget or visible teleport. */
export const HUMAN_WALK_SPEED = 0.42;
export const HUMAN_MAX_WALK_SPEED = 0.55;
export const HUMAN_MAX_RUN_SPEED = 0.95;
export const HUMAN_ACCELERATION = 0.8;
export const HUMAN_BRAKING = 1.2;
export const HUMAN_RADIUS = 0.075;
const TURN_RATE = 5.2;
const RETARGET_EPSILON = 0.02;
export const WALK_SPEED_THRESHOLD = 0.05;
export const RUN_SPEED_THRESHOLD = 0.65;

export interface PersonVisualTarget {
  /** Authoritative simulation position, already adjusted for grouping and clearance. */
  destination: Vec2;
  /** Route the simulation used, if any. Passed waypoints become the visual journey's spine. */
  waypoints?: readonly Vec2[];
  waypointIndex?: number;
  /** Facing to adopt while standing still, e.g. turning toward a shrine or a conversation. */
  restFacing?: number;
  /** Resource workers slow through the last part of an approach before orienting to contact. */
  arrivalEase?: boolean;
  /** Indicates a bounded local activity step; it never changes the speed contract. */
  localMove?: boolean;
  localSpeed?: number;
  smoothTravel?: boolean;
  /** Only explicit emergency authority may unlock running. */
  emergency?: boolean;
}

export interface PersonVisualGround {
  /** Rendered terrain height at a visual position. */
  heightAt(x: number, z: number): number;
  /** Whether a visual position is dry, gentle ground a character may stand on. */
  isStandable(x: number, z: number): boolean;
  safeSegment?(a: Vec2, b: Vec2): boolean;
  detour?(a: Vec2, b: Vec2): Vec2[];
  /** Optional world-aware recovery used only when a requested/current point is already blocked. */
  nearestSafePoint?(point: Vec2, identity: string): Vec2 | undefined;

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
  /** Arrival flag (0 while navigating, 1 on arrival). */
  progress: number;
  /** Nominal physical travel time, for inspection only; never a catch-up deadline. */
  duration: number;
  /** Smoothed facing in radians, matching the direction of visual travel. */
  facing: number;
  /** Visual world units per second. Drives walk/run selection, not simulation speed. */
  speed: number;
  traveling: boolean;
  arrivalEase: boolean;
  localMove: boolean;
  smoothTravel: boolean;
  /** True on the frame the character was repositioned instead of interpolated. */
  snapped: boolean;
  /** Route-aware journey polyline, origin first and destination last. */
  path: Vec2[];
  lastGroundX: number;
  lastGroundZ: number;
  velocityX: number;
  velocityZ: number;
  maxPhysicalSpeed: number;
  waypoint: number;
  blocked: boolean;
  retrySeconds: number;
  /** Facing the character is easing toward, held after movement stops. */
  desiredFacing: number;
  lastFrame: number;
}

export class PeopleVisualStateStore {
  private readonly states = new Map<string, PersonVisualState>();
  private frame = 0;
  private readonly buckets = new Map<string, PersonVisualState[]>();

  get size(): number {
    return this.states.size;
  }

  get(personId: string): PersonVisualState | undefined {
    return this.states.get(personId);
  }

  beginFrame(): void {
    this.frame += 1;
    this.buckets.clear();
    for (const state of this.states.values()) {
      const key = `${Math.floor(state.x)}:${Math.floor(state.z)}`;
      const bucket = this.buckets.get(key) ?? [];
      bucket.push({ ...state }); this.buckets.set(key, bucket);
    }
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
    this.states.clear(); this.buckets.clear();
  }

  resolve(personId: string, target: PersonVisualTarget, deltaSeconds: number, ground: PersonVisualGround): PersonVisualState {
    const existing = this.states.get(personId);
    const recovered = existing ? this.depenetrate(existing, personId, ground) : false;
    const safeDestination = nearestSafeVisualPoint(target.destination, `${personId}:destination`, ground)
      ?? (existing && safeGroundSegment(existing, existing, ground) ? { x: existing.x, z: existing.z } : target.destination);
    const resolvedTarget = safeDestination.x === target.destination.x && safeDestination.z === target.destination.z
      ? target : { ...target, destination: safeDestination };
    const state = existing ?? this.spawn(personId, resolvedTarget.destination, ground);
    if (!existing) this.states.set(personId, state);
    state.lastFrame = this.frame;
    state.arrivalEase = resolvedTarget.arrivalEase ?? false;
    state.localMove = resolvedTarget.localMove ?? false;
    state.smoothTravel = resolvedTarget.smoothTravel ?? false;
    state.snapped = !existing || recovered;
    const cap = resolvedTarget.emergency ? HUMAN_MAX_RUN_SPEED : HUMAN_MAX_WALK_SPEED;
    const requestedSpeed = resolvedTarget.localSpeed ?? (resolvedTarget.emergency ? cap : HUMAN_WALK_SPEED);
    state.maxPhysicalSpeed = Math.min(cap, Math.max(0.1, Number.isFinite(requestedSpeed) ? requestedSpeed : HUMAN_WALK_SPEED));

    const moved = Math.hypot(resolvedTarget.destination.x - state.destinationX, resolvedTarget.destination.z - state.destinationZ);
    if (moved > RETARGET_EPSILON) {
      this.retarget(state, resolvedTarget, ground);
    }

    this.advance(state, deltaSeconds, resolvedTarget.restFacing, ground);
    return state;
  }

  private depenetrate(state: PersonVisualState, personId: string, ground: PersonVisualGround): boolean {
    if (safeGroundSegment(state, state, ground)) return false;
    const recovered = nearestSafeVisualPoint({ x: state.x, z: state.z }, `${personId}:depenetrate`, ground);
    if (!recovered) {
      state.blocked = true;
      state.velocityX = 0; state.velocityZ = 0; state.speed = 0;
      return false;
    }
    state.x = recovered.x; state.z = recovered.z;
    state.footY = ground.heightAt(recovered.x, recovered.z);
    state.originX = recovered.x; state.originZ = recovered.z;
    state.destinationX = recovered.x; state.destinationZ = recovered.z;
    state.path = [{ ...recovered }];
    state.waypoint = 1; state.progress = 1; state.traveling = false; state.blocked = false; state.retrySeconds = 0;
    state.velocityX = 0; state.velocityZ = 0; state.speed = 0;
    state.lastGroundX = recovered.x; state.lastGroundZ = recovered.z;
    return true;
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
      duration: 0,
      facing: 0,
      speed: 0,
      traveling: false,
      arrivalEase: false,
      localMove: false,
      smoothTravel: false,
      snapped: true,
      path: [{ x: at.x, z: at.z }],
      lastGroundX: at.x,
      lastGroundZ: at.z,
      velocityX: 0, velocityZ: 0, maxPhysicalSpeed: HUMAN_WALK_SPEED,
      waypoint: 1, blocked: false, retrySeconds: 0,
      desiredFacing: 0,
      lastFrame: this.frame,
    };
  }

  private retarget(state: PersonVisualState, target: PersonVisualTarget, ground: PersonVisualGround): void {
    const requestedPath = routeAwarePath(state, target.destination, target.waypoints, target.waypointIndex);
    // Historical waypoints can become stale when a new structure/tree occupies an old corridor.
    // Keep their documentary shape only while the waypoint itself remains valid; swept collision
    // below still protects every connecting segment.
    state.path = requestedPath.filter((point, index) =>
      index === 0 || index === requestedPath.length - 1 || safeGroundSegment(point, point, ground));
    state.originX = state.x; state.originZ = state.z;
    state.destinationX = target.destination.x; state.destinationZ = target.destination.z;
    state.duration = polylineLength(state.path) / state.maxPhysicalSpeed;
    state.progress = 0; state.waypoint = 1;
    state.traveling = true; state.blocked = false; state.retrySeconds = 0;
  }

  private advance(state: PersonVisualState, deltaSeconds: number, restFacing: number | undefined, ground: PersonVisualGround): void {
    // Tab stalls cannot become giant physical steps. Substeps validate the entire corridor.
    const dt = Number.isFinite(deltaSeconds) ? Math.min(0.1, Math.max(0, deltaSeconds)) : 0;
    const previousX = state.x, previousZ = state.z;
    state.retrySeconds = Math.max(0, state.retrySeconds - dt);
    let next = state.path[state.waypoint];
    const distanceToNext = next ? Math.hypot(next.x - state.x, next.z - state.z) : 0;
    const corridorEnd = next && distanceToNext > 3 ? { x: state.x + (next.x - state.x) * 3 / distanceToNext,
      z: state.z + (next.z - state.z) * 3 / distanceToNext } : next;
    if (corridorEnd && state.retrySeconds === 0 && !safeGroundSegment(state, corridorEnd, ground)) {
      const route = ground.detour?.(state, corridorEnd) ?? [];
      if (route.length) {
        state.path.splice(state.waypoint, distanceToNext > 3 ? 0 : 1, ...route);
        next = state.path[state.waypoint]; state.blocked = false;
      } else {
        const bypass = this.localBypass(state, corridorEnd, ground);
        if (bypass) {
          state.path.splice(state.waypoint, 0, bypass);
          next = state.path[state.waypoint]; state.blocked = false;
        } else {
          state.blocked = true; state.retrySeconds = 0.8;
        }
      }
    }
    if (corridorEnd && state.retrySeconds === 0 && safeGroundSegment(state, corridorEnd, ground)) state.blocked = false;
    if (next && !state.blocked) {
      const dx = next.x - state.x, dz = next.z - state.z, distance = Math.hypot(dx, dz);
      state.desiredFacing = Math.atan2(dx, dz);
      state.facing = turnToward(state.facing, state.desiredFacing, TURN_RATE * dt);
      const grade = distance > 0.001 ? (ground.heightAt(next.x, next.z) - state.footY) / distance : 0;
      const slopeSpeed = state.maxPhysicalSpeed / (1 + Math.max(0, grade) * 0.7 + Math.max(0, -grade) * 0.3);
      const braking = Math.sqrt(2 * HUMAN_BRAKING * distance);
      const alignment = Math.cos(state.desiredFacing - state.facing);
      const desiredSpeed = alignment > 0.8 ? Math.min(slopeSpeed, braking) : 0;
      const oldSpeed = Math.hypot(state.velocityX, state.velocityZ);
      const speed = Math.max(0, Math.min(desiredSpeed, oldSpeed + HUMAN_ACCELERATION * dt));
      const step = Math.min(distance, speed * dt, state.maxPhysicalSpeed * dt);
      const proposed = { x: state.x + dx / (distance || 1) * step, z: state.z + dz / (distance || 1) * step };
      const accepted = this.avoidPeers(state, proposed, dt, ground);
      if (safeGroundSegment(state, accepted, ground)) {
        state.x = accepted.x; state.z = accepted.z;
      } else { state.blocked = true; state.retrySeconds = 0; }
      if (Math.hypot(next.x - state.x, next.z - state.z) < 0.00001) state.waypoint++;
    } else if (restFacing !== undefined) {
      state.desiredFacing = restFacing;
      state.facing = turnToward(state.facing, restFacing, TURN_RATE * dt);
    }
    state.velocityX = dt > 0 ? (state.x - previousX) / dt : 0;
    state.velocityZ = dt > 0 ? (state.z - previousZ) / dt : 0;
    state.speed = Math.hypot(state.velocityX, state.velocityZ);
    state.traveling = state.waypoint < state.path.length && !state.blocked;
    state.progress = state.waypoint >= state.path.length ? 1 : 0;
    state.footY = ground.heightAt(state.x, state.z);
    state.lastGroundX = state.x; state.lastGroundZ = state.z;
  }

  private avoidPeers(state: PersonVisualState, proposed: Vec2, dt: number, ground: PersonVisualGround): Vec2 {
    const peers = this.nearby(state);
    const clear = (point: Vec2) => peers.every(peer => {
      const separation = Math.hypot(state.x - peer.x, state.z - peer.z);
      // Pre-existing spawn overlap can unwind but cannot get worse.
      return segmentDistance(state, point, peer) >= Math.min(HUMAN_RADIUS * 2 + peer.maxPhysicalSpeed * dt, separation) - 1e-7;
    });
    let threatened = false;
    for (const peer of peers) {
      if (state.id < peer.id && Math.hypot(peer.velocityX, peer.velocityZ) > 0.02) continue;
      const predicted = { x: peer.x + peer.velocityX * 0.5, z: peer.z + peer.velocityZ * 0.5 };
      const ahead = { x: state.x + (proposed.x - state.x) * 20, z: state.z + (proposed.z - state.z) * 20 };
      if (segmentDistance(state, ahead, predicted) < 0.23) threatened = true;
    }
    if (!threatened && clear(proposed)) return proposed;
    const dx = proposed.x - state.x, dz = proposed.z - state.z;
    const length = Math.hypot(dx, dz);
    if (length > 0) for (const angle of [0.65, 1.1, 1.5, -0.65, -1.1]) {
      const c = Math.cos(angle), s = Math.sin(angle);
      const point = { x: state.x + dx * c + dz * s, z: state.z - dx * s + dz * c };
      if (Math.hypot(point.x - state.x, point.z - state.z) <= state.maxPhysicalSpeed * dt + 1e-9
        && clear(point) && safeGroundSegment(state, point, ground)) return point;
    }
    return clear(proposed) ? proposed : { x: state.x, z: state.z };
  }

  /** Short deterministic steering fallback for solid objects that do not own pathfinder nodes. */
  private localBypass(state: PersonVisualState, end: Vec2, ground: PersonVisualGround): Vec2 | undefined {
    const dx = end.x - state.x, dz = end.z - state.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.08) return undefined;
    const ux = dx / distance, uz = dz / distance;
    const px = -uz, pz = ux;
    const preferred = stableVisualHash(state.id) % 2 === 0 ? 1 : -1;
    let fallback: Vec2 | undefined;
    for (const sign of [preferred, -preferred]) {
      for (const lateral of [0.2, 0.34, 0.5]) {
        for (const forward of [0.16, 0.28, 0.42]) {
          const candidate = {
            x: state.x + ux * Math.min(forward, distance * 0.5) + px * lateral * sign,
            z: state.z + uz * Math.min(forward, distance * 0.5) + pz * lateral * sign,
          };
          if (!safeGroundSegment(state, candidate, ground)) continue;
          if (safeGroundSegment(candidate, end, ground)) return candidate;
          fallback ??= candidate;
        }
      }
    }
    return fallback;
  }

  private nearby(state: PersonVisualState): PersonVisualState[] {
    const peers: PersonVisualState[] = [];
    const bx = Math.floor(state.x), bz = Math.floor(state.z);
    for (let x = bx - 1; x <= bx + 1; x++) for (let z = bz - 1; z <= bz + 1; z++) {
      for (const peer of this.buckets.get(`${x}:${z}`) ?? []) if (peer.id !== state.id) peers.push(peer);
    }
    return peers;
  }

}

/** Symmetric acceleration/deceleration, with a constant-speed middle half. */
export function easedLocalProgress(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  if (t < 0.25) return t * t / 0.375;
  if (t > 0.75) return 1 - (1 - t) * (1 - t) / 0.375;
  return (t - 0.125) / 0.75;
}

/** Integrates constant walking speed into a smooth deceleration over the final 30% of time. */
export function easedArrivalProgress(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  if (t <= 0.7) return t / 0.85;
  const tail = (t - 0.7) / 0.3;
  return (0.7 + 0.3 * (tail - tail * tail * 0.5)) / 0.85;
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

/**
 * Resolves a blocked target without ever drawing a segment through the blocker. The renderer may
 * provide a world-aware query; the deterministic ring fallback keeps the contract usable in tests
 * and small presentation scenes that only expose segment predicates.
 */
export function nearestSafeVisualPoint(point: Vec2, identity: string, ground: PersonVisualGround): Vec2 | undefined {
  if (safeGroundSegment(point, point, ground)) return { ...point };
  const delegated = ground.nearestSafePoint?.(point, identity);
  if (delegated && safeGroundSegment(delegated, delegated, ground)) return { ...delegated };
  const phase = stableVisualHash(identity) / 0xffffffff * Math.PI * 2;
  const step = 0.12;
  for (let radius = step; radius <= 4; radius += step) {
    const samples = Math.max(12, Math.ceil(Math.PI * 2 * radius / 0.18));
    for (let index = 0; index < samples; index++) {
      const angle = phase + index / samples * Math.PI * 2;
      const candidate = { x: point.x + Math.cos(angle) * radius, z: point.z + Math.sin(angle) * radius };
      if (safeGroundSegment(candidate, candidate, ground)) return candidate;
    }
  }
  return undefined;
}

/** Samples rendered grade/water; optional structure callback uses exact swept rectangles. */
export function safeGroundSegment(a: Vec2, b: Vec2, ground: PersonVisualGround): boolean {
  if (ground.safeSegment && !ground.safeSegment(a, b)) return false;
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  // Long authority routes are validated incrementally, without unbounded per-frame sampling.
  const samples = Math.max(1, Math.ceil(Math.min(distance, 3) / 0.06));
  const fraction = distance > 3 ? 3 / distance : 1;
  let height = ground.heightAt(a.x, a.z);
  for (let i = 1; i <= samples; i++) {
    const t = i / samples * fraction;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const nextHeight = ground.heightAt(x, z);
    if (!ground.isStandable(x, z) || !Number.isFinite(nextHeight)
      || Math.abs(nextHeight - height) > Math.max(0.015, distance * fraction / samples * 0.84)) return false;
    height = nextHeight;
  }
  return true;
}

function stableVisualHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function segmentDistance(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
