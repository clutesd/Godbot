import { beforeAll, describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { killPeople } from '../src/sim/people/PersonLifecycle';
import { advanceBodies, bodyWeathering, removeBody } from '../src/sim/people/BodyLifecycle';
import { physicalCondition } from '../src/render/animation/PhysicalCondition';
import type { SimulationState } from '../src/sim/types';
let base: SimulationState;
beforeAll(() => { base = new Simulation({ seed: 'physical-mortality', startingPopulation: 24, settlementCount: [1, 1], world: { size: 24 } }).state; });
describe('authoritative physical mortality', () => {
  it('retains identity and actual migrant death location through retirement and restore', () => {
    const state = structuredClone(base), person = state.people[0]!;
    person.activity = 'migrate'; person.position = { x: 3, z: 7 };
    killPeople(state, [person, person], 'infection');
    const body = state.bodies![0]!;
    expect(body.person.position).toEqual({ x: 3, z: 7 });
    expect(state.history.find(e => e.id === body.deathEventId)?.location).toEqual(person.position);
    expect(body.person.appearance).toEqual(person.appearance);
    state.people = []; state.history = [];
    const restored = structuredClone(state);
    killPeople(restored, [body.person], 'infection');
    expect(restored.bodies).toEqual(state.bodies);
    expect(restored.bodies).toHaveLength(1);
  });
  it('weathering is bounded and deterministic; removal requires a recorded operation', () => {
    const state = structuredClone(base);
    killPeople(state, [state.people[0]!], 'age');
    const body = state.bodies![0]!;
    expect(bodyWeathering(body, -10)).toBe(0);
    state.month = body.month + 24; advanceBodies(state);
    expect(body.removed).toBeUndefined();
    expect(bodyWeathering(body, state.month)).toBe(1);
    expect(bodyWeathering(structuredClone(body), state.month)).toBe(1);
    expect(removeBody(state, body.id, 'burial')).toBe(true);
    expect(removeBody(state, body.id, 'burial')).toBe(false);
    expect(state.history.find(e => e.id === body.removed!.eventId)?.causes).toContain(body.deathEventId);
  });
  it('decomposition runs once in the simulation, independently of the renderer', () => {
    const state = structuredClone(base); killPeople(state, [state.people[0]!], 'war');
    state.month += 36; advanceBodies(state);
    const restored = structuredClone(state); advanceBodies(restored);
    expect(restored.bodies).toEqual(state.bodies);
    expect(restored.history.length).toBe(state.history.length);
    expect(state.bodies![0]!.removed?.reason).toBe('decomposition');
  });
  it('gates symptoms by perception, infectious window and pathogen', () => {
    const state = structuredClone(base), p = state.people[0]!, s = state.settlements[0]!;
    p.infection = { pathogen: 'respiratory', acquiredMonth: 0, infectiousMonth: 2, recoveryMonth: 5, severity: 0.8 };
    expect(physicalCondition(p, undefined, 3).respiratory).toBe(false);
    expect(physicalCondition(p, s, 1, true).illness).toBe(0);
    expect(physicalCondition(p, s, 3, true).respiratory).toBe(true);
    p.infection.pathogen = 'enteric';
    expect(physicalCondition(p, s, 3, true).respiratory).toBe(false);
    expect(physicalCondition(p, s, 5, true).illness).toBe(0);
    p.alive = false;
    expect(physicalCondition(p, s, 3, true).illness).toBe(0);
  });
});
