import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { casualtyLifecycle, casualtyReceipts, MAX_BATTLE_BODIES } from '../src/render/war/BattleAftermath';
import { createCombatExchanges, exchangeFigurePose, exchangeImpactAt, exchangePhase, formationCount } from '../src/render/war/CombatExchanges';
import { engagementGap } from '../src/render/war/CombatChoreography';
import { militaryVisualStyle } from '../src/render/war/MilitaryVisualLanguage';
import { deriveMilitaryProfile, militaryProfileForWar } from '../src/sim/war/MilitaryCapability';
import { WarRenderer } from '../src/render/war/WarRenderer';
import { warFixture } from './fixtures/war';
import type { HistoricalEvent } from '../src/sim/types';

function fixture() {
  const f = warFixture('exchange-contract');
  const war = f.declare();
  const styles = [militaryVisualStyle(militaryProfileForWar(war, 'attacker') ?? deriveMilitaryProfile(f.a)),
    militaryVisualStyle(militaryProfileForWar(war, 'defender') ?? deriveMilitaryProfile(f.b))] as const;
  const event: HistoricalEvent = { id: 'exchange-event', type: 'battle', month: 1, actors: [war.id],
    location: { x: 8.32, z: 0 }, causes: [], context: { casualtiesA: 16, casualtiesB: 16, progress: 0 },
    outcome: '', affectedPopulation: 32, magnitude: 1, significance: 1, tags: [], summary: '' };
  return { ...f, war, styles, event };
}

describe('deterministic combat exchanges and continuous casualties', () => {
  it('keeps unique partners and phase identity independent of frame sampling', () => {
    const { styles } = fixture();
    const plan = createCombatExchanges('battle', { x: 0, z: 0 }, 0.7, engagementGap(styles), styles, [20, 20]);
    for (const side of [0, 1]) expect(new Set(plan.exchanges.map(e => e.slots[side])).size).toBe(plan.exchanges.length);
    const expected = exchangeFigurePose(plan, 0, 0, 1.17, true, false);
    for (const t of [3, 0, 0.1, 2, 10]) exchangeFigurePose(plan, 0, 0, t, true, false);
    expect(exchangeFigurePose(plan, 0, 0, 1.17, true, false)).toEqual(expected);
    expect(plan).toEqual(createCombatExchanges('battle', { x: 0, z: 0 }, 0.7, engagementGap(styles), styles, [20, 20]));
    const phases = new Set<string>();
    for (let t = 0; t < 8; t += 0.03) phases.add(exchangePhase(plan, plan.exchanges[0]!, t).phase);
    expect(phases).toEqual(new Set(['approach', 'windup', 'contact', 'recoil', 'recover']));
  });

  it('aims melee contact at its partner and braces that defender while retaining spacing', () => {
    const { styles } = fixture();
    for (const weapon of ['club', 'spear'] as const) {
      const style = { ...styles[0], weapon };
      const plan = createCombatExchanges('contact', { x: 0, z: 0 }, 0, engagementGap([style, style]), [style, style], [20, 20]);
      for (const exchange of plan.exchanges) for (const targetSide of [0, 1] as const) {
        const attackerSide = 1 - targetSide;
        const t = exchangeImpactAt(plan, exchange, targetSide);
        const attack = exchangeFigurePose(plan, attackerSide, exchange.slots[attackerSide]!, t, true, false);
        const target = exchangeFigurePose(plan, targetSide, exchange.slots[targetSide], t, true, false);
        expect(target.pose.brace).toBeGreaterThan(0.95);
        const tipLength = (weapon === 'spear' ? 0.25 : 0.12) * Math.sin(attack.pose.pitch);
        const tip = { x: attack.position.x + Math.sin(attack.yaw) * (attack.pose.reach + tipLength),
          z: attack.position.z + Math.cos(attack.yaw) * (attack.pose.reach + tipLength) };
        expect(Math.hypot(tip.x - target.position.x, tip.z - target.position.z)).toBeLessThan(0.085);
        expect(Math.hypot(attack.position.x - target.position.x, attack.position.z - target.position.z)).toBeGreaterThan(0.25);
      }
      // Melee reserves have no phantom attacker reaching through their own front rank.
      expect(exchangeFigurePose(plan, 0, 19, 1, true, false).pose.attack).toBe(0);
    }
  });

  it('samples all visible ranks without replacement, scales modestly, and retains the global cap', () => {
    const { war, styles, event } = fixture();
    const slots = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const records = casualtyReceipts(war, [{ ...event, id: `event-${i}` }], 1, styles);
      for (const side of [0, 1]) {
        const selected = records.filter(r => r.side === side);
        expect(new Set(selected.map(r => r.slot)).size).toBe(selected.length);
        expect(selected).toHaveLength(5);
        selected.forEach(r => slots.add(r.slot));
      }
    }
    expect(slots.size).toBe(formationCount(war.campaign.initialStrengthA));
    let previous = 0;
    for (const losses of [1, 2, 4, 16, 128, 100000]) {
      const records = casualtyReceipts(war, [{ ...event, context: { casualtiesA: losses, casualtiesB: 0 } }], 1, styles);
      expect(records.length).toBeGreaterThanOrEqual(previous);
      expect(records.length).toBeLessThanOrEqual(Math.min(8, losses));
      previous = records.length;
    }
    const history = Array.from({ length: 20 }, (_, i) => ({ ...event, id: `history-${i}`, month: i }));
    expect(casualtyReceipts(war, history, 19, styles).length).toBeLessThanOrEqual(MAX_BATTLE_BODIES);
    const original = casualtyReceipts(war, [event], 1, styles);
    war.strengthA = 0; war.strengthB = 0;
    expect(casualtyReceipts(war, [event], 1, styles)).toEqual(original);
  });

  it('has an identity hit transform and progresses monotonically into a static corpse', () => {
    expect(casualtyLifecycle(0, false)).toMatchObject({ phase: 'hit', fall: 0, retreat: 0, reaction: 0, settle: 0 });
    expect(casualtyLifecycle(0.2, false).phase).toBe('stagger');
    expect(casualtyLifecycle(0.8, false).phase).toBe('fall');
    expect(casualtyLifecycle(2, false).phase).toBe('corpse');
    expect(casualtyLifecycle(2, false)).toEqual(casualtyLifecycle(100, false));
    expect(casualtyLifecycle(0, true)).toEqual(casualtyLifecycle(100, true));
    let fall = 0;
    for (let t = 0; t < 2; t += 0.01) {
      const next = casualtyLifecycle(t, false).fall;
      expect(next).toBeGreaterThanOrEqual(fall); fall = next;
    }
  });

  it('keeps every casualty in the same company mesh and preserves its exact impact transform', () => {
    const f = fixture();
    f.state.month = 1; f.state.history.push(f.event);
    f.war.phase = 'battle'; f.war.campaign.battleCount = 1; f.war.campaign.lastBattleMonth = 1;
    const records = casualtyReceipts(f.war, f.state.history, 1, f.styles);
    const renderer = new WarRenderer(f.state, () => 0);
    const before = JSON.stringify(f.state);
    renderer.update(0, 0, f.war.id);
    const mesh = renderer.group.getObjectByName('Campaign soldiers 0') as THREE.InstancedMesh;
    const geometry = mesh.geometry, material = mesh.material;
    // Match the pre/post hit body by location, not its transient packed instance index.
    const nearest = (side: number, x: number, z: number) => {
      const body = renderer.group.getObjectByName(`Campaign soldiers ${side}`) as THREE.InstancedMesh;
      let distance = Infinity, best = new THREE.Matrix4();
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < body.count; i++) {
        body.getMatrixAt(i, matrix);
        const d = Math.hypot(matrix.elements[12]! - x, matrix.elements[14]! - z);
        if (d < distance) { best = matrix.clone(); distance = d; }
      }
      expect(distance).toBeLessThan(0.001);
      return best;
    };
    for (const record of records) {
      renderer.update(0, record.impactAt - 0.000001, f.war.id);
      const live = nearest(record.side, record.position.x, record.position.z);
      renderer.update(0, record.impactAt, f.war.id);
      const hit = nearest(record.side, record.position.x, record.position.z);
      for (let i = 0; i < 16; i++) expect(hit.elements[i]).toBeCloseTo(live.elements[i]!, 4);
    }
    renderer.update(0, 10, f.war.id);
    expect(renderer.group.getObjectByName('Campaign soldiers 0')).toBe(mesh);
    expect(mesh.geometry).toBe(geometry); expect(mesh.material).toBe(material);
    expect(renderer.group.getObjectByName('Recorded fallen soldiers')).toBeUndefined();
    expect(renderer.report.figures).toBeLessThanOrEqual(renderer.report.budget);
    expect(JSON.stringify(f.state)).toBe(before);
    renderer.dispose(); renderer.dispose();
  });

  it('renders the same battle clock identically after skipped frames and freezes reduced motion', () => {
    const f = fixture();
    f.state.month = 1; f.state.history.push(f.event);
    f.war.phase = 'battle'; f.war.campaign.battleCount = 1; f.war.campaign.lastBattleMonth = 1;
    const direct = new WarRenderer(f.state, () => 0), stepped = new WarRenderer(f.state, () => 0);
    const matrices = (renderer: WarRenderer) => {
      const result: number[][] = [];
      renderer.group.traverse(object => {
        if (object instanceof THREE.InstancedMesh) result.push([object.count, ...object.instanceMatrix.array.slice(0, object.count * 16)]);
      });
      return result;
    };
    direct.update(0, 0, f.war.id); stepped.update(0, 0, f.war.id);
    for (let t = 0.1; t < 4; t += 0.1) stepped.update(0.1, t, f.war.id);
    direct.update(4, 4, f.war.id); stepped.update(0.1, 4, f.war.id);
    expect(matrices(direct)).toEqual(matrices(stepped));
    direct.update(0, 10, f.war.id, true);
    const still = matrices(direct);
    direct.update(0, 100, f.war.id, true);
    expect(matrices(direct)).toEqual(still);
    direct.dispose(); stepped.dispose();
  });


  it.each(['clubs', 'stone-spears', 'bows', 'rifles', 'automatic-weapons'] as const)('keeps fallen %s equipment above the ground', equipment => {
    const f = fixture();
    f.state.month = 1; f.state.history.push(f.event);
    f.war.phase = 'battle'; f.war.campaign.battleCount = 1; f.war.campaign.lastBattleMonth = 1;
    Object.assign(f.war.campaign, {
      militaryA: { ...militaryProfileForWar(f.war, 'attacker')!, equipment: [equipment] },
      militaryB: { ...militaryProfileForWar(f.war, 'defender')!, equipment: [equipment] },
    });
    const renderer = new WarRenderer(f.state, () => 0);
    renderer.update(0, 0, f.war.id); renderer.update(10, 10, f.war.id);
    const matrix = new THREE.Matrix4();
    for (const side of [0, 1]) {
      const weapons = renderer.group.getObjectByName(`Campaign weapons ${side}`) as THREE.InstancedMesh;
      weapons.geometry.computeBoundingBox();
      expect(weapons.count).toBeGreaterThan(0);
      for (let i = 0; i < weapons.count; i++) {
        weapons.getMatrixAt(i, matrix);
        expect(weapons.geometry.boundingBox!.clone().applyMatrix4(matrix).min.y).toBeGreaterThanOrEqual(-0.001);
      }
    }
    renderer.dispose();
  });

});
