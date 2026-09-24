import { describe, expect, it } from 'vitest';
import {
  createFoundingHearthEmbers,
  createFoundingHearthFlameRig,
  updateFoundingHearthFireMotion,
} from '../src/render/founding/FoundingHearthVisual';

describe('founding hearth visual rig', () => {
  it('builds a restrained layered fire with deterministic tongues, sparks, and embers', () => {
    const first = createFoundingHearthFlameRig('hearth:test');
    const second = createFoundingHearthFlameRig('hearth:test');
    const embers = createFoundingHearthEmbers('hearth:test');

    const tongues = first.children.filter(child => child.userData['hearthFlameTongue']);
    const sparks = first.children.filter(child => child.userData['hearthSpark']);
    expect(tongues).toHaveLength(6);
    expect(sparks).toHaveLength(7);
    expect(embers.children.filter(child => child.userData['hearthEmber'])).toHaveLength(9);

    const firstTongue = tongues[0]!;
    const secondTongue = second.children.find(child => child.userData['hearthFlameTongue'])!;
    expect(firstTongue.position.x).toBeCloseTo(secondTongue.position.x, 8);
    expect(firstTongue.position.y).toBeCloseTo(secondTongue.position.y, 8);
    expect(firstTongue.position.z).toBeCloseTo(secondTongue.position.z, 8);
  });

  it('animates flame detail in real time but becomes static for reduced motion', () => {
    const rig = createFoundingHearthFlameRig('hearth:motion');
    const embers = createFoundingHearthEmbers('hearth:motion');
    const tongue = rig.children.find(child => child.userData['hearthFlameTongue'])!;
    const spark = rig.children.find(child => child.userData['hearthSpark'])!;

    updateFoundingHearthFireMotion(rig, embers, 1, false);
    const animated = [tongue.position.x, tongue.position.y, tongue.position.z, tongue.rotation.x, tongue.rotation.z, tongue.scale.y];
    updateFoundingHearthFireMotion(rig, embers, 1.2, false);
    const advanced = [tongue.position.x, tongue.position.y, tongue.position.z, tongue.rotation.x, tongue.rotation.z, tongue.scale.y];
    expect(advanced).not.toEqual(animated);
    expect(spark.visible).toBe(true);

    updateFoundingHearthFireMotion(rig, embers, 2, true);
    expect(tongue.rotation.x).toBe(0);
    expect(tongue.rotation.z).toBe(0);
    expect(tongue.scale.x).toBe(1);
    expect(tongue.scale.y).toBe(1);
    expect(tongue.scale.z).toBe(1);
    expect(spark.visible).toBe(false);
  });
});
