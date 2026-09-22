import { describe, expect, it } from 'vitest';
import { LocalActivityPresentation, LOCAL_ACTIVITY_ARRIVAL_HOLD_SECONDS, LOCAL_ACTIVITY_RADIUS, localSegmentSafe, activityStructureSignature, clearActivityStructure, type LocalActivityContext } from '../src/render/people/LocalActivityPresentation';
import { PeopleVisualStateStore } from '../src/render/people/PeopleVisualState';
import { AnimationController } from '../src/render/animation/AnimationController';
import { buildSocialGroups, groupKeyFor, placeInGroup, travelAnimationFor } from '../src/render/people/PeoplePresentation';
import type { Activity, DestinationKind, Person, SocialRelationship, SocialRelationshipKind, Vec2 } from '../src/sim/types';
import type { MemoryPerson } from '../src/sim/people/PersonalMemorySystem';

function person(id = 'resident'): Person {
  return { id, name: id, sex: 'female', bornMonth: 0, parents: [], children: [], cultureId: 'culture', energy: 1, prestige: 0,
    traits: { curiosity: 0.5, cooperation: 0.5, sociability: 0.5, aggression: 0.5, ambition: 0.5, riskTolerance: 0.5,
      empathy: 0.5, conformity: 0.5, courage: 0.5, patience: 0.5, conscientiousness: 0.5, loyalty: 0.5 },
    homeId: 'town', householdId: 'house', occupation: 'artisan', role: 'craft-worker', activity: 'craft',
    alive: true, health: 1, ageMonths: 360, position: { x: 0, z: 0 }, target: { x: 0, z: 0 },
    navigation: { destinationId: 'bench', destinationKind: 'workshop', schedulePhase: 'work', traveling: false,
      waypoints: [], waypointIndex: 0, reason: 'test' } };
}
function relationship(a: string, b: string, kind: SocialRelationshipKind, overrides: Partial<SocialRelationship> = {}): SocialRelationship {
  const [first, second] = a < b ? [a, b] : [b, a];
  return {
    id: `social-${first}-${second}`,
    a: first,
    b: second,
    kind,
    trust: 0.78,
    strength: 0.82,
    formedMonth: 120,
    lastContactMonth: 358,
    ...overrides,
  };
}
function relationshipLookup(relationships: readonly SocialRelationship[]): (a: string, b: string) => SocialRelationship | undefined {
  const byPair = new Map(relationships.map(r => [r.a < r.b ? `${r.a}|${r.b}` : `${r.b}|${r.a}`, r]));
  return (a, b) => byPair.get(a < b ? `${a}|${b}` : `${b}|${a}`);
}

const ground = { heightAt: () => 0, isStandable: () => true };
function harness(people = [person()], overrides: Partial<LocalActivityContext> = {}) {
  const local = new LocalActivityPresentation();
  const visuals = new PeopleVisualStateStore();
  const peers = new Map(people.map(p => [p.id, p]));
  const groups = buildSocialGroups(people);
  const previousPositions = new Map<string, Vec2>();
  const tick = (dt = 1 / 30) => {
    local.beginFrame(); visuals.beginFrame();
    for (const p of people) { const v = visuals.get(p.id) ?? p.position; previousPositions.set(p.id, { x: v.x, z: v.z }); }
    return people.map(p => {
      const context: LocalActivityContext = { base: { ...p.position, restFacing: 0 }, visual: visuals.get(p.id),
        group: groups.get(groupKeyFor(p) ?? ''), people: peers, structures: [], safeSegment: () => true,
        visualFor: id => previousPositions.get(id),
        revision: 1, blocked: false, ...overrides };
      const plan = local.resolve(p, context, dt);
      const v = visuals.resolve(p.id, { destination: plan?.destination ?? p.position,
        restFacing: plan?.restFacing, localMove: !!plan }, dt, ground);
      return { x: v.x, z: v.z, speed: v.speed, destination: { x: v.destinationX, z: v.destinationZ },
        action: plan?.action, phase: plan?.phase, facing: v.facing, partnerId: plan?.partnerId };
    });
  };
  return { local, visuals, tick };
}

describe('renderer-owned local activity', () => {
  it.each([
    ['home', 'rest'], ['market', 'trade'], ['plaza', 'socialize'], ['workshop', 'craft'], ['shrine', 'worship'],
    ['civic-building', 'assist'], ['knowledge-institution', 'study'], ['industrial-site', 'craft'], ['patrol-route', 'patrol'],
  ] as [DestinationKind, Activity][])('gives %s a bounded sequence under sixty seconds of frozen authority', (kind, activity) => {
    const p = person(); p.activity = activity; p.navigation!.destinationKind = kind;
    const before = JSON.stringify(p), h = harness([p]); const actions = new Set<string>(), points = new Set<string>();
    for (let i = 0; i < 1800; i++) {
      const v = h.tick()[0]!; actions.add(v.action!); points.add(`${v.x.toFixed(2)},${v.z.toFixed(2)}`);
      expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(LOCAL_ACTIVITY_RADIUS);
    }
    expect(actions.size).toBeGreaterThan(3); expect(points.size).toBeGreaterThan(12);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('keeps a frozen authority inhabited for sixty seconds, bounded and byte-for-byte unchanged', () => {
    const p = person(); const before = JSON.stringify(p);
    const h = harness([p]); const points = new Set<string>(); let moving = 0, standing = 0;
    for (let i = 0; i < 1800; i++) {
      const v = h.tick()[0]!;
      points.add(`${v.x.toFixed(2)},${v.z.toFixed(2)}`);
      expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(LOCAL_ACTIVITY_RADIUS);
      if (v.speed >= 0.05) moving++; else standing++;
    }
    expect(points.size).toBeGreaterThan(20);
    expect(moving).toBeGreaterThan(100); expect(standing).toBeGreaterThan(moving);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('keeps the arrival beat brief before beginning purposeful local activity', () => {
    for (const id of ['arrival-a', 'arrival-b', 'arrival-c', 'arrival-d']) {
      const p = person(id), h = harness([p]);
      h.tick(0);
      const initial = h.local.get(p.id)!;
      expect(initial.action).toBe('arrive');
      expect(initial.hold).toBeGreaterThanOrEqual(LOCAL_ACTIVITY_ARRIVAL_HOLD_SECONDS.min);
      expect(initial.hold).toBeLessThanOrEqual(LOCAL_ACTIVITY_ARRIVAL_HOLD_SECONDS.max);

      let elapsed = 0;
      while (h.local.get(p.id)?.action === 'arrive' && elapsed < 2) {
        h.tick(1 / 60);
        elapsed += 1 / 60;
      }
      expect(h.local.get(p.id)?.action).not.toBe('arrive');
      expect(elapsed).toBeLessThan(1.5);
    }
  });

  it('binds home rest to unique physical support slots instead of generic household points', () => {
    const home = { key: 'home-rest', worldX: 0, worldZ: 0, width: 1.2, depth: 0.8, rotationY: Math.PI / 6, role: 'house' };
    const residents = ['rest-a', 'rest-b', 'rest-c', 'rest-d'].map((id, index) => {
      const p = person(id);
      const angle = index / 4 * Math.PI * 2;
      p.activity = 'rest';
      p.navigation!.destinationKind = 'home';
      p.navigation!.destinationId = home.key;
      p.navigation!.schedulePhase = 'home';
      p.position = { x: Math.cos(angle) * 1.35, z: Math.sin(angle) * 1.35 };
      p.target = { ...p.position };
      return p;
    });
    const h = harness(residents, { structures: [home], revision: activityStructureSignature([home]) });

    for (let frame = 0; frame < 8 * 60; frame++) {
      h.tick(1 / 60);
      if (residents.every(p => h.local.get(p.id)?.restStage === 'settled')) break;
    }
    const states = residents.map(p => h.local.get(p.id)!);
    expect(states.every(state => state.action === 'rest')).toBe(true);
    expect(states.every(state => state.restStage === 'settled')).toBe(true);
    expect(states.every(state => state.rest !== undefined)).toBe(true);
    expect(new Set(states.map(state => state.rest!.key)).size).toBe(residents.length);

    for (const state of states) {
      expect(state.destination).toEqual(state.rest!.destination);
      expect(state.rest!.supportKey).toBe(home.key);
      expect(localSegmentSafe(state.destination, state.destination, { structures: [home], safeSegment: () => true })).toBe(true);
    }
  });

  it('completes settle, sustained rest, and rise before allowing the next household movement', () => {
    const home = { key: 'home-choreography', worldX: 0, worldZ: 0, width: 1.2, depth: 0.8, rotationY: 0, role: 'house' };
    const p = person('rest-choreography');
    p.activity = 'rest';
    p.navigation!.destinationKind = 'home';
    p.navigation!.destinationId = home.key;
    p.navigation!.schedulePhase = 'home';
    p.position = { x: 1.2, z: 0.4 };
    p.target = { ...p.position };
    const h = harness([p], { structures: [home], revision: activityStructureSignature([home]) });

    let sawSettling = false, sawSettled = false, sawRising = false;
    let seat: { x: number; z: number } | undefined;
    let riseFrames = 0;
    for (let frame = 0; frame < 20 * 60 && !sawRising; frame++) {
      const visual = h.tick(1 / 60)[0]!;
      const state = h.local.get(p.id);
      if (!state?.rest) continue;
      seat ??= { ...state.rest.destination };
      if (state.restStage === 'settling') sawSettling = true;
      if (state.restStage === 'settled') sawSettled = true;
      if (state.restStage === 'rising') {
        sawRising = true;
        riseFrames++;
        expect(state.destination).toEqual(seat);
        expect(visual.speed).toBeLessThan(0.05);
      }
    }
    expect(sawSettling).toBe(true);
    expect(sawSettled).toBe(true);
    expect(sawRising).toBe(true);

    while (h.local.get(p.id)?.restStage === 'rising' && riseFrames < 180) {
      const visual = h.tick(1 / 60)[0]!;
      const state = h.local.get(p.id)!;
      riseFrames++;
      if (state.restStage === 'rising') {
        expect(state.destination).toEqual(seat);
        expect(visual.speed).toBeLessThan(0.05);
      }
    }
    expect(riseFrames).toBeGreaterThan(20);
    expect(h.local.get(p.id)?.restStage).not.toBe('rising');
  });

  it('replays identically independent of visible-person iteration order and offsets people in time', () => {
    const a = person('a'), b = person('b');
    const first = harness([a, b]), replay = harness([b, a]); let different = 0;
    for (let i = 0; i < 900; i++) {
      const x = first.tick(), y = replay.tick().reverse();
      expect(x).toEqual(y);
      if (x[0]!.phase !== x[1]!.phase || Math.abs(x[0]!.speed - x[1]!.speed) > 0.01) different++;
    }
    expect(different).toBeGreaterThan(90);
  });

  it('checks connecting corridors, water and rotated building corners, not just safe endpoints', () => {
    const obstacle = { key: 'house', worldX: 0, worldZ: 0, width: 0.3, depth: 1, rotationY: Math.PI / 4 };
    const context = { structures: [obstacle], safeSegment: () => true };
    expect(localSegmentSafe({ x: -1, z: 0 }, { x: 1, z: 0 }, context)).toBe(false);
    expect(localSegmentSafe({ x: 2, z: -1 }, { x: 2, z: 1 }, context)).toBe(true);
    expect(localSegmentSafe({ x: 2, z: -1 }, { x: 2, z: 1 }, { ...context, safeSegment: () => false })).toBe(false);
    const h = harness([person()], { safeSegment: (a, b) => a.x <= 0.01 && b.x <= 0.01 });
    for (let i = 0; i < 900; i++) expect(h.tick()[0]!.x).toBeLessThanOrEqual(0.01);
    const blocked = harness([person()], { safeSegment: () => false });
    for (let i = 0; i < 600; i++) expect(blocked.tick()[0]!.speed).toBe(0);
  });

  it.each(['activity', 'destination', 'occupation', 'household'] as const)('immediately replaces local intent when semantic authority changes: %s', field => {
    const p = person(), h = harness([p]);
    for (let i = 0; i < 360; i++) h.tick();
    const old = h.local.get(p.id)!;
    if (field === 'activity') p.activity = 'assist';
    if (field === 'destination') p.navigation!.destinationId = 'other';
    if (field === 'occupation') p.occupation = 'keeper';
    if (field === 'household') p.householdId = 'other-household';
    const v = h.tick(0)[0]!;
    expect(h.local.get(p.id)).not.toBe(old);
    expect(v.destination).toEqual(p.position);
    expect(v.action).toBe('arrive');
  });


  it('preserves an in-progress local routine and absorbs small monthly base jitter', () => {
    const p = person(), h = harness([p]);
    for (let i = 0; i < 360; i++) h.tick();
    const previous = h.local.get(p.id)!;
    const base = { ...previous.base };
    const step = previous.step, cycle = previous.cycle, seconds = previous.seconds, action = previous.action;

    // These values can all change as monthly authority and group placement refresh. None changes
    // the fact that this resident is still an artisan working at the same workshop. The 0.21-unit
    // base drift remains inside the hysteresis band and should therefore be ignored.
    p.position.x += 0.18;
    p.position.z -= 0.11;
    p.target.x += 0.35;
    p.navigation!.schedulePhase = 'meal';
    p.navigation!.waypointIndex = 2;

    h.tick(0);
    const next = h.local.get(p.id)!;
    expect(next).toBe(previous);
    expect(next.step).toBe(step);
    expect(next.cycle).toBe(cycle);
    expect(next.seconds).toBe(seconds);
    expect(next.action).toBe(action);
    expect(next.base).toEqual(base);
  });

  it('uses base hysteresis to follow meaningful drift without chasing each monthly correction', () => {
    const p = person(), h = harness([p]);
    for (let i = 0; i < 360; i++) h.tick();
    const state = h.local.get(p.id)!;
    const step = state.step, cycle = state.cycle, seconds = state.seconds, action = state.action;

    // Cross the follow threshold. The anchor should move most of the way, but deliberately leave
    // a 0.10-unit release gap instead of snapping to the observed group/authority base.
    p.position.x += 0.4;
    h.tick(0);
    const followed = h.local.get(p.id)!;
    expect(followed).toBe(state);
    expect(followed.base.x).toBeCloseTo(0.3, 5);
    expect(Math.abs(p.position.x - followed.base.x)).toBeCloseTo(0.1, 5);
    expect(followed.step).toBe(step);
    expect(followed.cycle).toBe(cycle);
    expect(followed.seconds).toBe(seconds);
    expect(followed.action).toBe(action);

    // A small reverse correction stays inside the dead-band, so the anchor does not chatter back.
    const stableBase = { ...followed.base };
    p.position.x -= 0.12;
    h.tick(0);
    expect(h.local.get(p.id)).toBe(state);
    expect(h.local.get(p.id)!.base).toEqual(stableBase);

    // Accumulated movement beyond the band follows again without resetting the micro-life cycle.
    p.position.x += 0.35;
    h.tick(0);
    const refollowed = h.local.get(p.id)!;
    expect(refollowed).toBe(state);
    expect(refollowed.base.x).toBeGreaterThan(stableBase.x);
    expect(Math.abs(p.position.x - refollowed.base.x)).toBeCloseTo(0.1, 5);
    expect(refollowed.step).toBe(step);
    expect(refollowed.cycle).toBe(cycle);
    expect(refollowed.action).toBe(action);
  });

  it('suspends an ordinary sampled commute without destroying local-life continuity', () => {
    const p = person(), h = harness([p]);
    for (let i = 0; i < 360; i++) h.tick();
    const previous = h.local.get(p.id)!;

    p.activity = 'travel';
    p.navigation!.schedulePhase = 'commute';
    p.navigation!.traveling = false;
    const commuting = h.tick(1 / 60)[0]!;
    expect(commuting.action).toBeUndefined();
    expect(h.local.get(p.id)).toBe(previous);

    p.activity = 'craft';
    p.navigation!.schedulePhase = 'work';
    p.navigation!.destinationId = 'new-bench';
    h.tick(0);
    const resumed = h.local.get(p.id)!;
    expect(resumed).not.toBe(previous);
    expect(resumed.action).toBe('arrive');
    expect(resumed.hold).toBe(0);

    // Once the wider local frontage approach/orientation is complete, no second arrival pause is
    // charged. Step 2 deliberately permits a meaningful short walk here; this is not a teleport.
    let elapsed = 0;
    while (h.local.get(p.id)?.action === 'arrive' && elapsed < 3) {
      h.tick(1 / 60);
      elapsed += 1 / 60;
    }
    expect(h.local.get(p.id)?.action).not.toBe('arrive');
    expect(elapsed).toBeLessThan(2.8);
  });

  it('samples different purposeful routine slices across documentary semantic hand-offs', () => {
    const p = person(), h = harness([p]);
    const sampledActions = new Set<string>();

    // First appearance may use the normal arrival beat.
    for (let i = 0; i < 180; i++) h.tick();
    const first = h.local.get(p.id);
    if (first?.action && first.action !== 'arrive' && first.action !== 'pause') sampledActions.add(first.action);

    for (let handoff = 0; handoff < 6; handoff++) {
      p.activity = 'travel';
      p.navigation!.schedulePhase = 'commute';
      p.navigation!.traveling = false;
      h.tick(1 / 60);

      p.activity = 'craft';
      p.navigation!.schedulePhase = 'work';
      p.navigation!.destinationId = `bench-${handoff}`;
      h.tick(0);
      const resumed = h.local.get(p.id)!;
      // If already oriented, a zero arrival hold may advance into the sampled intent in this same
      // frame. Otherwise the retained route still exposes an explicit zero-hold arrival approach.
      if (resumed.action === 'arrive') expect(resumed.hold).toBe(0);
      else expect(['pause', 'wait-for-clearance', 'observe']).not.toContain(resumed.action);

      for (let i = 0; i < 90 && h.local.get(p.id)?.action === 'arrive'; i++) h.tick(1 / 60);
      const action = h.local.get(p.id)?.action;
      if (action && !['arrive', 'pause', 'wait-for-clearance', 'observe'].includes(action)) sampledActions.add(action);
    }

    expect(sampledActions.size).toBeGreaterThanOrEqual(3);
  });

  it.each(['flee', 'migrate', 'shelter', 'gather', 'construct', 'farm'] as Activity[])('yields to %s and never substitutes ambient work', activity => {
    const p = person(), h = harness([p]); h.tick(); expect(h.local.size).toBe(1);
    p.activity = activity; h.tick(0); expect(h.local.size).toBe(0);
  });

  it('yields to emergencies, displacement, travel and scene interruption', () => {
    for (const interrupt of [(p: Person) => { p.navigation!.schedulePhase = 'emergency'; },
      (p: Person) => { p.displacedSinceMonth = 1; }, (p: Person) => { p.navigation!.traveling = true; }]) {
      const p = person(), h = harness([p]); h.tick(); interrupt(p); h.tick(0); expect(h.local.size).toBe(0);
    }
    expect(harness([person()], { blocked: true }).tick()[0]!.action).toBeUndefined();
  });

  it('uses a head-led recognition glance without steering the whole body toward a nearby friend', () => {
    const a = person('aware-a'), b = person('aware-b');
    b.position = { x: 0.78, z: 0.42 };
    b.target = { ...b.position };
    const tie = relationship('aware-a', 'aware-b', 'friend', { trust: 0.9, strength: 0.9 });
    const before = JSON.stringify([a, b]);
    const h = harness([a, b], { relationshipFor: relationshipLookup([tie]) });
    let noticed = false;
    let cleared = false;
    let sawAcquire = false;
    let sawHold = false;
    let sawRelease = false;
    let maxHeadYaw = 0;
    let maxTorsoYaw = 0;
    let maxBlend = 0;
    let bodyPeerError = 0;
    let attentionBodyFacing: number | undefined;
    let maxBodyFacingDrift = 0;

    for (let frame = 0; frame < 18 * 60; frame++) {
      h.tick(1 / 60);
      const state = h.local.get('aware-a');
      const visual = h.visuals.get('aware-a');
      const peer = h.visuals.get('aware-b');
      if (state?.attentionId === 'aware-b' && visual && peer) {
        noticed = true;
        sawAcquire ||= state.attentionPhase === 'acquire';
        sawHold ||= state.attentionPhase === 'hold';
        sawRelease ||= state.attentionPhase === 'release';
        maxHeadYaw = Math.max(maxHeadYaw, Math.abs(state.attentionHeadYaw ?? 0));
        maxTorsoYaw = Math.max(maxTorsoYaw, Math.abs(state.attentionTorsoYaw ?? 0));
        maxBlend = Math.max(maxBlend, state.attentionBlend ?? 0);
        attentionBodyFacing ??= state.restFacing;
        maxBodyFacingDrift = Math.max(maxBodyFacingDrift,
          Math.abs(Math.atan2(Math.sin(state.restFacing - attentionBodyFacing), Math.cos(state.restFacing - attentionBodyFacing))));
        const peerFacing = Math.atan2(peer.x - state.destination.x, peer.z - state.destination.z);
        bodyPeerError = Math.max(bodyPeerError,
          Math.abs(Math.atan2(Math.sin(state.restFacing - peerFacing), Math.cos(state.restFacing - peerFacing))));
      } else if (noticed && !state?.attentionId) {
        cleared = true;
        break;
      }
    }

    expect(noticed).toBe(true);
    expect(sawAcquire).toBe(true);
    expect(sawHold).toBe(true);
    expect(sawRelease).toBe(true);
    expect(maxBlend).toBeGreaterThan(0.95);
    expect(maxHeadYaw).toBeGreaterThan(0.25);
    expect(maxTorsoYaw).toBeGreaterThan(0);
    expect(maxTorsoYaw).toBeLessThan(maxHeadYaw * 0.35);
    expect(maxBodyFacingDrift).toBeLessThan(0.02);
    expect(bodyPeerError).toBeGreaterThan(0.25);
    expect(cleared).toBe(true);
    expect(h.local.get('aware-a')?.attentionCooldown ?? 0).toBeGreaterThan(0);
    expect(JSON.stringify([a, b])).toBe(before);
  });

  it('does not let child play override rest, study, travel or emergency authority', () => {
    const resting = person('resting-child');
    resting.ageMonths = 10 * 12;
    resting.occupation = 'child';
    resting.role = 'child';
    resting.activity = 'rest';
    resting.navigation!.destinationKind = 'home';
    resting.navigation!.destinationId = 'child-home';
    resting.navigation!.schedulePhase = 'home';
    const restHarness = harness([resting]);
    for (let frame = 0; frame < 6 * 60; frame++) {
      restHarness.tick(1 / 60);
      expect(restHarness.local.get(resting.id)?.action?.startsWith('play-') ?? false).toBe(false);
    }

    const studying = person('studying-child');
    studying.ageMonths = 12 * 12;
    studying.occupation = 'child';
    studying.role = 'child';
    studying.activity = 'study';
    studying.navigation!.destinationKind = 'knowledge-institution';
    studying.navigation!.destinationId = 'school';
    studying.navigation!.schedulePhase = 'work';
    const studyHarness = harness([studying]);
    for (let frame = 0; frame < 6 * 60; frame++) {
      studyHarness.tick(1 / 60);
      expect(studyHarness.local.get(studying.id)?.action?.startsWith('play-') ?? false).toBe(false);
    }

    studying.navigation!.schedulePhase = 'emergency';
    studyHarness.tick(0);
    expect(studyHarness.local.get(studying.id)).toBeUndefined();
  });

  it('presents free children as active play instead of miniature adult conversation', () => {
    const children = ['child-a', 'child-b', 'child-c'].map((id, index) => {
      const p = person(id);
      p.ageMonths = (8 + index * 2) * 12;
      p.occupation = 'child';
      p.role = 'child';
      p.activity = 'socialize';
      p.navigation!.destinationKind = 'plaza';
      p.navigation!.destinationId = 'play-plaza';
      p.navigation!.schedulePhase = 'social';
      const angle = index / 3 * Math.PI * 2;
      p.position = { x: Math.cos(angle) * 0.6, z: Math.sin(angle) * 0.6 };
      p.target = { ...p.position };
      return p;
    });
    const before = JSON.stringify(children);
    const h = harness(children);
    const actions = new Set<string>();
    let playFrames = 0;
    let playmateFrames = 0;
    let movingFrames = 0;

    for (let frame = 0; frame < 18 * 60; frame++) {
      const visuals = h.tick(1 / 60);
      for (let index = 0; index < children.length; index++) {
        const state = h.local.get(children[index]!.id);
        if (state?.action?.startsWith('play-')) actions.add(state.action);
        if (state?.animation === 'play') playFrames++;
        if (state?.partnerId) playmateFrames++;
        if ((visuals[index]?.speed ?? 0) > 0.05) movingFrames++;
      }
    }

    expect(actions.size).toBeGreaterThanOrEqual(4);
    expect([...actions]).toEqual(expect.arrayContaining(['play-hop', 'play-chase']));
    expect(playFrames).toBeGreaterThan(120);
    expect(playmateFrames).toBeGreaterThan(90);
    expect(movingFrames).toBeGreaterThan(90);
    expect(JSON.stringify(children)).toBe(before);
  });

  it('keeps a frozen visible social cluster changing formation instead of occupying mannequin slots', () => {
    const people = Array.from({ length: 8 }, (_, index) => {
      const p = person(`social-${index}`);
      const angle = index / 8 * Math.PI * 2;
      p.position = { x: Math.cos(angle) * 0.7, z: Math.sin(angle) * 0.7 };
      p.target = { ...p.position };
      p.activity = 'socialize';
      p.navigation!.destinationKind = 'plaza';
      p.navigation!.destinationId = 'central-plaza';
      p.navigation!.schedulePhase = 'social';
      return p;
    });
    const before = JSON.stringify(people);
    const local = new LocalActivityPresentation();
    const visuals = new PeopleVisualStateStore();
    const peers = new Map(people.map(p => [p.id, p]));
    const group = buildSocialGroups(people).get('plaza:central-plaza')!;
    const previous = new Map<string, Vec2>();
    const origin = new Map<string, Vec2>();
    const maxDisplacement = new Map(people.map(p => [p.id, 0]));
    const pairMin = new Map<string, number>();
    const pairMax = new Map<string, number>();
    let conversationFrames = 0;

    for (let frame = 0; frame < 15 * 60; frame++) {
      local.beginFrame(); visuals.beginFrame();
      previous.clear();
      for (const p of people) {
        const v = visuals.get(p.id);
        if (v) previous.set(p.id, { x: v.x, z: v.z });
      }
      for (const p of people) {
        const base = placeInGroup(p, group, p.position);
        const plan = local.resolve(p, {
          base, visual: visuals.get(p.id), group, people: peers, visualFor: id => previous.get(id),
          structures: [], safeSegment: () => true, revision: 'social-cluster', blocked: false, far: false,
        }, 1 / 60);
        const v = visuals.resolve(p.id, {
          destination: plan?.destination ?? base,
          restFacing: plan?.restFacing ?? base.restFacing,
          localMove: Boolean(plan && plan.action !== 'arrive'),
          smoothTravel: !plan,
        }, 1 / 60, ground);
        if (!origin.has(p.id)) origin.set(p.id, { x: v.x, z: v.z });
        const start = origin.get(p.id)!;
        maxDisplacement.set(p.id, Math.max(maxDisplacement.get(p.id)!, Math.hypot(v.x - start.x, v.z - start.z)));
        if (plan?.partnerId) conversationFrames++;
      }
      for (let a = 0; a < people.length; a++) for (let b = a + 1; b < people.length; b++) {
        const va = visuals.get(people[a]!.id)!, vb = visuals.get(people[b]!.id)!;
        const key = `${a}:${b}`;
        const d = Math.hypot(va.x - vb.x, va.z - vb.z);
        pairMin.set(key, Math.min(pairMin.get(key) ?? Infinity, d));
        pairMax.set(key, Math.max(pairMax.get(key) ?? 0, d));
      }
      local.prune(); visuals.prune();
    }

    const mobile = [...maxDisplacement.values()].filter(distance => distance >= 0.22).length;
    const changingPairs = [...pairMax.keys()].filter(key => pairMax.get(key)! - pairMin.get(key)! >= 0.16).length;
    expect(mobile).toBeGreaterThanOrEqual(5);
    expect(changingPairs).toBeGreaterThanOrEqual(8);
    expect(conversationFrames).toBeGreaterThan(180);
    expect(JSON.stringify(people)).toBe(before);
  });

  it('chooses a strong real relationship over a merely convenient nearby partner', () => {
    const a = person('a'), friend = person('friend'), nearby = person('nearby');
    for (const p of [a, friend, nearby]) {
      p.activity = 'socialize';
      p.navigation!.destinationKind = 'plaza';
      p.navigation!.destinationId = 'meaningful-plaza';
      p.navigation!.schedulePhase = 'social';
    }
    a.position = { x: 0, z: 0 }; friend.position = { x: 0.95, z: 0.12 }; nearby.position = { x: 0.42, z: -0.1 };
    friend.target = { ...friend.position }; nearby.target = { ...nearby.position };
    const ties = [
      relationship('a', 'friend', 'friend', { trust: 0.9, strength: 0.92 }),
      relationship('a', 'nearby', 'neighbor', { trust: 0.48, strength: 0.24 }),
    ];
    const h = harness([a, nearby, friend], { relationshipFor: relationshipLookup(ties) });
    let selected: string | undefined;
    for (let frame = 0; frame < 45 * 60 && !selected; frame++) {
      h.tick(1 / 60);
      selected = h.local.get('a')?.partnerId;
    }
    expect(selected).toBe('friend');
    expect(h.local.get('a')?.encounter?.relationshipKind).toBe('friend');
    expect(h.local.get('a')?.encounter?.tone).toBe('warm');
  });

  it('holds a mentor relationship through several readable guidance beats instead of one generic gesture', () => {
    const mentor = person('mentor'), learner = person('learner');
    mentor.ageMonths = 50 * 12; learner.ageMonths = 24 * 12;
    for (const p of [mentor, learner]) {
      p.activity = 'study';
      p.navigation!.destinationKind = 'knowledge-institution';
      p.navigation!.destinationId = 'archive';
      p.navigation!.schedulePhase = 'work';
    }
    learner.position.x = 0.72; learner.target = { ...learner.position };
    const tie = relationship('mentor', 'learner', 'mentor', {
      teaching: { mentorId: 'mentor', learnerId: 'learner', domain: 'records', progress: 0.7, lastTaughtMonth: 358 },
    });
    const h = harness([mentor, learner], { relationshipFor: relationshipLookup([tie]) });
    const mentorActions = new Set<string>(), learnerActions = new Set<string>();
    const mentorBeats = new Set<number>(), learnerBeats = new Set<number>();
    for (let frame = 0; frame < 60 * 60; frame++) {
      h.tick(1 / 60);
      const m = h.local.get('mentor'), l = h.local.get('learner');
      if (m?.encounter?.partnerId === 'learner') { mentorActions.add(m.action); mentorBeats.add(m.encounter.beat); }
      if (l?.encounter?.partnerId === 'mentor') { learnerActions.add(l.action); learnerBeats.add(l.encounter.beat); }
    }
    expect([...mentorActions]).toEqual(expect.arrayContaining(['offer-guidance', 'explain-guidance', 'check-understanding']));
    expect([...learnerActions]).toEqual(expect.arrayContaining(['seek-guidance', 'listen-to-mentor', 'consider-guidance']));
    expect(mentorBeats.size).toBeGreaterThanOrEqual(3);
    expect(learnerBeats.size).toBeGreaterThanOrEqual(3);
  });

  it('turns recent grief between close friends into quiet support rather than cheerful generic conversation', () => {
    const grieving = person('grieving') as MemoryPerson, friend = person('supporter');
    for (const p of [grieving, friend]) {
      p.activity = 'socialize';
      p.navigation!.destinationKind = 'plaza';
      p.navigation!.destinationId = 'support-plaza';
      p.navigation!.schedulePhase = 'social';
    }
    friend.position.x = 0.68; friend.target = { ...friend.position };
    grieving.personalMemories = [{
      id: 'memory-loss', kind: 'loss', month: 358, subjectId: 'lost-relative',
      emotionalWeight: 0.92, valence: -1, reason: 'family-loss',
    }];
    const tie = relationship('grieving', 'supporter', 'friend', { trust: 0.9, strength: 0.88 });
    const h = harness([grieving, friend], { relationshipFor: relationshipLookup([tie]) });
    const grievingActions = new Set<string>(), supporterActions = new Set<string>();
    let quietAnimationSeen = false;
    for (let frame = 0; frame < 45 * 60; frame++) {
      h.tick(1 / 60);
      const g = h.local.get('grieving'), s = h.local.get('supporter');
      if (g?.encounter?.partnerId === 'supporter') {
        grievingActions.add(g.action);
        quietAnimationSeen ||= g.animation === 'converse-quiet';
      }
      if (s?.encounter?.partnerId === 'grieving') supporterActions.add(s.action);
    }
    expect(h.local.get('grieving')?.encounter?.tone ?? 'supportive').toBe('supportive');
    expect([...grievingActions]).toEqual(expect.arrayContaining(['receive-check-in', 'accept-quiet-company']));
    expect([...supporterActions]).toEqual(expect.arrayContaining(['check-in', 'offer-quiet-company']));
    expect(quietAnimationSeen).toBe(true);
  });

  it('presents a rivalry as a shorter guarded encounter with more space', () => {
    const a = person('rival-a'), b = person('rival-b');
    for (const p of [a, b]) {
      p.activity = 'socialize';
      p.navigation!.destinationKind = 'plaza';
      p.navigation!.destinationId = 'rival-plaza';
      p.navigation!.schedulePhase = 'social';
    }
    b.position.x = 0.8; b.target = { ...b.position };
    const tie = relationship('rival-a', 'rival-b', 'rival', { trust: 0.18, strength: 0.9 });
    const h = harness([a, b], { relationshipFor: relationshipLookup([tie]) });
    let tone: string | undefined;
    let guarded = false;
    let minimumPlannedSeparation = Infinity;
    for (let frame = 0; frame < 40 * 60; frame++) {
      h.tick(1 / 60);
      const state = h.local.get('rival-a');
      if (state?.encounter?.partnerId === 'rival-b') {
        tone = state.encounter.tone;
        guarded ||= state.animation === 'converse-tense' || state.action.startsWith('guarded-');
        const peer = h.visuals.get('rival-b') ?? b.position;
        minimumPlannedSeparation = Math.min(minimumPlannedSeparation, Math.hypot(state.destination.x - peer.x, state.destination.z - peer.z));
      }
    }
    expect(tone).toBe('tense');
    expect(guarded).toBe(true);
    expect(minimumPlannedSeparation).toBeGreaterThan(0.56);
  });

  it('prefers reciprocal social partners so conversations can read as two-sided', () => {
    const people = Array.from({ length: 4 }, (_, index) => {
      const p = person(`pair-${index}`);
      p.position = { x: (index - 1.5) * 0.55, z: index % 2 ? 0.25 : -0.25 };
      p.target = { ...p.position };
      p.activity = 'socialize';
      p.navigation!.destinationKind = 'plaza';
      p.navigation!.destinationId = 'pair-plaza';
      p.navigation!.schedulePhase = 'social';
      return p;
    });
    const h = harness(people);
    let mutualFrames = 0;
    for (let frame = 0; frame < 30 * 60; frame++) {
      h.tick(1 / 60);
      for (const p of people) {
        const partner = h.local.get(p.id)?.partnerId;
        if (partner && h.local.get(partner)?.partnerId === p.id) mutualFrames++;
      }
    }
    expect(mutualFrames).toBeGreaterThan(90);
  });

  it('keeps local destinations clear of uninvolved peers instead of walking onto their floor slot', () => {
    const people = Array.from({ length: 6 }, (_, index) => {
      const p = person(`clear-${index}`);
      const angle = index / 6 * Math.PI * 2;
      p.position = { x: Math.cos(angle) * 0.62, z: Math.sin(angle) * 0.62 };
      p.target = { ...p.position };
      p.activity = 'socialize';
      p.navigation!.destinationKind = 'plaza';
      p.navigation!.destinationId = 'clear-plaza';
      p.navigation!.schedulePhase = 'social';
      return p;
    });
    const h = harness(people);
    for (let frame = 0; frame < 20 * 60; frame++) {
      // LocalActivityPresentation plans from the previous-frame peer snapshot so results do not
      // depend on visible-person iteration order. Validate against that exact planning snapshot.
      const planningPositions = new Map(people.map(p => {
        const visual = h.visuals.get(p.id);
        return [p.id, visual ? { x: visual.x, z: visual.z } : { ...p.position }] as const;
      }));
      h.tick(1 / 60);
      for (const p of people) {
        const state = h.local.get(p.id);
        if (!state) continue;
        for (const other of people) {
          if (other.id === p.id || other.id === state.partnerId) continue;
          const at = planningPositions.get(other.id)!;
          expect(Math.hypot(state.destination.x - at.x, state.destination.z - at.z)).toBeGreaterThanOrEqual(0.339);
        }
      }
    }
  });

  it('varies repeated local reposition targets so long frozen shots do not reveal seven exact markers', () => {
    const p = person('varied-local');
    p.activity = 'patrol';
    p.navigation!.destinationKind = 'patrol-route';
    p.navigation!.destinationId = 'watch-route';
    const h = harness([p]);
    const targets = new Set<string>();
    let lastAction = '';
    for (let frame = 0; frame < 90 * 30; frame++) {
      h.tick(1 / 30);
      const state = h.local.get(p.id);
      if (!state) continue;
      if (state.action !== lastAction && ['patrol-point', 'survey-route'].includes(state.action)) {
        targets.add(`${state.destination.x.toFixed(3)},${state.destination.z.toFixed(3)}`);
      }
      lastAction = state.action;
    }
    expect(targets.size).toBeGreaterThanOrEqual(6);
  });

  it('turns toward a real companion without ever aliasing their authority', () => {
    const a = person('a'), b = person('b'); b.position.x = 0.7;
    for (const p of [a, b]) { p.activity = 'socialize'; p.navigation!.destinationKind = 'plaza'; }
    const before = JSON.stringify([a, b]), h = harness([a, b]); let interactions = 0;
    for (let i = 0; i < 1800; i++) {
      h.tick();
      for (const p of [a, b]) if (h.local.get(p.id)?.partnerId) interactions++;
    }
    expect(interactions).toBeGreaterThan(0); expect(JSON.stringify([a, b])).toBe(before);
    b.activity = 'flee'; h.tick(); expect(h.local.get(a.id)?.partnerId).toBeUndefined();
  });

  it('prunes local, visual and animation state when visibility ends', () => {
    const h = harness(), animation = new AnimationController(); h.tick(); animation.getOrCreateCharacterState('resident', 'artisan');
    h.local.beginFrame(); h.visuals.beginFrame(); h.local.prune(); h.visuals.prune(id => animation.release(id));
    expect(h.local.size).toBe(0); expect(h.visuals.size).toBe(0); expect(animation.trackedCharacters).toBe(0);
  });

  it('keeps timing across equivalent geometry rebuilds and cancels a newly obstructed return', () => {
    const structures = [{ key: 'workshop', worldX: 0, worldZ: -1, width: 0.6, depth: 0.5, rotationY: 0, role: 'workshop' }];
    const p = person(), options: Partial<LocalActivityContext> = { structures, revision: activityStructureSignature(structures) };
    const h = harness([p], options);
    for (let i = 0; i < 300; i++) h.tick();
    const previous = h.local.get(p.id)!;
    options.structures = structuredClone(structures); options.revision = activityStructureSignature(options.structures);
    h.tick(); expect(h.local.get(p.id)).toBe(previous);
    for (let i = 0; i < 900 && Math.hypot(h.visuals.get(p.id)!.x, h.visuals.get(p.id)!.z) < 0.05; i++) h.tick();
    const at = h.visuals.get(p.id)!;
    const stoppedAt = { x: at.x, z: at.z };
    options.revision = 'new-obstacle'; options.safeSegment = (a, b) => a.x === b.x && a.z === b.z;
    h.tick(0);
    expect(h.local.get(p.id)).not.toBe(previous);
    expect(h.local.get(p.id)?.destination).toEqual(stoppedAt);
    expect(h.local.get(p.id)?.action).toBe('wait-for-clearance');
  });

  it('does not originate local motion inside a building, including rotated corners', () => {
    const building = { key: 'house', worldX: 0, worldZ: 0, width: 1, depth: 1, rotationY: Math.PI / 4 };
    const h = harness([person()], { structures: [building] });
    h.tick(); expect(h.local.size).toBe(0);
    for (const point of [{ x: 0, z: 0 }, { x: 0.72, z: 0 }, { x: 0.5, z: 0.4 }]) {
      const safe = clearActivityStructure(point, building, 0);
      expect(localSegmentSafe(safe, safe, { structures: [building], safeSegment: () => true })).toBe(true);
    }
  });

  it('turns before a short step, eases in and out, without a month estimator', () => {
    const store = new PeopleVisualStateStore();
    store.resolve('walker', { destination: { x: 0, z: 0 } }, 0, ground);
    const target = { destination: { x: 0.6, z: 0 }, localMove: true, localSpeed: 0.3 };
    const turn = store.resolve('walker', target, 0.016, ground);
    expect(turn.speed).toBe(0); expect(turn.facing).toBeGreaterThan(0);
    const speeds: number[] = [];
    for (let i = 0; i < 180; i++) { const v = store.resolve('walker', target, 1 / 60, ground); if (v.speed > 0) speeds.push(v.speed); }
    expect(speeds[0]).toBeLessThan(Math.max(...speeds) / 4);
    expect(speeds.at(-1)).toBeLessThan(Math.max(...speeds) / 4);
    expect(store.get('walker')!.x).toBeCloseTo(0.6);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(0.3 + 1e-8);
  });

  it('retries after the ground guard stops a journey instead of freezing in approach', () => {
    const p = person(), h = harness([p]);
    for (let i = 0; i < 300; i++) h.tick();
    const plan = h.local.get(p.id)!, visual = h.visuals.get(p.id)!;
    visual.x = plan.destination.x + 0.2; visual.z = plan.destination.z;
    visual.destinationX = plan.destination.x; visual.destinationZ = plan.destination.z;
    visual.progress = 1; visual.traveling = false; visual.speed = 0;
    const stopped = { x: visual.x, z: visual.z };
    h.tick(0);
    expect(h.local.get(p.id)!.destination).toEqual(stopped);
    expect(h.local.get(p.id)!.action).toBe('wait-for-clearance');
  });
});

describe('displacement-driven human animation', () => {
  it.each(['travel', 'patrol', 'flee', 'migrate'] as Activity[])('does not walk in place for %s, even through transition blending', activity => {
    const controller = new AnimationController(); const p = person(); p.activity = activity; p.navigation!.traveling = true;
    controller.getOrCreateCharacterState(p.id, p.occupation);
    controller.updateCharacterAnimation(p.id, 0.4, activity, 'walk', 0.4);
    controller.updateCharacterAnimation(p.id, 0.016, activity, 'walk', 0);
    expect(travelAnimationFor(0, p)).toBe('idle');
    expect(controller.getCurrentPose(p.id)!.leftHipRotation).toBe(0);
    expect(controller.getCurrentPose(p.id)!.rightHipRotation).toBe(0);
  });

  it('advances stride by distance, preserves it across pauses and keeps carrying arms occupied', () => {
    const controller = new AnimationController();
    const state = controller.getOrCreateCharacterState('walker', 'carrier');
    controller.updateCharacterAnimation('walker', 0.5, 'transport', 'carry', 0.3, 360, true);
    const phase = state.stridePhase, pose = { ...controller.getCurrentPose('walker')! };
    expect(pose.leftShoulderRotation).toBe(0.42);
    controller.updateCharacterAnimation('walker', 2, 'transport', 'idle', 0);
    expect(state.stridePhase).toBe(phase);
    controller.updateCharacterAnimation('walker', 0.5, 'transport', 'carry', 0.3, 360, true);
    expect(state.stridePhase).toBeGreaterThan(phase);
  });

  it('provides bounded, unsynchronized stationary gestures independent of creation order', () => {
    const a = new AnimationController('same'), b = new AnimationController('same');
    a.getOrCreateCharacterState('one', 'elder'); b.getOrCreateCharacterState('other', 'elder'); b.getOrCreateCharacterState('one', 'elder');
    const samples: number[] = [];
    for (let i = 0; i < 900; i++) {
      for (const controller of [a, b]) controller.updateCharacterAnimation('one', 1 / 30, 'patrol', 'idle', 0, 850);
      const pose = a.getCurrentPose('one')!; samples.push(pose.headRotation);
      expect(pose).toEqual(b.getCurrentPose('one'));
      expect(Math.abs(pose.headRotation)).toBeLessThanOrEqual(0.21);
      expect(pose.leftHipRotation).toBe(0);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.05);
  });
});
