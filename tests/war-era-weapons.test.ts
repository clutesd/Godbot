import { describe, expect, it } from 'vitest';
import { applyWarPreviewMethod, WAR_PREVIEW_METHODS, warPreviewMethod } from '../src/dev/warPreviewModel';
import { militaryProfileForWar } from '../src/sim/war/MilitaryCapability';
import { isFirearmWeapon, militaryVisualStyle } from '../src/render/war/MilitaryVisualLanguage';
import { attackPeriod, combatPose } from '../src/render/war/CombatChoreography';
import { createCombatExchanges, exchangeFigurePose, exchangeImpactAt } from '../src/render/war/CombatExchanges';
import { engagementGap } from '../src/render/war/CombatChoreography';
import { WarRenderer } from '../src/render/war/WarRenderer';
import { warFixture } from './fixtures/war';

describe('era-specific combat presentation', () => {
  it('distinguishes the primary weapon for each development step', () => {
    const f = warFixture('era-weapons');
    const war = f.declare();
    for (const [method, weapon] of [['club', 'club'], ['spear', 'spear'], ['sword', 'sword'],
      ['bow', 'bow'], ['musket', 'musket'], ['rifle', 'rifle'], ['automatic', 'automatic']] as const) {
      applyWarPreviewMethod(war, warPreviewMethod(method));
      const profile = militaryProfileForWar(war, 'attacker')!;
      const style = militaryVisualStyle(profile);
      expect(style.weapon).toBe(weapon);
      expect(combatPose(style, 0, 0, 0.1, true, false).ranged).toBe(weapon === 'bow' || isFirearmWeapon(weapon));
    }
    applyWarPreviewMethod(war, warPreviewMethod('rifle'));
    const rifle = militaryVisualStyle(militaryProfileForWar(war, 'attacker')!);
    applyWarPreviewMethod(war, warPreviewMethod('musket'));
    expect(attackPeriod(militaryVisualStyle(militaryProfileForWar(war, 'attacker')!))).toBeGreaterThan(attackPeriod(rifle));
  });

  it('uses a ranged partner exchange and projectile impact for muskets', () => {
    const f = warFixture('musket-exchange');
    const war = f.declare();
    applyWarPreviewMethod(war, warPreviewMethod('musket'));
    const style = militaryVisualStyle(militaryProfileForWar(war, 'attacker')!);
    const plan = createCombatExchanges('musket-battle', { x: 0, z: 0 }, 0, engagementGap([style, style]), [style, style], [12, 12]);
    for (const exchange of plan.exchanges) {
      const time = exchangeImpactAt(plan, exchange, 1 - exchange.initiative);
      const attacker = exchangeFigurePose(plan, exchange.initiative, exchange.slots[exchange.initiative], time, true, false);
      expect(attacker.pose.ranged).toBe(true);
      expect(attacker.targetDistance).toBeGreaterThan(2);
    }
  });

  it('renders wooden siege engines rather than cannon for pre-gunpowder armies', () => {
    const f = warFixture('siege-equipment');
    const war = f.declare();
    applyWarPreviewMethod(war, warPreviewMethod('siege'));
    const renderer = new WarRenderer(f.state, () => 0);
    renderer.update(0, 0, war.id);
    expect(renderer.group.getObjectByName('siege-engine-0')).toBeDefined();
    expect(renderer.group.getObjectByName('artillery-0')).toBeUndefined();
    renderer.dispose();
    applyWarPreviewMethod(war, warPreviewMethod('cannon'));
    const cannon = new WarRenderer(f.state, () => 0);
    cannon.update(0, 0, war.id);
    expect(cannon.group.getObjectByName('cannon-0')).toBeDefined();
    expect(cannon.group.getObjectByName('siege-engine-0')).toBeUndefined();
    cannon.dispose();
  });

  it('keeps advanced previews from contaminating subsequent primitive kits or live settlements', () => {
    const f = warFixture('preview-kit-reset');
    const war = f.declare();
    const original = JSON.stringify(f.state.settlements);
    applyWarPreviewMethod(war, warPreviewMethod('missile'));
    expect(militaryVisualStyle(militaryProfileForWar(war, 'attacker')!).missiles).toBeGreaterThan(0);
    applyWarPreviewMethod(war, warPreviewMethod('club'));
    const profile = militaryProfileForWar(war, 'attacker')!;
    expect(profile.equipment).toEqual(['clubs']);
    expect(profile.airPower).toBe(0);
    expect(profile.missile).toBe(0);
    expect(militaryProfileForWar(war, 'defender')!.equipment).not.toBe(profile.equipment);
    expect(JSON.stringify(f.state.settlements)).toBe(original);
    expect(warPreviewMethod('unknown')).toBe(WAR_PREVIEW_METHODS[0]);
  });
});
