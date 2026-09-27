import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { survivalState } from '../src/sim/pressures/Survival';
import type { StructureDevelopment, StructureHistoryEntry } from '../src/sim/development/types';
import type { Settlement, StructurePlot } from '../src/sim/types';
import {
  FOUNDING_STANDARD_DURATION_SECONDS,
  FoundingStandardPresentation,
  foundingStandardEligible,
  type FoundingStandardPhase,
} from '../src/render/founding/FoundingStandardPresentation';

function foundingFixture(seed = 'founding-standard-presentation') {
  const simulation = new Simulation({ seed, startMode: 'arrival', world: { size: 64 } });
  simulation.advanceArrival(80);
  if (!simulation.beginHistory()) throw new Error('Expected founding history to begin');
  const settlement = simulation.state.settlements.find(candidate => candidate.alive && candidate.foundingPodId);
  if (!settlement) throw new Error('Expected a living founding settlement');
  const presentation = new FoundingStandardPresentation(simulation.state);
  return { simulation, settlement, presentation };
}

function completeFoundingShelter(settlement: Settlement, simulation: Simulation): void {
  const culture = simulation.state.cultures.find(candidate => candidate.id === simulation.state.people.find(person => person.homeId === settlement.id)?.cultureId)
    ?? simulation.state.cultures[0];
  if (!culture) throw new Error('Expected founding culture');
  const origin: StructureHistoryEntry = {
    month: simulation.state.month,
    action: 'founded',
    name: 'communal lean-to',
    need: 'housing',
    cultureId: culture.id,
    reasons: ['founding survival'],
    form: 'dwelling',
    level: 1,
    material: 'timber',
  };
  const development: StructureDevelopment = {
    adaptation: 'lean-to',
    temporary: true,
    insulation: 0.5,
    need: 'housing',
    form: 'dwelling',
    name: 'communal lean-to',
    level: 1,
    material: 'timber',
    cultureId: culture.id,
    style: { ...culture.style },
    services: { housing: 8 / 17 },
    reasons: ['founding survival'],
    capabilities: [],
    cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
    labor: 3,
    status: 'active',
    origin,
    history: [],
    transitionCount: 0,
    lastUsedMonth: simulation.state.month,
  };
  const plot: StructurePlot = {
    id: `${settlement.id}:founding-shelter-test`,
    development,
    worldX: settlement.position.x + 1.2,
    worldZ: settlement.position.z + 0.7,
    radius: 0.9,
    width: 1.5,
    height: 1.1,
    depth: 1.2,
    condition: 1,
    foundedMonth: simulation.state.month,
  };
  settlement.structurePlots = [plot];
}

function makeEligible(settlement: Settlement, simulation: Simulation): void {
  survivalState(settlement).firstFire = {
    month: simulation.state.month,
    eventId: `first-fire:${settlement.id}:standard-test`,
  };
  completeFoundingShelter(settlement, simulation);
}

function seekPhase(
  presentation: FoundingStandardPresentation,
  simulation: Simulation,
  settlementId: string,
  phase: FoundingStandardPhase,
): number {
  for (let time = 0; time <= FOUNDING_STANDARD_DURATION_SECONDS + 3; time += 0.05) {
    presentation.update(simulation.state, time);
    if (presentation.sample(settlementId).phase === phase) return time;
  }
  throw new Error(`Could not reach founding-standard phase ${phase}`);
}

describe('founding standard presentation', () => {
  it('requires both the first hearth and a completed usable founding shelter', () => {
    const { simulation, settlement } = foundingFixture('founding-standard-eligibility');
    expect(foundingStandardEligible(settlement)).toBe(false);

    survivalState(settlement).firstFire = {
      month: simulation.state.month,
      eventId: 'first-fire:eligibility',
    };
    expect(foundingStandardEligible(settlement)).toBe(false);

    completeFoundingShelter(settlement, simulation);
    expect(foundingStandardEligible(settlement)).toBe(true);
  });

  it('keeps the standard hidden until people actually begin the ceremony', () => {
    const { simulation, settlement, presentation } = foundingFixture('founding-standard-hidden');
    makeEligible(settlement, simulation);

    expect(presentation.update(simulation.state, 0)).toBe(true);
    expect(presentation.stateFor(settlement.id)).toBe('raising');
    expect(presentation.sample(settlement.id)).toMatchObject({
      active: false,
      established: false,
      phase: 'complete',
      clothUnfurl: 0,
    });

    const prepareAt = seekPhase(presentation, simulation, settlement.id, 'prepare-base');
    expect(prepareAt).toBeGreaterThan(0);
    expect(presentation.sample(settlement.id)).toMatchObject({
      active: true,
      established: false,
      phase: 'prepare-base',
      clothUnfurl: 0,
    });
  });

  it('orders the physical act as base preparation, carry, cloth attachment, raising, securing and unfurl', () => {
    const { simulation, settlement, presentation } = foundingFixture('founding-standard-sequence');
    makeEligible(settlement, simulation);
    presentation.update(simulation.state, 0);

    const prepare = seekPhase(presentation, simulation, settlement.id, 'prepare-base');
    const carry = seekPhase(presentation, simulation, settlement.id, 'carry-pole');
    const attach = seekPhase(presentation, simulation, settlement.id, 'attach-cloth');
    const raise = seekPhase(presentation, simulation, settlement.id, 'raise');
    const secure = seekPhase(presentation, simulation, settlement.id, 'secure');
    const unfurl = seekPhase(presentation, simulation, settlement.id, 'unfurl');
    const acknowledge = seekPhase(presentation, simulation, settlement.id, 'acknowledge');

    expect(prepare).toBeLessThan(carry);
    expect(carry).toBeLessThan(attach);
    expect(attach).toBeLessThan(raise);
    expect(raise).toBeLessThan(secure);
    expect(secure).toBeLessThan(unfurl);
    expect(unfurl).toBeLessThan(acknowledge);

    presentation.update(simulation.state, attach + 0.7);
    const attached = presentation.sample(settlement.id);
    expect(attached.bundleVisible).toBe(true);
    expect(attached.clothUnfurl).toBe(0);
    expect(attached.polePitch).toBeCloseTo(-Math.PI / 2, 4);

    presentation.update(simulation.state, raise + 2.4);
    const raising = presentation.sample(settlement.id);
    expect(raising.polePitch).toBeGreaterThan(-Math.PI / 2);
    expect(raising.polePitch).toBeLessThan(0.01);
    expect(raising.clothUnfurl).toBe(0);

    presentation.update(simulation.state, unfurl + 1.7);
    const cloth = presentation.sample(settlement.id);
    expect(cloth.polePitch).toBeCloseTo(0, 4);
    expect(cloth.clothUnfurl).toBeGreaterThan(0.3);
  });

  it('puts real founders on the mast instead of playing the ceremony without people', () => {
    const { simulation, settlement, presentation } = foundingFixture('founding-standard-people');
    makeEligible(settlement, simulation);
    presentation.update(simulation.state, 0);

    const carryAt = seekPhase(presentation, simulation, settlement.id, 'carry-pole');
    presentation.update(simulation.state, carryAt + 1);
    const participants = presentation.participantIds(settlement.id);
    expect(participants.size).toBeGreaterThanOrEqual(3);

    const base = { x: settlement.position.x + 1.4, z: settlement.position.z + 0.4 };
    const supply = { x: settlement.position.x - 1.3, z: settlement.position.z - 0.2 };
    const carryTargets = simulation.state.people
      .filter(person => participants.has(person.id))
      .map(person => presentation.targetFor(person.id, settlement.id, base, supply, 3.4))
      .filter(target => target !== undefined);
    expect(carryTargets.length).toBeGreaterThanOrEqual(2);
    expect(carryTargets.every(target => target.phase === 'carry-pole')).toBe(true);
    expect(carryTargets.every(target => target.interactionTarget !== undefined)).toBe(true);

    const raiseAt = seekPhase(presentation, simulation, settlement.id, 'raise');
    presentation.update(simulation.state, raiseAt + 2);
    const raiseTargets = simulation.state.people
      .filter(person => participants.has(person.id))
      .map(person => presentation.targetFor(person.id, settlement.id, base, supply, 3.4))
      .filter(target => target !== undefined);
    expect(raiseTargets.some(target => target.role === 'raiser' || target.role === 'base-worker')).toBe(true);
    expect(raiseTargets.some(target => (target.interactionHeight ?? 0) > 0.2)).toBe(true);
  });

  it('can be held behind another founding ceremony without consuming its milestone', () => {
    const { simulation, settlement, presentation } = foundingFixture('founding-standard-blocked');
    makeEligible(settlement, simulation);
    const blocked = new Set([settlement.id]);

    expect(presentation.update(simulation.state, 0, blocked)).toBe(false);
    expect(presentation.stateFor(settlement.id)).toBe('hidden');

    expect(presentation.update(simulation.state, 1, new Set())).toBe(true);
    expect(presentation.stateFor(settlement.id)).toBe('raising');
  });

  it('does not replay an already-earned standard after a renderer reload', () => {
    const { simulation, settlement } = foundingFixture('founding-standard-reload');
    makeEligible(settlement, simulation);

    const reloaded = new FoundingStandardPresentation(simulation.state);
    expect(reloaded.stateFor(settlement.id)).toBe('established');
    expect(reloaded.sample(settlement.id)).toMatchObject({
      active: false,
      established: true,
      phase: 'complete',
      transferProgress: 1,
      polePitch: 0,
      clothUnfurl: 1,
    });
    expect(reloaded.participantIds(settlement.id).size).toBe(0);
  });

  it('is deterministic for the same world and presentation clock', () => {
    const { simulation, settlement } = foundingFixture('founding-standard-deterministic');
    const first = new FoundingStandardPresentation(simulation.state);
    const second = new FoundingStandardPresentation(simulation.state);
    makeEligible(settlement, simulation);

    first.update(simulation.state, 0);
    second.update(simulation.state, 0);
    for (const time of [0.5, 2, 5, 9, 13, 17]) {
      first.update(simulation.state, time);
      second.update(simulation.state, time);
      expect(first.sample(settlement.id)).toEqual(second.sample(settlement.id));
      expect([...first.participantIds(settlement.id)]).toEqual([...second.participantIds(settlement.id)]);
    }
  });
});
