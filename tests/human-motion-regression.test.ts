import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GroundedLocomotion } from '../src/render/people/GroundedLocomotion';
import { PeopleVisualStateStore } from '../src/render/people/PeopleVisualState';
import { HumanJointRig } from '../src/render/people/HumanJointRig';
import { arrivalFounderPose, arrivalGroundFor, ARRIVAL_HATCH } from '../src/render/founding/ArrivalChoreography';
import { applyConversationGesture } from '../src/render/people/SocialGesturePresentation';
import { AnimationController } from '../src/render/animation/AnimationController';
import type { LocalActivityState } from '../src/render/people/LocalActivityPresentation';
import type { FoundingPod } from '../src/sim/founding/FoundingArrival';
import type { Person } from '../src/sim/types';

const flat = { heightAt: () => 0, isStandable: () => true };

describe('walking on slopes and leaving the ship', () => {
  it.each([30, 60, 120])('keeps adult and child walkers upright through uphill acceleration at %s fps', fps => {
    for (const scale of [0.22, 0.32]) for (const grade of [-0.6, 0, 0.6]) {
      const ground = { ...flat, heightAt: (_x: number, z: number) => z * grade };
      const store = new PeopleVisualStateStore(), gait = new GroundedLocomotion();
      const leg = scale < 0.3 ? 0.85 : 1;
      gait.update(store.resolve('walker', { destination: { x: 0, z: 0 } }, 0, ground), 0, scale, leg, 0.05, 1, ground);
      const rig = new HumanJointRig();
      let footfalls = 0;
      const previous = [true, true];
      for (let frame = 0; frame < fps * 4; frame++) {
        store.beginFrame();
        const v = store.resolve('walker', { destination: { x: 0, z: 4 }, localSpeed: 0.22 }, 1 / fps, ground);
        const s = gait.update(v, 1 / fps, scale, leg, 0.05, 1, ground);
        // A normal walk may compress, but never collapse toward a kneeling pose.
        expect(s.bodyY / leg, `grade ${grade}, scale ${scale}, frame ${frame}`).toBeGreaterThan(-0.105);
        const parent = new THREE.Matrix4().compose(new THREE.Vector3(v.x + s.weight * scale * 0.024,
          v.footY + (0.45 * leg + s.bodyY) * scale, v.z), new THREE.Quaternion(), new THREE.Vector3().setScalar(scale));
        s.feet.forEach((f, side) => {
          if (f.planted && !previous[side]) footfalls++;
          expect(f.y).toBeGreaterThanOrEqual(ground.heightAt(f.x, f.z) - 0.0001);
          rig.reach(parent, (side ? 1 : -1) * 0.05, 0, new THREE.Vector3(f.x, f.y, f.z), 0.225 * leg, 0.225 * leg, side ? 1 : -1, true);
          expect(rig.tip.distanceTo(new THREE.Vector3(f.x, f.y, f.z))).toBeLessThan(scale * 0.008);
          previous[side] = f.planted;
        });
      }
      expect(footfalls).toBeGreaterThan(8);
    }
  });

  it('shortens foot placement on a narrow corridor instead of leaving a foot pinned behind', () => {
    const ground = { ...flat, isStandable: (x: number) => Math.abs(x) < 0.008 };
    const store = new PeopleVisualStateStore(), gait = new GroundedLocomotion();
    gait.update(store.resolve('narrow', { destination: { x: 0, z: 0 } }, 0, ground), 0, 0.32, 1, 0.05, 1, ground);
    for (let frame = 0; frame < 360; frame++) {
      store.beginFrame();
      const v = store.resolve('narrow', { destination: { x: 0, z: 3 }, localSpeed: 0.2 }, 1 / 60, ground);
      const s = gait.update(v, 1 / 60, 0.32, 1, 0.05, 1, ground);
      expect(s.bodyY).toBeGreaterThan(-0.15);
      if (frame > 60) for (const foot of s.feet) expect(Math.abs(foot.z - v.z)).toBeLessThan(0.12);
    }
  });

  it.each([-0.15, 0, 0.15])('plants on the actual ramp and walks onto terrain at landing grade %s', grade => {
    const pod = { id: 'pod', position: { x: 0, z: 0 }, groundY: 0, personIds: ['founder'] } as FoundingPod;
    const person = { id: 'founder', target: { x: -0.4, z: -2.8 },
      foundingOrigin: { podId: 'pod', emergedSeconds: 0 } } as Person;
    // The vessel blocks terrain navigation; only the actual portal receives an exemption.
    const terrain = { heightAt: (_x: number, z: number) => z * grade, isStandable: () => true,
      safeSegment: (a: { z: number }, b: { z: number }) => a.z < -1.2 && b.z < -1.2 };
    const ground = arrivalGroundFor(pod, terrain);
    const tipY = ARRIVAL_HATCH.sill + Math.cos(ground.ramp.angle) * ARRIVAL_HATCH.length;
    expect(tipY).toBeCloseTo(terrain.heightAt(0, ground.ramp.z), 4);
    expect(ground.safeSegment!({ x: 0, z: -0.7 }, { x: 0.4, z: -0.7 })).toBe(false);
    const store = new PeopleVisualStateStore(), gait = new GroundedLocomotion();
    let rampContacts = 0, terrainContacts = 0;
    for (let frame = 0; frame < 720; frame++) {
      const pose = arrivalFounderPose(person, pod, frame / 60, ground.heightAt, ground.ramp)!;
      store.beginFrame();
      const v = store.stageArrival(person.id, pose, ground);
      const s = gait.update(v, 1 / 60, 0.32, 1, 0.05, 1, ground);
      expect(s.bodyY).toBeGreaterThan(-0.16);
      for (const f of s.feet) if (f.planted) {
        expect(f.y).toBeCloseTo(ground.heightAt(f.x, f.z), 5);
        if (f.z > ground.ramp.z && f.z < ARRIVAL_HATCH.z) rampContacts++;
        if (f.z < ground.ramp.z - 0.1) terrainContacts++;
      }
    }
    expect(rampContacts).toBeGreaterThan(50);
    expect(terrainContacts).toBeGreaterThan(50);
    expect(store.get(person.id)!.traveling).toBe(false);
    expect(store.get(person.id)!.z).toBeCloseTo(person.target.z, 5);
  });

  it('reinitializes contacts after an arrival preview seek and anticipates forward motion', () => {
    const store = new PeopleVisualStateStore();
    const pose = { x: 0, z: 0, facing: 0, speed: 0.5, footY: 0 };
    expect(store.stageArrival('p', pose, flat).snapped).toBe(true);
    const second = store.stageArrival('p', { ...pose, z: 0.01 }, flat);
    expect(second.snapped).toBe(false);
    expect(second.destinationZ).toBeGreaterThan(second.z + 0.1);
    expect(store.stageArrival('p', { ...pose, z: 2 }, flat).snapped).toBe(true);
  });
});

describe('conversational performance', () => {
  const visual = new PeopleVisualStateStore().resolve('speaker', { destination: { x: 0, z: 0 } }, 0, flat);
  const local = (id: string, animation: LocalActivityState['animation'], seconds: number): LocalActivityState => ({
    authority: 'social', revision: 0, seen: 0, base: { x: 0, z: 0 }, points: [], focus: { x: 0, z: 0.4 },
    stationFocus: { x: 0, z: 0.4 }, destination: { x: 0, z: 0 }, restFacing: 0, animation,
    action: 'talk', phase: 'action', step: 0, cycle: 0, sample: 0, seconds, hold: 6,
    encounter: { partnerId: id, tone: 'warm', role: 'peer', strength: 0.8, trust: 0.8, beat: 1, ready: true },
  });
  const pose = () => {
    const controller = new AnimationController('conversation-review');
    controller.getOrCreateCharacterState('p', 'artisan');
    return structuredClone(controller.getCurrentPose('p')!);
  };
  it('gives speech an asymmetric emphasis, a quiet recovery, and delayed listener nods', () => {
    const speech = pose(), listening = pose(), recovery = pose();
    applyConversationGesture(speech, 'speaker', local('listener', 'converse-warm', 0.975), local('speaker', 'converse-quiet', 0.975), visual, 0.8);
    applyConversationGesture(listening, 'listener', local('speaker', 'converse-quiet', 1.525), local('listener', 'converse-warm', 1.525), visual, 0.8);
    applyConversationGesture(recovery, 'speaker', local('listener', 'converse-warm', 3), local('speaker', 'converse-quiet', 3), visual, 0.8);
    expect(Math.abs(speech.leftShoulderRotation - speech.rightShoulderRotation)).toBeGreaterThan(0.2);
    expect(Math.max(recovery.leftShoulderRotation, recovery.rightShoulderRotation)).toBeLessThan(0.06);
    expect(listening.headPitch).toBeGreaterThan(0.08);
    expect(Math.max(listening.leftShoulderRotation, listening.rightShoulderRotation)).toBeLessThan(0.06);
    expect(speech.positionOffset).toEqual(recovery.positionOffset);
  });
  it('does not overwrite walking, approach, greetings or interrupted conversations', () => {
    const original = pose();
    for (const mode of ['walking', 'approach', 'greeting', 'interrupted']) {
      const p = structuredClone(original), l = local('listener', 'converse-warm', 1);
      const v = { ...visual };
      if (mode === 'walking') v.speed = 0.2;
      if (mode === 'approach') l.phase = 'approach';
      if (mode === 'greeting') { l.encounter!.beat = 0; l.encounter!.greeting = 'wave'; }
      if (mode === 'interrupted') l.encounter!.ready = false;
      applyConversationGesture(p, 'speaker', l, undefined, v, 0.8);
      expect(p).toEqual(original);
    }
  });
});
