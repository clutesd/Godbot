import type { DestinationKind, Person, SocialRelationship, SocialRelationshipKind, Vec2 } from '../../sim/types';
import { memoryInfluenceFor } from '../../sim/people/PersonalMemorySystem';
import type { AnimationState } from '../animation/AnimationController';
import { resourceVisualUnit as unit } from '../../sim/resources/ResourceWorkPresentation';
import { atInteraction, facingTarget } from './PhysicalActionPresentation';
import { conversationPodCenter, conversationPodFor, type GroupPlacement, type SocialGroup, type SocialPod } from './PeoplePresentation';
import type { PersonVisualState } from './PeopleVisualState';
import { planRestSpot, type RestSpotPresentation, type RestSupportFootprint } from './RestPresentation';
import { restPreferenceFor, restTransitionSeconds, type RestStage } from './RestChoreography';

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
const SOCIAL_AWARENESS_RADIUS = 1.2;
const SOCIAL_AWARENESS_ACQUIRE_SECONDS = 0.28;
const SOCIAL_AWARENESS_RELEASE_SECONDS = 0.42;
const SOCIAL_AWARENESS_MIN_HOLD_SECONDS = 0.45;
const SOCIAL_AWARENESS_MAX_HOLD_SECONDS = 1.05;
const SOCIAL_AWARENESS_COOLDOWN_MIN_SECONDS = 7;
const SOCIAL_AWARENESS_COOLDOWN_MAX_SECONDS = 16;
const SOCIAL_AWARENESS_MAX_HEAD_YAW = 0.62;
const SOCIAL_AWARENESS_MAX_TORSO_YAW = 0.15;
const RECENT_SOCIAL_ENCOUNTER_SECONDS = 16;
const RECENT_SOCIAL_POD_SECONDS = 10;
const RECENT_SOCIAL_PLAY_SECONDS = 12;
const RECENT_SOCIAL_PASSING_SECONDS = 5;
const MUTUAL_YIELD_RADIUS = 0.95;
const MUTUAL_YIELD_SECONDS = 0.58;
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
const YOUNG_CHILD_PLAY_ROUTINE: readonly Intent[] = [
  ['task', 0, 'play-explore', 1.5],
  ['reposition', 1, 'play-toddle', 1.2],
  ['pause', 0, 'play-watch', 1.0],
  ['task', 2, 'play-reach', 1.35],
  ['reposition', 3, 'play-return', 1.2],
];
const CHILD_PLAY_ROUTINE: readonly Intent[] = [
  ['reposition', 4, 'play-dash', 1.0],
  ['task', 0, 'play-hop', 1.1],
  ['reposition', 5, 'play-circle', 1.15],
  ['pause', 1, 'play-watch', 0.7],
  ['reposition', 6, 'play-chase', 1.0],
  ['task', 2, 'play-gesture', 1.15],
  ['reposition', 3, 'play-return', 1.0],
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
    { action: 'warm-greeting', animation: 'social-wave', seconds: 0.95, spacing: 0.44, lateral: 0.03 },
    { action: 'warm-conversation', animation: 'converse-warm', seconds: 2.0, spacing: 0.45, lateral: 0.06 },
    { action: 'small-shared-laugh', animation: 'social-laugh', seconds: 0.78, spacing: 0.46, lateral: 0.05 },
    { action: 'linger-together', animation: 'converse-quiet', seconds: 1.4, spacing: 0.47, lateral: 0.04 },
  ],
  supportive: [
    { action: 'check-in', animation: 'converse-quiet', seconds: 1.35, spacing: 0.43, lateral: 0.02 },
    { action: 'quiet-company', animation: 'converse-quiet', seconds: 5.8, spacing: 0.52, lateral: 0.02 },
    { action: 'reassurance', animation: 'converse-warm', seconds: 3.2, spacing: 0.52, lateral: 0.04 },
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
    { action: 'greeting', animation: 'social-wave', seconds: 0.85, spacing: 0.52, lateral: 0.04 },
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
  /** Explicit choreography stage keeps departure blocked until the body is standing again. */
  restStage?: RestStage;
  /** Documentary hold retained separately from settle/rise transition durations. */
  restHold?: number;
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
  /** Brief presentation-only notice of a nearby peer before any full social encounter. */
  attentionId?: string;
  attentionPhase?: 'acquire' | 'hold' | 'release';
  attentionSeconds?: number;
  attentionHold?: number;
  /** 0..1 ease value used by the renderer to layer head/torso attention without steering locomotion. */
  attentionBlend?: number;
  /** Signed yaw relative to locomotion facing; head leads, torso only follows for meaningful recognition. */
  attentionHeadYaw?: number;
  attentionTorsoYaw?: number;
  attentionCooldown?: number;
  hold: number;
  partnerId?: string;
  /** Multi-beat presentation-only social encounter derived from real relationship authority. */
  encounter?: SocialEncounterPresentation;
  /** Discourages immediate partner repetition when a group offers other plausible people. */
  lastPartnerId?: string;
  /** Pod attention that is neither a generic glance nor an exclusive two-person encounter. */
  socialFocusId?: string;
  socialRole?: 'speaker' | 'listener';
  /** Shared child-game presentation state. Never mutates simulation activity or relationships. */
  playGame?: 'parallel' | 'tag' | 'circle' | 'follow';
  playRole?: 'solo' | 'runner' | 'chaser' | 'leader' | 'follower' | 'orbit';
  /** Short presentation-side continuity: who mattered in the immediately preceding social moment. */
  recentSocialId?: string;
  recentSocialKind?: 'encounter' | 'pod' | 'play' | 'passing';
  recentSocialUntil?: number;
  /** One-way anticipation overlay used to yield before paths collide; never changes simulation authority. */
  yieldToId?: string;
  yieldUntil?: number;
  yieldResume?: {
    destination: Vec2;
    restFacing: number;
    action: string;
    animation: AnimationState;
    hold: number;
  };
}

export class LocalActivityPresentation {
  private readonly states = new Map<string, LocalActivityState>();
  private frame = 0;
  private presentationSeconds = 0;
  private clockFrame = -1;
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
  clear(): void { this.states.clear(); this.presentationSeconds = 0; this.clockFrame = -1; }

  resolve(person: Person, context: LocalActivityContext, delta: number): LocalActivityState | undefined {
    if (this.clockFrame !== this.frame) {
      this.presentationSeconds += Math.max(0, delta);
      this.clockFrame = this.frame;
    }
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
        state.recentSocialId = previous.recentSocialId ?? previous.partnerId;
        state.recentSocialKind = previous.recentSocialKind ?? (previous.partnerId ? 'encounter' : undefined);
        state.recentSocialUntil = previous.recentSocialUntil;
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
    state.attentionCooldown = Math.max(0, (state.attentionCooldown ?? 0) - delta);
    if ((state.recentSocialUntil ?? 0) <= this.presentationSeconds) clearRecentSocial(state);
    updateMutualYield(person, context, state, context.visual, this.presentationSeconds, this.previousStates);
    // Personal space is a live constraint, not only a target-selection check. If an uninvolved
    // resident drifts into this destination after it was chosen, step to another valid frontage
    // point rather than waiting on a future routine transition to resolve the overlap.
    const clearanceIgnoreId = state.yieldToId ?? state.partnerId;
    if (!state.rest && !hasPeerClearance(person, state.destination, context, clearanceIgnoreId, 0.34)) {
      const preferred = Math.abs(state.step + state.cycle + 1) % Math.max(1, state.points.length);
      const adjusted = clearLocalPoint(person, context, state, preferred, true, clearanceIgnoreId);
      if (Math.hypot(adjusted.x - state.destination.x, adjusted.z - state.destination.z) > 0.01) {
        state.destination = adjusted;
        state.seconds = 0;
        state.phase = 'approach';
      }
    }
    // Invitations are renderer-owned and reciprocal. A resident cannot belong to two scenes.
    if (!state.encounter && !state.socialCooldown && !state.yieldToId && !state.rest) {
      for (const id of context.group?.members ?? []) {
        const invitation = this.previousStates.get(id);
        const peer = context.people.get(id);
        if (!peer || invitation?.encounter?.partnerId !== person.id || !canInteract(person, peer)) continue;
        clearRestChoreography(state);
        clearPodParticipation(state);
        clearPlayPresentation(state);
        clearAmbientAttention(state);
        state.encounter = buildSocialEncounter(person, peer, context.relationshipFor?.(person.id, peer.id));
        state.encounter.beat = invitation.encounter.beat;
        state.partnerId = peer.id; state.seconds = 0;
        applySocialBeat(person, peer, context, state);
        // The invited listener holds their place while the initiator approaches only when that
        // floor slot is still clear. In a dense pod, keeping the safe encounter destination is
        // preferable to overwriting it with a current position another bystander has entered.
        const holdPosition = { x: context.visual?.x ?? state.base.x, z: context.visual?.z ?? state.base.z };
        if (hasPeerClearance(person, holdPosition, context, peer.id, 0.34)) state.destination = holdPosition;
        state.restFacing = facingTarget(state.destination, context.visualFor?.(peer.id) ?? peer.position);
        break;
      }
    }
    const visual = context.visual;
    refreshPodRhythm(person, context, state, this.previousStates, this.presentationSeconds);
    refreshPresentationFocus(person, context, state);
    updateAmbientAttention(person, context, state, visual, delta, this.previousStates, this.presentationSeconds);
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
      rememberSocial(state, state.partnerId, this.presentationSeconds, 'encounter');
      state.socialCooldown = 2; state.lastPartnerId = state.partnerId; state.encounter = undefined; state.partnerId = undefined;
      state.animation = 'idle'; state.action = 'quiet-departure'; state.seconds = 0; state.hold = 1.8;
    }
    if (state.encounter && ((partnerState?.partnerId && partnerState.partnerId !== person.id)
      || (state.sceneSeconds ?? 0) > 12 && (state.phase === 'approach' || !partnerState?.encounter))) {
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
    if (oriented && leads && state.seconds >= state.hold && !state.attentionId) {
      if (state.rest) {
        if (state.restStage === 'settling') {
          state.restStage = 'settled';
          state.action = 'rest';
          state.animation = 'rest';
          state.seconds = 0;
          state.hold = state.restHold ?? 5.5;
          state.phase = 'action';
          return state;
        }
        if (state.restStage === 'settled') {
          state.restStage = 'rising';
          state.action = 'rise-from-rest';
          state.animation = 'rest';
          state.seconds = 0;
          state.hold = restTransitionSeconds('rising', person.ageMonths);
          state.phase = 'action';
          return state;
        }
        if (state.restStage === 'rising') clearRestChoreography(state);
      }
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
        rememberSocial(state, state.encounter.partnerId, this.presentationSeconds, 'encounter');
        state.encounter = undefined;
        state.partnerId = undefined;
      }
      state.step = (state.step + 1) % routineFor(person).length;
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
    const routine = routineFor(person);
    const childPlay = isChildPlayRoutine(routine);
    const [step, pointIndex, action, seconds] = routine[state.step]!;
    const variation = unit(`${person.id}:${state.cycle}:${state.step}:hold`);
    state.sceneSeconds = 0;
    state.hold = seconds * (0.8 + variation * 0.7) * (context.far ? 1.5 : 1);
    state.partnerId = undefined;
    state.encounter = undefined;
    clearPodParticipation(state);
    clearPlayPresentation(state);
    clearAmbientAttention(state);
    clearRestChoreography(state);
    state.animation = 'idle';
    state.action = action;
    const pointOffset = step === 'reposition'
      ? state.cycle + Math.floor(unit(`${person.id}:${state.step}:reposition`) * state.points.length)
      : 0;
    const preferredPoint = (pointIndex + pointOffset) % state.points.length;
    const point = clearLocalPoint(person, context, state, preferredPoint, step === 'reposition' || step === 'inspect');
    const focus: Readonly<Vec2> = state.stationFocus;

    const memory = memoryInfluenceFor(person);
    const distress = Math.max(memory.grief, memory.recentShock);
    if (!childPlay && distress > 0.3 && ['pause', 'inspect'].includes(step)) {
      state.animation = 'reflect';
      state.action = 'quiet-reflection';
      state.destination = { ...(context.visual ?? state.destination) };
      state.restFacing = context.visual?.facing ?? state.restFacing;
      state.hold *= 1.4 + distress;
      return;
    }

    if (childPlay && applyChildPlay(person, context, state, point, this.presentationSeconds)) return;

    if (!state.socialCooldown && (step === 'interact' || (kind === 'plaza' || kind === 'market') && step === 'task')) {
      const selected = selectSocialPartner(person, context, state, id => {
        const peer = this.previousStates.get(id);
        return !peer?.socialCooldown && !peer?.rest && !peer?.yieldToId && person.id < id && (!peer?.partnerId || peer.partnerId === person.id);
      });
      if (selected) {
        state.encounter = buildSocialEncounter(person, selected.peer, selected.relationship);
        state.partnerId = selected.peer.id;
        applySocialBeat(person, selected.peer, context, state);
        return;
      }
    }

    // A visible pod remains one conversation even when this person is not in the exclusive pair.
    if ((kind === 'plaza' || kind === 'market') && ['task', 'interact', 'pause'].includes(step)
      && applyPodParticipation(person, context, state, point, this.previousStates, this.presentationSeconds)) return;

    if (childPlay) {
      state.playGame = 'parallel';
      state.playRole = 'solo';
      state.animation = 'play';
      state.action = action;
      const from = context.visual ?? state.destination;
      if (bounded(person, point) && localSegmentSafe(from, point, context)
        && hasPeerClearance(person, point, context, undefined, 0.28)) state.destination = point;
      else { state.animation = 'idle'; state.action = 'wait-for-clearance'; }
      state.restFacing = facingTarget(state.destination, state.stationFocus);
      return;
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
          preference: restPreferenceFor(person.id, person.ageMonths),
        });
        if (rest) {
          state.rest = rest;
          state.restStage = 'settling';
          state.restHold = state.hold * (1.45 + (1 - person.energy) * 1.8 + (person.ageMonths >= 62 * 12 ? 0.45 : 0));
          state.hold = restTransitionSeconds('settling', person.ageMonths);
          state.animation = 'rest';
          state.action = 'settle-into-rest';
          state.destination = { ...rest.destination };
          state.restFacing = rest.facing;
          const attention = restingCompanionFocus(person, context, rest);
          state.focus.x = attention.x;
          state.focus.z = attention.z;
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
    const from = context.visual ?? state.destination;
    const peerSafe = hasPeerClearance(person, point, context, state.partnerId, 0.34);
    if (bounded(person, point) && localSegmentSafe(from, point, context) && peerSafe) state.destination = point;
    else { state.animation = 'idle'; state.action = 'wait-for-clearance'; }
    state.restFacing = facingTarget(state.destination, focus);
    if (focus !== state.focus) { state.focus.x = focus.x; state.focus.z = focus.z; }
  }
}


interface SocialPartnerSelection {
  peer: Person;
  relationship?: SocialRelationship;
  score: number;
}

function selectSocialPartner(person: Person, context: LocalActivityContext, state: LocalActivityState, available: (id: string) => boolean): SocialPartnerSelection | undefined {
  const pod = conversationPodFor(context.group, person.id);
  const members = pod?.members ?? context.group?.members;
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
    if (!localSegmentSafe(context.visual ?? state.base, peerPosition, context)) continue;
    const relationship = context.relationshipFor?.(person.id, peer.id);
    if ((person as Person & { socialAvoidIds?: string[] }).socialAvoidIds?.includes(peer.id) || (peer as Person & { socialAvoidIds?: string[] }).socialAvoidIds?.includes(person.id)) continue;
    const memory = memoryInfluenceFor(person);
    const distress = Math.max(memory.grief, memory.recentShock);
    if (distress > 0.45 && relationship?.kind !== 'friend' && relationship?.kind !== 'family'
      && person.householdId !== peer.householdId) continue;
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

/** Shared, irregular turns: deterministic across frame order and simulation speed. */
export function conversationTurn(key: string, seconds: number): { epoch: number; progress: number } {
  const durations = Array.from({ length: 6 }, (_, i) => 3.8 + unit(`${key}:${i}:turn-length`) * 4.4);
  const cycle = durations.reduce((a, b) => a + b, 0);
  const time = Math.max(0, seconds) + unit(`${key}:speaker-phase`) * cycle;
  const round = Math.floor(time / cycle);
  let remaining = time - round * cycle;
  for (let i = 0; i < durations.length; i++) {
    if (remaining < durations[i]! || i === durations.length - 1) {
      return { epoch: round * durations.length + i, progress: remaining / durations[i]! };
    }
    remaining -= durations[i]!;
  }
  return { epoch: 0, progress: 0 };
}

function conversationSpeaker(ids: string[], people: ReadonlyMap<string, Person>, epoch: number, key: string): string {
  // Rotate the opportunity to speak; withdrawn residents can quietly pass their turn.
  for (let offset = 0; offset < ids.length; offset++) {
    const id = ids[(epoch + offset) % ids.length]!;
    const person = people.get(id)!;
    const memory = memoryInfluenceFor(person);
    const willingness = 0.55 + person.traits.sociability * 0.4 - Math.max(memory.grief, memory.recentShock) * 0.5;
    if (unit(`${key}:${epoch}:${id}:take-turn`) < willingness) return id;
  }
  return ids[epoch % ids.length]!;
}

function applyPodParticipation(person: Person, context: LocalActivityContext, state: LocalActivityState, point: Vec2,
  previousStates: ReadonlyMap<string, LocalActivityState>, presentationSeconds: number): boolean {
  const group = context.group;
  const pod = conversationPodFor(group, person.id);
  if (!group || !pod || pod.members.length < 3) return false;
  const adults = pod.members.filter(id => {
    const candidate = context.people.get(id);
    return Boolean(candidate && !isChildPresentationPerson(candidate)
      && (id === person.id || canInteract(person, candidate)));
  });
  if (adults.length < 2 || !adults.includes(person.id)) return false;

  const { epoch, progress: turnProgress } = conversationTurn(pod.id, presentationSeconds);

  let speakerId = adults.find(id => {
    const previous = previousStates.get(id);
    return Boolean(previous?.encounter && previous.partnerId && pod.members.includes(previous.partnerId)
      && previous.animation !== 'converse-quiet');
  });
  if (!speakerId) speakerId = conversationSpeaker(adults, context.people, epoch, pod.id);

  const listeners = adults.filter(id => id !== speakerId);
  const reactorIndex = listeners.length > 0
    ? Math.floor(unit(`${pod.id}:${epoch}:reactor`) * listeners.length) % listeners.length : -1;
  const reactorId = reactorIndex >= 0 ? listeners[reactorIndex] : undefined;
  const reactionWindow = turnProgress >= 0.66 && turnProgress < 0.82;

  let focusId: string;
  if (speakerId === person.id) {
    const own = adults.indexOf(person.id);
    focusId = adults[(own + 1 + Math.floor(turnProgress * (adults.length - 1))) % adults.length]!;
    state.socialRole = 'speaker';
    state.animation = turnProgress < 0.14 ? 'converse-quiet' : turnProgress > 0.84 ? 'converse-quiet' : 'converse';
    state.action = turnProgress < 0.14 ? 'take-turn' : turnProgress > 0.84 ? 'finish-turn' : 'address-pod';
  } else {
    focusId = speakerId;
    state.socialRole = 'listener';
    if (reactionWindow && reactorId === person.id) {
      state.animation = memoryInfluenceFor(person).grief > 0.3 ? 'converse-quiet' : 'converse-warm';
      state.action = 'react-in-pod';
    } else if (turnProgress < 0.14) {
      state.animation = 'converse-quiet';
      state.action = 'shift-attention';
    } else {
      state.animation = 'converse-quiet';
      state.action = 'listen-in-pod';
    }
  }

  const peer = context.people.get(focusId);
  if (!peer) return false;
  const at = context.visualFor?.(peer.id) ?? peer.position;
  state.socialFocusId = peer.id;
  rememberSocial(state, peer.id, presentationSeconds, 'pod');
  state.focus.x = at.x;
  state.focus.z = at.z;
  const from = context.visual ?? state.destination;
  const podPoint = {
    x: state.base.x + (point.x - state.base.x) * 0.34,
    z: state.base.z + (point.z - state.base.z) * 0.34,
  };
  const target = bounded(person, podPoint) && localSegmentSafe(from, podPoint, context)
    && hasPeerClearance(person, podPoint, context, undefined, 0.34) ? podPoint : state.base;
  state.destination = { ...target };
  state.restFacing = facingTarget(state.destination, state.focus);
  state.hold *= 1.05 + person.traits.sociability * 0.12;
  return true;
}

function refreshPodRhythm(person: Person, context: LocalActivityContext, state: LocalActivityState,
  previousStates: ReadonlyMap<string, LocalActivityState>, presentationSeconds: number): void {
  if (!state.socialRole || state.partnerId || state.encounter || state.playGame || state.yieldToId) return;
  const group = context.group;
  const pod = conversationPodFor(group, person.id);
  if (!pod || pod.members.length < 3) return;
  const adults = pod.members.filter(id => {
    const candidate = context.people.get(id);
    return Boolean(candidate && !isChildPresentationPerson(candidate)
      && (id === person.id || canInteract(person, candidate)));
  });
  if (adults.length < 2 || !adults.includes(person.id)) return;

  const { epoch, progress: turnProgress } = conversationTurn(pod.id, presentationSeconds);
  let speakerId = adults.find(id => {
    const previous = previousStates.get(id);
    return Boolean(previous?.encounter && previous.partnerId && pod.members.includes(previous.partnerId)
      && previous.animation !== 'converse-quiet');
  });
  if (!speakerId) speakerId = conversationSpeaker(adults, context.people, epoch, pod.id);

  const listeners = adults.filter(id => id !== speakerId);
  const reactorId = listeners.length
    ? listeners[Math.floor(unit(`${pod.id}:${epoch}:reactor`) * listeners.length) % listeners.length] : undefined;
  const reactionWindow = turnProgress >= 0.66 && turnProgress < 0.82;

  let focusId: string;
  if (speakerId === person.id) {
    const own = adults.indexOf(person.id);
    focusId = adults[(own + 1 + Math.floor(turnProgress * (adults.length - 1))) % adults.length]!;
    state.socialRole = 'speaker';
    state.animation = turnProgress < 0.14 ? 'converse-quiet' : turnProgress > 0.84 ? 'converse-quiet' : 'converse';
    state.action = turnProgress < 0.14 ? 'take-turn' : turnProgress > 0.84 ? 'finish-turn' : 'address-pod';
  } else {
    focusId = speakerId;
    state.socialRole = 'listener';
    if (reactionWindow && reactorId === person.id) {
      state.animation = memoryInfluenceFor(person).grief > 0.3 ? 'converse-quiet' : 'converse-warm';
      state.action = 'react-in-pod';
    } else if (turnProgress < 0.14) {
      state.animation = 'converse-quiet';
      state.action = 'shift-attention';
    } else {
      state.animation = 'converse-quiet';
      state.action = 'listen-in-pod';
    }
  }

  const peer = context.people.get(focusId);
  if (!peer) return;
  state.socialFocusId = peer.id;
  rememberSocial(state, peer.id, presentationSeconds, 'pod');
}

function applyChildPlay(person: Person, context: LocalActivityContext, state: LocalActivityState, fallback: Vec2,
  presentationSeconds: number): boolean {
  if (!isChildPresentationPerson(person) || person.activity !== 'socialize') return false;
  const group = context.group;
  const pod = conversationPodFor(group, person.id);
  const members = childPlayMembers(person, context, pod);
  const from = context.visual ?? state.destination;
  const center = group && pod ? conversationPodCenter(group, pod)
    : context.base.podCenter ?? state.stationFocus;

  if (person.ageMonths < 3 * 12 || members.length < 2) {
    state.playGame = 'parallel';
    state.playRole = 'solo';
    state.animation = 'play';
    state.action = person.ageMonths < 3 * 12 ? state.action : 'play-solo';
    state.focus.x = center.x;
    state.focus.z = center.z;
    const scale = person.ageMonths < 3 * 12 ? 0.42 : 0.72;
    const target = { x: state.base.x + (fallback.x - state.base.x) * scale, z: state.base.z + (fallback.z - state.base.z) * scale };
    adoptPlayDestination(person, context, state, from, target);
    state.restFacing = facingTarget(state.destination, state.focus);
    return true;
  }

  const phaseOffset = unit(`${pod?.id ?? group?.key ?? person.homeId}:play-phase`) * 5;
  const epoch = Math.floor((presentationSeconds + phaseOffset) / 6.2);
  const gameIndex = person.ageMonths < 6 * 12 ? 1 + Math.abs(epoch) % 2 : Math.abs(epoch) % 3;
  const game = (['tag', 'circle', 'follow'] as const)[gameIndex]!;
  state.playGame = game;
  state.animation = 'play';

  const own = members.indexOf(person.id);
  if (game === 'tag') {
    const runnerId = members[((epoch % members.length) + members.length) % members.length]!;
    if (runnerId === person.id) {
      state.playRole = 'runner';
      state.action = 'play-tag-run';
      const chasers = members.filter(id => id !== person.id);
      const nearest = nearestPeer(person, chasers, context, state.base);
      if (nearest) {
        const at = context.visualFor?.(nearest.id) ?? nearest.position;
        state.socialFocusId = nearest.id;
        rememberSocial(state, nearest.id, presentationSeconds, 'play');
        state.focus.x = at.x; state.focus.z = at.z;
        const target = farthestPlayPoint(state.points, at, fallback);
        adoptPlayDestination(person, context, state, from, target, nearest.id);
      } else adoptPlayDestination(person, context, state, from, fallback);
    } else {
      const runner = context.people.get(runnerId);
      if (!runner) return false;
      const at = context.visualFor?.(runner.id) ?? runner.position;
      state.playRole = 'chaser';
      state.action = 'play-tag-chase';
      state.socialFocusId = runner.id;
      rememberSocial(state, runner.id, presentationSeconds, 'play');
      state.focus.x = at.x; state.focus.z = at.z;
      const target = standOffPoint(context.visual ?? state.base, at, center, 0.36,
        unit(`${person.id}:${runner.id}:${epoch}:tag-side`) < 0.5 ? -0.07 : 0.07);
      adoptPlayDestination(person, context, state, from, target, runner.id);
    }
  } else if (game === 'circle') {
    state.playRole = 'orbit';
    state.action = 'play-circle';
    const radius = pod?.kind === 'children' ? 0.52 : 0.44;
    const angle = unit(`${pod?.id ?? group?.key}:circle-axis`) * Math.PI * 2
      + own / members.length * Math.PI * 2 + (state.cycle + state.step * 0.35) * 0.46;
    const target = { x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius };
    state.focus.x = center.x; state.focus.z = center.z;
    adoptPlayDestination(person, context, state, from, target);
  } else {
    const leaderId = members[(((epoch + 1) % members.length) + members.length) % members.length]!;
    if (leaderId === person.id) {
      state.playRole = 'leader';
      state.action = 'play-lead';
      state.focus.x = center.x; state.focus.z = center.z;
      adoptPlayDestination(person, context, state, from, fallback);
    } else {
      const leader = context.people.get(leaderId);
      if (!leader) return false;
      const at = context.visualFor?.(leader.id) ?? leader.position;
      state.playRole = 'follower';
      state.action = 'play-follow';
      state.socialFocusId = leader.id;
      rememberSocial(state, leader.id, presentationSeconds, 'play');
      state.focus.x = at.x; state.focus.z = at.z;
      const target = followPoint(at, center, 0.42, own, members.length);
      adoptPlayDestination(person, context, state, from, target, leader.id);
    }
  }

  state.restFacing = facingTarget(state.destination, state.focus);
  return true;
}

function childPlayMembers(person: Person, context: LocalActivityContext, pod: SocialPod | undefined): string[] {
  const local = (pod?.members ?? context.group?.members ?? []).filter(id => {
    const peer = context.people.get(id);
    return Boolean(peer && isChildPresentationPerson(peer) && peer.activity === 'socialize'
      && (id === person.id || canInteract(person, peer)));
  });
  if (local.length >= 2) return local;
  return (context.group?.members ?? []).filter(id => {
    const peer = context.people.get(id);
    return Boolean(peer && isChildPresentationPerson(peer) && peer.activity === 'socialize'
      && (id === person.id || canInteract(person, peer)));
  });
}

function nearestPeer(person: Person, ids: readonly string[], context: LocalActivityContext, origin: Vec2): Person | undefined {
  let best: Person | undefined;
  let distance = Infinity;
  for (const id of ids) {
    const peer = context.people.get(id);
    if (!peer || peer.id === person.id) continue;
    const at = context.visualFor?.(id) ?? peer.position;
    const d = Math.hypot(at.x - origin.x, at.z - origin.z);
    if (d < distance) { best = peer; distance = d; }
  }
  return best;
}

function standOffPoint(own: Vec2, target: Vec2, center: Vec2, distance: number, lateral: number): Vec2 {
  let dx = own.x - target.x, dz = own.z - target.z;
  let length = Math.hypot(dx, dz);
  if (length < 0.01) {
    dx = target.x - center.x; dz = target.z - center.z; length = Math.hypot(dx, dz);
  }
  if (length < 0.01) { dx = 1; dz = 0; length = 1; }
  dx /= length; dz /= length;
  return {
    x: target.x + dx * distance - dz * lateral,
    z: target.z + dz * distance + dx * lateral,
  };
}

function followPoint(leader: Vec2, center: Vec2, distance: number, index: number, count: number): Vec2 {
  let dx = leader.x - center.x, dz = leader.z - center.z;
  const length = Math.hypot(dx, dz) || 1;
  dx /= length; dz /= length;
  const lateral = (index - (count - 1) / 2) * 0.07;
  return {
    x: leader.x - dx * distance - dz * lateral,
    z: leader.z - dz * distance + dx * lateral,
  };
}

function farthestPlayPoint(points: readonly Vec2[], threat: Vec2, fallback: Vec2): Vec2 {
  let best = fallback, bestDistance = Math.hypot(fallback.x - threat.x, fallback.z - threat.z);
  for (const point of points) {
    const distance = Math.hypot(point.x - threat.x, point.z - threat.z);
    if (distance > bestDistance) { best = point; bestDistance = distance; }
  }
  return best;
}

function adoptPlayDestination(person: Person, context: LocalActivityContext, state: LocalActivityState, from: Vec2,
  candidate: Vec2, ignoreId?: string): void {
  if (bounded(person, candidate) && localSegmentSafe(from, candidate, context)
    && hasPeerClearance(person, candidate, context, ignoreId, 0.27)) {
    state.destination = { ...candidate };
    return;
  }
  const fallback = clearLocalPoint(person, context, state,
    Math.abs(state.step + state.cycle) % Math.max(1, state.points.length), true, ignoreId);
  if (bounded(person, fallback) && localSegmentSafe(from, fallback, context)) state.destination = fallback;
  else { state.animation = 'idle'; state.action = 'wait-for-clearance'; }
}

function isChildPresentationPerson(person: Person): boolean {
  return person.ageMonths < 15 * 12 && (person.occupation === 'child' || person.role === 'child');
}

function clearPodParticipation(state: LocalActivityState): void {
  delete state.socialFocusId;
  delete state.socialRole;
}

function clearPlayPresentation(state: LocalActivityState): void {
  delete state.playGame;
  delete state.playRole;
}

function refreshPresentationFocus(person: Person, context: LocalActivityContext, state: LocalActivityState): void {
  if (state.partnerId || !state.socialFocusId) return;
  const peer = context.people.get(state.socialFocusId);
  if (!peer || !canInteract(person, peer)) {
    clearPodParticipation(state);
    if (state.playGame) {
      state.focus.x = context.base.podCenter?.x ?? state.stationFocus.x;
      state.focus.z = context.base.podCenter?.z ?? state.stationFocus.z;
      state.restFacing = facingTarget(state.destination, state.focus);
    }
    return;
  }
  const at = context.visualFor?.(peer.id) ?? peer.position;
  state.focus.x = at.x;
  state.focus.z = at.z;
  state.restFacing = facingTarget(state.destination, state.focus);
}

function rememberSocial(state: LocalActivityState, peerId: string | undefined, now: number,
  kind: NonNullable<LocalActivityState['recentSocialKind']>): void {
  if (!peerId) return;
  state.recentSocialId = peerId;
  state.recentSocialKind = kind;
  const duration = kind === 'encounter' ? RECENT_SOCIAL_ENCOUNTER_SECONDS
    : kind === 'pod' ? RECENT_SOCIAL_POD_SECONDS
      : kind === 'play' ? RECENT_SOCIAL_PLAY_SECONDS : RECENT_SOCIAL_PASSING_SECONDS;
  state.recentSocialUntil = Math.max(state.recentSocialUntil ?? 0, now + duration);
}

function clearRecentSocial(state: LocalActivityState): void {
  delete state.recentSocialId;
  delete state.recentSocialKind;
  delete state.recentSocialUntil;
}

function updateMutualYield(person: Person, context: LocalActivityContext, state: LocalActivityState,
  visual: PersonVisualState | undefined, now: number, previousStates: ReadonlyMap<string, LocalActivityState>): void {
  if (state.yieldToId) {
    const peer = context.people.get(state.yieldToId);
    const at = peer ? context.visualFor?.(peer.id) ?? peer.position : undefined;
    if (!peer || !at || now >= (state.yieldUntil ?? 0)
      || Math.hypot(at.x - (visual?.x ?? state.destination.x), at.z - (visual?.z ?? state.destination.z)) > 1.15) {
      finishYield(state, now);
      return;
    }
    state.focus.x = at.x;
    state.focus.z = at.z;
    state.restFacing = facingTarget(state.destination, state.focus);
    state.seconds = 0;
    return;
  }

  if (!visual || visual.traveling || state.rest || state.partnerId || state.encounter || state.socialFocusId || state.playGame
    || state.attentionId || state.action === 'arrive' || state.action === 'wait-for-clearance') return;
  const ownRemaining = Math.hypot(state.destination.x - visual.x, state.destination.z - visual.z);
  if (ownRemaining < 0.14) return;

  for (const [id, peer] of context.people) {
    if (id === person.id) continue;
    const peerState = previousStates.get(id);
    const peerAt = context.visualFor?.(id) ?? peer.position;
    if (!canPerceive(person, peer) || peerState?.yieldToId === person.id
      || peerState?.partnerId || peerState?.encounter || peerState?.playGame || peerState?.rest
      || state.recentSocialKind === 'passing' && state.recentSocialId === peer.id && (state.recentSocialUntil ?? 0) > now) continue;
    const peerDestination = peerState?.destination ?? peer.target;
    const separation = Math.hypot(peerAt.x - visual.x, peerAt.z - visual.z);
    if (separation < 0.26 || separation > MUTUAL_YIELD_RADIUS) continue;
    if (Math.hypot(peerDestination.x - peerAt.x, peerDestination.z - peerAt.z) < 0.14) continue;
    if (!pathsConflict({ x: visual.x, z: visual.z }, state.destination, peerAt, peerDestination, 0.28)) continue;
    if (!shouldYieldTo(person, peer)) continue;

    const dx = state.destination.x - visual.x;
    const dz = state.destination.z - visual.z;
    const length = Math.hypot(dx, dz) || 1;
    const side = unit(`${person.id}:${peer.id}:yield-side`) < 0.5 ? -1 : 1;
    const lateral = { x: -dz / length * 0.2 * side, z: dx / length * 0.2 * side };
    const first = { x: visual.x + lateral.x, z: visual.z + lateral.z };
    const second = { x: visual.x - lateral.x, z: visual.z - lateral.z };
    const candidate = [first, second].find(point => bounded(person, point)
      && localSegmentSafe({ x: visual.x, z: visual.z }, point, context)
      && hasPeerClearance(person, point, context, peer.id, 0.25))
      ?? { x: visual.x, z: visual.z };

    state.yieldResume = {
      destination: { ...state.destination },
      restFacing: state.restFacing,
      action: state.action,
      animation: state.animation,
      hold: state.hold,
    };
    state.yieldToId = peer.id;
    state.yieldUntil = now + MUTUAL_YIELD_SECONDS;
    state.destination = candidate;
    state.focus.x = peerAt.x;
    state.focus.z = peerAt.z;
    state.restFacing = facingTarget(candidate, peerAt);
    state.action = 'yield-pass';
    state.animation = 'idle';
    state.hold = 99;
    state.seconds = 0;
    clearAmbientAttention(state);
    return;
  }
}

function finishYield(state: LocalActivityState, now: number): void {
  const peerId = state.yieldToId;
  const resume = state.yieldResume;
  if (resume) {
    state.destination = { ...resume.destination };
    state.restFacing = resume.restFacing;
    state.action = resume.action;
    state.animation = resume.animation;
    state.hold = resume.hold;
  }
  rememberSocial(state, peerId, now, 'passing');
  delete state.yieldToId;
  delete state.yieldUntil;
  delete state.yieldResume;
  state.seconds = 0;
}

function shouldYieldTo(person: Person, peer: Person): boolean {
  const own = passagePriority(person);
  const other = passagePriority(peer);
  if (Math.abs(own - other) > 0.001) return own < other;
  return person.id > peer.id;
}

function passagePriority(person: Person): number {
  let score = 0;
  if (person.ageMonths < 12 * 12) score += 2.2;
  if (person.ageMonths > 68 * 12) score += 1.7;
  if (person.activity === 'transport' || ['basket', 'bag', 'toolkit'].includes(person.appearance?.carriedItem ?? '')) score += 1.1;
  if (['craft', 'study', 'assist', 'trade', 'patrol'].includes(person.activity)) score += 0.3;
  return score;
}

function pathsConflict(a: Vec2, aTarget: Vec2, b: Vec2, bTarget: Vec2, minimum: number): boolean {
  if (segmentsIntersect(a, aTarget, b, bTarget)) return true;
  return Math.min(
    pointSegmentDistance(a, b, bTarget),
    pointSegmentDistance(aTarget, b, bTarget),
    pointSegmentDistance(b, a, aTarget),
    pointSegmentDistance(bTarget, a, aTarget),
  ) < minimum;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const onSegment = (p: Vec2, q: Vec2, r: Vec2) => q.x >= Math.min(p.x, r.x) - 0.000001
    && q.x <= Math.max(p.x, r.x) + 0.000001 && q.z >= Math.min(p.z, r.z) - 0.000001
    && q.z <= Math.max(p.z, r.z) + 0.000001;
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (Math.sign(abC) !== Math.sign(abD) && Math.sign(cdA) !== Math.sign(cdB)) return true;
  if (Math.abs(abC) < 0.000001 && onSegment(a, c, b)) return true;
  if (Math.abs(abD) < 0.000001 && onSegment(a, d, b)) return true;
  if (Math.abs(cdA) < 0.000001 && onSegment(c, a, d)) return true;
  if (Math.abs(cdB) < 0.000001 && onSegment(c, b, d)) return true;
  return false;
}

function pointSegmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 0.000001) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq, 0, 1);
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
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
  clearPodParticipation(state);
  clearPlayPresentation(state);
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
    if (bounded(person, paired) && localSegmentSafe(from, paired, context)
      && hasPeerClearance(person, paired, context, peer.id, 0.34)) state.destination = paired;
  }
  state.focus.x = peerPosition.x;
  state.focus.z = peerPosition.z;
  state.restFacing = facingTarget(state.destination, state.focus);
  state.partnerId = peer.id;
  const speaking = encounter.role === 'mentor' || encounter.role === 'supporter'
    || encounter.role === 'peer' && (person.id < peer.id) === (encounter.beat % 2 === 0);
  const sharedLaugh = encounter.tone === 'warm' && beat.animation === 'social-laugh';
  state.animation = encounter.role === 'supported' && encounter.beat === 1
    ? 'reflect'
    : sharedLaugh ? 'social-laugh' : speaking ? beat.animation : 'converse-quiet';
  state.action = socialActionFor(encounter, beat.action);
  const relationalLinger = encounter.tone === 'tense'
    ? 0.82 + encounter.strength * 0.08
    : 0.9 + encounter.strength * 0.18 + encounter.trust * 0.14
      + (person.traits.sociability + peer.traits.sociability) * 0.05;
  state.hold = beat.seconds * relationalLinger * (context.far ? 1.35 : 1);
}

function updateAmbientAttention(person: Person, context: LocalActivityContext, state: LocalActivityState,
  visual: PersonVisualState | undefined, delta: number, previousStates: ReadonlyMap<string, LocalActivityState>, now: number): void {
  const dt = Math.max(0, delta);
  const continuityMoving = Boolean(visual && state.recentSocialId && (state.recentSocialUntil ?? 0) > now
    && visual.speed > 0.045 && visual.speed <= 0.22);
  const unsuitable = state.partnerId || state.encounter || state.rest || state.socialFocusId || state.playGame || state.yieldToId
    || !visual || visual.traveling || visual.speed > 0.045 && !continuityMoving || state.action === 'arrive';

  if (state.attentionId) {
    const peer = context.people.get(state.attentionId);
    const at = peer ? context.visualFor?.(peer.id) ?? peer.position : undefined;
    const peerState = peer ? previousStates.get(peer.id) : undefined;
    const valid = !unsuitable && peer && at && canInteract(person, peer)
      && peerState?.phase !== 'approach' && peerState?.action !== 'arrive'
      && Math.hypot(at.x - visual!.x, at.z - visual!.z) <= SOCIAL_AWARENESS_RADIUS * 1.15;

    if (!valid && state.attentionPhase !== 'release') {
      state.attentionPhase = 'release';
      state.attentionSeconds = 0;
    }

    if (state.attentionPhase !== 'release' && peer && at && visual) {
      const relationship = context.relationshipFor?.(person.id, peer.id);
      const recent = state.recentSocialId === peer.id && (state.recentSocialUntil ?? 0) > now;
      const meaningful = recent || meaningfulAmbientRecognition(person, peer, relationship);
      const relativeYaw = normalizeAngle(facingTarget(visual, at) - visual.facing);
      const maxYaw = meaningful ? SOCIAL_AWARENESS_MAX_HEAD_YAW : SOCIAL_AWARENESS_MAX_HEAD_YAW * 0.78;
      state.attentionHeadYaw = clamp(relativeYaw, -maxYaw, maxYaw);
      state.attentionTorsoYaw = meaningful
        ? clamp(relativeYaw * 0.22, -SOCIAL_AWARENESS_MAX_TORSO_YAW, SOCIAL_AWARENESS_MAX_TORSO_YAW)
        : 0;
    }

    state.attentionSeconds = (state.attentionSeconds ?? 0) + dt;
    if (state.attentionPhase === 'acquire') {
      state.attentionBlend = smoothAttention((state.attentionSeconds ?? 0) / SOCIAL_AWARENESS_ACQUIRE_SECONDS);
      if ((state.attentionSeconds ?? 0) >= SOCIAL_AWARENESS_ACQUIRE_SECONDS) {
        state.attentionPhase = 'hold';
        state.attentionSeconds = 0;
        state.attentionBlend = 1;
      }
    } else if (state.attentionPhase === 'hold') {
      state.attentionBlend = 1;
      if ((state.attentionSeconds ?? 0) >= (state.attentionHold ?? SOCIAL_AWARENESS_MIN_HOLD_SECONDS)) {
        state.attentionPhase = 'release';
        state.attentionSeconds = 0;
      }
    } else {
      state.attentionBlend = 1 - smoothAttention((state.attentionSeconds ?? 0) / SOCIAL_AWARENESS_RELEASE_SECONDS);
      if ((state.attentionSeconds ?? 0) >= SOCIAL_AWARENESS_RELEASE_SECONDS) {
        const peerId = state.attentionId;
        clearAmbientAttention(state);
        const spread = unit(`${person.id}:${peerId}:${state.cycle}:${state.step}:attention-cooldown`);
        state.attentionCooldown = SOCIAL_AWARENESS_COOLDOWN_MIN_SECONDS
          + spread * (SOCIAL_AWARENESS_COOLDOWN_MAX_SECONDS - SOCIAL_AWARENESS_COOLDOWN_MIN_SECONDS);
      }
    }
    return;
  }

  if (unsuitable || (state.attentionCooldown ?? 0) > 0) return;
  const selected = selectAmbientAttentionPeer(person, context, state, visual!, previousStates, now);
  if (!selected) return;
  const at = context.visualFor?.(selected.peer.id) ?? selected.peer.position;
  const relativeYaw = normalizeAngle(facingTarget(visual!, at) - visual!.facing);
  state.attentionId = selected.peer.id;
  state.attentionPhase = 'acquire';
  state.attentionSeconds = 0;
  const linger = unit(`${person.id}:${selected.peer.id}:${state.cycle}:${state.step}:attention-linger`);
  state.attentionHold = selected.recent
    ? 0.78 + linger * 0.52
    : SOCIAL_AWARENESS_MIN_HOLD_SECONDS
      + linger * (SOCIAL_AWARENESS_MAX_HOLD_SECONDS - SOCIAL_AWARENESS_MIN_HOLD_SECONDS);
  state.attentionBlend = 0;
  const maxYaw = selected.meaningful ? SOCIAL_AWARENESS_MAX_HEAD_YAW : SOCIAL_AWARENESS_MAX_HEAD_YAW * 0.78;
  state.attentionHeadYaw = clamp(relativeYaw, -maxYaw, maxYaw);
  state.attentionTorsoYaw = selected.meaningful
    ? clamp(relativeYaw * 0.22, -SOCIAL_AWARENESS_MAX_TORSO_YAW, SOCIAL_AWARENESS_MAX_TORSO_YAW)
    : 0;
}

interface AmbientAttentionSelection {
  peer: Person;
  meaningful: boolean;
  recent: boolean;
  caregiver: boolean;
  score: number;
}

function selectAmbientAttentionPeer(person: Person, context: LocalActivityContext, state: LocalActivityState,
  visual: PersonVisualState, previousStates: ReadonlyMap<string, LocalActivityState>, now: number): AmbientAttentionSelection | undefined {
  let selected: AmbientAttentionSelection | undefined;
  const kind = person.navigation?.destinationKind;
  const continuityActive = Boolean(state.recentSocialId && (state.recentSocialUntil ?? 0) > now);
  for (const [id, peer] of context.people) {
    if (id === person.id) continue;
    const peerState = previousStates.get(id);
    if (!canPerceive(person, peer) || peerState?.action === 'arrive') continue;
    const recent = continuityActive && state.recentSocialId === peer.id;
    if (visual.speed > 0.045 && !recent) continue;
    const caregiver = person.children.includes(peer.id) || peer.parents.includes(person.id);
    // A caregiver may track a moving child; everyone else avoids snapping attention toward people
    // already in a locomotion beat.
    if (peerState?.phase === 'approach' && !caregiver && !recent) continue;
    const at = context.visualFor?.(peer.id) ?? peer.position;
    const distance = Math.hypot(at.x - visual.x, at.z - visual.z);
    const radius = caregiver ? 1.7 : recent ? 1.5 : SOCIAL_AWARENESS_RADIUS;
    if (distance < 0.38 || distance > radius) continue;

    const relationship = context.relationshipFor?.(person.id, peer.id);
    const meaningful = recent || caregiver || meaningfulAmbientRecognition(person, peer, relationship);
    const coworkers = Boolean(person.workplaceId && person.workplaceId === peer.workplaceId);
    const yaw = Math.abs(normalizeAngle(facingTarget(visual, at) - visual.facing));
    const cone = caregiver ? 2.15 : recent ? 2.0 : meaningful ? 1.75 : relationship || coworkers ? 1.25 : 0.82;
    if (yaw > cone) continue;

    // Unknown passers-by remain background. Social continuity, caregiving and real relationships
    // are allowed to cut through this gate because they have an intelligible reason to matter.
    if (!meaningful && !relationship && !coworkers) {
      if (kind !== 'plaza' && kind !== 'market') continue;
      const [first, second] = person.id < peer.id ? [person.id, peer.id] : [peer.id, person.id];
      const observerIsFirst = unit(`${first}:${second}:ambient-observer`) < 0.5;
      if ((person.id === first) !== observerIsFirst) continue;
      if (unit(`${person.id}:${peer.id}:${state.cycle}:${state.step}:ambient-interest`) > 0.24 + person.traits.sociability * 0.18) continue;
    }

    const relational = relationship
      ? relationshipScoreForPresentation(person, peer, relationship, person.bornMonth + person.ageMonths)
      : caregiver ? 1.05 : meaningful ? 0.82 : coworkers ? 0.48 : 0.18;
    const continuity = recent ? 0.72 : continuityActive ? -0.18 : 0;
    const score = relational + continuity + (caregiver ? 0.28 : 0) - distance * 0.34 - yaw * 0.22;
    if (!selected || score > selected.score + 0.001 || Math.abs(score - selected.score) <= 0.001 && peer.id < selected.peer.id) {
      selected = { peer, meaningful, recent, caregiver, score };
    }
  }
  return selected;
}

function meaningfulAmbientRecognition(person: Person, peer: Person, relationship: SocialRelationship | undefined): boolean {
  if (person.partnerId === peer.id || peer.partnerId === person.id
    || Boolean(person.householdId && person.householdId === peer.householdId)) return true;
  return relationship?.kind === 'family' || relationship?.kind === 'friend' || relationship?.kind === 'mentor'
    || relationship?.kind === 'intellectual-collaborator' || Boolean(relationship && relationship.strength >= 0.72);
}

function smoothAttention(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clearAmbientAttention(state: LocalActivityState): void {
  delete state.attentionId;
  delete state.attentionPhase;
  delete state.attentionSeconds;
  delete state.attentionHold;
  delete state.attentionBlend;
  delete state.attentionHeadYaw;
  delete state.attentionTorsoYaw;
}

function hasPeerClearance(person: Person, point: Vec2, context: LocalActivityContext, ignoreId?: string, minimum = 0.3): boolean {
  for (const [id, peer] of context.people) {
    if (id === person.id || id === ignoreId || !peer.alive) continue;
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

function routineFor(person: Person): readonly Intent[] {
  const child = isChildPresentationPerson(person);
  const freeToPlay = child && person.activity === 'socialize'
    && person.navigation?.schedulePhase !== 'emergency'
    && (person.navigation?.destinationKind === 'plaza' || person.navigation?.destinationKind === 'market');
  if (!freeToPlay) return ROUTINES[person.navigation!.destinationKind] ?? WORK_ROUTINE;
  return person.ageMonths < 3 * 12 ? YOUNG_CHILD_PLAY_ROUTINE : CHILD_PLAY_ROUTINE;
}

function isChildPlayRoutine(routine: readonly Intent[]): boolean {
  return routine === CHILD_PLAY_ROUTINE || routine === YOUNG_CHILD_PLAY_ROUTINE;
}

function sampledEntryStep(person: Person, sample: number): number {
  const routine = routineFor(person);
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

function canPerceive(person: Person, peer: Person): boolean {
  return peer.id !== person.id && peer.alive && peer.health > 0.2
    && peer.navigation?.schedulePhase !== 'emergency' && peer.displacedSinceMonth === undefined
    && !['flee', 'migrate', 'shelter'].includes(peer.activity);
}

function canInteract(person: Person, peer: Person): boolean {
  return canPerceive(person, peer) && !peer.navigation?.traveling
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


function clearRestChoreography(state: LocalActivityState): void {
  delete state.rest;
  delete state.restStage;
  delete state.restHold;
}

function restingCompanionFocus(person: Person, context: LocalActivityContext, rest: RestSpotPresentation): Vec2 {
  let best: Vec2 | undefined;
  let bestDistance = Infinity;
  for (const id of context.group?.members ?? []) {
    if (id === person.id) continue;
    const peer = context.people.get(id);
    if (!peer || peer.activity !== 'rest') continue;
    const at = context.visualFor?.(id) ?? peer.position;
    const distance = Math.hypot(at.x - rest.destination.x, at.z - rest.destination.z);
    if (distance < bestDistance && distance <= 1.65) {
      best = { x: at.x, z: at.z };
      bestDistance = distance;
    }
  }
  return best ?? {
    x: rest.destination.x + Math.sin(rest.facing) * 0.5,
    z: rest.destination.z + Math.cos(rest.facing) * 0.5,
  };
}
