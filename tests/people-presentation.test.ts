import { describe, expect, it } from 'vitest';
import {
  PeopleVisualStateStore,
  RUN_SPEED_THRESHOLD,
  SNAP_DISTANCE,
  polylineLength,
  routeAwarePath,
  samplePolyline,
  turnToward,
  type PersonVisualGround,
} from '../src/render/people/PeopleVisualState';
import { buildSocialGroups, groupKeyFor, placeInGroup, travelAnimationFor, visualTierFor } from '../src/render/people/PeoplePresentation';
import { AnimationController } from '../src/render/animation/AnimationController';
import { HistoricalImportanceSystem } from '../src/sim/people/HistoricalImportance';
import { NOTABLE_VISUAL_BUDGET, visiblePersonBudgetForDensity } from '../src/render/GodboxRenderer';
import { Simulation } from '../src/sim/Simulation';
import type { HistoricalEvent, Person, SimulationState, Vec2 } from '../src/sim/types';

const flatGround: PersonVisualGround = {
  heightAt: () => 2.5,
  isStandable: () => true,
};

const groundWithWater = (isWater: (x: number, z: number) => boolean): PersonVisualGround => ({
  heightAt: (x, z) => (isWater(x, z) ? -1 : 2.5),
  isStandable: (x, z) => !isWater(x, z),
});

const step = (store: PeopleVisualStateStore, id: string, destination: Vec2, seconds: number, ground: PersonVisualGround = flatGround, waypoints?: Vec2[]) => {
  store.beginFrame();
  const state = store.resolve(id, { destination, ...(waypoints ? { waypoints, waypointIndex: waypoints.length } : {}) }, seconds, ground);
  store.prune();
  return state;
};

const person = (overrides: Partial<Person> = {}): Person => ({
  id: 'person-1',
  name: 'Test',
  sex: 'female',
  ageMonths: 30 * 12,
  bornMonth: 0,
  parents: [],
  children: [],
  householdId: 'household-1',
  homeId: 'settlement-1',
  cultureId: 'culture-1',
  position: { x: 0, z: 0 },
  target: { x: 0, z: 0 },
  occupation: 'farmer',
  activity: 'rest',
  health: 1,
  energy: 1,
  prestige: 0.2,
  traits: { curiosity: 0.5, cooperation: 0.5, sociability: 0.5, aggression: 0.3, ambition: 0.5, riskTolerance: 0.5, empathy: 0.5, conformity: 0.5, courage: 0.5, patience: 0.5, conscientiousness: 0.5, loyalty: 0.5 },
  alive: true,
  ...overrides,
});

const emptyState = (overrides: Partial<SimulationState> = {}): SimulationState => ({
  polities: [], wars: [], institutions: [], history: [], people: [], ...overrides,
} as unknown as SimulationState);

describe('Visual continuity for represented people', () => {
  it('interpolates ordinary movement instead of snapping, and converges on the simulation position', () => {
    const store = new PeopleVisualStateStore();
    const spawned = step(store, 'person-1', { x: 0, z: 0 }, 0.016);
    expect(spawned.snapped).toBe(true);

    const started = step(store, 'person-1', { x: 4, z: 0 }, 0.016);
    expect(started.snapped).toBe(false);
    expect(Math.hypot(started.x - 4, started.z)).toBeGreaterThan(3);

    let travelled = started;
    for (let frame = 0; frame < 8; frame += 1) travelled = step(store, 'person-1', { x: 4, z: 0 }, 0.05);
    expect(travelled.x).toBeGreaterThan(0.001);
    expect(travelled.x).toBeLessThan(4);
    expect(travelled.snapped).toBe(false);

    for (let frame = 0; frame < 400; frame += 1) travelled = step(store, 'person-1', { x: 4, z: 0 }, 0.05);
    expect(travelled.x).toBeCloseTo(4, 3);
    expect(travelled.traveling).toBe(false);
  });

  it('smoothly retargets mid-journey rather than teleporting', () => {
    const store = new PeopleVisualStateStore();
    step(store, 'person-1', { x: 0, z: 0 }, 0.016);
    step(store, 'person-1', { x: 6, z: 0 }, 0.4);
    for (let frame = 0; frame < 6; frame += 1) step(store, 'person-1', { x: 6, z: 0 }, 0.1);
    const before = store.get('person-1')!;
    const midX = before.x;
    const midZ = before.z;
    expect(midX).toBeGreaterThan(0.01);
    expect(midX).toBeLessThan(6);

    const retargeted = step(store, 'person-1', { x: 6, z: 6 }, 0);
    expect(retargeted.snapped).toBe(false);
    expect(retargeted.x).toBeCloseTo(midX, 6);
    expect(retargeted.z).toBeCloseTo(midZ, 6);
    expect(retargeted.destinationX).toBe(6);
    expect(retargeted.destinationZ).toBe(6);

    let state = retargeted;
    for (let frame = 0; frame < 400; frame += 1) state = step(store, 'person-1', { x: 6, z: 6 }, 0.05);
    expect(state.x).toBeCloseTo(6, 3);
    expect(state.z).toBeCloseTo(6, 3);
  });

  it('resets rather than dragging a character across an impossible jump', () => {
    const store = new PeopleVisualStateStore();
    step(store, 'person-1', { x: 0, z: 0 }, 0.016);
    const jumped = step(store, 'person-1', { x: SNAP_DISTANCE + 5, z: 0 }, 0.05);
    expect(jumped.snapped).toBe(true);
    expect(jumped.x).toBeCloseTo(SNAP_DISTANCE + 5, 5);
    expect(jumped.traveling).toBe(false);
  });

  it('anchors the feet on rendered terrain and never leaves a character in water', () => {
    const water = groundWithWater((x) => x > 2);
    const store = new PeopleVisualStateStore();
    step(store, 'person-1', { x: 0, z: 0 }, 0.016, water);
    let state = store.get('person-1')!;
    expect(state.footY).toBe(2.5);

    for (let frame = 0; frame < 200; frame += 1) state = step(store, 'person-1', { x: 5, z: 0 }, 0.05, water);
    expect(state.x).toBeLessThanOrEqual(2);
    expect(state.footY).toBe(2.5);
  });

  it('faces the direction of visual travel and turns instead of flipping', () => {
    const store = new PeopleVisualStateStore();
    step(store, 'person-1', { x: 0, z: 0 }, 0.016);
    let state = step(store, 'person-1', { x: 0, z: 5 }, 0.05);
    for (let frame = 0; frame < 30; frame += 1) state = step(store, 'person-1', { x: 0, z: 5 }, 0.05);
    expect(state.facing).toBeCloseTo(0, 2);

    state = step(store, 'person-1', { x: 0, z: -5 }, 0.05);
    const afterOneFrame = Math.abs(state.facing);
    expect(afterOneFrame).toBeLessThan(Math.PI * 0.5);
    for (let frame = 0; frame < 30; frame += 1) state = step(store, 'person-1', { x: 0, z: -5 }, 0.05);
    expect(Math.abs(Math.abs(state.facing) - Math.PI)).toBeLessThan(0.2);
  });

  it('compresses long journeys into bounded, legible motion', () => {
    const store = new PeopleVisualStateStore();
    step(store, 'person-1', { x: 0, z: 0 }, 0.016);
    step(store, 'person-1', { x: 12, z: 0 }, 1);
    const state = store.get('person-1')!;
    expect(state.duration).toBeGreaterThan(0);
    expect(state.duration).toBeLessThanOrEqual(8);
    expect(12 / state.duration).toBeGreaterThan(RUN_SPEED_THRESHOLD * 0.5);
  });

  it('drops visual state for people who stop being represented', () => {
    const store = new PeopleVisualStateStore();
    step(store, 'person-1', { x: 0, z: 0 }, 0.016);
    step(store, 'person-2', { x: 1, z: 0 }, 0.016);
    expect(store.size).toBe(1);

    store.beginFrame();
    store.resolve('person-1', { destination: { x: 0, z: 0 } }, 0.016, flatGround);
    store.resolve('person-2', { destination: { x: 1, z: 0 } }, 0.016, flatGround);
    store.prune();
    expect(store.size).toBe(2);

    const removed: string[] = [];
    store.beginFrame();
    store.resolve('person-1', { destination: { x: 0, z: 0 } }, 0.016, flatGround);
    store.prune((id) => removed.push(id));
    expect(removed).toEqual(['person-2']);
    expect(store.size).toBe(1);
  });
});

describe('Route-aware visual travel', () => {
  it('threads the journey through the waypoints the simulation actually used', () => {
    const path = routeAwarePath({ x: 0, z: 0 }, { x: 10, z: 0 }, [
      { x: 0, z: 0 }, { x: 3, z: 4 }, { x: 7, z: 4 }, { x: 10, z: 0 },
    ], 4);
    expect(path[0]).toEqual({ x: 0, z: 0 });
    expect(path[path.length - 1]).toEqual({ x: 10, z: 0 });
    expect(path.some((point) => point.z === 4)).toBe(true);
    expect(polylineLength(path)).toBeGreaterThan(10);
    for (let index = 2; index < path.length; index += 1) {
      const previous = Math.hypot(10 - path[index - 1]!.x, path[index - 1]!.z);
      const current = Math.hypot(10 - path[index]!.x, path[index]!.z);
      expect(current).toBeLessThan(previous);
    }
  });

  it('falls back to a straight interpolation when no route is available', () => {
    const path = routeAwarePath({ x: 0, z: 0 }, { x: 4, z: 0 }, undefined);
    expect(path).toEqual([{ x: 0, z: 0 }, { x: 4, z: 0 }]);
    expect(samplePolyline(path, 0.5)).toEqual({ x: 2, z: 0 });
  });

  it('keeps the rendered walk on the route rather than cutting the corner', () => {
    const waypoints = [{ x: 0, z: 0 }, { x: 0, z: 6 }, { x: 6, z: 6 }];
    const store = new PeopleVisualStateStore();
    step(store, 'person-1', { x: 0, z: 0 }, 0.016);
    let state = step(store, 'person-1', { x: 6, z: 6 }, 0.5, flatGround, waypoints);
    let sawCorridor = false;
    for (let frame = 0; frame < 200 && state.traveling; frame += 1) {
      state = step(store, 'person-1', { x: 6, z: 6 }, 0.05, flatGround, waypoints);
      if (state.x < 1 && state.z > 4) sawCorridor = true;
    }
    expect(sawCorridor).toBe(true);
  });

  it('turns along the shortest arc with a bounded step', () => {
    expect(turnToward(0, Math.PI * 0.5, 0.1)).toBeCloseTo(0.1, 6);
    expect(turnToward(0, -Math.PI * 0.5, 0.1)).toBeCloseTo(-0.1, 6);
    expect(turnToward(Math.PI - 0.05, -Math.PI + 0.05, 1)).toBeCloseTo(Math.PI + 0.05, 6);
  });
});

describe('Purposeful gatherings', () => {
  const attendee = (id: string, x: number, z: number) => person({
    id,
    position: { x, z },
    navigation: {
      destinationKind: 'shrine', destinationId: 'settlement-1:shrine', reason: 'evening gathering',
      waypoints: [], waypointIndex: 0, schedulePhase: 'ritual', traveling: false, crossingMode: 'walk',
    },
  });

  it('groups settled attendants and leaves travellers on their own route', () => {
    const travelling = person({ id: 'person-9', navigation: { ...attendee('person-9', 0, 0).navigation!, traveling: true } });
    expect(groupKeyFor(travelling)).toBeUndefined();
    const groups = buildSocialGroups([attendee('person-1', 0, 0), attendee('person-2', 2, 0), travelling]);
    expect(groups.size).toBe(1);
    expect(groups.get('shrine:settlement-1:shrine')!.members).toEqual(['person-1', 'person-2']);
    expect(groups.get('shrine:settlement-1:shrine')!.centerX).toBe(1);
  });

  it('places attendants deterministically, near their own position, and turned toward the focus', () => {
    const people = [attendee('person-1', 0, 0), attendee('person-2', 2, 0), attendee('person-3', 1, 2)];
    const groups = buildSocialGroups(people);
    const group = groups.get('shrine:settlement-1:shrine')!;
    const placements = people.map((candidate) => placeInGroup(candidate, group, candidate.position));
    const again = people.map((candidate) => placeInGroup(candidate, group, candidate.position));
    expect(placements).toEqual(again);
    for (let index = 0; index < people.length; index += 1) {
      const placement = placements[index]!;
      const source = people[index]!.position;
      expect(Math.hypot(placement.x - source.x, placement.z - source.z)).toBeLessThanOrEqual(1.6001);
      expect(placement.restFacing).toBeDefined();
    }
    const distinct = new Set(placements.map((placement) => `${placement.x.toFixed(4)}:${placement.z.toFixed(4)}`));
    expect(distinct.size).toBe(people.length);
  });

  it('maps visual travel onto locomotion animation rather than a stationary work loop', () => {
    const walker = person({ activity: 'craft' });
    expect(travelAnimationFor(0, walker)).toBeUndefined();
    expect(travelAnimationFor(0.4, walker)).toBe('walk');
    expect(travelAnimationFor(RUN_SPEED_THRESHOLD + 0.1, walker)).toBe('run');
    expect(travelAnimationFor(0.4, person({ activity: 'transport' }))).toBe('carry');
    expect(travelAnimationFor(0.4, person({ activity: 'flee' }))).toBe('run');
  });
});

describe('Historical importance', () => {
  it('leaves ordinary lives ordinary and promotes only people the simulation singled out', () => {
    const system = new HistoricalImportanceSystem();
    const ordinary = person({ id: 'person-1' });
    const leader = person({ id: 'person-2' });
    const state = emptyState({
      polities: [{ id: 'polity-1', leadingPersonId: 'person-2', settlementIds: ['settlement-1', 'settlement-2'], phaseSinceMonth: 0, legitimacy: 0.6 }],
    } as unknown as Partial<SimulationState>);

    expect(system.evaluate(ordinary, state, 120).status).toBe('ordinary');
    expect(system.evaluate(leader, state, 120).status).toBe('notable');
    expect(leader.historical!.reasons).toContain('polity-leader');
  });

  it('reaches historical status only through a chronicled record, and never demotes a life', () => {
    const system = new HistoricalImportanceSystem();
    const figure = person({ id: 'person-2' });
    const history: HistoricalEvent[] = [1, 2, 3].map((index) => ({
      id: `event-${index}`, month: index * 12, type: 'discovery', actors: ['settlement-1', 'person-2'],
      causes: [], context: {}, outcome: '', affectedPopulation: 0, magnitude: 0.8, significance: 0.9, tags: [], summary: '',
    }));
    const state = emptyState({
      history,
      polities: [{ id: 'polity-1', leadingPersonId: 'person-2', settlementIds: ['settlement-1'], phaseSinceMonth: 0, legitimacy: 0.8 }],
    } as unknown as Partial<SimulationState>);

    system.ingest(state);
    const promoted = system.evaluate(figure, state, 200);
    expect(promoted.status).toBe('historical');
    expect(promoted.reasons).toContain('major-discovery');
    expect(promoted.eventIds).toEqual(['event-1', 'event-2', 'event-3']);

    const demoted = system.evaluate(figure, emptyState(), 260);
    expect(demoted.status).toBe('historical');
    expect(demoted.promotedMonth).toBe(200);
  });

  it('keeps a notable life in the record after death but stops treating it as living', () => {
    const system = new HistoricalImportanceSystem();
    const figure = person({ id: 'person-2', name: 'Anu' });
    const state = emptyState({
      polities: [{ id: 'polity-1', leadingPersonId: 'person-2', settlementIds: ['settlement-1'], phaseSinceMonth: 0, legitimacy: 0.6 }],
    } as unknown as Partial<SimulationState>);
    system.evaluate(figure, state, 120);
    figure.alive = false;
    system.retire(figure, 480);

    const roster = system.roster([figure]);
    expect(roster).toHaveLength(1);
    expect(roster[0]!.name).toBe('Anu');
    expect(roster[0]!.diedMonth).toBe(480);
  });

  it('forgets ordinary lives instead of accumulating them', () => {
    const system = new HistoricalImportanceSystem();
    const ordinary = person({ id: 'person-3' });
    system.evaluate(ordinary, emptyState(), 12);
    ordinary.alive = false;
    system.retire(ordinary, 24);
    expect(system.roster([ordinary])).toHaveLength(0);
  });
});

describe('Notable people in a live run', () => {
  it('selects a small, deterministic, persistent set of notable lives', { timeout: 60_000 }, () => {
    const config = { seed: 'notable-people', startingPopulation: 150, settlementCount: [3, 3] as const };
    const first = new Simulation(config);
    const second = new Simulation(config);
    first.step(180);
    second.step(180);

    const roster = (simulation: Simulation) => (simulation.state.notableFigures ?? [])
      .map((figure) => `${figure.id}:${figure.status}:${figure.reasons.join(',')}`).sort();
    expect(roster(first)).toEqual(roster(second));
    expect(roster(first).length).toBeGreaterThan(0);

    const living = first.state.people;
    const notable = living.filter((candidate) => candidate.historical && candidate.historical.status !== 'ordinary');
    expect(notable.length).toBeLessThan(Math.max(8, living.length * 0.08));
    for (const candidate of living) expect(candidate.alive).toBe(true);

    const before = new Map(notable.map((candidate) => [candidate.id, candidate.historical!.status]));
    first.step(36);
    for (const survivor of first.state.people) {
      const previous = before.get(survivor.id);
      if (!previous) continue;
      expect(survivor.historical!.status).not.toBe('ordinary');
    }
  });

  it('keeps a person visually recognisable for their whole life', { timeout: 60_000 }, () => {
    const simulation = new Simulation({ seed: 'persistent-identity', startingPopulation: 120, settlementCount: [3, 3] });
    simulation.step(24);
    const tracked = new Map(simulation.state.people.map((candidate) => [candidate.id, {
      height: candidate.appearance!.heightScale,
      build: candidate.appearance!.buildScale,
    }]));
    simulation.step(96);
    let compared = 0;
    for (const candidate of simulation.state.people) {
      const original = tracked.get(candidate.id);
      if (!original) continue;
      compared += 1;
      expect(candidate.appearance!.heightScale).toBe(original.height);
      expect(candidate.appearance!.buildScale).toBe(original.build);
    }
    expect(compared).toBeGreaterThan(20);
  });
});

describe('Animation integration', () => {
  it('plays a continuous walk cycle on real time, independent of simulation speed', () => {
    const controller = new AnimationController('walk-cycle');
    controller.getOrCreateCharacterState('person-1', 'farmer');
    const samples: number[] = [];
    for (let frame = 0; frame < 24; frame += 1) {
      controller.updateCharacterAnimation('person-1', 0.05, 'craft', 'walk');
      samples.push(controller.getCurrentPose('person-1')!.leftHipRotation);
    }
    expect(new Set(samples.map((value) => value.toFixed(4))).size).toBeGreaterThan(8);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.1);
  });

  it('lets visual travel override a stationary activity and blends back out of it', () => {
    const controller = new AnimationController('walk-override');
    controller.getOrCreateCharacterState('person-1', 'artisan');
    for (let frame = 0; frame < 20; frame += 1) controller.updateCharacterAnimation('person-1', 0.05, 'craft');
    const working = controller.getCurrentPose('person-1')!.rightShoulderRotation;
    controller.updateCharacterAnimation('person-1', 0.05, 'craft', 'walk');
    const firstBlended = controller.getCurrentPose('person-1')!.rightShoulderRotation;
    expect(Math.abs(firstBlended - working)).toBeLessThan(0.4);
    for (let frame = 0; frame < 30; frame += 1) controller.updateCharacterAnimation('person-1', 0.05, 'craft', 'walk');
    expect(controller.getCurrentPose('person-1')!.name).toContain('walk');
  });

  it('releases per-character state so removed people leave nothing behind', () => {
    const controller = new AnimationController('release');
    controller.getOrCreateCharacterState('person-1', 'farmer');
    controller.getOrCreateCharacterState('person-2', 'farmer');
    expect(controller.trackedCharacters).toBe(2);
    controller.release('person-2');
    expect(controller.trackedCharacters).toBe(1);
    expect(controller.getCurrentPose('person-2')).toBeNull();
  });
});

describe('Presentation budgets', () => {
  it('keeps ordinary people instanced and reserves extra geometry for a handful of lives', () => {
    expect(visiblePersonBudgetForDensity(1)).toBe(384);
    expect(NOTABLE_VISUAL_BUDGET).toBeLessThanOrEqual(48);
    expect(NOTABLE_VISUAL_BUDGET).toBeLessThan(visiblePersonBudgetForDensity(1));
  });

  it('reads the visual tier straight from simulation state', () => {
    expect(visualTierFor(person())).toBe('population');
    expect(visualTierFor(person({ historical: { status: 'notable', score: 0.5, reasons: [], eventIds: [] } }))).toBe('notable');
    expect(visualTierFor(person({ historical: { status: 'historical', score: 0.9, reasons: [], eventIds: [] } }))).toBe('historical');
  });
});
