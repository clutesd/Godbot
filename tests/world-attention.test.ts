import { describe, expect, it } from 'vitest';
import type { Person, Settlement } from '../src/sim/types';
import { attentionLineClear, WorldAttentionPresentation, worldAttentionCues, WORLD_ATTENTION_CANDIDATE_CAP,
  type WorldAttentionCue } from '../src/render/people/WorldAttentionPresentation';
import type { RestSupportFootprint } from '../src/render/people/RestPresentation';

const resident = (id = 'observer') => ({ id, alive: true, health: 1, activity: 'travel',
  traits: { curiosity: 1 }, position: { x: 0, z: 0 } }) as Person;
const view = { x: 0, z: 0, facing: 0, speed: 0.3 };
const fire: WorldAttentionCue = { id: 'fire:house:10', structureId: 'house', kind: 'fire', x: 1, z: 1, radius: 4 };
const wall: RestSupportFootprint = { key: 'wall', worldX: 0.5, worldZ: 0.5, width: 0.4, depth: 0.4, rotationY: Math.PI / 4 };

describe('source-backed world attention', () => {
  it('notices an actual nearby fire with bounded head-led motion and remembers the incident', () => {
    const attention = new WorldAttentionPresentation(); attention.refresh([fire]);
    const person = resident(), before = JSON.stringify([person, view, fire]);
    let starts = 0, active = false, previousYaw = 0, noticed = false;
    for (let frame = 0; frame < 40 * 60; frame++) {
      attention.beginFrame(1 / 60);
      const s = attention.resolve(person, view, 1 / 60, []);
      if (s.targetId && !active) starts++;
      active = !!s.targetId;
      expect(Math.abs(s.headYaw - previousYaw)).toBeLessThanOrEqual(1.7 / 60 + 1e-9);
      expect(s.torsoYaw).toBe(0); // Walking retains locomotion orientation.
      expect(Math.abs(s.headYaw)).toBeLessThanOrEqual(0.7);
      noticed ||= s.headYaw > 0.4;
      previousYaw = s.headYaw;
    }
    expect(starts).toBe(1); expect(noticed).toBe(true); expect(previousYaw).toBe(0);
    expect(JSON.stringify([person, view, fire])).toBe(before);
  });

  it.each([
    ['distant', { ...fire, x: 8 }], ['behind', { ...fire, x: 0, z: -1 }],
  ])('ignores a %s cue', (_name, cue) => {
    const attention = new WorldAttentionPresentation(); attention.refresh([cue]);
    for (let i = 0; i < 120; i++) {
      attention.beginFrame(1 / 60);
      expect(attention.resolve(resident(), view, 1 / 60, []).targetId).toBeUndefined();
    }
  });

  it('checks rotated sight blockers while allowing a look at the target workface', () => {
    expect(attentionLineClear(view, fire, [wall])).toBe(false);
    expect(attentionLineClear(view, fire, [{ ...wall, key: 'house' }])).toBe(true);
    expect(attentionLineClear(view, fire, [{ ...wall, worldX: 3 }])).toBe(true);
    const attention = new WorldAttentionPresentation(); attention.refresh([fire]);
    for (let i = 0; i < 120; i++) {
      attention.beginFrame(1 / 60);
      expect(attention.resolve(resident(), view, 1 / 60, [wall]).targetId).toBeUndefined();
    }
  });

  it('releases attention when evidence disappears or a higher-priority pose takes over', () => {
    const attention = new WorldAttentionPresentation(); attention.refresh([fire]);
    for (let i = 0; i < 60; i++) { attention.beginFrame(1 / 60); attention.resolve(resident(), view, 1 / 60, []); }
    attention.refresh([]);
    attention.beginFrame(1 / 60);
    expect(attention.resolve(resident(), view, 1 / 60, []).targetId).toBeUndefined();
    attention.refresh([{ ...fire, id: 'fire:new:11' }]);
    for (let i = 0; i < 120; i++) {
      attention.beginFrame(1 / 60);
      const s = attention.resolve(resident(), view, 1 / 60, [], false);
      expect(s.targetId).toBeUndefined();
      if (i === 119) expect(s.headYaw).toBe(0);
    }
    attention.beginFrame(0); attention.prune(); expect(attention.size).toBe(0);
  });

  it('replays independently of cue/person order with capped perception and staggered onset', () => {
    const people = Array.from({ length: 24 }, (_, i) => resident(`observer-${i}`));
    const cues = Array.from({ length: 50 }, (_, i) => ({ ...fire, id: `fire:${i}` }));
    const run = (reverse: boolean) => {
      const layer = new WorldAttentionPresentation(); layer.refresh(reverse ? [...cues].reverse() : cues);
      const starts = new Map<string, number>();
      const trace: string[] = [];
      for (let frame = 0; frame < 120; frame++) {
        layer.beginFrame(1 / 60);
        const row = (reverse ? [...people].reverse() : people).map(p => {
          const s = layer.resolve(p, view, 1 / 60, []);
          if (s.targetId && !starts.has(p.id)) starts.set(p.id, frame);
          return `${p.id}:${s.targetId}:${s.headYaw}`;
        });
        trace.push(row.sort().join('|'));
      }
      expect(new Set(starts.values()).size).toBeGreaterThan(5);
      return trace;
    };
    expect(run(false)).toEqual(run(true));
    // Acquiring with 50 collocated cues remains bounded.
    const layer = new WorldAttentionPresentation();
    layer.refresh(cues);
    let acquired = false, inspected = false;
    for (let i = 0; i < 8; i++) {
      layer.beginFrame(0.1);
      const result = layer.resolve(resident('cap'), view, 0.1, []);
      acquired ||= !!result.targetId;
      inspected ||= result.candidatesChecked === WORLD_ATTENTION_CANDIDATE_CAP;
      expect(result.candidatesChecked ?? 0).toBeLessThanOrEqual(WORLD_ATTENTION_CANDIDATE_CAP);
    }
    expect(inspected).toBe(true); expect(acquired).toBe(true);
  });

  it('derives construction interest only from an unfinished project with an actual crew', () => {
    const person = { ...resident('builder'), homeId: 'town', activity: 'construct',
      navigation: { destinationId: 'site', schedulePhase: 'work', traveling: false } } as Person;
    const settlement = { id: 'town', alive: true, structurePlots: [],
      development: { project: { plotId: 'site', progress: 0.4, startedMonth: 3 } } } as unknown as Settlement;
    const site = { ...wall, key: 'site' };
    const placements = new Map([['town', [site]]]);
    const before = JSON.stringify([person, settlement, site]);
    expect(worldAttentionCues([settlement], [person], placements)).toEqual([
      { id: 'construction:site:3', structureId: 'site', kind: 'construction', x: 0.5, z: 0.5, radius: 2.4 },
    ]);
    expect(worldAttentionCues([settlement], [], placements)).toEqual([]);
    expect(JSON.stringify([person, settlement, site])).toBe(before);
    settlement.development!.project!.progress = 1;
    expect(worldAttentionCues([settlement], [person], placements)).toEqual([]);
  });

  it('uses the recorded fire identity across stage changes and forgets extinguished evidence', () => {
    const plot = { id: 'house', worldX: 1, worldZ: 1, fire: { startedMonth: 10, intensity: 0.5, stage: 'growing' } };
    const settlement = { id: 'town', alive: true, structurePlots: [plot] } as unknown as Settlement;
    const before = JSON.stringify(settlement);
    expect(worldAttentionCues([settlement], [], new Map())).toEqual([fire]);
    expect(JSON.stringify(settlement)).toBe(before);
    plot.fire.stage = 'involved';
    expect(worldAttentionCues([settlement], [], new Map())[0]!.id).toBe(fire.id);
    plot.fire.intensity = 0;
    expect(worldAttentionCues([settlement], [], new Map())).toEqual([]);
  });
});
