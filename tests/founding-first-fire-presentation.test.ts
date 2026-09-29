import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { survivalState } from '../src/sim/pressures/Survival';
import { AnimationController } from '../src/render/animation/AnimationController';
import {
  FIRST_FIRE_DURATION_SECONDS,
  FIRST_FIRE_CAMERA_GRACE_SECONDS,
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
  it('celebrates every settlement once even if the camera never selects its event', () => {
    const simulation = new Simulation({ seed: 'every-settlement-celebrates', settlementCount: [3, 3], world: { size: 24 } });
    const presentation = new FoundingFirstFirePresentation(simulation.state);
    for (const settlement of simulation.state.settlements) {
      survivalState(settlement).firstFire = { month: 1, eventId: `fire:${settlement.id}` };
    }
    presentation.update(simulation.state, 0, 'unrelated-event');
    const danced = new Set<string>();
    for (let time = FIRST_FIRE_CAMERA_GRACE_SECONDS; time < FIRST_FIRE_DURATION_SECONDS + 35; time += 0.5) {
      presentation.update(simulation.state, time, 'unrelated-event');
      for (const settlement of simulation.state.settlements) {
        for (const person of simulation.state.people.filter(p => p.homeId === settlement.id)) {
          const target = presentation.targetFor(person.id, settlement.id, settlement.position, person.position);
          if (target?.animation === 'dance') danced.add(settlement.id);
        }
      }
    }
    expect(danced.size).toBe(simulation.state.settlements.length);
    const revision = presentation.revision;
    presentation.update(simulation.state, 1000, 'unrelated-event');
    expect(presentation.revision).toBe(revision);
    expect(presentation.participantIds().size).toBe(0);
  });
  it('celebrates the lit fire in a separated dance circle, then settles and releases everyone', () => {
    const simulation = new Simulation({ seed: 'fire-dancing', world: { size: 24 } });
    const settlement = simulation.state.settlements[0]!;
    const presentation = new FoundingFirstFirePresentation(simulation.state);
    survivalState(settlement).firstFire = { month: 1, eventId: 'dance-fire' };
    presentation.update(simulation.state, 0);
    presentation.update(simulation.state, FOUNDING_HEARTH_ASSEMBLY_SECONDS + 15);
    const hearth = settlement.position;
    const people = simulation.state.people.filter(p => p.homeId === settlement.id);
    const targets = people.map(p => presentation.targetFor(p.id, settlement.id, hearth, p.position)).filter(t => t !== undefined);
    expect(targets.length).toBeGreaterThan(1);
    expect(targets.every(t => t.animation === 'dance')).toBe(true);
    for (const target of targets) expect(Math.hypot(target.x - hearth.x, target.z - hearth.z)).toBeGreaterThan(1);
    for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      expect(Math.hypot(targets[i]!.x - targets[j]!.x, targets[i]!.z - targets[j]!.z)).toBeGreaterThan(0.7);
    }
    for (const p of people) {
      const reduced = presentation.targetFor(p.id, settlement.id, hearth, p.position, hearth, true);
      if (reduced) expect(reduced.animation).toBe('converse-warm');
    }
    presentation.update(simulation.state, FIRST_FIRE_DURATION_SECONDS + 2);
    expect(presentation.isPerforming(settlement.id)).toBe(false);
    expect(presentation.sample(settlement.id).flameScale).toBe(1);
  });

  it('keeps dance steps articulated even with a small side-step speed', () => {
    const animator = new AnimationController();
    animator.getOrCreateCharacterState('dancer', 'forager');
    animator.updateCharacterAnimation('dancer', 1, 'socialize', 'dance', 0.04, 360, false, 0.8);
    const pose = animator.getCurrentPose('dancer')!;
    expect(pose.leftShoulderRotation).toBeGreaterThan(0.3);
    expect(pose.rightShoulderRotation).toBeGreaterThan(0.3);
    expect(Math.max(pose.leftKneeRotation, pose.rightKneeRotation)).toBeGreaterThan(0.15);
  });
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

    presentation.update(simulation.state, 9);
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

  it('keeps a hearth piece in the founder hand until the visible ground placement completes', () => {
    const simulation = new Simulation({ seed: 'first-fire-hand-placement' });
    const settlement = simulation.state.settlements[0]!;
    settlement.foundingPodId = 'pod-placement';
    const presentation = new FoundingFirstFirePresentation(simulation.state);
    survivalState(settlement).firstFire = { month: 1, eventId: 'first-fire:placement' };
    presentation.update(simulation.state, 0);

    const hearth = { x: settlement.position.x + 1.8, z: settlement.position.z + 0.1 };
    let pickup:
      | NonNullable<ReturnType<FoundingFirstFirePresentation['targetFor']>>
      | undefined;
    let placing:
      | NonNullable<ReturnType<FoundingFirstFirePresentation['targetFor']>>
      | undefined;

    for (let time = 0; time < FOUNDING_HEARTH_ASSEMBLY_SECONDS && (!pickup || !placing); time += 0.05) {
      presentation.update(simulation.state, time);
      for (const person of simulation.state.people.filter(candidate => candidate.homeId === settlement.id)) {
        const target = presentation.targetFor(person.id, settlement.id, hearth, person.position, settlement.position);
        if (!target || target.role !== 'builder') continue;
        if (!pickup && target.assemblyPhase === 'pickup') pickup = target;
        if (!placing && target.assemblyPhase === 'place' && target.carriedObject) placing = target;
      }
    }

    expect(pickup).toBeDefined();
    expect(pickup?.carriedObject).toBeUndefined();
    expect(pickup?.interactionTarget).toEqual({ x: pickup?.x, z: pickup?.z });
    expect(placing).toBeDefined();
    expect(placing?.carriedObject).toMatch(/stone|timber/);
    expect(placing?.interactionTarget).toBeDefined();
    expect(Math.hypot(
      (placing?.interactionTarget?.x ?? 0) - (placing?.x ?? 0),
      (placing?.interactionTarget?.z ?? 0) - (placing?.z ?? 0),
    )).toBeGreaterThan(0.2);
    expect(placing?.contactStrength).toBeGreaterThanOrEqual(0);
  });

  it('gives the tender a dedicated low ignition pose instead of generic gathering', () => {
    const controller = new AnimationController('first-fire-ignite-pose');
    controller.getOrCreateCharacterState('tender', 'builder');
    for (let frame = 0; frame < 40; frame += 1) {
      controller.updateCharacterAnimation('tender', 1 / 60, 'gather', 'ignite', 0, 360);
    }
    const pose = controller.getCurrentPose('tender');
    expect(pose).not.toBeNull();
    expect(pose!.leftKneeRotation).toBeGreaterThan(0.7);
    expect(pose!.rightKneeRotation).toBeGreaterThan(0.7);
    expect(pose!.spineRotation).toBeGreaterThan(0.25);
    expect(pose!.headPitch ?? 0).toBeGreaterThan(0.15);
  });

  it('uses one deterministic placement timeline with three builders and no material teleportation', () => {
    const tasks = foundingHearthAssemblyTasks();
    expect(tasks).toHaveLength(FOUNDING_HEARTH_STONE_COUNT + FOUNDING_HEARTH_LOG_COUNT);
    expect(new Set(tasks.map(task => task.builderSlot))).toEqual(new Set([0, 1, 2]));
    expect(tasks.every(task => task.startSeconds < task.pickupEndSeconds
      && task.pickupEndSeconds < task.carryEndSeconds
      && task.carryEndSeconds < task.placeEndSeconds)).toBe(true);

    for (let builder = 0; builder < 3; builder += 1) {
      const own = tasks.filter(task => task.builderSlot === builder).sort((a, b) => a.startSeconds - b.startSeconds);
      for (let index = 1; index < own.length; index += 1) {
        expect(own[index]!.startSeconds).toBeGreaterThanOrEqual(own[index - 1]!.placeEndSeconds);
      }
    }

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

    presentation.update(simulation.state, 10);
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
