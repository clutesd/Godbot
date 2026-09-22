import type { DestinationKind, Person, SocialRelationship, SocialRelationshipKind, Vec2 } from '../../sim/types';
import { memoryInfluenceFor } from '../../sim/people/PersonalMemorySystem';
import type { AnimationState } from '../animation/AnimationController';
import { resourceVisualUnit as unit } from '../../sim/resources/ResourceWorkPresentation';
import { atInteraction, facingTarget } from './PhysicalActionPresentation';
import type { GroupPlacement, SocialGroup } from './PeoplePresentation';
import type { PersonVisualState } from './PeopleVisualState';
import { planRestSpot, type RestSpotPresentation, type RestSupportFootprint } from './RestPresentation';

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
export interface ActivityStructure extends RestSupportFootprint {
  role?: string;
}
export interface LocalActivityContext {
  base: GroupPlacement;
  visual?: PersonVisualState;
  group?: SocialGroup;
  /** Visible peers only; callers cache the index once per frame. */
  people: ReadonlyMap<string, Person>;
  /** Authoritative social graph lookup. Presentation reads it but never mutates it. */
  relationshipFor?(a: string, b: string): SocialRelationship | undefined;
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

export type SocialEncounterTone = 'warm' | 'supportive' | 'mentoring' | 'collaborative' | 'formal' | 'casual' | 'tense';
type SocialEncounterRole = 'peer' | 'mentor' | 'learner' | 'supporter' | 'supported';
interface SocialBeat {
  action: string;
  animation: AnimationState;
  seconds: number;
  spacing: number;
  lateral: number;
}
const SOCIAL_SCRIPTS: Record<SocialEncounterTone, readonly SocialBeat[]> = {
  warm: [
    { action: 'warm-greeting', animation: 'converse-warm', seconds: 1.15, spacing: 0.44, lateral: 0.03 },
    { action: 'warm-conversation', animation: 'converse-warm', seconds: 2.25, spacing: 0.45, lateral: 0.06 },
    { action: 'linger-together', animation: 'converse-quiet', seconds: 1.65, spacing: 0.47, lateral: 0.04 },
  ],
  supportive: [
    { action: 'check-in', animation: 'converse-quiet', seconds: 1.35, spacing: 0.43, lateral: 0.02 },
    { action: 'quiet-company', animation: 'converse-quiet', seconds: 2.65, spacing: 0.44, lateral: 0.02 },
    { action: 'reassurance', animation: 'converse-warm', seconds: 1.8, spacing: 0.45, lateral: 0.04 },
  ],
  mentoring: [
    { action: 'guidance-opening', animation: 'converse-teach', seconds: 1.4, spacing: 0.5, lateral: 0.04 },
    { action: 'guidance-exchange', animation: 'converse-teach', seconds: 2.35, spacing: 0.5, lateral: 0.06 },
    { action: 'guidance-reflection', animation: 'converse-quiet', seconds: 1.7, spacing: 0.52, lateral: 0.04 },
  ],
  collaborative: [
    { action: 'consult', animation: 'converse', seconds: 1.25, spacing: 0.5, lateral: 0.04 },
    { action: 'exchange-ideas', animation: 'converse-teach', seconds: 2.15, spacing: 0.51, lateral: 0.07 },
    { action: 'consider-together', animation: 'converse-quiet', seconds: 1.5, spacing: 0.53, lateral: 0.04 },
  ],
  formal: [
    { action: 'formal-greeting', animation: 'converse-quiet', seconds: 1.05, spacing: 0.57, lateral: 0.02 },
    { action: 'formal-consultation', animation: 'converse', seconds: 1.8, spacing: 0.58, lateral: 0.04 },
    { action: 'acknowledge', animation: 'converse-quiet', seconds: 1.0, spacing: 0.6, lateral: 0.02 },
  ],
  casual: [
    { action: 'greeting', animation: 'converse', seconds: 1.0, spacing: 0.52, lateral: 0.04 },
    { action: 'brief-conversation', animation: 'converse', seconds: 1.75, spacing: 0.54, lateral: 0.06 },
  ],
  tense: [
    { action: 'guarded-greeting', animation: 'converse-tense', seconds: 0.9, spacing: 0.7, lateral: 0.02 },
    { action: 'guarded-exchange', animation: 'converse-tense', seconds: 1.35, spacing: 0.74, lateral: 0.04 },
    { action: 'disengage', animation: 'converse-quiet', seconds: 0.8, spacing: 0.78, lateral: 0.03 },
  ],
};

export interface SocialEncounterPresentation {
  partnerId: string;
  tone: SocialEncounterTone;
  role: SocialEncounterRole;
  relationshipKind?: SocialRelationshipKind;
  relationshipId?: string;
  strength: number;
  trust: number;
  beat: number;
  pairedOffset?: Vec2;
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
  /** Physical support slot reserved for an active home-rest beat. */
  rest?: RestSpotPresentation;
  restFacing: number;
  animation: AnimationState;
  action: string;
  phase: 'approach' | 'orient' | 'action' | 'pause';
  step: number;
  cycle: number;
  /** Documentary slice sequence retained across ordinary semantic hand-offs. */
  sample: number;
  seconds: number;
  sceneSeconds?: number;
  socialCooldown?: number;
  hold: number;
  partnerId?: string;
  /** Multi-beat presentation-only social encounter derived from real relationship authority. */
  encounter?: SocialEncounterPresentation;
  /** Discourages immediate partner repetition when a group offers other plausible people. */
  lastPartnerId?: string;
}

export class LocalActivityPresentation {
  private readonly states = new Map<string, LocalActivityState>();
  private frame = 0;
  private readonly previousStates = new Map<string, LocalActivityState>();
  get size(): number { return this.states.size; }
  get(id: string): Readonly<LocalActivityState> | undefined { return this.states.get(id); }
  beginFrame(): void {
    this.frame++; this.previousStates.clear();
    for (const [id, state] of this.states) this.previousStates.set(id, { ...state,
      destination: { ...state.destination },
      rest: state.rest ? { ...state.rest, destination: { ...state.rest.destination } } : undefined,
      encounter: state.encounter ? { ...state.encounter } : undefined });
  }
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
      || baseDrift > LOCAL_ACTIVITY_REANCHOR_LIMIT && !bounded(person, state.destination)) {
      if (!bounded(person, context.base) || !localSegmentSafe(context.base, context.base, context)) {
        this.states.delete(person.id);
        return undefined;
      }
      const previous = state;
      const stagedBase = delta > 0 && previous?.revision === context.revision && context.visual && bounded(person, context.visual)
        && localSegmentSafe(context.visual, context.visual, context)
        ? { x: context.visual.x, z: context.visual.z, restFacing: context.visual.facing } : context.base;
      state = this.create(person, { ...context, base: stagedBase }, authority);
      // "Arrive" is a first-appearance beat, not a tax on every monthly routine hand-off. If this
      // resident already had a local life before a commute/context change, the retained route still
      // supplies the approach. Once oriented, enter a deterministic *different slice* of the
      // destination's ongoing routine instead of replaying step zero every historical sample.
      if (previous) {
        state.sample = previous.sample + 1;
        state.step = sampledEntryStep(person, state.sample) - 1;
        state.hold = 0;
        state.lastPartnerId = previous.lastPartnerId ?? previous.partnerId;
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
    state.sceneSeconds = (state.sceneSeconds ?? 0) + Math.max(0, delta);
    state.socialCooldown = Math.max(0, (state.socialCooldown ?? 0) - delta);
    // Personal space is a live constraint, not only a target-selection check. If an uninvolved
    // resident drifts into this destination after it was chosen, step to another valid frontage
    // point rather than waiting on a future routine transition to resolve the overlap.
    if (!state.rest && !hasPeerClearance(person, state.destination, context, state.partnerId, 0.34)) {
      const preferred = Math.abs(state.step + state.cycle + 1) % Math.max(1, state.points.length);
      const adjusted = clearLocalPoint(person, context, state, preferred, true, state.partnerId);
      if (Math.hypot(adjusted.x - state.destination.x, adjusted.z - state.destination.z) > 0.01) {
        state.destination = adjusted;
        state.seconds = 0;
        state.phase = 'approach';
      }
    }
    // Invitations are renderer-owned and reciprocal. A resident cannot belong to two scenes.
    if (!state.encounter && !state.socialCooldown) {
      for (const id of context.group?.members ?? []) {
        const invitation = this.previousStates.get(id);
        const peer = context.people.get(id);
        if (!peer || invitation?.encounter?.partnerId !== person.id || !canInteract(person, peer)) continue;
        delete state.rest;
        state.encounter = buildSocialEncounter(person, peer, context.relationshipFor?.(person.id, peer.id));
        state.encounter.beat = invitation.encounter.beat;
        state.partnerId = peer.id; state.seconds = 0;
        applySocialBeat(person, peer, context, state);
        // The invited listener holds their place while the initiator approaches.
        state.destination = { x: context.visual?.x ?? state.base.x, z: context.visual?.z ?? state.base.z };
        state.restFacing = facingTarget(state.destination, context.visualFor?.(peer.id) ?? peer.position);
        break;
      }
    }
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
    const partnerState = state.partnerId ? this.previousStates.get(state.partnerId) : undefined;
    if (state.encounter && partnerState && !partnerState.encounter && partnerState.lastPartnerId === person.id) {
      state.socialCooldown = 2; state.lastPartnerId = state.partnerId; state.encounter = undefined; state.partnerId = undefined;
      state.animation = 'idle'; state.action = 'quiet-departure'; state.seconds = 0; state.hold = 1.8;
    }
    if (state.encounter && ((partnerState?.partnerId && partnerState.partnerId !== person.id)
      || (state.sceneSeconds ?? 0) > 12 && state.phase === 'approach')) {
      state.socialCooldown = 2; state.lastPartnerId = state.partnerId; state.encounter = undefined; state.partnerId = undefined;
      state.animation = 'idle'; state.action = 'observe'; state.seconds = state.hold;
    }
    const reciprocal = partnerState?.partnerId === person.id;
    const partnerReady = reciprocal && (partnerState.phase === 'action' || partnerState.phase === 'pause');
    if (oriented && (!state.encounter || partnerReady)) state.seconds += Math.max(0, delta);
    if (state.encounter && reciprocal && partnerState.encounter
      && state.encounter.beat < partnerState.encounter.beat) {
      state.encounter.beat = Math.max(state.encounter.beat, partnerState.encounter.beat);
      state.encounter.pairedOffset = partnerState.encounter.pairedOffset;
      const peer = context.people.get(state.partnerId!);
      if (peer) { state.seconds = 0; applySocialBeat(person, peer, context, state); }
    }
    if (state.partnerId) {
      const peer = context.people.get(state.partnerId);
      if (!peer || !canInteract(person, peer)) {
        state.partnerId = undefined;
        state.encounter = undefined;
        state.animation = 'idle';
        state.action = 'observe';
        state.seconds = state.hold;
      } else {
        const at = context.visualFor?.(peer.id) ?? peer.position;
        state.focus.x = at.x; state.focus.z = at.z;
        state.restFacing = facingTarget(state.destination, state.focus);
      }
    }
    // The stable pair leader advances the shared beat; listener readiness is required.
    const leads = !state.encounter || !reciprocal || person.id < state.partnerId!;
    if (oriented && leads && state.seconds >= state.hold) {
      if (state.encounter) {
        const peer = context.people.get(state.encounter.partnerId);
        if (peer && canInteract(person, peer) && state.encounter.beat + 1 < SOCIAL_SCRIPTS[state.encounter.tone].length) {
          state.encounter.beat += 1;
          if (state.encounter.beat === 2 && ['warm', 'collaborative'].includes(state.encounter.tone)) {
            const at = context.visualFor?.(peer.id) ?? peer.position;
            const dx = state.stationFocus.x - (state.destination.x + at.x) / 2;
            const dz = state.stationFocus.z - (state.destination.z + at.z) / 2;
            const length = Math.hypot(dx, dz) || 1;
            const offset = { x: dx / length * 0.32, z: dz / length * 0.32 };
            const a = { x: state.destination.x + offset.x, z: state.destination.z + offset.z };
            const b = { x: at.x + offset.x, z: at.z + offset.z };
            if (bounded(person, a) && bounded(peer, b) && localSegmentSafe(state.destination, a, context)
              && localSegmentSafe(at, b, context) && hasPeerClearance(person, a, context, peer.id)
              && hasPeerClearance(peer, b, context, person.id)) state.encounter.pairedOffset = offset;
          }
          state.seconds = 0;
          applySocialBeat(person, peer, context, state);
          state.phase = 'approach';
          return state;
        }
        state.socialCooldown = 2;
        state.lastPartnerId = state.encounter.partnerId;
        state.encounter = undefined;
        state.partnerId = undefined;
      }
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
    state.sceneSeconds = 0;
    state.hold = seconds * (0.8 + variation * 0.7) * (context.far ? 1.5 : 1);
    state.partnerId = undefined;
    state.encounter = undefined;
    delete state.rest;
    state.animation = 'idle';
    state.action = action;
    const pointOffset = step === 'reposition'
      ? state.cycle + Math.floor(unit(`${person.id}:${state.step}:reposition`) * state.points.length)
      : 0;
    const preferredPoint = (pointIndex + pointOffset) % state.points.length;
    const point = clearLocalPoint(person, context, state, preferredPoint, step === 'reposition' || step === 'inspect');
    const focus: Readonly<Vec2> = state.stationFocus;
    if (!state.socialCooldown && (step === 'interact' || (kind === 'plaza' || kind === 'market') && step === 'task')) {
      const selected = selectSocialPartner(person, context, state, id => {
        const peer = this.previousStates.get(id);
        return !peer?.socialCooldown && person.id < id && (!peer?.partnerId || peer.partnerId === person.id);
      });
      if (selected) {
        state.encounter = buildSocialEncounter(person, selected.peer, selected.relationship);
        state.partnerId = selected.peer.id;
        applySocialBeat(person, selected.peer, context, state);
        return;
      }
    }
    if (step === 'task' || step === 'return') {
      if (kind === 'home' && person.activity === 'rest') {
        const from = context.visual ? { x: context.visual.x, z: context.visual.z } : state.destination;
        const rest = planRestSpot({
          personId: person.id,
          base: state.base,
          from,
          group: context.group,
          structure: state.structure,
          restingIds: context.group?.members.filter(id => context.people.get(id)?.activity === 'rest'),
          safePoint: candidate => bounded(person, candidate)
            && localSegmentSafe(candidate, candidate, context)
            && hasPeerClearance(person, candidate, context, undefined, 0.3),
          safeSegment: (a, b) => localSegmentSafe(a, b, context),
        });
        if (rest) {
          state.rest = rest;
          state.animation = 'rest';
          state.action = 'rest';
          state.destination = { ...rest.destination };
          state.restFacing = rest.facing;
          state.focus.x = rest.destination.x + Math.sin(rest.facing) * 0.5;
          state.focus.z = rest.destination.z + Math.cos(rest.facing) * 0.5;
          return;
        }
        state.animation = 'idle';
        state.action = 'wait-for-rest-place';
      }
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
    // Validate the actual connecting segment, not just the cached endpoints. A local target also
    // keeps room around uninvolved visible peers; the conversation partner is the one deliberate
    // exception and already has its own personal-space stand-off.
    const from = context.visual ?? state.destination;
    const peerSafe = hasPeerClearance(person, point, context, state.partnerId, 0.34);
    if (bounded(person, point) && localSegmentSafe(from, point, context) && peerSafe) state.destination = point;
    else { state.animation = 'idle'; state.action = 'wait-for-clearance'; }
    state.restFacing = facingTarget(state.destination, focus);
    // Own the focus vector; never retain/mutate a simulation position through a peer alias.
    if (focus !== state.focus) { state.focus.x = focus.x; state.focus.z = focus.z; }
  }
}


interface SocialPartnerSelection {
  peer: Person;
  relationship?: SocialRelationship;
  score: number;
}

function selectSocialPartner(person: Person, context: LocalActivityContext, state: LocalActivityState, available: (id: string) => boolean): SocialPartnerSelection | undefined {
  const members = context.group?.members;
  if (!members || members.length < 2) return undefined;
  const own = members.indexOf(person.id);
  const reciprocal = own >= 0 ? (own % 2 === 0 ? own + 1 : own - 1) : -1;
  const currentMonth = person.bornMonth + person.ageMonths;
  const candidates: SocialPartnerSelection[] = [];
  for (let index = 0; index < members.length; index++) {
    const peerId = members[index]!;
    const peer = context.people.get(peerId);
    if (!peer || !available(peerId) || !canInteract(person, peer)) continue;
    const peerPosition = context.visualFor?.(peer.id) ?? peer.position;
    const distance = Math.hypot(peerPosition.x - state.base.x, peerPosition.z - state.base.z);
    if (distance < 0.18 || distance > 2.7) continue;
    const relationship = context.relationshipFor?.(person.id, peer.id);
    let score = relationshipScoreForPresentation(person, peer, relationship, currentMonth);
    if (index === reciprocal) score += 0.14;
    if (state.lastPartnerId === peer.id && members.length > 2) score -= 0.16;
    score -= Math.max(0, distance - 0.8) * 0.05;
    score += unit(`${person.id}:${peer.id}:${state.cycle}:social-choice`) * 0.025;
    candidates.push({ peer, relationship, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.peer.id.localeCompare(b.peer.id));
  return candidates[0];
}

function relationshipScoreForPresentation(person: Person, peer: Person, relationship: SocialRelationship | undefined, month: number): number {
  const kindBase: Partial<Record<SocialRelationshipKind, number>> = {
    family: 0.95, friend: 0.9, mentor: 0.88, 'intellectual-collaborator': 0.82,
    'political-ally': 0.73, superior: 0.62, colleague: 0.56, neighbor: 0.46, rival: 0.16,
  };
  let score = 0.2 + (person.traits.sociability + peer.traits.sociability) * 0.08
    + (person.traits.cooperation + peer.traits.cooperation) * 0.055;
  if (relationship) {
    const recency = Math.exp(-Math.max(0, month - relationship.lastContactMonth) / 36);
    score += (kindBase[relationship.kind] ?? 0.3)
      + relationship.strength * 0.42
      + (relationship.kind === 'rival' ? 1 - relationship.trust : relationship.trust) * 0.2
      + recency * 0.08;
  }
  if (person.partnerId === peer.id || peer.partnerId === person.id) score += 0.4;
  if (person.householdId === peer.householdId) score += 0.28;
  if (person.parents.includes(peer.id) || peer.parents.includes(person.id) || person.children.includes(peer.id) || peer.children.includes(person.id)) score += 0.35;
  if (person.workplaceId && person.workplaceId === peer.workplaceId) score += 0.12;
  if (person.institutionId && person.institutionId === peer.institutionId) score += 0.12;
  return score;
}

function buildSocialEncounter(person: Person, peer: Person, relationship: SocialRelationship | undefined): SocialEncounterPresentation {
  const selfMemory = memoryInfluenceFor(person);
  const peerMemory = memoryInfluenceFor(peer);
  const strength = relationship?.strength ?? (person.householdId === peer.householdId ? 0.5 : 0.25);
  const trust = relationship?.trust ?? (person.householdId === peer.householdId ? 0.62 : 0.48);
  let tone: SocialEncounterTone;
  let role: SocialEncounterRole = 'peer';

  const selfDistress = Math.max(selfMemory.grief, selfMemory.recentShock);
  const peerDistress = Math.max(peerMemory.grief, peerMemory.recentShock);
  const closePositive = relationship?.kind !== 'rival'
    && (relationship?.kind === 'family' || relationship?.kind === 'friend' || relationship?.kind === 'mentor'
      || person.householdId === peer.householdId || person.partnerId === peer.id || peer.partnerId === person.id);
  if (closePositive && Math.max(selfDistress, peerDistress) > 0.28) {
    tone = 'supportive';
    role = selfDistress > peerDistress + 0.08 ? 'supported'
      : peerDistress > selfDistress + 0.08 ? 'supporter' : 'peer';
  } else {
    switch (relationship?.kind) {
      case 'family':
      case 'friend':
        tone = 'warm'; break;
      case 'mentor':
        tone = 'mentoring';
        if (relationship.teaching?.mentorId === person.id) role = 'mentor';
        else if (relationship.teaching?.learnerId === person.id) role = 'learner';
        else role = person.ageMonths >= peer.ageMonths ? 'mentor' : 'learner';
        break;
      case 'intellectual-collaborator':
      case 'colleague':
        tone = 'collaborative'; break;
      case 'political-ally':
      case 'superior':
        tone = 'formal'; break;
      case 'rival':
        tone = 'tense'; break;
      case 'neighbor':
        tone = 'casual'; break;
      default:
        tone = person.householdId === peer.householdId ? 'warm'
          : person.workplaceId && person.workplaceId === peer.workplaceId ? 'collaborative' : 'casual';
    }
  }

  return {
    partnerId: peer.id,
    tone,
    role,
    ...(relationship ? { relationshipKind: relationship.kind, relationshipId: relationship.id } : {}),
    strength,
    trust,
    beat: 0,
  };
}

function socialActionFor(encounter: SocialEncounterPresentation, baseAction: string): string {
  if (encounter.tone === 'supportive') {
    if (encounter.role === 'supporter') return baseAction === 'check-in' ? 'check-in' : baseAction === 'quiet-company' ? 'offer-quiet-company' : 'offer-reassurance';
    if (encounter.role === 'supported') return baseAction === 'check-in' ? 'receive-check-in' : baseAction === 'quiet-company' ? 'accept-quiet-company' : 'receive-reassurance';
  }
  if (encounter.tone === 'mentoring') {
    if (encounter.role === 'mentor') return encounter.beat === 0 ? 'offer-guidance' : encounter.beat === 1 ? 'explain-guidance' : 'check-understanding';
    if (encounter.role === 'learner') return encounter.beat === 0 ? 'seek-guidance' : encounter.beat === 1 ? 'listen-to-mentor' : 'consider-guidance';
  }
  return baseAction;
}

function applySocialBeat(person: Person, peer: Person, context: LocalActivityContext, state: LocalActivityState): void {
  const encounter = state.encounter;
  if (!encounter) return;
  const script = SOCIAL_SCRIPTS[encounter.tone];
  const beat = script[Math.min(encounter.beat, script.length - 1)]!;
  const peerPosition = context.visualFor?.(peer.id) ?? peer.position;
  const from = context.visual ?? state.destination;
  let dx = from.x - peerPosition.x;
  let dz = from.z - peerPosition.z;
  let distance = Math.hypot(dx, dz);
  if (distance < 0.001) {
    const angle = unit(`${person.id}:${peer.id}:encounter-axis`) * Math.PI * 2;
    dx = Math.cos(angle); dz = Math.sin(angle); distance = 1;
  }
  dx /= distance; dz /= distance;
  const lateralSign = unit(`${person.id}:${peer.id}:encounter-side`) < 0.5 ? -1 : 1;
  const spacing = beat.spacing
    + (encounter.tone === 'warm' || encounter.tone === 'supportive' ? -encounter.trust * 0.035 : 0)
    + (encounter.tone === 'tense' ? encounter.strength * 0.05 : 0);
  const lateralX = -dz * beat.lateral * lateralSign;
  const lateralZ = dx * beat.lateral * lateralSign;
  const candidate = {
    x: peerPosition.x + dx * spacing + lateralX,
    z: peerPosition.z + dz * spacing + lateralZ,
  };
  if (encounter.beat === 0 && bounded(person, candidate) && localSegmentSafe(from, candidate, context)
    && hasPeerClearance(person, candidate, context, peer.id, 0.34)) {
    state.destination = candidate;
  }
  if (encounter.pairedOffset) {
    const paired = { x: state.destination.x + encounter.pairedOffset.x, z: state.destination.z + encounter.pairedOffset.z };
    if (bounded(person, paired) && localSegmentSafe(from, paired, context)) state.destination = paired;
  }
  state.focus.x = peerPosition.x;
  state.focus.z = peerPosition.z;
  state.restFacing = facingTarget(state.destination, state.focus);
  state.partnerId = peer.id;
  const speaking = encounter.role === 'mentor' || encounter.role === 'supporter'
    || encounter.role === 'peer' && (person.id < peer.id) === (encounter.beat % 2 === 0);
  state.animation = speaking ? beat.animation : 'converse-quiet';
  state.action = socialActionFor(encounter, beat.action);
  const relationalLinger = encounter.tone === 'tense'
    ? 0.82 + encounter.strength * 0.08
    : 0.9 + encounter.strength * 0.18 + encounter.trust * 0.14
      + (person.traits.sociability + peer.traits.sociability) * 0.05;
  state.hold = beat.seconds * relationalLinger * (context.far ? 1.35 : 1);
}

function hasPeerClearance(person: Person, point: Vec2, context: LocalActivityContext, ignoreId?: string, minimum = 0.3): boolean {
  const members = context.group?.members;
  if (!members) return true;
  for (const id of members) {
    if (id === person.id || id === ignoreId) continue;
    const peer = context.people.get(id);
    if (!peer || !peer.alive) continue;
    const at = context.visualFor?.(id) ?? peer.position;
    if (Math.hypot(point.x - at.x, point.z - at.z) < minimum) return false;
  }
  return true;
}

function clearLocalPoint(person: Person, context: LocalActivityContext, state: LocalActivityState, preferred: number, vary: boolean,
  ignoreId?: string): Vec2 {
  const from = context.visual ?? state.destination;
  for (let offset = 0; offset < state.points.length; offset++) {
    const index = (preferred + offset) % state.points.length;
    const base = state.points[index]!;
    let candidate = base;
    if (vary) {
      // A few centimetres of deterministic micro-variation keeps repeated cycles from exposing
      // seven exact floor markers while preserving the semantic frontage and replayability.
      const angle = unit(`${person.id}:${state.cycle}:${state.step}:${index}:angle`) * Math.PI * 2;
      const radius = 0.035 + unit(`${person.id}:${state.cycle}:${state.step}:${index}:radius`) * 0.085;
      const varied = { x: base.x + Math.cos(angle) * radius, z: base.z + Math.sin(angle) * radius };
      if (bounded(person, varied) && localSegmentSafe(from, varied, context)) candidate = varied;
    }
    if (bounded(person, candidate) && localSegmentSafe(from, candidate, context)
      && hasPeerClearance(person, candidate, context, ignoreId, 0.34)) return candidate;
  }
  // Holding the current position is preferable to stepping through another resident just to keep
  // a routine moving. The next intent will retry a different semantic point.
  return { x: state.destination.x, z: state.destination.z };
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
