import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GroundedLocomotion } from '../src/render/people/GroundedLocomotion';
import { PeopleVisualStateStore } from '../src/render/people/PeopleVisualState';
import { soleTarget } from '../src/render/people/FootContactPose';
import { HumanJointRig } from '../src/render/people/HumanJointRig';

const ground = { heightAt: () => 0, isStandable: () => true };
const dt = 1 / 60;
function walking() {
  const nav = new PeopleVisualStateStore(), gait = new GroundedLocomotion();
  gait.update(nav.resolve('p', { destination: { x: 0, z: 0 } }, 0, ground), dt, 0.32, 1, 0.05, 1, ground);
  return { nav, gait };
}

describe('walking quality contracts', () => {
  it('lands ahead of the moving pelvis, maintains stance overlap, and rolls over the planted toe', () => {
    const { nav, gait } = walking();
    const previous = [true, true];
    let landed = 0, doubleSupport = 0, toeSupport = 0;
    const ahead: number[] = [];
    for (let frame = 0; frame < 600; frame++) {
      nav.beginFrame();
      const visual = nav.resolve('p', { destination: { x: 0, z: 10 }, localSpeed: 0.2 }, dt, ground);
      const state = gait.update(visual, dt, 0.32, 1, 0.05, 1, ground);
      if (state.feet.every(f => f.planted)) doubleSupport++;
      state.feet.forEach((foot, side) => {
        if (foot.planted && !previous[side]) {
          landed++;
          ahead.push((foot.z - visual.z) / 0.32);
          expect(foot.pitch).toBeLessThan(0); // Heel receives the landing.
        }
        if (foot.planted && foot.pitch > 0.04) toeSupport++;
        previous[side] = foot.planted;
      });
    }
    expect(landed).toBeGreaterThan(20);
    expect(landed).toBeLessThan(35);
    expect(ahead.slice(2).every(distance => distance > 0.04 && distance < 0.17)).toBe(true);
    expect(doubleSupport).toBeGreaterThan(50);
    expect(toeSupport).toBeGreaterThan(50);
  });

  it.each([-0.14, 0, 0.25])('holds the supporting heel/toe fixed while rolling at %s radians', pitch => {
    const scale = 0.32, thickness = 0.9, yaw = 0.9;
    const contact = { x: 3, y: 0.4, z: -2, pitch, yaw };
    const origin = soleTarget(new THREE.Vector3(), contact, scale, thickness);
    const pivot = (pitch > 0 ? 0.092 : -0.026) * scale * thickness;
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    const actual = new THREE.Vector3(0, 0, pivot).applyQuaternion(rotation).add(origin);
    const expected = new THREE.Vector3(contact.x + Math.sin(yaw) * pivot, contact.y, contact.z + Math.cos(yaw) * pivot);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-12);
  });

  it('cancels lateral and forward shin tilt without changing the knee or stretching either bone', () => {
    const rig = new HumanJointRig();
    const parent = new THREE.Matrix4().compose(new THREE.Vector3(2, 0.135, -1),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.8, 0.018, 'YXZ')), new THREE.Vector3(0.32, 0.32, 0.32));
    rig.reach(parent, 0.05, 0, new THREE.Vector3(2.035, 0, -0.97), 0.225, 0.225, 1, true);
    const lowerBefore = rig.lower.clone(), tipBefore = rig.tip.clone();
    const localFoot = rig.footOrientation(0.4, -0.14).clone();
    const shin = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(rig.lower));
    const desired = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.14, 0.4, 0, 'YXZ'));
    expect(shin.multiply(localFoot).angleTo(desired)).toBeLessThan(1e-7);
    expect(rig.lower.equals(lowerBefore)).toBe(true);
    expect(rig.tip.equals(tipBefore)).toBe(true);
  });

  it('keeps a committed swing duration fixed through acceleration and deceleration', () => {
    const { nav, gait } = walking();
    let active = -1, duration = 0, checked = 0;
    for (let frame = 0; frame < 180; frame++) {
      nav.beginFrame();
      const visual = nav.resolve('p', { destination: { x: 0, z: 10 }, localSpeed: frame % 50 < 25 ? 0.12 : 0.24 }, dt, ground);
      const state = gait.update(visual, dt, 0.32, 1, 0.05, 1, ground);
      if (state.active >= 0) {
        const foot = state.feet[state.active]!;
        if (state.active === active) { expect(foot.duration).toBe(duration); checked++; }
        duration = foot.duration;
      }
      active = state.active;
    }
    expect(checked).toBeGreaterThan(100);
  });
});
