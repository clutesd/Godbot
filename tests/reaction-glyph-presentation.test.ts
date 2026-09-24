import { describe, expect, it } from 'vitest';
import type { LocalActivityState } from '../src/render/people/LocalActivityPresentation';
import { REACTION_GLYPH_BUDGET, reactionGlyphCueFor, type ReactionGlyphEvidence } from '../src/render/people/ReactionGlyphRenderer';

function person(id = 'a'): ReactionGlyphEvidence['person'] {
  return {
    id,
    activity: 'socialize',
    navigation: {
      destinationKind: 'plaza',
      destinationId: 'plaza',
      schedulePhase: 'social',
      traveling: false,
      reason: 'test',
      waypoints: [],
      waypointIndex: 0,
    },
  };
}

function local(overrides: Partial<LocalActivityState>): LocalActivityState {
  return {
    authority: 'test',
    revision: 0,
    seen: 1,
    base: { x: 0, z: 0 },
    points: [],
    focus: { x: 0, z: 0 },
    stationFocus: { x: 0, z: 0 },
    destination: { x: 0, z: 0 },
    restFacing: 0,
    animation: 'converse',
    action: 'brief-conversation',
    phase: 'action',
    step: 0,
    cycle: 0,
    sample: 0,
    seconds: 0,
    hold: 1,
    ...overrides,
  };
}

describe('reaction glyph evidence', () => {
  it('keeps the global presentation budget deliberately tiny', () => {
    expect(REACTION_GLYPH_BUDGET).toBe(4);
  });

  it('uses fire only for an actually staged First Fire tender', () => {
    const p = person();
    const cue = reactionGlyphCueFor({
      person: p,
      firstFire: {
        x: 0,
        z: 0,
        eventId: 'first-fire',
        role: 'tender',
        animation: 'gather',
        restFacing: 0,
        phaseProgress: 0.5,
      },
    });
    expect(cue).toMatchObject({ glyph: '🔥', reason: 'first-fire' });
  });

  it('maps grounded social beats to support, joy, affection and tension without generic mood guessing', () => {
    const p = person('a');
    const baseEncounter = {
      partnerId: 'b',
      relationshipId: 'rel',
      strength: 0.8,
      trust: 0.8,
      beat: 1,
      role: 'peer' as const,
    };

    expect(reactionGlyphCueFor({ person: p, local: local({
      action: 'reassurance',
      encounter: { ...baseEncounter, tone: 'supportive', relationshipKind: 'friend' },
    }) })?.glyph).toBe('🥺');

    expect(reactionGlyphCueFor({ person: p, local: local({
      action: 'small-shared-laugh',
      encounter: { ...baseEncounter, tone: 'warm', relationshipKind: 'friend' },
    }) })?.glyph).toBe('😊');

    expect(reactionGlyphCueFor({ person: p, local: local({
      action: 'warm-conversation',
      encounter: { ...baseEncounter, tone: 'warm', relationshipKind: 'family' },
    }) })?.glyph).toBe('❤️');

    expect(reactionGlyphCueFor({ person: p, local: local({
      action: 'guarded-exchange',
      encounter: { ...baseEncounter, tone: 'tense', relationshipKind: 'rival' },
    }) })?.glyph).toBe('😡');
  });

  it('shows timber only for real timber gathering evidence', () => {
    const p = person();
    p.activity = 'gather';
    expect(reactionGlyphCueFor({ person: p, resourceKind: 'timber' })?.glyph).toBe('🪵');
    expect(reactionGlyphCueFor({ person: p, resourceKind: 'mineral' })).toBeUndefined();
  });

  it('suppresses glyphs in emergency or serious documentary shots', () => {
    const p = person();
    const warm = local({
      action: 'small-shared-laugh',
      encounter: {
        partnerId: 'b',
        relationshipId: 'rel',
        strength: 0.8,
        trust: 0.8,
        beat: 2,
        role: 'peer',
        tone: 'warm',
        relationshipKind: 'friend',
      },
    });
    expect(reactionGlyphCueFor({ person: p, local: warm, seriousShot: true })).toBeUndefined();
    p.navigation!.schedulePhase = 'emergency';
    expect(reactionGlyphCueFor({ person: p, local: warm })).toBeUndefined();
  });

  it('emits pair-level affection and tension from only one side to avoid duplicate bubbles', () => {
    const first = person('a');
    const second = person('z');
    const encounter = {
      partnerId: 'z',
      relationshipId: 'rel',
      strength: 0.8,
      trust: 0.8,
      beat: 1,
      role: 'peer' as const,
      tone: 'warm' as const,
      relationshipKind: 'friend' as const,
    };
    expect(reactionGlyphCueFor({ person: first, local: local({ action: 'linger-together', encounter }) })?.glyph).toBe('❤️');
    expect(reactionGlyphCueFor({
      person: second,
      local: local({ action: 'linger-together', encounter: { ...encounter, partnerId: 'a' } }),
    })).toBeUndefined();
  });
});
