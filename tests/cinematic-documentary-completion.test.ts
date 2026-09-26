import { describe, expect, it } from 'vitest';
import {
  documentaryMinimumHoldSeconds,
  documentaryShotShouldComplete,
} from '../src/render/CameraDirector';

describe('documentary shot completion', () => {
  it('never ends a meaningful action before the viewer has had time to read it', () => {
    expect(documentaryShotShouldComplete({
      mode: 'subject-action',
      role: 'detail',
      kind: 'worker-follow',
      ageSeconds: documentaryMinimumHoldSeconds('detail', 'worker-follow') - 0.01,
      durationSeconds: 20,
      settled: true,
      subjectPresent: true,
      actionProgress: 1,
      contactStrength: 1,
    })).toBe(false);
  });

  it('ends a detail shot when the observed action actually reaches contact or completion', () => {
    const base = {
      mode: 'subject-action' as const,
      role: 'detail' as const,
      kind: 'worker-follow' as const,
      ageSeconds: 9,
      durationSeconds: 20,
      settled: true,
      subjectPresent: true,
    };

    expect(documentaryShotShouldComplete({
      ...base,
      actionProgress: 0.5,
      contactStrength: 0.2,
    })).toBe(false);
    expect(documentaryShotShouldComplete({
      ...base,
      actionProgress: 0.87,
      contactStrength: 0.2,
    })).toBe(true);
    expect(documentaryShotShouldComplete({
      ...base,
      actionProgress: 0.4,
      contactStrength: 0.72,
    })).toBe(true);
  });

  it('lets an editorial beat finish once its composition has settled instead of waiting for an arbitrary timer', () => {
    const base = {
      mode: 'sequence-beat' as const,
      role: 'reveal' as const,
      kind: 'infrastructure-scene' as const,
      ageSeconds: 8,
      durationSeconds: 12,
    };

    expect(documentaryShotShouldComplete({ ...base, settled: false })).toBe(false);
    expect(documentaryShotShouldComplete({ ...base, settled: true })).toBe(true);
  });

  it('keeps explicit timed shots on their authored timing path', () => {
    expect(documentaryShotShouldComplete({
      mode: 'timed',
      role: 'release',
      kind: 'landscape-pause',
      ageSeconds: 100,
      durationSeconds: 12,
      settled: true,
    })).toBe(false);
  });

  it('can release a human shot cleanly when its subject is no longer present', () => {
    expect(documentaryShotShouldComplete({
      mode: 'subject-action',
      role: 'observe',
      kind: 'traveler-follow',
      ageSeconds: 8,
      durationSeconds: 16,
      settled: true,
      subjectPresent: false,
    })).toBe(true);
  });
});
