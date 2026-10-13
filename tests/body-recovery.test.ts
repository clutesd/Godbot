import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { killPeople } from '../src/sim/people/PersonLifecycle';
import { advanceBodies } from '../src/sim/people/BodyLifecycle';
import { BodyRecoveryPresentation } from '../src/render/people/BodyRecoveryPresentation';
import { casualtyLifecycle } from '../src/render/war/BattleAftermath';

function fixture() {
  const state = new Simulation({ seed: 'body-recovery', startingPopulation: 12, settlementCount: [1, 1], world: { size: 24 } }).state;
  const [person, helper] = state.people;
  person!.position = { x: 5, z: 5 };
  helper!.position = { x: 5, z: 5.6 }; helper!.homeId = person!.homeId;
  helper!.ageMonths = 300; helper!.health = 1; helper!.activity = 'rest'; helper!.navigation = undefined;
  killPeople(state, [person!], 'age');
  return { state, body: state.bodies![0]!, helper: helper! };
}

describe('body recovery', () => {
  it('records one burial with a living adult helper and death provenance', () => {
    const { state, body, helper } = fixture();
    for (const p of state.people) if (p.id !== helper.id) p.activity = 'construct';
    state.month++; advanceBodies(state);
    expect(body.recovery?.helperId).toBe(helper.id);
    expect(body.removed).toBeUndefined();
    state.month++; advanceBodies(state); advanceBodies(state);
    expect(body.removed?.reason).toBe('burial');
    const event = state.history.find(e => e.id === body.removed?.eventId)!;
    expect(event.actors).toContain(helper.id);
    expect(event.causes).toContain(body.deathEventId);
    expect(state.history.filter(e => e.context.bodyId === body.id)).toHaveLength(1);
  });
  it('does not let a deceased helper complete recovery', () => {
    const { state, body, helper } = fixture();
    body.recovery = { helperId: helper.id, month: state.month };
    helper.alive = false; state.month++; advanceBodies(state);
    expect(body.removed).toBeUndefined();
    expect(body.recovery?.helperId).not.toBe(helper.id);
  });
  it('approaches before contact, keeps the grip attached while dragging, and releases at completion', () => {
    const { body, helper } = fixture();
    const presentation = new BodyRecoveryPresentation();
    const before = JSON.stringify(body);
    presentation.start(body, helper, body.person.position, helper.position, 0, 0, () => true);
    expect(presentation.pose(body.id, 0)?.helper).toEqual(helper.position);
    expect(presentation.pose(body.id, 1)?.body).toEqual(body.person.position);
    const middle = presentation.pose(body.id, 7)!;
    expect(middle.dragging).toBe(true);
    expect(middle.helper.z - middle.body.z).toBeCloseTo(0.18);
    expect(middle.body.z).toBeGreaterThan(5);
    expect(presentation.pose(body.id, 30)?.done).toBe(true);
    expect(presentation.pose(body.id, 30)?.bend).toBe(0);
    expect(presentation.bodyForHelper(helper.id, 30)).toBeUndefined();
    expect(JSON.stringify(body)).toBe(before);
  });
  it('rejects blocked routes and suppresses gait oscillation for reduced motion', () => {
    const { body, helper } = fixture();
    const presentation = new BodyRecoveryPresentation();
    presentation.start(body, helper, body.person.position, helper.position, 0, 0, () => false);
    expect(presentation.pose(body.id, 5)).toBeUndefined();
    presentation.start(body, helper, body.person.position, helper.position, 0, 0, () => true);
    expect(presentation.pose(body.id, 7, true)?.stride).toBe(0);
    helper.alive = false; presentation.prune([body], [helper], 7);
    expect(presentation.has(body.id)).toBe(false);
  });
  it('starts upright, buckles during the fall, and settles without nonfinite transforms', () => {
    expect(casualtyLifecycle(0, false).pitch).toBe(0);
    expect(casualtyLifecycle(0.9, false).buckle).toBeGreaterThan(0.1);
    for (const t of [0, 0.38, 1, 1.63, 2, 10, Infinity]) {
      const pose = casualtyLifecycle(t, false);
      for (const value of Object.values(pose)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
    expect(casualtyLifecycle(10, false).pitch).toBeCloseTo(-Math.PI / 2);
    expect(casualtyLifecycle(0, true).fall).toBe(1);
  });
});
