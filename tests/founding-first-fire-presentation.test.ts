import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { survivalState } from '../src/sim/pressures/Survival';
import { FIRST_FIRE_DURATION_SECONDS, FoundingFirstFirePresentation } from '../src/render/founding/FoundingFirstFirePresentation';

describe('founding first-fire presentation', () => {
  it('performs a newly recorded first fire once on real presentation time', () => {
    const simulation = new Simulation({ seed: 'first-fire-presentation' });
    const settlement = simulation.state.settlements[0]!;
    settlement.foundingPodId = 'test-pod';
    const presentation = new FoundingFirstFirePresentation(simulation.state);

    survivalState(settlement).firstFire = { month: simulation.state.month, eventId: 'first-fire:test' };
    presentation.update(simulation.state, 0);
    expect(presentation.sample(settlement.id)).toMatchObject({ active: true, phase: 'kindle' });

    presentation.update(simulation.state, 2.4);
    const catching = presentation.sample(settlement.id);
    expect(catching.phase).toBe('catch');
    expect(catching.flameScale).toBeGreaterThan(0.2);
    expect(catching.lightGain).toBeGreaterThan(0.15);

    presentation.update(simulation.state, 4.2);
    expect(presentation.sample(settlement.id).phase).toBe('gather');
    const hearth = { x: settlement.position.x + 2, z: settlement.position.z };
    const participants = simulation.state.people
      .filter(person => person.homeId === settlement.id)
      .map(person => presentation.targetFor(person.id, settlement.id, hearth, person.position))
      .filter(target => target !== undefined);
    expect(participants.length).toBeGreaterThanOrEqual(2);
    expect(participants.length).toBeLessThanOrEqual(5);
    expect(participants.some(target => target.role === 'tender' && target.animation === 'gather')).toBe(true);
    for (const target of participants) {
      expect(Math.hypot(target.x - hearth.x, target.z - hearth.z)).toBeGreaterThan(0.5);
      expect(Math.hypot(target.x - hearth.x, target.z - hearth.z)).toBeLessThan(0.9);
    }

    presentation.update(simulation.state, FIRST_FIRE_DURATION_SECONDS + 0.1);
    expect(presentation.isPerforming(settlement.id)).toBe(false);
    expect(presentation.sample(settlement.id)).toEqual({
      active: false, phase: 'complete', phaseProgress: 1,
      flameScale: 1, emberScale: 1, lightGain: 1, smokeGain: 1,
    });

    presentation.update(simulation.state, FIRST_FIRE_DURATION_SECONDS + 20);
    expect(presentation.isPerforming(settlement.id)).toBe(false);
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
      active: false, phase: 'complete', flameScale: 1, lightGain: 1,
    });
  });

  it('removes flicker from the ignition sample for reduced-motion presentation', () => {
    const simulation = new Simulation({ seed: 'first-fire-reduced-motion' });
    const settlement = simulation.state.settlements[0]!;
    settlement.foundingPodId = 'test-pod';
    const presentation = new FoundingFirstFirePresentation(simulation.state);
    survivalState(settlement).firstFire = { month: 1, eventId: 'first-fire:reduced' };
    presentation.update(simulation.state, 0);
    presentation.update(simulation.state, 2.7);
    const first = presentation.sample(settlement.id, true);
    presentation.update(simulation.state, 2.75);
    const second = presentation.sample(settlement.id, true);
    expect(first.phase).toBe('catch');
    expect(second.phase).toBe('catch');
    expect(second.flameScale).toBeGreaterThan(first.flameScale);
  });
});
