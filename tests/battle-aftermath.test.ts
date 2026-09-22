import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BattleAftermath, casualtyReceipts, MAX_BATTLE_BODIES, AFTERMATH_MONTHS } from '../src/render/war/BattleAftermath';
import { combatPose, engagementGap, figurePosition } from '../src/render/war/CombatChoreography';
import { militaryVisualStyle } from '../src/render/war/MilitaryVisualLanguage';
import { deriveMilitaryProfile } from '../src/sim/war/MilitaryCapability';
import type { HistoricalEvent } from '../src/sim/types';
import { WarRenderer } from '../src/render/war/WarRenderer';
import { warFixture } from './fixtures/war';

function fixture() {
  const f = warFixture('aftermath-contract');
  const war = f.declare();
  const style = militaryVisualStyle(deriveMilitaryProfile(f.a));
  const styles = [style, style] as const;
  const event: HistoricalEvent = { id: 'recorded-battle', type: 'battle', month: 1, actors: [war.id],
    location: { x: 8, z: 0 }, causes: [], context: { casualtiesA: 2, casualtiesB: 1, progress: 0 },
    outcome: '', affectedPopulation: 3, magnitude: 1, significance: 1, tags: [], summary: '' };
  return { ...f, war, styles, event };
}

describe('casualty-backed battlefield presentation', () => {
  it('requires finite recorded side losses, deduplicates events, and never renders more deaths than the event', () => {
    const { war, styles, event } = fixture();
    war.casualtiesA = 1000;
    expect(casualtyReceipts(war, [], 1, styles)).toEqual([]);
    const records = casualtyReceipts(war, [event, event], 1, styles);
    expect(records.filter(r => r.side === 0)).toHaveLength(2);
    expect(records.filter(r => r.side === 1)).toHaveLength(1);
    for (const losses of [0, -1, NaN, Infinity, '12', undefined]) {
      const invalid = { ...event, context: { casualtiesA: losses, casualtiesB: 0 } } as HistoricalEvent;
      expect(casualtyReceipts(war, [invalid], 1, styles)).toHaveLength(0);
    }
  });

  it('reconstructs stable representative identities, stays bounded, expires, and excludes future events after rewind', () => {
    const { war, styles, event } = fixture();
    const history = Array.from({ length: 100 }, (_, i) => ({ ...event, id: `battle-${i}`, month: i,
      context: { casualtiesA: 100, casualtiesB: 200 } }));
    const records = casualtyReceipts(war, history, 99, styles);
    expect(records.length).toBeLessThanOrEqual(MAX_BATTLE_BODIES);
    expect(records).toEqual(casualtyReceipts(structuredClone(war), structuredClone(history), 99, styles));
    expect(casualtyReceipts(war, history, 99 + AFTERMATH_MONTHS, styles)).toHaveLength(0);
    expect(casualtyReceipts(war, history, 2, styles).every(r => r.month <= 2)).toBe(true);
  });

  it('keeps remains after fighting, respects obstacles, and makes reduced motion static', () => {
    const { war, styles, event } = fixture();
    const aftermath = new BattleAftermath(() => 0);
    aftermath.sync(war, [event], 1, 0, styles);
    aftermath.update(1, 0.1, true, () => true);
    const bodies = aftermath.group.getObjectByName('Recorded fallen soldiers') as THREE.InstancedMesh;
    const first = bodies.instanceMatrix.array.slice();
    aftermath.update(1, 20, true, () => true);
    expect(bodies.instanceMatrix.array).toEqual(first);
    expect(bodies.count).toBe(3);
    expect((aftermath.group.getObjectByName('Casualty contact bursts') as THREE.InstancedMesh).count).toBe(0);
    aftermath.sync(war, [event], 4, 20, styles);
    aftermath.update(4, 20, false, () => true);
    expect(bodies.count).toBe(3);
    aftermath.update(4, 20, false, () => false);
    expect(bodies.count).toBe(0);
    aftermath.sync(war, [event], 13, 20, styles);
    expect(aftermath.records).toHaveLength(0);
    aftermath.dispose(); aftermath.dispose();
    expect(aftermath.group.children).toHaveLength(0);
  });

  it('keeps opposite formations in separate half-planes throughout attack poses', () => {
    const { styles } = fixture();
    for (const weapon of ['club', 'spear', 'bow', 'rifle', 'automatic'] as const) {
      const style = { ...styles[0], weapon };
      const gap = engagementGap([style, style]);
      for (let t = 0; t < 6; t += 0.07) for (let slot = 0; slot < 20; slot++) {
        const a = figurePosition({ x: 0, z: 0 }, 0, gap, style, 0, slot);
        const b = figurePosition({ x: 0, z: 0 }, 0, gap, style, 1, slot);
        const pa = combatPose(style, slot, 0, t, true, false);
        const pb = combatPose(style, slot, 1, t, true, false);
        expect(b.z - pb.advance - a.z - pa.advance).toBeGreaterThan(0.25);
      }
    }
  });

  it('gates muzzle flashes to firearms and freezes poses without motion while retaining equipment language', () => {
    const { styles } = fixture();
    for (const weapon of ['club', 'spear', 'bow', 'rifle', 'automatic'] as const) {
      const style = { ...styles[0], weapon };
      expect(combatPose(style, 1, 0, 2, false, false).flash).toBe(false);
      const reduced = combatPose(style, 1, 0, 2, true, true);
      expect(reduced.attack).toBe(0);
      expect(reduced.flight).toBe(-1);
      expect(reduced.flash).toBe(false);
      if (weapon === 'spear') expect(reduced.pitch).toBeGreaterThan(1);
      if (weapon === 'rifle') expect(reduced.pitch).toBeCloseTo(0);
    }
  });

  it('visualizes actual resolver events without altering any simulation state across phase changes', () => {
    const f = fixture();
    for (let i = 0; i < 70 && !f.state.history.some(e => e.type === 'battle'); i++) f.tick();
    expect(f.state.history.some(e => e.type === 'battle')).toBe(true);
    const renderer = new WarRenderer(f.state, () => 0);
    const before = JSON.stringify(f.state);
    for (const time of [0, 0.2, 0.8, 1.5, 9, 20]) renderer.update(0.016, time, f.war.id);
    renderer.update(0.1, 25, f.war.id, true);
    expect(JSON.stringify(f.state)).toBe(before);
    expect((renderer.group.getObjectByName('Recorded fallen soldiers') as THREE.InstancedMesh).count).toBeGreaterThan(0);
    renderer.dispose(); renderer.dispose();
  });
});
