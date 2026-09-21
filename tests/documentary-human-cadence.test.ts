import { describe, expect, it } from 'vitest';
import { GODBOX_TIME_PRESETS } from '../src/presets';
import { Simulation } from '../src/sim/Simulation';
import type { Person, Vec2 } from '../src/sim/types';
import { LocalActivityPresentation } from '../src/render/people/LocalActivityPresentation';
import { PeopleVisualStateStore } from '../src/render/people/PeopleVisualState';
import { HumanLifeClock } from '../src/render/people/HumanLifeClock';
import { buildSocialGroups, groupKeyFor, placeInGroup } from '../src/render/people/PeoplePresentation';

const FPS = 60;
const PRESENTATION_SECONDS = 20;
const FRAME_SECONDS = 1 / FPS;
const WALKING = 0.05;
const ground = { heightAt: () => 0, isStandable: () => true };
const purposeful = (action: string | undefined): boolean =>
  Boolean(action && !['arrive', 'pause', 'wait-for-clearance', 'observe'].includes(action));

interface ResidentCadence {
  actions: Set<string>;
  movementEpisodes: number;
  localMovementFrames: number;
  stableComparisons: number;
  sameAuthorityResets: number;
  previousMoving: boolean;
}

/**
 * This is intentionally an integration-style presentation test rather than a fake fractional-day
 * planner. Simulation.step() runs the production PeopleSystem monthly while local life still gets
 * sixty wall-clock presentation updates per second around those authoritative samples.
 */
describe('documentary human cadence', () => {
  it('keeps believable local life moving at documentary speed without animating literal days or mutating history', () => {
    const documentary = GODBOX_TIME_PRESETS.documentary.presentation;
    const monthsPerSecond = documentary?.ordinaryMonthsPerSecond;
    expect(monthsPerSecond).toBe(2);

    const makeSimulation = () => new Simulation({
      ...GODBOX_TIME_PRESETS.documentary,
      seed: 'documentary-human-cadence',
      startMode: 'established',
      startingPopulation: 72,
      settlementCount: [2, 2] as const,
      world: { size: 20 },
    });
    const observed = makeSimulation();
    const control = makeSimulation();
    expect(JSON.stringify(observed.state)).toBe(JSON.stringify(control.state));

    const selectedIds = observed.state.people
      .filter(person => person.alive && person.ageMonths >= 18 * 12 && person.ageMonths <= 55 * 12)
      .slice(0, 24)
      .map(person => person.id);
    expect(selectedIds.length).toBeGreaterThanOrEqual(12);

    const local = new LocalActivityPresentation();
    const visuals = new PeopleVisualStateStore();
    const lifeClock = new HumanLifeClock();
    const metrics = new Map<string, ResidentCadence>(selectedIds.map(id => [id, {
      actions: new Set<string>(),
      movementEpisodes: 0,
      localMovementFrames: 0,
      stableComparisons: 0,
      sameAuthorityResets: 0,
      previousMoving: false,
    }]));

    let monthAccumulator = 0;
    let monthlySteps = 0;
    const totalFrames = PRESENTATION_SECONDS * FPS;

    for (let frame = 0; frame < totalFrames; frame++) {
      monthAccumulator += monthsPerSecond! * FRAME_SECONDS;
      while (monthAccumulator + 1e-9 >= 1) {
        observed.step();
        control.step();
        monthlySteps++;
        monthAccumulator -= 1;
      }

      const visible = selectedIds
        .map(id => observed.state.people.find(person => person.id === id))
        .filter((person): person is Person => Boolean(person?.alive));
      const peers = new Map(observed.state.people.filter(person => person.alive).map(person => [person.id, person]));
      const groups = buildSocialGroups(observed.state.people.filter(person => person.alive));
      const previousPositions = new Map<string, Vec2>();
      for (const id of selectedIds) {
        const visual = visuals.get(id);
        if (visual) previousPositions.set(id, { x: visual.x, z: visual.z });
      }

      const life = lifeClock.advance(FRAME_SECONDS);
      local.beginFrame();
      visuals.beginFrame();

      for (const person of visible) {
        const group = groups.get(groupKeyFor(person) ?? '');
        const base = placeInGroup(person, group, person.position);
        const before = local.get(person.id);
        const plan = local.resolve(person, {
          base,
          visual: visuals.get(person.id),
          group,
          people: peers,
          visualFor: id => previousPositions.get(id),
          structures: [],
          safeSegment: () => true,
          revision: 'documentary-cadence-flat-fixture',
          blocked: false,
          far: false,
        }, life.deltaSeconds);

        const metric = metrics.get(person.id)!;
        if (before && plan && before.authority === plan.authority) {
          metric.stableComparisons++;
          if (before !== plan) metric.sameAuthorityResets++;
        }
        if (purposeful(plan?.action)) metric.actions.add(plan!.action);

        const visual = visuals.resolve(person.id, {
          destination: plan?.destination ?? person.position,
          restFacing: plan?.restFacing ?? base.restFacing,
          localMove: Boolean(plan && plan.action !== 'arrive'),
          smoothTravel: !plan,
          ...(!plan && person.navigation ? {
            waypoints: person.navigation.waypoints,
            waypointIndex: person.navigation.waypointIndex,
          } : {}),
        }, life.deltaSeconds, ground);

        const moving = visual.speed >= WALKING;
        if (moving && !metric.previousMoving) metric.movementEpisodes++;
        if (moving && plan) metric.localMovementFrames++;
        metric.previousMoving = moving;
      }

      local.prune();
      visuals.prune();
    }

    expect(monthlySteps).toBe(PRESENTATION_SECONDS * monthsPerSecond!);
    expect(observed.state.month).toBe(control.state.month);
    // Presentation is a reader: after the same authoritative monthly ticks, history/state must be
    // exactly identical to a matched simulation that was never rendered.
    expect(JSON.stringify(observed.state)).toBe(JSON.stringify(control.state));

    const residents = [...metrics.values()];
    const residentsWithPurposefulVariety = residents.filter(metric => metric.actions.size >= 2);
    const residentsWithRepeatedMovement = residents.filter(metric => metric.movementEpisodes >= 2);
    const localMovementFrames = residents.reduce((sum, metric) => sum + metric.localMovementFrames, 0);
    const stableComparisons = residents.reduce((sum, metric) => sum + metric.stableComparisons, 0);
    const sameAuthorityResets = residents.reduce((sum, metric) => sum + metric.sameAuthorityResets, 0);
    const repeatedlyObserved = residents.filter(metric => metric.stableComparisons >= 30);
    const diagnostics = residents.map(metric => ({
      actions: [...metric.actions].sort(),
      movementEpisodes: metric.movementEpisodes,
      localMovementFrames: metric.localMovementFrames,
      stableComparisons: metric.stableComparisons,
      sameAuthorityResets: metric.sameAuthorityResets,
    }));

    // Twenty presentation seconds at 2 months/sec spans forty real PeopleSystem updates. The
    // settlement must still show readable action variety and repeated movement instead of spending
    // the whole observation in arrival/reset states.
    expect(residentsWithPurposefulVariety.length, JSON.stringify(diagnostics)).toBeGreaterThanOrEqual(4);
    expect(residentsWithRepeatedMovement.length, JSON.stringify(diagnostics)).toBeGreaterThanOrEqual(4);
    expect(localMovementFrames, JSON.stringify(diagnostics)).toBeGreaterThan(20);

    // Monthly churn may legitimately interrupt a routine by commute/emergency/destination change.
    // What must never happen is recreation every frame while the semantic authority is unchanged.
    expect(stableComparisons, JSON.stringify(diagnostics)).toBeGreaterThan(100);
    expect(repeatedlyObserved.length, JSON.stringify(diagnostics)).toBeGreaterThanOrEqual(4);
    expect(sameAuthorityResets, JSON.stringify(diagnostics)).toBeLessThanOrEqual(Math.max(1, Math.floor(stableComparisons * 0.02)));
    for (const metric of repeatedlyObserved) {
      expect(metric.sameAuthorityResets).toBeLessThanOrEqual(Math.max(1, Math.floor(metric.stableComparisons * 0.05)));
    }
  });

  it('keeps human life running for twenty real seconds while historical time is completely frozen', () => {
    const simulation = new Simulation({
      ...GODBOX_TIME_PRESETS.documentary,
      seed: 'frozen-history-human-life',
      startMode: 'established',
      startingPopulation: 72,
      settlementCount: [2, 2] as const,
      world: { size: 20 },
    });
    simulation.step(8);

    const eligible = simulation.state.people
      .filter(person => person.alive
        && person.navigation
        && !person.navigation.traveling
        && person.navigation.schedulePhase !== 'emergency'
        && !['gather', 'construct', 'farm', 'flee', 'migrate', 'shelter'].includes(person.activity))
      .slice(0, 16);
    expect(eligible.length).toBeGreaterThanOrEqual(6);

    const before = JSON.stringify(simulation.state);
    const frozenMonth = simulation.state.month;
    const selectedIds = eligible.map(person => person.id);
    const local = new LocalActivityPresentation();
    const visuals = new PeopleVisualStateStore();
    const lifeClock = new HumanLifeClock();
    const actions = new Map<string, Set<string>>(selectedIds.map(id => [id, new Set<string>()]));
    const points = new Map<string, Set<string>>(selectedIds.map(id => [id, new Set<string>()]));
    let movingFrames = 0;

    for (let frame = 0; frame < PRESENTATION_SECONDS * FPS; frame++) {
      // Intentionally no simulation.step(): Historian/civilization time is frozen.
      const life = lifeClock.advance(FRAME_SECONDS);
      const peers = new Map(simulation.state.people.filter(person => person.alive).map(person => [person.id, person]));
      const groups = buildSocialGroups(simulation.state.people.filter(person => person.alive));
      const previousPositions = new Map<string, Vec2>();
      for (const id of selectedIds) {
        const visual = visuals.get(id);
        if (visual) previousPositions.set(id, { x: visual.x, z: visual.z });
      }

      local.beginFrame();
      visuals.beginFrame();
      for (const person of eligible) {
        const group = groups.get(groupKeyFor(person) ?? '');
        const base = placeInGroup(person, group, person.position);
        const plan = local.resolve(person, {
          base,
          visual: visuals.get(person.id),
          group,
          people: peers,
          visualFor: id => previousPositions.get(id),
          structures: [],
          safeSegment: () => true,
          revision: 'frozen-history-flat-fixture',
          blocked: false,
          far: false,
        }, life.deltaSeconds);

        if (purposeful(plan?.action)) actions.get(person.id)!.add(plan!.action);
        const visual = visuals.resolve(person.id, {
          destination: plan?.destination ?? person.position,
          restFacing: plan?.restFacing ?? base.restFacing,
          localMove: Boolean(plan && plan.action !== 'arrive'),
          smoothTravel: !plan,
        }, life.deltaSeconds, ground);
        points.get(person.id)!.add(`${visual.x.toFixed(2)},${visual.z.toFixed(2)}`);
        if (visual.speed >= WALKING) movingFrames++;
      }
      local.prune();
      visuals.prune();
    }

    expect(lifeClock.elapsed).toBeCloseTo(PRESENTATION_SECONDS, 5);
    expect(simulation.state.month).toBe(frozenMonth);
    expect(JSON.stringify(simulation.state)).toBe(before);

    const variedResidents = selectedIds.filter(id => actions.get(id)!.size >= 2);
    const visiblyMobileResidents = selectedIds.filter(id => points.get(id)!.size >= 8);
    expect(variedResidents.length).toBeGreaterThanOrEqual(3);
    expect(visiblyMobileResidents.length).toBeGreaterThanOrEqual(3);
    expect(movingFrames).toBeGreaterThan(120);
  });
});
