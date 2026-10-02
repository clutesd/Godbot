import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GroundedLocomotion, SUPPORT_SHIFT } from '../src/render/people/GroundedLocomotion';
import { PeopleVisualStateStore } from '../src/render/people/PeopleVisualState';
import { HumanJointRig } from '../src/render/people/HumanJointRig';
import { GODBOX_HEADS, humanCultureGrammar } from '../src/render/people/HumanIdentity';
import { humanLookFor } from '../src/render/people/HumanAppearanceProfile';
import type { Culture, Person } from '../src/sim/types';

const flat = { heightAt: () => 0, isStandable: () => true };
const dt = 1 / 60;

describe('authored presence contacts', () => {
  it.each([0.22, 0.32, 0.4])('holds planted soles in world space at body scale %s, with reachable knees', scale => {
    const store = new PeopleVisualStateStore(), gait = new GroundedLocomotion(), rig = new HumanJointRig();
    let visual = store.resolve('walker', { destination: { x: 0, z: 0 } }, 0, flat);
    gait.update(visual, dt, scale, 1, 0.05, 1, flat);
    let previous: { x: number; z: number; planted: boolean }[] = [];
    let plants = 0;
    for (let frame = 0; frame < 600; frame++) {
      store.beginFrame();
      visual = store.resolve('walker', { destination: { x: 0, z: 1.2 }, localSpeed: 0.18 }, dt, flat);
      const pose = gait.update(visual, dt, scale, 1, 0.05, 1, flat);
      expect(pose.feet.filter(f => !f.planted).length).toBeLessThanOrEqual(1);
      const parent = new THREE.Matrix4().compose(
        new THREE.Vector3(visual.x + pose.weight * scale * SUPPORT_SHIFT, (0.45 + pose.bodyY) * scale, visual.z),
        new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      pose.feet.forEach((foot, side) => {
        const before = previous[side];
        if (foot.planted && before?.planted) {
          expect(foot.x).toBe(before.x); expect(foot.z).toBe(before.z); plants++;
        }
        if (foot.planted) expect(foot.y).toBe(0);
        expect(foot.y).toBeGreaterThanOrEqual(0);
        rig.reach(parent, (side ? 1 : -1) * 0.05, 0, new THREE.Vector3(foot.x, foot.y, foot.z), 0.225, 0.225, side ? 1 : -1, true);
        expect(rig.tip.distanceTo(new THREE.Vector3(foot.x, foot.y, foot.z))).toBeLessThan(0.001);
      });
      previous = pose.feet.map(f => ({ x: f.x, z: f.z, planted: f.planted }));
    }
    expect(plants).toBeGreaterThan(300);
    const settled = gait.update(visual, dt, scale, 1, 0.05, 1, flat);
    expect(settled.active).toBe(-1);
    expect(settled.feet.every(f => f.planted)).toBe(true);
  });

  it('steps through an in-place turn, leads with the head, and settles without sliding', () => {
    const store = new PeopleVisualStateStore(), gait = new GroundedLocomotion();
    gait.update(store.resolve('turner', { destination: { x: 0, z: 0 } }, 0, flat), dt, 0.32, 1, 0.05, 1, flat);
    let lifted = false, headLed = false;
    for (let frame = 0; frame < 240; frame++) {
      store.beginFrame();
      const visual = store.resolve('turner', { destination: { x: 0, z: 0 }, restFacing: Math.PI / 2 }, dt, flat);
      const pose = gait.update(visual, dt, 0.32, 1, 0.05, 1, flat);
      lifted ||= pose.active >= 0; headLed ||= pose.headLead > 0.1;
      expect(visual.x).toBe(0); expect(visual.z).toBe(0);
      if (frame === 239) {
        expect(pose.active).toBe(-1);
        expect(Math.abs(pose.headLead)).toBeLessThan(0.001);
      }
    }
    expect(lifted && headLed).toBe(true);
  });

  it('uses stable authored skull families and distinct inherited cultural forms', () => {
    const heads = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const person = { id: `citizen-${i}`, ageMonths: 360, prestige: 20, sex: 'female', role: 'farmer', cultureId: 'test' } as Person;
      const a = humanLookFor(person), b = humanLookFor(person);
      expect(a).toEqual(b); heads.add(a.head.name);
    }
    expect(heads.size).toBe(GODBOX_HEADS.length);
    const mountain = humanCultureGrammar({ style: { symbol: 'mountain-knot', pattern: 'terrace' } } as Culture);
    const river = humanCultureGrammar({ style: { symbol: 'river-eye', pattern: 'wave' } } as Culture);
    expect(mountain.crest).not.toBe(river.crest);
    expect(mountain.waist).not.toBe(river.waist);
    expect(mountain.symmetry).toBeGreaterThan(river.symmetry);
  });
});
