import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { StructureNavigation } from '../src/sim/people/StructureNavigation';
import { SleepPresentation } from '../src/render/people/SleepPresentation';
import { indoorSleepingSpots, sleepAreaPoint, sleepAreaLocal, sleepAreaFloor, type IndoorSleepingArea } from '../src/render/people/IndoorSleepingArea';
import { PeopleVisualStateStore } from '../src/render/people/PeopleVisualState';

const room: IndoorSleepingArea = { key: 'home', worldX: 0, worldZ: 0, width: 1.4, depth: 1.2,
  rotationY: 0, floorY: 0.12, doorWidth: 0.34, plotWidth: 1.8, plotDepth: 1.6 };

describe('designated indoor sleeping areas', () => {
  it.each([0, Math.PI / 3])('keeps beds inside rotated walls with a clear central aisle (%s)', rotationY => {
    const area = { ...room, rotationY };
    const beds = indoorSleepingSpots(area);
    expect(beds).toHaveLength(4);
    for (const bed of beds) {
      const local = sleepAreaLocal(area, bed.destination);
      expect(Math.abs(local.x) + 0.11).toBeLessThan(area.width / 2);
      expect(Math.abs(local.z) + 0.2).toBeLessThan(area.depth / 2);
      expect(Math.abs(local.x) - 0.11).toBeGreaterThan(0.15);
      expect(bed.indoor).toBe(area);
    }
    expect(sleepAreaFloor(area, beds[0]!.destination, 0)).toBeCloseTo(0.12);
  });

  it.each([0, Math.PI / 4])('walks through the doorway to a bed and back out without crossing walls (%s)', rotationY => {
    const area = { ...room, rotationY };
    const nav = new StructureNavigation();
    nav.set([{ ...area, width: area.plotWidth, depth: area.plotDepth }]);
    const safe = (a: { x: number; z: number }, b = a) => nav.clear(a, b, area);
    const center = sleepAreaPoint(area, 0, 0);
    expect(nav.clear(center)).toBe(false);
    expect(safe(sleepAreaPoint(area, -2, 0), center)).toBe(false);
    expect(safe(sleepAreaPoint(area, 0, -2), center)).toBe(false);
    expect(safe(sleepAreaPoint(area, 0, 2), center)).toBe(true);
    const ground = { heightAt: () => 0.12, isStandable: () => true, safeSegment: safe,
      detour: (a: { x: number; z: number }, b: { x: number; z: number }) => nav.detour(a, b, safe, area) };
    const store = new PeopleVisualStateStore();
    const outside = sleepAreaPoint(area, -2, 0);
    store.resolve('resident', { destination: outside }, 0, ground);
    for (const destination of [indoorSleepingSpots(area)[0]!.destination, outside]) {
      for (let frame = 0; frame < 1500; frame++) {
        const before = { ...store.get('resident')! };
        store.beginFrame();
        const visual = store.resolve('resident', { destination }, 1 / 60, ground);
        expect(safe(before, visual)).toBe(true);
        expect(visual.snapped).toBe(false);
      }
      expect(store.get('resident')!.x).toBeCloseTo(destination.x, 3);
      expect(store.get('resident')!.z).toBeCloseTo(destination.z, 3);
    }
  });

  it('assigns unique beds, uses camp overflow, and retains doorway access while leaving', () => {
    const simulation = new Simulation({ seed: 'sleep-indoors', world: { size: 24 } });
    const people = Array.from({ length: 6 }, (_, i) => ({ ...simulation.state.people[0]!, id: `resident-${i}`, alive: true }));
    const structures = [{ ...room, role: 'house', sleepingArea: room }];
    const planner = new SleepPresentation();
    planner.beginFrame(people);
    const spots = people.map(person => planner.resolve(person, true, { x: 0, z: 0 }, structures, () => true, () => true)!);
    expect(spots.filter(spot => spot.support === 'bed')).toHaveLength(4);
    expect(spots.filter(spot => spot.support === 'ground')).toHaveLength(2);
    expect(new Set(spots.map(spot => spot.key)).size).toBe(6);
    const first = people[0]!, bed = spots[0]!;
    expect(planner.accessFor(first.id, bed.destination, bed, structures)).toBe(room);
    planner.resolve(first, false, { x: 0, z: 0 }, structures, () => true, () => true);
    expect(planner.accessFor(first.id, bed.destination, undefined, structures)).toBe(room);
    expect(planner.accessFor(first.id, { x: 3, z: 0 }, undefined, structures)).toBeUndefined();
    expect(planner.resolve(people[1]!, true, { x: 0, z: 0 }, [], () => true, () => true)?.support).toBe('ground');
  });

  it('does not invent capacity in tiny rooms or rooms with impassable doors', () => {
    expect(indoorSleepingSpots({ ...room, width: 0.3 })).toHaveLength(0);
    expect(indoorSleepingSpots({ ...room, doorWidth: 0.1 })).toHaveLength(0);
    expect(indoorSleepingSpots({ ...room, width: 0.5, depth: 0.6 })).toHaveLength(1);
  });
});
