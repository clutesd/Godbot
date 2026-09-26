import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AnimationController } from '../src/render/animation/AnimationController';
import { HumanJointRig } from '../src/render/people/HumanJointRig';
import { PeopleVisualStateStore } from '../src/render/people/PeopleVisualState';
import { createCosmicArmGeometry, createCosmicLegGeometry } from '../src/render/people/CosmicPeople';

const dt = 1 / 60;
function walker(age = 360) {
  const controller = new AnimationController('joint-review');
  const state = controller.getOrCreateCharacterState('resident', 'artisan');
  controller.updateCharacterAnimation('resident', 1, 'travel', 'walk', 0.3, age);
  return { controller, state };
}

describe('ordinary articulated human contract', () => {
  it('keeps elbow/hand transforms attached and yaw-equivariant at every heading', () => {
    const rig = new HumanJointRig();
    rig.compose(new THREE.Matrix4(), 0.12, 0.71, 0.3, 0.7, 0.19, 0.18, true);
    const tip = rig.tip.clone();
    const elbow = new THREE.Vector3(0, -0.19, 0).applyMatrix4(rig.upper);
    expect(elbow.distanceTo(new THREE.Vector3().setFromMatrixPosition(rig.lower))).toBeLessThan(1e-10);
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.2) {
      const parent = new THREE.Matrix4().makeRotationY(yaw);
      rig.compose(parent, 0.12, 0.71, 0.3, 0.7, 0.19, 0.18, true);
      expect(rig.tip.distanceTo(tip.clone().applyMatrix4(parent))).toBeLessThan(1e-10);
    }
  });

  it('opposes ankle strides and arms, bends the recovering knee, and grounds the supporting foot', () => {
    const { controller, state } = walker();
    const rig = new HumanJointRig();
    for (let phase = 0; phase < Math.PI * 2; phase += 0.08) {
      state.stridePhase = phase;
      const pose = controller.getCurrentPose('resident')!;
      expect(pose.leftShoulderRotation + pose.rightShoulderRotation).toBeCloseTo(0, 8);
      expect(Math.abs(pose.leftShoulderRotation)).toBeLessThan(0.3);
      expect(pose.leftElbowRotation).toBeGreaterThan(0.1);
      const parent = new THREE.Matrix4().makeTranslation(0, 0.45 + pose.positionOffset.y, 0);
      rig.compose(parent, -0.049, 0, pose.leftHipRotation, pose.leftKneeRotation, 0.225, 0.225, false);
      const left = rig.tip.clone();
      rig.compose(parent, 0.049, 0, pose.rightHipRotation, pose.rightKneeRotation, 0.225, 0.225, false);
      expect(left.z * rig.tip.z).toBeLessThanOrEqual(1e-8);
      expect(Math.min(left.y, rig.tip.y)).toBeCloseTo(0, 7);
      expect(pose.leftKneeRotation * pose.rightKneeRotation).toBe(0);
    }
  });

  it('settles a frozen stride smoothly without cycling legs at rest', () => {
    const { controller, state } = walker();
    state.stridePhase = 1;
    let previous = controller.getCurrentPose('resident')!.leftHipRotation;
    const phase = state.stridePhase;
    for (let frame = 0; frame < 90; frame++) {
      controller.updateCharacterAnimation('resident', dt, 'travel', 'idle', 0);
      const hip = controller.getCurrentPose('resident')!.leftHipRotation;
      expect(Math.abs(hip - previous)).toBeLessThan(0.07);
      expect(hip).toBeLessThanOrEqual(previous + 1e-8);
      expect(state.stridePhase).toBe(phase);
      previous = hip;
    }
    expect(previous).toBe(0);
  });

  it('keeps seeded identity stable, elder strides restrained and carrying hands occupied', () => {
    const adult = walker(), elder = walker(900);
    adult.state.stridePhase = elder.state.stridePhase = Math.PI / 2;
    expect(Math.abs(elder.controller.getCurrentPose('resident')!.leftHipRotation))
      .toBeLessThan(Math.abs(adult.controller.getCurrentPose('resident')!.leftHipRotation));
    const duplicate = walker();
    adult.state.stridePhase = duplicate.state.stridePhase;
    expect(adult.controller.getCurrentPose('resident')).toEqual(duplicate.controller.getCurrentPose('resident'));
    for (const speed of [0.3, 0]) {
      adult.controller.updateCharacterAnimation('resident', 1, 'transport', 'carry', speed, 360, true);
      const pose = adult.controller.getCurrentPose('resident')!;
      expect(pose.leftElbowRotation).toBeGreaterThan(1);
      expect(pose.leftShoulderRotation).toBe(pose.rightShoulderRotation);
    }
  });

  it('gives listeners quiet asymmetric arms and a nod, with different teaching energy', () => {
    const { controller } = walker();
    controller.updateCharacterAnimation('resident', 2, 'socialize', 'converse-quiet', 0);
    const listener = structuredClone(controller.getCurrentPose('resident')!);
    controller.updateCharacterAnimation('resident', 2, 'socialize', 'converse-teach', 0);
    const teacher = controller.getCurrentPose('resident')!;
    expect(Math.max(listener.leftShoulderRotation, listener.rightShoulderRotation)).toBeLessThan(0.05);
    expect(listener.leftShoulderRotation).not.toBe(listener.rightShoulderRotation);
    expect(Math.max(teacher.leftShoulderRotation, teacher.rightShoulderRotation)).toBeGreaterThan(0.15);
    expect(teacher.leftShoulderRotation).not.toBe(teacher.rightShoulderRotation);
  });

  it('recognizes a passing relationship head-first without altering route or authority', () => {
    const store = new PeopleVisualStateStore();
    const ground = { heightAt: () => 0, isStandable: () => true };
    const a = store.resolve('a', { destination: { x: 0, z: 0 } }, 0, ground);
    store.resolve('b', { destination: { x: 0.4, z: 0.5 } }, 0, ground);
    store.beginFrame(); a.speed = 0.3;
    const route = JSON.stringify(a.path);
    store.noticePassingPeer('a', dt, () => false);
    expect(a.passingPeer).toBeUndefined();
    store.noticePassingPeer('a', dt, id => id === 'b');
    expect(a.passingPeer).toBe('b');
    expect(a.passingHeadYaw).toBeGreaterThan(0);
    expect(a.passingTorsoYaw).toBe(0);
    for (let i = 0; i < 30; i++) store.noticePassingPeer('a', dt, () => true);
    expect(a.passingTorsoYaw).toBeGreaterThan(0);
    expect(a.facing).toBe(0);
    expect(JSON.stringify(a.path)).toBe(route);
    for (let i = 0; i < 100; i++) store.noticePassingPeer('a', dt, () => true, false);
    expect(a.passingHeadYaw).toBe(0);
    expect(a.passingTorsoYaw).toBe(0);
  });

  it('bounds geometry and reuses pose buffers for a large visible population', () => {
    const geometries = [createCosmicArmGeometry('upper'), createCosmicArmGeometry('lower'),
      createCosmicLegGeometry('upper'), createCosmicLegGeometry('lower')];
    expect(geometries.reduce((n, g) => n + g.index!.count / 3, 0)).toBeLessThan(1500);
    geometries.forEach(g => g.dispose());
    const controller = new AnimationController('crowd');
    for (let i = 0; i < 1536; i++) {
      controller.getOrCreateCharacterState(String(i), 'artisan');
      controller.updateCharacterAnimation(String(i), 1, 'travel', 'walk', 0.3);
    }
    const buffer = controller.getCurrentPose('0');
    for (let frame = 0; frame < 30; frame++) for (let i = 0; i < 1536; i++) {
      controller.updateCharacterAnimation(String(i), dt, 'travel', 'walk', 0.3);
      expect(controller.getCurrentPose(String(i))).toBe(buffer);
    }
    for (let i = 0; i < 1536; i++) controller.release(String(i));
    expect(controller.trackedCharacters).toBe(0);
  });
});
