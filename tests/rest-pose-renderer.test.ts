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
    expect(seated.kneeZ).toBeGreaterThan(0.2);
    expect(seated.kneeY).toBeLessThan(0.12);
    expect(seated.ankleY).toBeCloseTo(0.02);
    expect(seated.ankleZ).toBeGreaterThan(seated.kneeZ);
    expect(seated.handY).toBeLessThan(seated.elbowY);

    // Ground sitting is visibly looser/wider than structure-supported rest.
    expect(ground.kneeX).toBeGreaterThan(seated.kneeX);
    expect(ground.bodyLift).toBeLessThan(seated.bodyLift);
    expect(ground.bodyPitch).toBeGreaterThan(seated.bodyPitch);
  });

  it('eases into and out of physical rest over presentation time', () => {
    const renderer = new RestPoseRenderer(2);
    renderer.beginFrame();
    let visual = renderer.resolve('resident', supported, true, 0);
    renderer.endFrame();
    expect(visual.blend).toBe(0);

    let elapsed = 0;
    while (elapsed < REST_SIT_SECONDS + 0.08) {
      renderer.beginFrame();
      visual = renderer.resolve('resident', supported, true, 1 / 60);
      renderer.endFrame();
      elapsed += 1 / 60;
    }
    expect(visual.blend).toBeGreaterThan(0.99);
    expect(visual.bodyLift).toBeLessThan(-0.2);

    elapsed = 0;
    while (elapsed < REST_STAND_SECONDS + 0.08) {
      renderer.beginFrame();
      visual = renderer.resolve('resident', undefined, false, 1 / 60);
      renderer.endFrame();
      elapsed += 1 / 60;
    }
    expect(visual.blend).toBeLessThan(0.01);
    expect(renderer.get('resident')?.spot).toBeUndefined();
    renderer.dispose();
  });

  it('emits two-part arms, two-part legs and grounded soles from one bounded instanced batch', () => {
    const renderer = new RestPoseRenderer(2);
    let visual = restJointPlan('supported-sit', 1);
    const restVisual = { ...visual, spot: supported };
    renderer.beginFrame();
    renderer.resolve('resident', supported, true, REST_SIT_SECONDS);
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
