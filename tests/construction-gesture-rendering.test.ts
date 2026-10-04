import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createResourceWorkMotion } from '../src/render/animation/ResourceWorkMotion';
import { sampleConstructionAction } from '../src/render/construction/ConstructionActionPresentation';
import { ResourceWorkerRenderer } from '../src/render/resources/ResourceWorkerRenderer';
import type { Person } from '../src/sim/types';
import type { StructureMaterial } from '../src/sim/development/types';
import { constructionBodyPitch } from '../src/render/construction/ConstructionGesture';

const person = { id: 'builder-gesture', activity: 'construct' } as Person;
const anchors = { pickup: { x: 1, z: 0 }, delivery: { x: 0, z: 0 }, handoff: { x: 0, z: -0.22 },
  materialCenter: { x: 1.13, z: 0 }, siteCenter: { x: 0, z: 0.3 }, prep: { x: -1, z: 0 }, prepCenter: { x: -1, z: 0.13 },
  workContact: { x: 0, z: 0.3 }, contactHeight: 0.18, platformHeight: 0 };
const scale = 0.28;

function matrix(renderer: ResourceWorkerRenderer, name: string, index = 0) {
  const mesh = renderer.group.getObjectByName(name) as THREE.InstancedMesh;
  const value = new THREE.Matrix4(); mesh.getMatrixAt(index, value); return value;
}
function position(renderer: ResourceWorkerRenderer, name: string, index = 0) {
  return new THREE.Vector3().setFromMatrixPosition(matrix(renderer, name, index));
}
function endpoint(renderer: ResourceWorkerRenderer, index: number) {
  // Work limbs are cylinders of unit height; +Y end is the hand for forearm segments.
  return new THREE.Vector3(0, 0.5, 0).applyMatrix4(matrix(renderer, 'Resource worker joints', index));
}
function draw(renderer: ResourceWorkerRenderer, p: number, material: StructureMaterial = 'timber', progress = 0.3, carrying = false) {
  const motion = createResourceWorkMotion();
  const action = sampleConstructionAction(person, 'plot', { phase: 'assemble', seconds: p * 1.8, carrying },
    anchors, material, motion, undefined, 'assembler', 2, progress);
  renderer.beginFrame();
  renderer.drawPhysical(motion, action.interactionAnchor, action.activeTool, action.carriedObject,
    '#987149', 1, 0, 0, 0, scale, 0, new THREE.Color('#333333'), false, true, false,
    action.contactEffect ?? 'none', action.contactHeight);
  renderer.endFrame();
  return { action, motion };
}

describe('builder animation as rendered, at the production human scale', () => {
  it('keeps a waiting assembler attentive without inventing a load, tool, or productive contact', () => {
    const motions = [0, 0.65, 1.3].map(seconds => {
      const motion = createResourceWorkMotion();
      const action = sampleConstructionAction(person, 'plot', { phase: 'assemble', seconds: 0, carrying: false },
        anchors, 'timber', motion, undefined, 'assembler', 2, 0.3, undefined, 'early', true, seconds);
      expect(action.activeTool).toBe('none');
      expect(action.carriedObject).toBeUndefined();
      expect(action.contactStrength).toBe(0);
      expect(action.contactEffect).toBeUndefined();
      return motion;
    });
    expect(new Set(motions.map(m => JSON.stringify(m))).size).toBe(3);
  });
  it('loads the torso backwards for anticipation and drives it toward the workface on contact', () => {
    const renderer = new ResourceWorkerRenderer();
    const anticipation = draw(renderer, 0.3).motion;
    const contact = draw(renderer, 0.415).motion;
    const shoulder = (motion: typeof contact) => new THREE.Vector3(0, 0.27, 0)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), constructionBodyPitch(motion, 1));
    expect(shoulder(anticipation).z).toBeLessThan(0);
    expect(shoulder(contact).z).toBeGreaterThan(0.08);
    expect(constructionBodyPitch(contact, 0)).toBe(0);
  });
  it('shows a large anticipation arc, exact downstroke contact, and a separate stationary bracing hand', () => {
    const renderer = new ResourceWorkerRenderer();
    draw(renderer, 0.3);
    const raised = position(renderer, 'Resource worker axe and pick heads');
    const braceRaised = endpoint(renderer, 1);
    const handRaised = endpoint(renderer, 3);
    const feet = [matrix(renderer, 'Resource worker joints', 8).toArray(), matrix(renderer, 'Resource worker joints', 9).toArray()];
    const { action } = draw(renderer, 0.415);
    const contact = position(renderer, 'Resource worker axe and pick heads');
    expect(raised.y - contact.y).toBeGreaterThan(scale * 0.5);
    expect(contact.distanceTo(new THREE.Vector3(0, anchors.contactHeight, anchors.workContact.z))).toBeLessThan(1e-6);
    expect(action.contactStrength).toBeGreaterThan(0.9);
    expect(position(renderer, 'Resource and construction contact fragments').distanceTo(contact)).toBeLessThan(0.04);
    expect(endpoint(renderer, 1).distanceTo(braceRaised)).toBeLessThan(1e-6);
    expect(endpoint(renderer, 3).distanceTo(handRaised)).toBeGreaterThan(scale * 0.3);
    expect([matrix(renderer, 'Resource worker joints', 8).toArray(), matrix(renderer, 'Resource worker joints', 9).toArray()]).toEqual(feet);
    draw(renderer, 0.8);
    expect(position(renderer, 'Resource worker axe and pick heads').y).toBeGreaterThan(contact.y);
  });

  it('visibly lifts and seats a received load instead of attaching it to the hammer', () => {
    const renderer = new ResourceWorkerRenderer();
    draw(renderer, 0.05, 'timber', 0.3, true);
    const from = position(renderer, 'Carried timber');
    draw(renderer, 0.4, 'timber', 0.3, true);
    const to = position(renderer, 'Carried timber');
    expect(to.distanceTo(new THREE.Vector3(0, anchors.contactHeight, anchors.workContact.z))).toBeLessThan(1e-6);
    expect(from.distanceTo(to)).toBeGreaterThan(0.15);
    draw(renderer, 0.3, 'timber', 0.3, true);
    expect(position(renderer, 'Carried timber').distanceTo(position(renderer, 'Resource worker axe and pick heads'))).toBeGreaterThan(0.1);
  });

  it('uses the same physical transfer point for giver and receiver', () => {
    const renderer = new ResourceWorkerRenderer();
    const points: THREE.Vector3[] = [];
    for (const receiving of [false, true]) {
      const motion = createResourceWorkMotion();
      const action = sampleConstructionAction(person, 'plot', { phase: receiving ? 'assemble' : 'handoff', seconds: 0.51 * 0.9, carrying: !receiving },
        anchors, 'timber', motion, undefined, receiving ? 'assembler' : 'hauler', 2, 0.3,
        receiving ? { sourcePersonId: 'hauler', progress: 0.52, material: 'timber' } : undefined);
      renderer.beginFrame();
      const z = receiving ? anchors.delivery.z : anchors.handoff.z;
      renderer.drawPhysical(motion, action.interactionAnchor, 'none', action.carriedObject, '#987149', 1,
        0, 0, z, scale, receiving ? Math.PI : 0, new THREE.Color('#333333'), false, false, false, 'none');
      renderer.endFrame();
      points.push(position(renderer, 'Carried timber'));
    }
    expect(points[0]!.distanceTo(points[1]!)).toBeLessThan(1e-6);
  });

  it.each(['ceramic', 'earth', 'masonry', 'metal'] as const)('keeps %s placement/contact visible and deterministic', material => {
    const renderer = new ResourceWorkerRenderer();
    const samples = [0.1, 0.3, 0.415, 0.8].map(p => {
      const { motion, action } = draw(renderer, p, material);
      return { motion, action, hands: [endpoint(renderer, 1).toArray(), endpoint(renderer, 3).toArray()] };
    });
    expect(new Set(samples.map(s => JSON.stringify(s.hands))).size).toBe(4);
    expect(samples[2]!.action.contactStrength).toBeGreaterThan(0.1);
    samples.forEach((sample, i) => {
      const repeated = draw(renderer, [0.1, 0.3, 0.415, 0.8][i]!, material);
      expect(repeated).toEqual({ motion: sample.motion, action: sample.action });
    });
  });
  it.each(['timber', 'ceramic', 'earth', 'masonry', 'metal'] as const)('returns %s hands smoothly to the next cycle instead of snapping', material => {
    const renderer = new ResourceWorkerRenderer();
    draw(renderer, 0.9999, material);
    const end = [endpoint(renderer, 1), endpoint(renderer, 3)];
    draw(renderer, 0, material);
    expect(endpoint(renderer, 1).distanceTo(end[0]!)).toBeLessThan(0.001);
    expect(endpoint(renderer, 3).distanceTo(end[1]!)).toBeLessThan(0.001);
  });
});
