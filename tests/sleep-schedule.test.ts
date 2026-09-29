import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { sleepSchedule } from '../src/sim/people/SleepSchedule';
import { SleepPresentation, solarHour } from '../src/render/people/SleepPresentation';
import { restJointPlan } from '../src/render/people/RestPoseRenderer';

const simulation = new Simulation({ seed: 'sleep-policy', world: { size: 24 } });
function resident() {
  return { ...simulation.state.people[0]!, alive: true, role: 'farmer' as const,
    ageMonths: 360, activity: 'farm' as const, navigation: undefined };
}

describe('household sleep schedule', () => {
  it('sleeps through midnight, wakes by morning, and heads home before bedtime', () => {
    const person = resident();
    expect(sleepSchedule(person, 0).sleeping).toBe(true);
    expect(sleepSchedule(person, 4).sleeping).toBe(true);
    expect(sleepSchedule(person, 8).sleeping).toBe(false);
    const { bedtime, wakeTime } = sleepSchedule(person, 12);
    expect(sleepSchedule(person, bedtime - 1)).toMatchObject({ returningHome: true, sleeping: false });
    expect(sleepSchedule(person, wakeTime)).toMatchObject({ returningHome: false, sleeping: false });
    expect((wakeTime - bedtime + 24) % 24).toBeCloseTo(8);
  });
  it('gives children longer nights and residents staggered bedtimes', () => {
    const person = resident();
    const child = sleepSchedule({ ...person, ageMonths: 96 }, 21);
    expect(child.sleeping).toBe(true);
    expect((child.wakeTime - child.bedtime + 24) % 24).toBeCloseTo(11);
    expect(new Set(Array.from({ length: 10 }, (_, i) => sleepSchedule({ ...person, id: `resident-${i}` }, 0).bedtime)).size).toBe(10);
  });
  it('gives night-shift workers a full daytime sleep window', () => {
    const workers = Array.from({ length: 30 }, (_, i) => ({ ...resident(), id: `guard-${i}`, role: 'guard' as const, activity: 'patrol' as const }));
    const nights = workers.filter(p => sleepSchedule(p, 0).nightShift);
    expect(nights.length).toBeGreaterThan(0);
    expect(nights.length).toBeLessThan(workers.length);
    for (const person of nights) {
      expect(sleepSchedule(person, 0).sleeping).toBe(false);
      expect(sleepSchedule(person, 12).sleeping).toBe(true);
    }
  });
  it('defers sleep for actual emergency care and evacuation, but not ordinary jobs', () => {
    const person = resident();
    expect(sleepSchedule({ ...person, activity: 'flee' }, 0).sleeping).toBe(false);
    expect(sleepSchedule({ ...person, role: 'healer', activity: 'assist',
      navigation: { ...simulation.state.people[0]!.navigation!, schedulePhase: 'emergency' } }, 0).sleeping).toBe(false);
    expect(sleepSchedule({ ...person, activity: 'construct' }, 0).sleeping).toBe(true);
    expect(sleepSchedule({ ...person, alive: false }, 0).sleeping).toBe(false);
  });
  it('uses the sky clock and repeats independently of historical months', () => {
    expect(solarHour((0.75 - 0.16) * 58)).toBeCloseTo(0);
    expect(solarHour((0.25 - 0.16) * 58)).toBeCloseTo(12);
    expect(solarHour(17)).toBeCloseTo(solarHour(17 + 58));
  });
});

describe('physical sleep presentation', () => {
  it('reserves separate stable sleeping spaces and checks full-body clearance', () => {
    const people = Array.from({ length: 8 }, (_, i) => ({ ...resident(), id: `sleeper-${i}` }));
    const planner = new SleepPresentation();
    planner.beginFrame(people);
    const spots = people.map(p => planner.resolve(p, true, { x: 0, z: 0 }, [], () => true, () => true)!);
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      expect(Math.hypot(spots[i]!.destination.x - spots[j]!.destination.x, spots[i]!.destination.z - spots[j]!.destination.z)).toBeGreaterThan(0.9);
    }
    expect(planner.resolve(people[0]!, true, { x: 5, z: 5 }, [], () => true, () => true)).toEqual(spots[0]);
    expect(planner.resolve(people[0]!, true, { x: 0, z: 0 }, [], () => false, () => true)).toBeUndefined();
    expect(planner.resolve(people[1]!, false, { x: 0, z: 0 }, [], () => true, () => true)).toBeUndefined();
  });
  it('reclines with the head and limbs above ground and blends back to standing', () => {
    const sleeping = restJointPlan('sleep', 1);
    expect(sleeping.bodyPitch).toBeCloseTo(-Math.PI / 2);
    expect(0.44 + sleeping.bodyLift + Math.cos(sleeping.bodyPitch) * 0.425).toBeGreaterThan(0.08);
    expect(sleeping.left.ankleY).toBeGreaterThan(0);
    expect(sleeping.left.kneeY).toBeGreaterThan(0);
    expect(restJointPlan('sleep', 0).bodyLift).toBe(0);
    expect(restJointPlan('sleep', 0).bodyPitch).toBe(0);
  });
});
