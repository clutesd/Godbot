import { describe, expect, it } from 'vitest';
import { LocalActivityPresentation, LOCAL_ACTIVITY_RADIUS, localSegmentSafe, activityStructureSignature, clearActivityStructure, type LocalActivityContext } from '../src/render/people/LocalActivityPresentation';
import { PeopleVisualStateStore } from '../src/render/people/PeopleVisualState';
import { AnimationController } from '../src/render/animation/AnimationController';
import { buildSocialGroups, groupKeyFor, travelAnimationFor } from '../src/render/people/PeoplePresentation';
import type { Activity, DestinationKind, Person, Vec2 } from '../src/sim/types';

function person(id = 'resident'): Person {
  return { id, name: id, sex: 'female', bornMonth: 0, parents: [], children: [], cultureId: 'culture', energy: 1, prestige: 0,
    traits: { curiosity: 0.5, cooperation: 0.5, sociability: 0.5, aggression: 0.5, ambition: 0.5, riskTolerance: 0.5,
      empathy: 0.5, conformity: 0.5, courage: 0.5, patience: 0.5, conscientiousness: 0.5, loyalty: 0.5 },
    homeId: 'town', householdId: 'house', occupation: 'artisan', role: 'craft-worker', activity: 'craft',
    alive: true, health: 1, ageMonths: 360, position: { x: 0, z: 0 }, target: { x: 0, z: 0 },
    navigation: { destinationId: 'bench', destinationKind: 'workshop', schedulePhase: 'work', traveling: false,
      waypoints: [], waypointIndex: 0, reason: 'test' } };
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
        action: plan?.action, phase: plan?.phase, facing: v.facing };
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

  it('turns before a short step, eases in and out, and does not train the month estimator', () => {
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
    expect(store.get('walker')!.retargets).toBe(0);
    expect(store.get('walker')!.monthSeconds).toBe(0);
    expect(store.get('walker')!.sinceRetarget).toBeCloseTo(3.016);
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
