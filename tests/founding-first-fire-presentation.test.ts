import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { survivalState } from '../src/sim/pressures/Survival';
import {
  FIRST_FIRE_DURATION_SECONDS,
  FoundingFirstFirePresentation,
  type FirstFirePhase,
} from '../src/render/founding/FoundingFirstFirePresentation';
import {
  FOUNDING_HEARTH_ASSEMBLY_SECONDS,
  FOUNDING_HEARTH_LOG_COUNT,
  FOUNDING_HEARTH_STONE_COUNT,
  foundingHearthAssemblySample,
  foundingHearthAssemblyTasks,
} from '../src/render/founding/FoundingHearthAssembly';

function seekPhase(
  presentation: FoundingFirstFirePresentation,
  state: Simulation['state'],
  settlementId: string,
  phase: FirstFirePhase,
): number {
  for (let time = 0; time <= FIRST_FIRE_DURATION_SECONDS + 2; time += 0.05) {
    presentation.update(state, time);
    if (presentation.sample(settlementId).phase === phase) return time;
  }
  throw new Error(`Could not reach first-fire phase ${phase}`);
}

describe('founding first-fire presentation', () => {
  it('physically assembles the hearth before any ignition can begin', () => {
    const simulation = new Simulation({ seed: 'first-fire-presentation' });
    const settlement = simulation.state.settlements[0]!;
    settlement.foundingPodId = 'test-pod';
    const presentation = new FoundingFirstFirePresentation(simulation.state);

    survivalState(settlement).firstFire = { month: simulation.state.month, eventId: 'first-fire:test' };
    presentation.update(simulation.state, 0);
    expect(presentation.isPerforming(settlement.id)).toBe(true);
    expect(presentation.sample(settlement.id)).toMatchObject({
      stonesPlaced: 0, logsPlaced: 0, flameScale: 0, sparkGain: 0, assemblyComplete: false,
    });

    presentation.update(simulation.state, 3);
    const building = presentation.sample(settlement.id);
    expect(building.phase).toBe('assemble-stones');
    expect(building.stonesPlaced).toBeGreaterThan(0);
    expect(building.stonesPlaced).toBeLessThan(FOUNDING_HEARTH_STONE_COUNT);
    expect(building.logsPlaced).toBe(0);
    expect(building.flameScale).toBe(0);
    expect(building.lightGain).toBe(0);

    const hearth = { x: settlement.position.x + 2, z: settlement.position.z };
    const targets = simulation.state.people
      .filter(person => person.homeId === settlement.id)
      .map(person => presentation.targetFor(person.id, settlement.id, hearth, person.position, settlement.position))
      .filter(target => target !== undefined);
    expect(targets.some(target => target.role === 'builder')).toBe(true);
    expect(targets.some(target => target.carriedObject === 'stone' || target.carriedObject === 'timber')).toBe(true);
    for (const target of targets.filter(target => target.role === 'builder')) {
      expect(target.interactionTarget).toBeDefined();
      expect(target.pieceIndex).toBeGreaterThanOrEqual(0);
    }

    const prepareAt = seekPhase(presentation, simulation.state, settlement.id, 'prepare-tinder');
    const ready = presentation.sample(settlement.id);
    expect(prepareAt).toBeGreaterThan(FOUNDING_HEARTH_ASSEMBLY_SECONDS);
    expect(ready.assemblyComplete).toBe(true);
    expect(ready.stonesPlaced).toBe(FOUNDING_HEARTH_STONE_COUNT);
    expect(ready.logsPlaced).toBe(FOUNDING_HEARTH_LOG_COUNT);
    expect(ready.flameScale).toBe(0);
    expect(ready.sparkGain).toBe(0);
    expect(ready.smokeGain).toBe(0);
  });

  it('lights the first fire through tinder, strike, ember, falter and catch instead of switching on', () => {
    const simulation = new Simulation({ seed: 'first-fire-ignition' });
    const settlement = simulation.state.settlements[0]!;
    settlement.foundingPodId = 'pod-ignition';
    const presentation = new FoundingFirstFirePresentation(simulation.state);
    survivalState(settlement).firstFire = { month: 1, eventId: 'first-fire:ignition' };
    presentation.update(simulation.state, 0);

    const hearth = { x: settlement.position.x + 1.8, z: settlement.position.z + 0.2 };

    const prepareAt = seekPhase(presentation, simulation.state, settlement.id, 'prepare-tinder');
    const prepareTargets = simulation.state.people
      .filter(person => person.homeId === settlement.id)
      .map(person => presentation.targetFor(person.id, settlement.id, hearth, person.position, settlement.position))
      .filter(target => target !== undefined);
    expect(prepareTargets).toHaveLength(1);
    expect(prepareTargets[0]).toMatchObject({
      role: 'tender',
      animation: 'ignite',
      ceremonyPhase: 'prepare-tinder',
    });
    expect(prepareTargets[0]!.interactionTarget).toEqual(hearth);

    const strikeAt = seekPhase(presentation, simulation.state, settlement.id, 'strike');
    const strike = presentation.sample(settlement.id);
    expect(strike.flameScale).toBe(0);
    expect(strike.sparkGain).toBeGreaterThan(0);
    expect(strike.lightGain).toBeLessThan(0.02);

    seekPhase(presentation, simulation.state, settlement.id, 'ember');
    const ember = presentation.sample(settlement.id);
    expect(ember.flameScale).toBe(0);
    expect(ember.emberScale).toBeGreaterThan(0);
    expect(ember.tinderGlow).toBeGreaterThan(0);
    expect(ember.smokeGain).toBeGreaterThan(0);

    const falterAt = seekPhase(presentation, simulation.state, settlement.id, 'falter');
    presentation.update(simulation.state, falterAt + 0.62);
    const firstFlame = presentation.sample(settlement.id);
    presentation.update(simulation.state, falterAt + 1.18);
    const weakened = presentation.sample(settlement.id);
    expect(firstFlame.phase).toBe('falter');
    expect(firstFlame.flameScale).toBeGreaterThan(weakened.flameScale);
    expect(weakened.flameScale).toBeGreaterThan(0);

    const catchAt = seekPhase(presentation, simulation.state, settlement.id, 'catch');
    presentation.update(simulation.state, catchAt + 1.4);
    const caught = presentation.sample(settlement.id);
    expect(caught.flameScale).toBeGreaterThan(weakened.flameScale);
    expect(caught.lightGain).toBeGreaterThan(0.3);
    expect(caught.smokeGain).toBeGreaterThan(0.4);

    const gatheredTargets = simulation.state.people
      .filter(person => person.homeId === settlement.id)
      .map(person => presentation.targetFor(person.id, settlement.id, hearth, person.position, settlement.position))
      .filter(target => target !== undefined);
    expect(gatheredTargets.some(target => target.role === 'witness')).toBe(true);
    expect(gatheredTargets.some(target => target.role === 'tender')).toBe(true);

    // The sequence must be causally ordered in real presentation time.
    expect(prepareAt).toBeLessThan(strikeAt);
    expect(strikeAt).toBeLessThan(falterAt);
    expect(falterAt).toBeLessThan(catchAt);
  });

  it('uses one deterministic placement timeline with three builders and no material teleportation', () => {
    const tasks = foundingHearthAssemblyTasks();
    expect(tasks).toHaveLength(FOUNDING_HEARTH_STONE_COUNT + FOUNDING_HEARTH_LOG_COUNT);
    expect(new Set(tasks.map(task => task.builderSlot))).toEqual(new Set([0, 1, 2]));
    expect(tasks.every(task => task.startSeconds < task.pickupEndSeconds
      && task.pickupEndSeconds < task.carryEndSeconds
      && task.carryEndSeconds < task.placeEndSeconds)).toBe(true);

    for (const task of tasks) {
      const before = foundingHearthAssemblySample(task.placeEndSeconds - 0.001);
      const after = foundingHearthAssemblySample(task.placeEndSeconds + 0.001);
      if (task.kind === 'stone') expect(after.stonesPlaced).toBe(before.stonesPlaced + 1);
      else expect(after.logsPlaced).toBe(before.logsPlaced + 1);
    }
  });

  it('queues same-tick first fires so separate camps never build or ignite in lockstep', () => {
    const simulation = new Simulation({ seed: 'first-fire-queue', settlementCount: [2, 2] });
    const [firstSettlement, secondSettlement] = simulation.state.settlements;
    expect(firstSettlement).toBeDefined();
    expect(secondSettlement).toBeDefined();
    firstSettlement!.foundingPodId = 'pod-a';
    secondSettlement!.foundingPodId = 'pod-b';
    const presentation = new FoundingFirstFirePresentation(simulation.state);

    survivalState(firstSettlement!).firstFire = { month: 1, eventId: 'fire-a', plannedMonth: 1, readiness: 0.9 };
    survivalState(secondSettlement!).firstFire = { month: 1, eventId: 'fire-b', plannedMonth: 1, readiness: 0.7 };
    presentation.update(simulation.state, 0);

    presentation.update(simulation.state, 4);
    const early = [presentation.sample(firstSettlement!.id), presentation.sample(secondSettlement!.id)];
    expect(early[0]!.stonesPlaced).toBeGreaterThan(early[1]!.stonesPlaced);
    expect(early.every(sample => sample.flameScale === 0)).toBe(true);

    presentation.update(simulation.state, FOUNDING_HEARTH_ASSEMBLY_SECONDS + 7);
    const later = [presentation.sample(firstSettlement!.id), presentation.sample(secondSettlement!.id)];
    expect(later.every(sample => sample.assemblyProgress > 0.9)).toBe(true);
    expect(new Set(later.map(sample => sample.phase)).size).toBeGreaterThan(1);
  });

  it('does not replay a first fire that already existed when presentation loaded', () => {
    const simulation = new Simulation({ seed: 'first-fire-reload' });
    const settlement = simulation.state.settlements[0]!;
    settlement.foundingPodId = 'test-pod';
    survivalState(settlement).firstFire = { month: 1, eventId: 'first-fire:old' };

    const presentation = new FoundingFirstFirePresentation(simulation.state);
    presentation.update(simulation.state, 1);
    expect(presentation.isPerforming(settlement.id)).toBe(false);
    expect(presentation.sample(settlement.id)).toMatchObject({
      active: false, phase: 'complete', assemblyComplete: true,
      stonesPlaced: FOUNDING_HEARTH_STONE_COUNT, logsPlaced: FOUNDING_HEARTH_LOG_COUNT,
      hearthScale: 1, flameScale: 1, lightGain: 1, tinderGlow: 1,
    });
  });

  it('removes flame flicker from reduced-motion catch presentation', () => {
    const simulation = new Simulation({ seed: 'first-fire-reduced-motion' });
    const settlement = simulation.state.settlements[0]!;
    settlement.foundingPodId = 'test-pod';
    const presentation = new FoundingFirstFirePresentation(simulation.state);
    survivalState(settlement).firstFire = { month: 1, eventId: 'first-fire:reduced' };
    presentation.update(simulation.state, 0);

    const catchAt = seekPhase(presentation, simulation.state, settlement.id, 'catch');
    presentation.update(simulation.state, catchAt + 0.25);
    const first = presentation.sample(settlement.id, true);
    presentation.update(simulation.state, catchAt + 0.35);
    const second = presentation.sample(settlement.id, true);
    expect(first.phase).toBe('catch');
    expect(second.phase).toBe('catch');
    expect(second.flameScale).toBeGreaterThan(first.flameScale);
  });
});
