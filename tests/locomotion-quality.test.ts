import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GroundedLocomotion } from '../src/render/people/GroundedLocomotion';
import { PeopleVisualStateStore } from '../src/render/people/PeopleVisualState';
import { soleTarget } from '../src/render/people/FootContactPose';
import { HumanJointRig } from '../src/render/people/HumanJointRig';

const ground = { heightAt: () => 0, isStandable: () => true };
const dt = 1 / 60;

function walking(id = 'p') {
  const nav = new PeopleVisualStateStore(), gait = new GroundedLocomotion();
  gait.update(nav.resolve(id, { destination: { x: 0, z: 0 } }, 0, ground), dt, 0.32, 1, 0.05, 1, ground);
  return { nav, gait, id };
}

describe('walking quality contracts', () => {
  it('lands ahead of the moving pelvis, maintains stance overlap, and rolls over the planted toe', () => {
    const { nav, gait, id } = walking();
    const previous = [true, true];
    let landed = 0, doubleSupport = 0, toeSupport = 0;
    const ahead: number[] = [];
    for (let frame = 0; frame < 600; frame++) {
      nav.beginFrame();
      const visual = nav.resolve(id, { destination: { x: 0, z: 10 }, localSpeed: 0.2 }, dt, ground);
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
    expect(landed).toBeGreaterThan(18);
    expect(landed).toBeLessThan(34);
    expect(ahead.slice(2).every(distance => distance > 0.025 && distance < 0.19)).toBe(true);
    expect(doubleSupport).toBeGreaterThan(45);
    expect(toeSupport).toBeGreaterThan(45);
  });

  it.each([-0.145, 0, 0.27])('holds the supporting heel/toe fixed while rolling at %s radians', pitch => {
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
    const localFoot = rig.footOrientation(0.4, -0.145).clone();
    const shin = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(rig.lower));
    const desired = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.145, 0.4, 0, 'YXZ'));
    expect(shin.multiply(localFoot).angleTo(desired)).toBeLessThan(1e-7);
    expect(rig.lower.equals(lowerBefore)).toBe(true);
    expect(rig.tip.equals(tipBefore)).toBe(true);
  });

  it('keeps a committed swing duration fixed through acceleration and deceleration', () => {
    const { nav, gait, id } = walking();
    let active = -1, duration = 0, checked = 0;
    for (let frame = 0; frame < 180; frame++) {
      nav.beginFrame();
      const visual = nav.resolve(id, { destination: { x: 0, z: 10 }, localSpeed: frame % 50 < 25 ? 0.12 : 0.24 }, dt, ground);
      const state = gait.update(visual, dt, 0.32, 1, 0.05, 1, ground);
      if (state.active >= 0) {
        const foot = state.feet[state.active]!;
        if (state.active === active) { expect(foot.duration).toBe(duration); checked++; }
        duration = foot.duration;
      }
      active = state.active;
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('uses an asymmetric swing: decisive clearance, then extension into a low heel approach', () => {
    const { nav, gait, id } = walking('swing-shape');
    let mid = 0, late = 0, sawSwing = false;
    for (let frame = 0; frame < 240; frame++) {
      nav.beginFrame();
      const visual = nav.resolve(id, { destination: { x: 0, z: 10 }, localSpeed: 0.2 }, dt, ground);
      const state = gait.update(visual, dt, 0.32, 1, 0.05, 1, ground);
      if (state.active < 0) continue;
      const foot = state.feet[state.active]!;
      sawSwing = true;
      if (foot.progress > 0.43 && foot.progress < 0.61) mid = Math.max(mid, foot.y);
      if (foot.progress > 0.82 && foot.progress < 0.94) late = Math.max(late, foot.y);
      if (mid > 0 && late > 0) break;
    }
    expect(sawSwing).toBe(true);
    expect(mid).toBeGreaterThan(0.006);
    expect(mid).toBeGreaterThan(late * 1.45);
  });

  it('commits a first step promptly and settles without an endless catch-up shuffle', () => {
    const { nav, gait, id } = walking('start-stop');
    let firstSwing = -1;
    let visual = nav.resolve(id, { destination: { x: 0, z: 2 }, localSpeed: 0.2 }, dt, ground);
    for (let frame = 0; frame < 90; frame++) {
      nav.beginFrame();
      visual = nav.resolve(id, { destination: { x: 0, z: 2 }, localSpeed: 0.2 }, dt, ground);
      const state = gait.update(visual, dt, 0.32, 1, 0.05, 1, ground);
      if (firstSwing < 0 && state.active >= 0) firstSwing = frame;
    }
    expect(firstSwing).toBeGreaterThanOrEqual(0);
    expect(firstSwing).toBeLessThan(12);

    const stop = { x: visual.x, z: visual.z };
    let settledFrames = 0;
    for (let frame = 0; frame < 180; frame++) {
      nav.beginFrame();
      visual = nav.resolve(id, { destination: stop, localSpeed: 0.2 }, dt, ground);
      const state = gait.update(visual, dt, 0.32, 1, 0.05, 1, ground);
      if (visual.speed < 0.01 && state.active < 0 && state.feet.every(foot => foot.planted)) settledFrames++;
      else settledFrames = 0;
    }
    expect(settledFrames).toBeGreaterThan(24);
  });

  it('anticipates a curved turn with foot yaw instead of corkscrewing a planted straight gait', () => {
    const { nav, gait, id } = walking('turner');
    let visual = nav.resolve(id, { destination: { x: 0, z: 4 }, localSpeed: 0.19 }, dt, ground);
    for (let frame = 0; frame < 100; frame++) {
      nav.beginFrame();
      visual = nav.resolve(id, { destination: { x: 0, z: 4 }, localSpeed: 0.19 }, dt, ground);
      gait.update(visual, dt, 0.32, 1, 0.05, 1, ground);
    }

    let maxLandingYaw = 0;
    const planted = [true, true];
    for (let frame = 0; frame < 220; frame++) {
      nav.beginFrame();
      visual = nav.resolve(id, { destination: { x: 4, z: 4 }, localSpeed: 0.19 }, dt, ground);
      const state = gait.update(visual, dt, 0.32, 1, 0.05, 1, ground);
      state.feet.forEach((foot, side) => {
        if (foot.planted && !planted[side]) maxLandingYaw = Math.max(maxLandingYaw, Math.abs(foot.yaw));
        planted[side] = foot.planted;
      });
    }
    expect(maxLandingYaw).toBeGreaterThan(0.22);
    expect(Math.abs(visual.facing)).toBeGreaterThan(0.45);
  });

  it('keeps the knee bend plane continuous while a foot target sweeps through a turn', () => {
    const rig = new HumanJointRig();
    const parent = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.144, 0),
      new THREE.Quaternion(), new THREE.Vector3(0.32, 0.32, 0.32));
    let previous: THREE.Quaternion | undefined;
    let worst = 0;
    for (let step = 0; step <= 32; step++) {
      const a = step / 32 * Math.PI * 0.45;
      const target = new THREE.Vector3(Math.sin(a) * 0.045, 0, Math.cos(a) * 0.045);
      rig.reach(parent, 0.05, 0, target, 0.225, 0.225, 1, true);
      const current = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(rig.upper));
      if (previous) worst = Math.max(worst, previous.angleTo(current));
      previous = current;
    }
    expect(worst).toBeLessThan(0.22);
  });
});
