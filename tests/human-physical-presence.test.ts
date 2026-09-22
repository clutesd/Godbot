import { describe, expect, it } from 'vitest';
import { PeopleVisualStateStore, HUMAN_MAX_WALK_SPEED, HUMAN_RADIUS, type PersonVisualGround } from '../src/render/people/PeopleVisualState';
import { StructureNavigation } from '../src/sim/people/StructureNavigation';

const flat: PersonVisualGround = { heightAt: () => 0, isStandable: () => true };
const dt = 1 / 60;

describe('real-time physical human contract', () => {
  it('has identical measured speed with frozen, slow, documentary and accelerated monthly destinations', () => {
    const journeys = [0, 0.1, 2, 100].map(rate => {
      const store = new PeopleVisualStateStore();
      store.resolve('resident', { destination: { x: 0, z: 0 } }, 0, flat);
      const samples: number[] = [];
      for (let frame = 0; frame < 600; frame++) {
        store.beginFrame();
        const previous = store.get('resident')!.x;
        // Historical updates make the destination recede; feet still have one physical clock.
        const visual = store.resolve('resident', { destination: { x: 20 + Math.floor(frame * dt * rate), z: 0 } }, dt, flat);
        const measured = Math.abs(visual.x - previous) / dt;
        expect(measured).toBeLessThanOrEqual(HUMAN_MAX_WALK_SPEED + 1e-9);
        samples.push(measured);
      }
      return samples;
    });
    for (const samples of journeys) samples.forEach((speed, i) => expect(speed).toBeCloseTo(journeys[0]![i]!, 8));
  });

  it.each([0, Math.PI / 4])('sweeps and detours around a rotated footprint (%s)', rotationY => {
    const nav = new StructureNavigation();
    nav.set([{ worldX: 0, worldZ: 0, width: 0.7, depth: 1.3, rotationY }]);
    const ground = { ...flat, safeSegment: (a: { x: number; z: number }, b: { x: number; z: number }) => nav.clear(a, b),
      detour: (a: { x: number; z: number }, b: { x: number; z: number }) => nav.detour(a, b, (a, b) => nav.clear(a, b)) };
    const store = new PeopleVisualStateStore();
    store.resolve('walker', { destination: { x: -1.5, z: 0 } }, 0, ground);
    let detoured = false;
    for (let frame = 0; frame < 1500; frame++) {
      store.beginFrame();
      const previous = { x: store.get('walker')!.x, z: store.get('walker')!.z };
      const v = store.resolve('walker', { destination: { x: 1.5, z: 0 } }, dt, ground);
      expect(nav.clear(previous, v)).toBe(true);
      expect(Math.hypot(v.x - previous.x, v.z - previous.z)).toBeLessThanOrEqual(v.maxPhysicalSpeed * dt + 1e-9);
      detoured ||= Math.abs(v.z) > 0.3;
    }
    expect(detoured).toBe(true);
    expect(store.get('walker')!.x).toBeCloseTo(1.5, 3);
  });

  it('never accepts a blocked destination and depenetrates when a solid appears around a resident', () => {
    const nav = new StructureNavigation();
    nav.set([{ worldX: 0, worldZ: 0, width: 0.9, depth: 1.1, rotationY: Math.PI / 7 }]);
    const ground = { ...flat, safeSegment: (a: { x: number; z: number }, b: { x: number; z: number }) => nav.clear(a, b),
      detour: (a: { x: number; z: number }, b: { x: number; z: number }) => nav.detour(a, b, (a, b) => nav.clear(a, b)) };
    const store = new PeopleVisualStateStore();
    store.resolve('walker', { destination: { x: -1.5, z: 0 } }, 0, ground);
    store.beginFrame();
    const approaching = store.resolve('walker', { destination: { x: 0, z: 0 } }, dt, ground);
    expect(nav.clear(approaching, approaching)).toBe(true);
    expect(Math.hypot(approaching.destinationX, approaching.destinationZ)).toBeGreaterThan(0.45);

    const dynamicNav = new StructureNavigation();
    const dynamicGround = { ...flat,
      safeSegment: (a: { x: number; z: number }, b: { x: number; z: number }) => dynamicNav.clear(a, b),
      detour: (a: { x: number; z: number }, b: { x: number; z: number }) => dynamicNav.detour(a, b, (a, b) => dynamicNav.clear(a, b)) };
    const dynamic = new PeopleVisualStateStore();
    dynamic.resolve('resident', { destination: { x: 0, z: 0 } }, 0, dynamicGround);
    dynamicNav.set([{ worldX: 0, worldZ: 0, width: 0.8, depth: 0.8, rotationY: 0 }]);
    dynamic.beginFrame();
    const recovered = dynamic.resolve('resident', { destination: { x: 1.4, z: 0 } }, dt, dynamicGround);
    expect(recovered.snapped).toBe(true);
    expect(dynamicNav.clear(recovered, recovered)).toBe(true);
  });

  it('steers around solid objects that do not provide pathfinder detour nodes', () => {
    const circleClear = (a: { x: number; z: number }, b: { x: number; z: number }): boolean => {
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, (-(a.x) * dx + -(a.z) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(a.x + dx * t, a.z + dz * t) >= 0.34;
    };
    const ground = { ...flat, safeSegment: circleClear };
    const store = new PeopleVisualStateStore();
    store.resolve('walker', { destination: { x: -1.2, z: 0 } }, 0, ground);
    let steered = false;
    for (let frame = 0; frame < 1800; frame++) {
      store.beginFrame();
      const previous = { x: store.get('walker')!.x, z: store.get('walker')!.z };
      const visual = store.resolve('walker', { destination: { x: 1.2, z: 0 } }, dt, ground);
      expect(circleClear(previous, visual)).toBe(true);
      steered ||= Math.abs(visual.z) > 0.2;
    }
    expect(steered).toBe(true);
    expect(store.get('walker')!.x).toBeCloseTo(1.2, 2);
    expect(store.get('walker')!.z).toBeCloseTo(0, 2);
  });

  it('keeps actual feet on hills, rejects new water, and resumes after clearance', () => {
    let flooded = false;
    const ground = { heightAt: (x: number) => Math.sin(x) * 0.1, isStandable: (x: number) => !flooded || x < 0.7 };
    const store = new PeopleVisualStateStore();
    store.resolve('walker', { destination: { x: 0, z: 0 } }, 0, ground);
    for (let frame = 0; frame < 900; frame++) {
      flooded = frame >= 30 && frame < 300;
      store.beginFrame();
      const v = store.resolve('walker', { destination: { x: 2, z: 0 } }, dt, ground);
      expect(v.footY).toBeCloseTo(ground.heightAt(v.x), 10);
      if (flooded) expect(v.x).toBeLessThan(0.7);
    }
    expect(store.get('walker')!.x).toBeCloseTo(2, 3);
  });

  it('passes opposing pedestrians without overlap, teleportation or deadlock', () => {
    const store = new PeopleVisualStateStore();
    store.resolve('a', { destination: { x: -1, z: 0 } }, 0, flat);
    store.resolve('b', { destination: { x: 1, z: 0 } }, 0, flat);
    for (let frame = 0; frame < 1800; frame++) {
      store.beginFrame();
      for (const [id, x] of [['a', 1], ['b', -1]] as const) {
        const old = { ...store.get(id)! };
        const v = store.resolve(id, { destination: { x, z: 0 } }, dt, flat);
        expect(Math.hypot(v.x - old.x, v.z - old.z)).toBeLessThanOrEqual(v.maxPhysicalSpeed * dt + 1e-9);
      }
      const a = store.get('a')!, b = store.get('b')!;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2 * HUMAN_RADIUS - 1e-5);
    }
    expect(store.get('a')!.x).toBeCloseTo(1, 2);
    expect(store.get('b')!.x).toBeCloseTo(-1, 2);
  });
});
