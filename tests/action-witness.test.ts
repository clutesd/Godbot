import { describe, expect, it } from 'vitest';
import { ActionWitness } from '../src/render/ActionWitness';
import { documentaryFramingFor } from '../src/render/CameraDirector';
import type { PhysicalActionPresentation } from '../src/render/people/PhysicalActionPresentation';

const action = (override: Partial<PhysicalActionPresentation> = {}): PhysicalActionPresentation => ({
  personId: 'builder', actionKind: 'construction-generalist', authoritativeActivity: 'construct',
  sourceAuthority: 'test', targetId: 'shelter', targetKind: 'workface',
  interactionAnchor: { x: 1, z: 0 }, locomotionTarget: { x: 1, z: 0 },
  phase: 'assemble', phaseProgress: 0.9, activeTool: 'hammer', contactStrength: 0, ...override,
});

describe('documentary action evidence', () => {
  it('does not finish at pickup, travel, or the end of a phase', () => {
    for (const phase of ['pickup', 'carry', 'deliver', 'inspect']) {
      const witness = new ActionWitness();
      expect(witness.observe(action({ phase, contactStrength: 1, phaseProgress: 1 }), 8)).toBe(false);
      expect(witness.observe(action({ phase, phaseProgress: 1 }), 12)).toBe(false);
    }
  });

  it('holds contact through follow-through and leaves time to read the result', () => {
    const witness = new ActionWitness();
    expect(witness.observe(action({ contactStrength: 1 }), 8)).toBe(false);
    expect(witness.observe(action({ contactStrength: 1 }), 10)).toBe(false);
    expect(witness.observe(action(), 10)).toBe(true);
    witness.reset();
    expect(witness.observe(action({ contactStrength: 1 }), 8)).toBe(false);
    expect(witness.observe(action(), 8.5)).toBe(false);
    expect(witness.observe(action(), 9.5)).toBe(true);
  });

  it('cannot reuse contact from another actor, project, blocked action, or shot', () => {
    for (const changed of [action({ targetId: 'other' }), action({ personId: 'other' }),
      action({ blockedReason: 'unsafe' }), undefined]) {
      const witness = new ActionWitness();
      witness.observe(action({ contactStrength: 1 }), 8);
      expect(witness.observe(changed, 10)).toBe(false);
      expect(witness.observe(action(), 12)).toBe(false);
    }
    const witness = new ActionWitness();
    witness.observe(action({ contactStrength: 1 }), 8);
    witness.reset();
    expect(witness.observe(action(), 12)).toBe(false);
  });

  it('turns planned scales into distinct physical compositions', () => {
    const detail = documentaryFramingFor('worker-follow', 'detail');
    const human = documentaryFramingFor('worker-follow', 'human');
    const medium = documentaryFramingFor('worker-follow', 'medium');
    expect(detail.radius[1]).toBeLessThan(human.radius[0]);
    expect(human.radius[1]).toBeLessThan(medium.radius[0]);
    expect(medium.height[0]).toBeGreaterThan(human.height[1]);
  });
});
