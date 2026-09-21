import type { DestinationKind, Person, Vec2 } from '../../sim/types';
import type { AnimationState } from '../animation/AnimationController';
import { resourceVisualUnit as unit } from '../../sim/resources/ResourceWorkPresentation';
import { atInteraction, facingTarget } from './PhysicalActionPresentation';
import type { GroupPlacement, SocialGroup } from './PeoplePresentation';
import type { PersonVisualState } from './PeopleVisualState';

/**
 * The single renderer-owned micro-life projection.
 *
 * IMPORTANT: every hold/step below is measured in wall-clock presentation seconds. Do not convert
 * simulated months or the displayed calendar day into local walking/action cycles. At documentary
 * speed history can advance multiple months per real second; this layer samples believable daily
 * life inside that history rather than attempting to animate every simulated day literally.
 * No clock, random source or write is shared with simulation.
 */
export const LOCAL_ACTIVITY_RADIUS = 2;
export const LOCAL_ACTIVITY_ARRIVAL_HOLD_SECONDS = { min: 0.4, max: 1.2 } as const;
/** Ignore monthly/group-layout drift inside this radius so local lives do not chase jitter. */
const LOCAL_ACTIVITY_BASE_FOLLOW_THRESHOLD = 0.24;
/** After following a meaningful shift, leave this much slack before following again. */
const LOCAL_ACTIVITY_BASE_RELEASE_RADIUS = 0.1;
const LOCAL_ACTIVITY_REANCHOR_LIMIT = 0.9;
export interface ActivityStructure {
  key: string; worldX: number; worldZ: number; width: number; depth: number; rotationY: number;
  role?: string;
}
export interface LocalActivityContext {
  base: GroupPlacement;
  visual?: PersonVisualState;
  group?: SocialGroup;
  /** Visible peers only; callers cache the index once per frame. */
  people: ReadonlyMap<string, Person>;
  visualFor?(id: string): Readonly<Vec2> | undefined;
  structures: readonly ActivityStructure[];
  safeSegment(a: Vec2, b: Vec2): boolean;
  /** Terrain/structure authority revision, independent of the local presentation clock. */
  revision: unknown;
  blocked: boolean;
  far?: boolean;
}
type Step = 'task' | 'inspect' | 'return' | 'interact' | 'pause' | 'reposition';
type Intent = readonly [step: Step, point: number, action: string, seconds: number];
const WORK_ROUTINE: readonly Intent[] = [
  ['task', 0, 'task', 4.5], ['inspect', 1, 'inspect-work-area', 2.6], ['reposition', 4, 'adjust-work-position', 1.8],
  ['return', 0, 'return-to-task', 3.6], ['interact', 5, 'look-to-colleague', 3], ['pause', 3, 'pause', 2.8],
  ['reposition', 2, 'change-work-side', 1.8],
];
const ROUTINES: Partial<Record<DestinationKind, readonly Intent[]>> = {
  workshop: WORK_ROUTINE,
  market: [['task', 0, 'attend-stall', 3.6], ['interact', 4, 'look-to-customer', 3.4], ['reposition', 5, 'step-aside', 1.7],
    ['inspect', 2, 'check-stall', 2.5], ['interact', 1, 'look-to-neighbour', 3.5], ['pause', 3, 'pause', 2.2],
    ['reposition', 6, 'cross-stall-frontage', 1.8]],
  plaza: [['interact', 0, 'join-pod', 3.8], ['reposition', 4, 'shift-in-pod', 1.6], ['interact', 1, 'join-neighbour', 3.5],
    ['pause', 1, 'pause', 2.1], ['reposition', 5, 'leave-pod', 1.8], ['inspect', 2, 'observe-plaza', 2.5],
    ['interact', 6, 'join-another-pod', 3.6]],
  'civic-building': [['task', 0, 'workstation-task', 5], ['interact', 1, 'consult-colleague', 3], ['return', 0, 'review-task', 4],
    ['inspect', 2, 'check-task-area', 3], ['pause', 2, 'pause', 4], ['reposition', 3, 'return-to-station', 2]],
  'knowledge-institution': [['task', 0, 'study', 6], ['inspect', 1, 'consider-task', 4], ['interact', 3, 'discuss-study', 4],
    ['return', 0, 'study', 5], ['pause', 0, 'pause', 4], ['reposition', 2, 'change-study-position', 2]],
  'industrial-site': [['task', 0, 'station-task', 5], ['inspect', 1, 'inspect-supply-side', 3], ['return', 0, 'station-task', 4],
    ['inspect', 2, 'inspect-work-area', 4], ['interact', 3, 'look-to-colleague', 3], ['pause', 3, 'pause', 4]],
  shrine: [['task', 0, 'ritual', 6], ['pause', 0, 'pause', 3], ['reposition', 1, 'adjust-gathering-position', 2],
    ['task', 1, 'ritual', 4], ['inspect', 2, 'observe-gathering', 3], ['reposition', 3, 'step-out-of-gathering', 3]],
  home: [['task', 0, 'rest', 6.5], ['pause', 0, 'pause', 2.8], ['reposition', 1, 'household-step', 1.8],
    ['interact', 4, 'look-to-household', 3.4], ['inspect', 3, 'check-household', 2.6],
    ['reposition', 2, 'household-crossing', 1.8], ['return', 0, 'rest', 5.5]],
  'patrol-route': [['inspect', 1, 'watch', 3], ['reposition', 2, 'patrol-point', 2], ['pause', 2, 'watch', 4],
    ['inspect', 3, 'survey-route', 3], ['return', 0, 'patrol-point', 2], ['pause', 0, 'watch', 4]],
};
const EXCLUSIVE_ACTIVITIES = new Set(['flee', 'migrate', 'shelter', 'travel', 'construct', 'farm', 'gather']);
const STRUCTURES: Partial<Record<DestinationKind, readonly string[]>> = {
  home: ['shelter', 'lean-to', 'hut', 'house', 'compound'], market: ['market'], shrine: ['shrine', 'ritual-marker'],
  workshop: ['workshop'], 'civic-building': ['hall'], 'knowledge-institution': ['research', 'hall'],
  'industrial-site': ['factory', 'foundry', 'energy'], warehouse: ['warehouse', 'granary'],
};
export interface LocalActivityState {
  authority: string;
  revision: unknown;
  seen: number;
  base: Vec2;
  points: Vec2[];
  focus: Vec2;
  stationFocus: Vec2;
  structure?: ActivityStructure;
  destination: Vec2;
  restFacing: number;
  animation: AnimationState;
  action: string;
  phase: 'approach' | 'orient' | 'action' | 'pause';
  step: number;
  cycle: number;
  /** Documentary slice sequence retained across ordinary semantic hand-offs. */
  sample: number;
  seconds: number;
  hold: number;
  partnerId?: string;
}

export class LocalActivityPresentation {
  private readonly states = new Map<string, LocalActivityState>();
  private frame = 0;
  get size(): number { return this.states.size; }
  get(id: string): Readonly<LocalActivityState> | undefined { return this.states.get(id); }
  beginFrame(): void { this.frame++; }
  prune(): void { for (const [id, state] of this.states) if (state.seen !== this.frame) this.states.delete(id); }
  clear(): void { this.states.clear(); }

  resolve(person: Person, context: LocalActivityContext, delta: number): LocalActivityState | undefined {
    const nav = person.navigation;
    if (!nav) {
      this.states.delete(person.id);
      return undefined;
    }

    // An ordinary commute is a sub-monthly documentary transition. The renderer should show the
    // consumed authoritative route, so local life yields for the shot, but the prior routine stays
    // cached. That prevents the next work/home sample from paying a brand-new arrival pause.
    const ordinaryCommute = !nav.traveling && nav.schedulePhase === 'commute' && person.activity === 'travel';
    if (ordinaryCommute) {
      const suspended = this.states.get(person.id);
      if (suspended) suspended.seen = this.frame;
      return undefined;
    }

    // Specialized physical workers and genuine in-progress/emergency travel own their workflow.
    if (context.blocked || !person.alive || nav.traveling
      || nav.schedulePhase === 'emergency' || person.displacedSinceMonth !== undefined || person.health <= 0.2
      || EXCLUSIVE_ACTIVITIES.has(person.activity)) {
      this.states.delete(person.id);
      return undefined;
    }
    // Keep the routine alive across ordinary monthly position/target/phase churn. Commute,
    // emergency and other exclusive authority changes already yield above; the identity below
    // changes only when the person's actual local-life context changes.
    const authority = localActivityAuthority(person);
    let state = this.states.get(person.id);
    const baseDrift = state ? Math.hypot(state.base.x - context.base.x, state.base.z - context.base.z) : Infinity;
    if (!state || state.authority !== authority || state.revision !== context.revision
      || baseDrift > LOCAL_ACTIVITY_REANCHOR_LIMIT) {
      if (!bounded(person, context.base) || !localSegmentSafe(context.base, context.base, context)) {
        this.states.delete(person.id);
        return undefined;
      }
      const previous = state;
      state = this.create(person, context, authority);
      // "Arrive" is a first-appearance beat, not a tax on every monthly routine hand-off. If this
      // resident already had a local life before a commute/context change, the retained route still
      // supplies the approach. Once oriented, enter a deterministic *different slice* of the
      // destination's ongoing routine instead of replaying step zero every historical sample.
      if (previous) {
        state.sample = previous.sample + 1;
        state.step = sampledEntryStep(person, state.sample) - 1;
        state.hold = 0;
      }
      // A newly placed obstacle can invalidate a formerly safe return corridor. Stop on this
      // side of it; never blindly cut across the new building to resume the old base position.
      if (previous && context.visual && !localSegmentSafe(context.visual, state.destination, context)) {
        state.destination = { x: context.visual.x, z: context.visual.z };
        state.action = 'wait-for-clearance';
      }
      this.states.set(person.id, state);
    } else if (baseDrift > LOCAL_ACTIVITY_BASE_FOLLOW_THRESHOLD) {
      // True hysteresis: ordinary monthly/group-layout jitter is absorbed inside the dead-band.
      // Once drift becomes meaningful, follow only far enough to re-enter the release radius.
      // This prevents an activity frontage from oscillating every month while still letting it
      // track a genuinely shifting workplace/social cluster without restarting the routine.
      this.reanchor(person, context, state, hysteresisBase(state.base, context.base));
    }
    state.seen = this.frame;
    const visual = context.visual;
    if (visual && !visual.traveling && visual.destinationX === state.destination.x && visual.destinationZ === state.destination.z
      && Math.hypot(visual.x - state.destination.x, visual.z - state.destination.z) > 0.035) {
      // Terrain may change between intents. PeopleVisualState stops on accepted ground; adopt
      // that stop and retry a checked task point after a pause instead of waiting forever.
      state.destination = { x: visual.x, z: visual.z };
      state.animation = 'idle'; state.action = 'wait-for-clearance'; state.seconds = 0;
    }
    const arrived = visual && !visual.traveling && Math.hypot(visual.x - state.destination.x, visual.z - state.destination.z) < 0.035;
    const oriented = arrived && atInteraction(visual, state.destination, visual.facing, state.restFacing, visual.speed);
    state.phase = !arrived ? 'approach' : !oriented ? 'orient' : state.action === 'pause' ? 'pause' : 'action';
    // Time spent walking/turning cannot consume the interaction it is approaching.
    if (oriented) state.seconds += Math.max(0, delta);
    if (state.partnerId) {
      const peer = context.people.get(state.partnerId);
      if (!peer || !canInteract(person, peer)) {
        state.partnerId = undefined;
        state.animation = 'idle';
        state.action = 'observe';
        state.seconds = state.hold;
      } else {
        const at = context.visualFor?.(peer.id) ?? peer.position;
        state.focus.x = at.x; state.focus.z = at.z;
        state.restFacing = facingTarget(state.destination, state.focus);
      }
    }
    if (oriented && state.seconds >= state.hold) {
      state.step = (state.step + 1) % (ROUTINES[nav.destinationKind] ?? WORK_ROUTINE).length;
      if (state.step === 0) state.cycle++;
      state.seconds = 0;
      this.choose(person, context, state);
      state.phase = 'approach';
    }
    return state;
  }

  private create(person: Person, context: LocalActivityContext, authority: string): LocalActivityState {
    const base = { x: context.base.x, z: context.base.z };
    const roles = STRUCTURES[person.navigation!.destinationKind];
    let structure: ActivityStructure | undefined;
    let distance = 3;
    for (const candidate of context.structures) {
      if (!roles?.includes(candidate.role ?? '') && candidate.key !== person.navigation!.destinationId) continue;
      const d = Math.hypot(candidate.worldX - base.x, candidate.worldZ - base.z);
      if (d < distance) { structure = candidate; distance = d; }
    }
    const angle = context.base.restFacing ?? unit(`${person.id}:activity-axis`) * Math.PI * 2;
    const focus = structure ? { x: structure.worldX, z: structure.worldZ }
      : { x: base.x + Math.sin(angle) * 0.4, z: base.z + Math.cos(angle) * 0.4 };
    const facing = facingTarget(base, focus);
    const kind = person.navigation!.destinationKind;
    const radius = activityRadius(kind);
    const forward = { x: Math.sin(facing), z: Math.cos(facing) };
    const side = { x: Math.cos(facing), z: -Math.sin(facing) };
    // Group placement is an arrival/safety anchor, not a permanent standing slot. These are
    // nearby semantic frontage positions for the same authoritative activity.
    const offsets = [[0, 0], [1, 0], [-1, 0], [0, -0.75], [0, 0.9], [0.72, 0.52], [-0.72, 0.52]] as const;
    const points = offsets.map(([sideAmount, forwardAmount]) => {
      const candidate = {
        x: base.x + side.x * sideAmount * radius + forward.x * forwardAmount * radius,
        z: base.z + side.z * sideAmount * radius + forward.z * forwardAmount * radius,
      };
      return bounded(person, candidate) && localSegmentSafe(base, candidate, context) ? candidate : base;
    });
    const state: LocalActivityState = { authority, revision: context.revision, seen: this.frame, base, points, focus, stationFocus: { ...focus }, structure,
      destination: base, restFacing: facing, animation: 'idle', action: 'arrive', phase: 'approach',
      step: -1, cycle: 0, sample: 0, seconds: 0,
      hold: LOCAL_ACTIVITY_ARRIVAL_HOLD_SECONDS.min
        + unit(`${person.id}:arrival-pause`)
          * (LOCAL_ACTIVITY_ARRIVAL_HOLD_SECONDS.max - LOCAL_ACTIVITY_ARRIVAL_HOLD_SECONDS.min) };
    return state;
  }

  private reanchor(person: Person, context: LocalActivityContext, state: LocalActivityState, base = context.base): void {
    const anchored = this.create(person, { ...context, base: { ...base, restFacing: context.base.restFacing } }, state.authority);
    const previousDestination = { ...state.destination };
    state.base = anchored.base;
    state.points = anchored.points;
    state.stationFocus = anchored.stationFocus;
    if (anchored.structure) state.structure = anchored.structure;
    else delete state.structure;
    state.revision = context.revision;
    if (!state.partnerId) {
      state.focus.x = anchored.focus.x;
      state.focus.z = anchored.focus.z;
    }

    const from = context.visual ?? state.base;
    if (bounded(person, previousDestination) && localSegmentSafe(from, previousDestination, context)) {
      // Do not jerk a person out of an action already underway. The next routine step will use
      // the newly anchored points.
      state.destination = previousDestination;
    } else {
      let nearest = state.points[0] ?? state.base;
      let best = Infinity;
      for (const point of state.points) {
        const distance = Math.hypot(point.x - previousDestination.x, point.z - previousDestination.z);
        if (distance < best && bounded(person, point) && localSegmentSafe(from, point, context)) {
          best = distance;
          nearest = point;
        }
      }
      state.destination = { ...nearest };
    }
    state.restFacing = facingTarget(state.destination, state.partnerId ? state.focus : state.stationFocus);
  }

  private choose(person: Person, context: LocalActivityContext, state: LocalActivityState): void {
    const kind = person.navigation!.destinationKind;
    const [step, pointIndex, action, seconds] = (ROUTINES[kind] ?? WORK_ROUTINE)[state.step]!;
    const variation = unit(`${person.id}:${state.cycle}:${state.step}:hold`);
    state.hold = seconds * (0.8 + variation * 0.7) * (context.far ? 1.5 : 1);
    state.partnerId = undefined;
    state.animation = 'idle';
    state.action = action;
    const pointOffset = step === 'reposition'
      ? state.cycle + Math.floor(unit(`${person.id}:${state.step}:reposition`) * state.points.length)
      : 0;
    let point = state.points[(pointIndex + pointOffset) % state.points.length]!;
    let focus: Readonly<Vec2> = state.stationFocus;
    if (step === 'interact' || (kind === 'plaza' || kind === 'market') && step === 'task') {
      const members = context.group?.members;
      if (members && members.length > 1) {
        const own = members.indexOf(person.id);
        // Adjacent members start as pods; later cycles change the neighbour they address.
        for (let offset = 1; offset <= Math.min(4, members.length - 1); offset++) {
          const peer = context.people.get(members[(own + offset + state.cycle) % members.length]!);
          if (!peer || !canInteract(person, peer)) continue;
          const peerPosition = context.visualFor?.(peer.id) ?? peer.position;
          const distance = Math.hypot(peerPosition.x - state.base.x, peerPosition.z - state.base.z);
          if (distance < 0.18 || distance > 2.7) continue;
          // Approach a real companion while keeping conversational personal space.
          const personalSpace = 0.42 + unit(`${person.id}:${peer.id}:social-space`) * 0.16;
          const approach = Math.min(0.72, Math.max(0.08, distance - personalSpace));
          const candidate = { x: state.base.x + (peerPosition.x - state.base.x) / distance * approach,
            z: state.base.z + (peerPosition.z - state.base.z) / distance * approach };
          if (!bounded(person, candidate) || !localSegmentSafe(state.destination, candidate, context)) continue;
          point = candidate; focus = peerPosition; state.partnerId = peer.id;
          state.animation = 'converse'; state.action = 'conversation'; break;
        }
      }
    }
    if (step === 'task' || step === 'return') {
      if (kind === 'home' && person.activity === 'rest') { state.animation = 'rest'; state.action = 'rest'; }
      else if (kind === 'shrine' && person.activity === 'worship') { state.animation = 'ritual'; state.action = 'ritual'; }
      else if (state.structure && ['craft', 'study', 'assist'].includes(person.activity)) {
        state.animation = 'work'; state.action = person.activity === 'study' ? 'study'
          : kind === 'workshop' ? 'bench-task' : kind === 'industrial-site' ? 'station-task' : 'workstation-task';
      }
    }
    if (kind === 'patrol-route') state.animation = 'alert';
    if (step === 'inspect' && ['bag', 'basket', 'ledger', 'toolkit'].includes(person.appearance?.carriedItem ?? '')) {
      state.action = 'check-carried-object'; state.animation = 'carry';
    }
    // Validate the actual connecting segment, not just the cached endpoints. No local pathfinder.
    const from = context.visual ?? state.destination;
    if (bounded(person, point) && localSegmentSafe(from, point, context)) state.destination = point;
    else { state.animation = 'idle'; state.action = 'wait-for-clearance'; }
    state.restFacing = facingTarget(state.destination, focus);
    // Own the focus vector; never retain/mutate a simulation position through a peer alias.
    if (focus !== state.focus) { state.focus.x = focus.x; state.focus.z = focus.z; }
  }
}


function activityRadius(kind: DestinationKind): number {
  if (kind === 'plaza' || kind === 'market') return 0.72;
  if (kind === 'patrol-route') return 0.9;
  if (kind === 'field') return 0.7;
  if (kind === 'warehouse' || kind === 'industrial-site') return 0.62;
  if (kind === 'workshop' || kind === 'knowledge-institution' || kind === 'civic-building') return 0.56;
  if (kind === 'shrine') return 0.52;
  if (kind === 'home') return 0.44;
  return 0.5;
}

function sampledEntryStep(person: Person, sample: number): number {
  const routine = ROUTINES[person.navigation!.destinationKind] ?? WORK_ROUTINE;
  const purposeful = routine
    .map((intent, index) => ({ intent, index }))
    .filter(({ intent }) => intent[0] !== 'pause');
  if (purposeful.length === 0) return 0;
  const offset = Math.floor(unit(`${person.id}:${person.navigation!.destinationKind}:entry-slice`) * purposeful.length);
  return purposeful[(offset + sample) % purposeful.length]!.index;
}

function hysteresisBase(current: Vec2, observed: Vec2): Vec2 {
  const dx = observed.x - current.x, dz = observed.z - current.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= LOCAL_ACTIVITY_BASE_RELEASE_RADIUS || distance === 0) return { ...current };
  const follow = distance - LOCAL_ACTIVITY_BASE_RELEASE_RADIUS;
  return { x: current.x + dx / distance * follow, z: current.z + dz / distance * follow };
}

function localActivityAuthority(person: Person): string {
  const nav = person.navigation!;
  // Intentionally omit position, target, waypoint index, schedule phase and carried appearance.
  // Those can change on monthly presentation refreshes without changing what the person is
  // semantically doing here. True interruptions are handled before this key is evaluated.
  return `${person.homeId}|${person.householdId}|${person.occupation}|${person.role}|${person.activity}|${nav.destinationKind}|${nav.destinationId}`;
}

function canInteract(person: Person, peer: Person): boolean {
  return peer.id !== person.id && peer.alive && peer.health > 0.2 && !peer.navigation?.traveling
    && peer.navigation?.schedulePhase !== 'emergency' && peer.displacedSinceMonth === undefined
    && !['flee', 'migrate', 'shelter'].includes(peer.activity)
    && peer.navigation?.destinationId === person.navigation?.destinationId
    && peer.navigation?.destinationKind === person.navigation?.destinationKind;
}
function bounded(person: Person, point: Vec2): boolean {
  return Math.hypot(point.x - person.position.x, point.z - person.position.z) <= LOCAL_ACTIVITY_RADIUS;
}

/** Reuses the resource-work terrain corridor check and the renderer's building clearance rule.
 * Exact rotated footprints additionally protect long/narrow buildings and their corners. */
export function localSegmentSafe(a: Vec2, b: Vec2, context: Pick<LocalActivityContext, 'structures' | 'safeSegment'>): boolean {
  if (!context.safeSegment(a, b)) return false;
  const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.06));
  for (let i = 0; i <= count; i++) {
    const x = a.x + (b.x - a.x) * i / count, z = a.z + (b.z - a.z) * i / count;
    for (const building of context.structures) {
      const dx = x - building.worldX, dz = z - building.worldZ;
      const clearance = Math.max(building.width, building.depth) * 0.52 + 0.12;
      if (Math.hypot(dx, dz) < clearance) return false;
      const c = Math.cos(building.rotationY), s = Math.sin(building.rotationY);
      if (Math.abs(c * dx - s * dz) < building.width / 2 + 0.1
        && Math.abs(s * dx + c * dz) < building.depth / 2 + 0.1) return false;
    }
  }
  return true;
}

/** Hashable geometry facts only: monthly output/banner rebuilds must not restart local lives. */
export function activityStructureSignature(structures: readonly ActivityStructure[]): string {
  return structures.map(s => `${s.key}:${s.worldX},${s.worldZ},${s.width},${s.depth},${s.rotationY}:${s.role}`).join('|');
}

/** Existing radial person clearance, plus the corners of the actual rotated footprint. */
export function clearActivityStructure(point: Vec2, building: ActivityStructure, fallbackAngle: number): Vec2 {
  let x = point.x, z = point.z;
  const clearance = Math.max(building.width, building.depth) * 0.52 + 0.2;
  const dx = x - building.worldX, dz = z - building.worldZ, separation = Math.hypot(dx, dz);
  if (separation < clearance) {
    const angle = separation > 0.001 ? Math.atan2(dz, dx) : fallbackAngle;
    x = building.worldX + Math.cos(angle) * clearance; z = building.worldZ + Math.sin(angle) * clearance;
  }
  const c = Math.cos(building.rotationY), s = Math.sin(building.rotationY);
  let localX = c * (x - building.worldX) - s * (z - building.worldZ);
  let localZ = s * (x - building.worldX) + c * (z - building.worldZ);
  const halfX = building.width / 2 + 0.12, halfZ = building.depth / 2 + 0.12;
  if (Math.abs(localX) < halfX && Math.abs(localZ) < halfZ) {
    if (halfX - Math.abs(localX) < halfZ - Math.abs(localZ)) localX = (localX < 0 ? -1 : 1) * halfX;
    else localZ = (localZ < 0 ? -1 : 1) * halfZ;
    x = building.worldX + c * localX + s * localZ; z = building.worldZ - s * localX + c * localZ;
  }
  return x === point.x && z === point.z ? point : { x, z };
}
