import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { survivalState } from '../src/sim/pressures/Survival';
import { FIRST_FIRE_DURATION_SECONDS, FoundingFirstFirePresentation } from '../src/render/founding/FoundingFirstFirePresentation';
import {
  FOUNDING_HEARTH_ASSEMBLY_SECONDS,
  FOUNDING_HEARTH_LOG_COUNT,
  FOUNDING_HEARTH_STONE_COUNT,
  foundingHearthAssemblySample,
  foundingHearthAssemblyTasks,
} from '../src/render/founding/FoundingHearthAssembly';

describe('founding first-fire presentation', () => {
  it('physically assembles the hearth before any flame can exist', () => {
    const simulation = new Simulation({ seed: 'first-fire-presentation' });
    const settlement = simulation.state.settlements[0]!;
    settlement.foundingPodId = 'test-pod';
    const presentation = new FoundingFirstFirePresentation(simulation.state);

    survivalState(settlement).firstFire = { month: simulation.state.month, eventId: 'first-fire:test' };
    presentation.update(simulation.state, 0);
    expect(presentation.isPerforming(settlement.id)).toBe(true);
    expect(presentation.sample(settlement.id)).toMatchObject({
      stonesPlaced: 0, logsPlaced: 0, flameScale: 0, assemblyComplete: false,
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

    // Even close to the end of assembly there is still no fire: construction and ignition are
    // separate readable acts.
    presentation.update(simulation.state, FOUNDING_HEARTH_ASSEMBLY_SECONDS);
    const almostReady = presentation.sample(settlement.id);
    expect(almostReady.flameScale).toBe(0);
    expect(almostReady.smokeGain).toBe(0);

    presentation.update(simulation.state, FOUNDING_HEARTH_ASSEMBLY_SECONDS + 2.5);
    const ignition = presentation.sample(settlement.id);
    expect(ignition.assemblyComplete).toBe(true);
    expect(ignition.stonesPlaced).toBe(FOUNDING_HEARTH_STONE_COUNT);
    expect(ignition.logsPlaced).toBe(FOUNDING_HEARTH_LOG_COUNT);
    expect(['kindle', 'catch']).toContain(ignition.phase);
    expect(ignition.flameScale).toBeGreaterThan(0);

    presentation.update(simulation.state, FIRST_FIRE_DURATION_SECONDS + 1);
    expect(presentation.isPerforming(settlement.id)).toBe(false);
    expect(presentation.sample(settlement.id)).toEqual({
      active: false, phase: 'complete', phaseProgress: 1,
      hearthScale: 1, assemblyProgress: 1,
      stonesPlaced: FOUNDING_HEARTH_STONE_COUNT, logsPlaced: FOUNDING_HEARTH_LOG_COUNT,
      assemblyComplete: true, flameScale: 1, emberScale: 1, lightGain: 1, smokeGain: 1,
    });
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

  it('queues same-tick first fires so separate camps never build in visual lockstep', () => {
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

    presentation.update(simulation.state, FOUNDING_HEARTH_ASSEMBLY_SECONDS + 5);
    const later = [presentation.sample(firstSettlement!.id), presentation.sample(secondSettlement!.id)];
    expect(later.every(sample => sample.assemblyProgress > 0.9)).toBe(true);
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
      hearthScale: 1, flameScale: 1, lightGain: 1,
    });
  });

  it('removes flicker from the post-assembly ignition sample for reduced-motion presentation', () => {
    const simulation = new Simulation({ seed: 'first-fire-reduced-motion' });
    const settlement = simulation.state.settlements[0]!;
    settlement.foundingPodId = 'test-pod';
    const presentation = new FoundingFirstFirePresentation(simulation.state);
    survivalState(settlement).firstFire = { month: 1, eventId: 'first-fire:reduced' };
    presentation.update(simulation.state, 0);
    presentation.update(simulation.state, FOUNDING_HEARTH_ASSEMBLY_SECONDS + 2.7);
    const first = presentation.sample(settlement.id, true);
    presentation.update(simulation.state, FOUNDING_HEARTH_ASSEMBLY_SECONDS + 2.75);
    const second = presentation.sample(settlement.id, true);
    expect(['kindle', 'catch']).toContain(first.phase);
    expect(second.flameScale).toBeGreaterThanOrEqual(first.flameScale);
  });
});
