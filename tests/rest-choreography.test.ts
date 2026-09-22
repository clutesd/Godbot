import { describe, expect, it } from 'vitest';
import {
  restAttentionWindow,
  restPreferenceFor,
  restStyleFor,
  restTransitionSeconds,
} from '../src/render/people/RestChoreography';

describe('rest choreography language', () => {
  it('is deterministic per person while producing multiple readable posture families', () => {
    expect(restStyleFor('resident-a', 'supported-sit')).toBe(restStyleFor('resident-a', 'supported-sit'));
    expect(restStyleFor('resident-a', 'ground-sit')).toBe(restStyleFor('resident-a', 'ground-sit'));

    const supported = new Set(Array.from({ length: 30 }, (_, i) => restStyleFor(`supported-${i}`, 'supported-sit')));
    const ground = new Set(Array.from({ length: 30 }, (_, i) => restStyleFor(`ground-${i}`, 'ground-sit')));
    expect(supported.size).toBeGreaterThanOrEqual(3);
    expect(ground.size).toBeGreaterThanOrEqual(3);
  });

  it('gives children ground-biased rest and elders support-biased rest without changing authority', () => {
    expect(restPreferenceFor('child', 10 * 12)).toBe('ground');
    expect(restPreferenceFor('elder', 72 * 12)).toBe('supported');

    const adultPreferences = new Set(Array.from({ length: 40 }, (_, i) => restPreferenceFor(`adult-${i}`, 35 * 12)));
    expect(adultPreferences.has('mixed')).toBe(true);
    expect(adultPreferences.has('ground')).toBe(true);
  });

  it('slows settle and rise slightly for older residents', () => {
    expect(restTransitionSeconds('settling', 75 * 12)).toBeGreaterThan(restTransitionSeconds('settling', 35 * 12));
    expect(restTransitionSeconds('rising', 75 * 12)).toBeGreaterThan(restTransitionSeconds('rising', 35 * 12));
  });

  it('uses sparse attention windows instead of constant seated fidgeting', () => {
    const samples = Array.from({ length: 600 }, (_, i) => restAttentionWindow('resident', i / 30));
    const active = samples.filter(value => value > 0.001).length;
    expect(active).toBeGreaterThan(10);
    expect(active).toBeLessThan(samples.length * 0.35);
    expect(Math.max(...samples)).toBeGreaterThan(0.9);
  });
});
