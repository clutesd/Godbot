import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AnimationController } from '../src/render/animation/AnimationController';
import { RestPoseRenderer, REST_SIT_SECONDS, REST_STAND_SECONDS, restJointPlan } from '../src/render/people/RestPoseRenderer';
import type { RestSpotPresentation } from '../src/render/people/RestPresentation';

const supported: RestSpotPresentation = {
  key: 'house:edge:0',
  destination: { x: 0, z: 0 },
  facing: 0,
  posture: 'supported-sit',
  support: 'structure-edge',
  supportKey: 'house',
};

describe('articulated rest pose', () => {
  it('folds hips and knees into a grounded seated silhouette instead of lowering rigid legs', () => {
    const standing = restJointPlan('supported-sit', 0);
    const seated = restJointPlan('supported-sit', 1);
    const ground = restJointPlan('ground-sit', 1);

    expect(standing.bodyLift).toBe(0);
    expect(seated.bodyLift).toBeLessThan(-0.2);
    expect(seated.left.kneeZ).toBeGreaterThan(0.2);
    expect(seated.left.kneeY).toBeLessThan(0.12);
    expect(seated.left.ankleY).toBeCloseTo(0.02);
    expect(seated.left.ankleZ).toBeGreaterThan(seated.left.kneeZ);
    expect(seated.left.handY).toBeLessThan(seated.left.elbowY);

    expect(ground.left.kneeX).toBeGreaterThan(seated.left.kneeX);
    expect(ground.bodyLift).toBeLessThan(seated.bodyLift);
    expect(ground.bodyPitch).toBeGreaterThan(seated.bodyPitch);
  });

  it('supports asymmetric bracing and ground-rest silhouettes instead of cloning one seated pose', () => {
    const braceLeft = restJointPlan('supported-sit', 1, 'supported-brace-left');
    const braceRight = restJointPlan('supported-sit', 1, 'supported-brace-right');
    const sideGround = restJointPlan('ground-sit', 1, 'ground-side-left');

    expect(braceLeft.left.handY).toBeLessThan(braceLeft.right.handY);
    expect(braceRight.right.handY).toBeLessThan(braceRight.left.handY);
    expect(braceLeft.left.handZ).toBeLessThan(0);
    expect(sideGround.left.kneeX).toBeGreaterThan(sideGround.right.kneeX);
    expect(sideGround.left.ankleX).toBeGreaterThan(sideGround.right.ankleX);
  });

  it('leans into the settle and rise beats while keeping attention as restrained upper-body motion', () => {
    const settle = restJointPlan('supported-sit', 0.55, 'supported-brace-left', 'settling', 1);
    const rise = restJointPlan('supported-sit', 0.55, 'supported-knees', 'rising', 1);
    const attentive = restJointPlan('ground-sit', 1, 'ground-open', 'settled', 0, 0.003, 0.42);

    expect(settle.bodyPitch).toBeGreaterThan(restJointPlan('supported-sit', 0.55).bodyPitch);
    expect(rise.bodyPitch).toBeGreaterThan(settle.bodyPitch);
    expect(attentive.headYaw).toBeGreaterThan(attentive.bodyYaw);
    expect(Math.abs(attentive.bodyYaw)).toBeLessThan(0.06);
  });

  it('eases into rest, remains anchored while rising, then releases the presentation state', () => {
    const renderer = new RestPoseRenderer(2);
    renderer.beginFrame();
    let visual = renderer.resolve('resident', supported, 'settling', 0);
    renderer.endFrame();
    expect(visual.blend).toBe(0);

    let elapsed = 0;
    while (elapsed < REST_SIT_SECONDS + 0.08) {
      renderer.beginFrame();
      visual = renderer.resolve('resident', supported, 'settling', 1 / 60);
      renderer.endFrame();
      elapsed += 1 / 60;
    }
    expect(visual.blend).toBeGreaterThan(0.99);
    expect(visual.bodyLift).toBeLessThan(-0.2);

    renderer.beginFrame();
    visual = renderer.resolve('resident', supported, 'settled', 1 / 60, 360, 0.3);
    renderer.endFrame();
    expect(visual.stage).toBe('settled');

    elapsed = 0;
    while (elapsed < REST_STAND_SECONDS + 0.08) {
      renderer.beginFrame();
      visual = renderer.resolve('resident', supported, 'rising', 1 / 60);
      renderer.endFrame();
      elapsed += 1 / 60;
    }
    expect(visual.blend).toBeLessThan(0.01);
    expect(renderer.get('resident')?.spot?.key).toBe(supported.key);

    renderer.beginFrame();
    visual = renderer.resolve('resident', undefined, undefined, 1 / 60);
    renderer.endFrame();
    expect(renderer.get('resident')).toBeUndefined();
    renderer.dispose();
  });

  it('emits two-part arms, two-part legs and grounded soles from one bounded instanced batch', () => {
    const renderer = new RestPoseRenderer(2);
    const visual = restJointPlan('supported-sit', 1, 'supported-brace-left');
    const restVisual = { ...visual, spot: supported, stage: 'settled' as const, style: 'supported-brace-left' as const };
    renderer.beginFrame();
    renderer.resolve('resident', supported, 'settled', REST_SIT_SECONDS);
    renderer.draw(restVisual, 3, 2, 1, 0.32, 1, 0.4, 0.08, new THREE.Color('white'));
    renderer.endFrame();

    const mesh = renderer.group.getObjectByName('Resting person joints') as THREE.InstancedMesh;
    expect(mesh.count).toBe(10);
    const matrix = new THREE.Matrix4();
    const thigh = new THREE.Vector3(), shin = new THREE.Vector3(), foot = new THREE.Vector3();
    mesh.getMatrixAt(4, matrix); thigh.setFromMatrixPosition(matrix);
    mesh.getMatrixAt(5, matrix); shin.setFromMatrixPosition(matrix);
    mesh.getMatrixAt(8, matrix); foot.setFromMatrixPosition(matrix);

    expect(thigh.y).toBeGreaterThan(shin.y);
    expect(shin.y).toBeGreaterThan(foot.y);
    expect(foot.y).toBeCloseTo(2 + 0.02 * 0.32, 2);
    expect(mesh.instanceColor).not.toBeNull();
    renderer.dispose();
  });

  it('keeps the rest animation quiet while preserving readable seated posture values', () => {
    const controller = new AnimationController('rest-test');
    controller.getOrCreateCharacterState('resident', 'elder');
    for (let frame = 0; frame < 60; frame++) {
      controller.updateCharacterAnimation('resident', 1 / 60, 'rest', 'rest', 0, 840);
      controller.getCurrentPose('resident');
    }
    const head: number[] = [];
    for (let frame = 0; frame < 20 * 60; frame++) {
      controller.updateCharacterAnimation('resident', 1 / 60, 'rest', 'rest', 0, 840);
      const pose = controller.getCurrentPose('resident')!;
      head.push(pose.headRotation);
      expect(pose.leftHipRotation).toBeGreaterThan(0.6);
      expect(pose.leftKneeRotation).toBeGreaterThan(0.8);
      expect(pose.positionOffset.y).toBeLessThan(-0.2);
    }
    expect(Math.max(...head) - Math.min(...head)).toBeLessThan(0.2);
  });
});
