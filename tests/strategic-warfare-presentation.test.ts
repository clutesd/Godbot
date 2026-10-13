import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { warFixture } from './fixtures/war';
import { applyWarPreviewMethod, prepareStrategicWarPreview, warPreviewEscalation, warPreviewMethod } from '../src/dev/warPreviewModel';
import { deriveMilitaryProfile, militaryProfileForWar } from '../src/sim/war/MilitaryCapability';
import { assessMilitaryCombat } from '../src/sim/war/MilitaryCombat';
import { StrategicBattleEffects, strategicCloudFrame } from '../src/render/war/StrategicBattleEffects';
import { warCameraFrame } from '../src/render/war/WarCamera';
import { warEventStory } from '../src/historian/WarStory';
import type { NuclearPosture } from '../src/sim/types';

function fixture(methodId: string, escalation: 'deterrence' | 'limited' | 'exchange' = 'limited') {
  const f = warFixture('strategic-presentation');
  const war = f.declare(), method = warPreviewMethod(methodId);
  applyWarPreviewMethod(war, method);
  for (let i = 0; i < 120 && war.campaign.battleCount === 0; i++) f.tick();
  const event = prepareStrategicWarPreview(f.state, war, method, escalation);
  return { ...f, war, event };
}

const cloud = (effects: StrategicBattleEffects) => effects.group.getObjectByName('Nuclear mushroom cloud') as THREE.InstancedMesh;

describe('late-era strategic warfare', () => {
  it('requires an existing operational arsenal, keeps civilian science separate, and freezes its weapon tier', () => {
    const f = warFixture('strategic-arsenal');
    const posture: NuclearPosture = { polityId: f.a.polityId, programLevel: 0.95, arsenalScale: 0.8, weaponClass: 'hydrogen',
      survivability: 0.8, warningReliability: 0.8, commandControlReliability: 0.8, riskTolerance: 0.5, doctrine: 'minimum-deterrence' };
    expect(deriveMilitaryProfile(f.a, posture).equipment).not.toContain('hydrogen-weapons');
    posture.weaponizedMonth = 0;
    expect(deriveMilitaryProfile(f.a, posture).equipment).toContain('hydrogen-weapons');
    f.state.advanced.atomic.postures.push(posture);
    const war = f.declare();
    expect(militaryProfileForWar(war, war.attacker === f.a.id ? 'attacker' : 'defender')!.equipment).toContain('hydrogen-weapons');
    posture.weaponClass = 'atomic'; posture.arsenalScale = 0;
    expect(militaryProfileForWar(war, war.attacker === f.a.id ? 'attacker' : 'defender')!.equipment).toContain('hydrogen-weapons');
    expect(deriveMilitaryProfile(f.a, posture).equipment).not.toContain('atomic-weapons');
    expect(deriveMilitaryProfile(f.a).equipment).not.toContain('biological-warfare');
  });

  it('holds MAD arsenals without detonations and records deterrence without treating nukes as conventional lethality', () => {
    const f = fixture('mad', 'deterrence');
    const a = militaryProfileForWar(f.war, 'attacker')!, b = militaryProfileForWar(f.war, 'defender')!;
    const assessment = assessMilitaryCombat(a, b, f.b);
    expect(assessment.nuclearDeterrence).toBe(true);
    const conventional = { ...a, equipment: a.equipment.filter(item => item !== 'hydrogen-weapons') };
    expect(assessMilitaryCombat(conventional, conventional, f.b).lethalityA).toBe(assessment.lethalityA);
    const effects = new StrategicBattleEffects(() => 0);
    effects.update(f.state, 0, false, f.war.id); effects.update(f.state, 9, false, f.war.id);
    expect(cloud(effects).count).toBe(0);
    expect(effects.group.getObjectByName('Strategic arsenal 0')!.visible).toBe(true);
    expect(effects.group.getObjectByName('Nuclear fireball 0')!.visible).toBe(false);
    const battle = f.state.history.find(event => event.type === 'battle' && event.actors.includes(f.war.id))!;
    expect(battle.context.nuclearDeterrence).toBe(true);
    expect(warEventStory(f.state, battle)).toContain('Mutual assured destruction');
    expect(warPreviewEscalation(warPreviewMethod('mad'), null)).toBe('deterrence');
    effects.dispose();
  });

  it('renders one event-relative detonation, a larger hydrogen cloud, and a staggered retaliatory exchange', () => {
    const f = fixture('hydrogen', 'exchange');
    const effects = new StrategicBattleEffects(() => 2);
    effects.update(f.state, 10, false, f.war.id); effects.update(f.state, 10.4, false, f.war.id);
    expect(effects.group.getObjectByName('Nuclear fireball 0')!.visible).toBe(true);
    expect(effects.group.getObjectByName('Nuclear fireball 1')!.visible).toBe(false);
    effects.update(f.state, 13, false, f.war.id);
    expect(effects.group.getObjectByName('Nuclear fireball 0')!.visible).toBe(false);
    expect(effects.group.getObjectByName('Nuclear fireball 1')!.visible).toBe(true);
    effects.update(f.state, 20, false, f.war.id);
    expect(cloud(effects).count).toBeGreaterThan(0);
    expect(cloud(effects).count).toBeLessThanOrEqual(cloud(effects).instanceMatrix.count);
    const atomic = strategicCloudFrame(10, false), hydrogen = strategicCloudFrame(10, true);
    expect(hydrogen.capRadius).toBeGreaterThan(atomic.capRadius);
    expect(hydrogen.rise).toBeGreaterThan(atomic.rise);
    effects.update(f.state, 55, false, f.war.id);
    expect(cloud(effects).count).toBe(0);
    expect(effects.group.getObjectByName('Recorded nuclear ground scar 0')!.visible).toBe(true);
    effects.update(f.state, 65, false, f.war.id);
    expect(effects.group.getObjectByName('Nuclear fireball 0')!.visible).toBe(false);
    effects.dispose();
  });

  it('shows old-event aftermath without a fresh flash and suppresses flashes under reduced motion', () => {
    const f = fixture('atomic');
    const effects = new StrategicBattleEffects(() => 0);
    effects.update(f.state, 0, true, f.war.id); effects.update(f.state, 0.4, true, f.war.id);
    expect(cloud(effects).count).toBeGreaterThan(0);
    expect(effects.group.getObjectByName('Nuclear fireball 0')!.visible).toBe(false);
    expect(effects.group.getObjectByName('Nuclear shock front 0')!.visible).toBe(false);
    f.state.month += 2;
    const late = new StrategicBattleEffects(() => 0);
    late.update(f.state, 0.4, false, f.war.id);
    expect(cloud(late).count).toBe(0);
    expect(late.group.getObjectByName('Nuclear fireball 0')!.visible).toBe(false);
    expect(late.group.getObjectByName('Recorded nuclear ground scar 0')!.visible).toBe(true);
    effects.dispose(); late.dispose();
  });

  it('keeps biological warfare abstract and clears its medical response when the kit changes', () => {
    const f = fixture('biological');
    const effects = new StrategicBattleEffects(() => 2);
    const before = JSON.stringify(f.state);
    effects.update(f.state, 0, false, f.war.id);
    expect(effects.group.getObjectByName('Abstract biological crisis markers')!.visible).toBe(true);
    expect(effects.group.getObjectByName('Biological crisis medical response 0')!.visible).toBe(true);
    expect(cloud(effects).count).toBe(0);
    expect(JSON.stringify(f.state)).toBe(before);
    expect(f.state.history.some(event => event.type === 'nuclear-use')).toBe(false);
    applyWarPreviewMethod(f.war, warPreviewMethod('club'));
    effects.update(f.state, 2, false, f.war.id);
    expect(effects.group.getObjectByName('Abstract biological crisis markers')!.visible).toBe(false);
    expect(effects.group.getObjectByName('Biological crisis medical response 0')!.visible).toBe(false);
    effects.dispose(); effects.dispose();
    expect(effects.group.children).toHaveLength(0);
  });

  it('pulls all nuclear shot roles back to an overview and renders recorded preview deaths without further mortality', () => {
    const f = fixture('atomic');
    const initial = f.state.people.filter(person => person.alive).length;
    expect(f.event?.context.previewScenario).toBe(true);
    expect(f.event?.affectedPopulation).toBeGreaterThan(4);
    expect(f.state.bodies?.filter(body => body.combatImpact?.eventId === f.event?.id).length).toBe(f.event?.affectedPopulation);
    const wide = warCameraFrame(f.state, f.war, 0.3, 0)!;
    const detail = warCameraFrame(f.state, f.war, 0.3, 0, 16 / 9, true)!;
    expect(wide.height).toBeGreaterThan(4);
    expect(Math.hypot(wide.x - wide.focusX, wide.z - wide.focusZ)).toBeGreaterThan(10);
    expect(detail.height).toBe(wide.height);
    const effects = new StrategicBattleEffects(() => 0);
    effects.update(f.state, 0, false, f.war.id); effects.update(f.state, 12, false, f.war.id);
    expect(f.state.people.filter(person => person.alive).length).toBe(initial);
    expect(warEventStory(f.state, f.event!)).not.toContain('NaN');
    effects.dispose();
  });
});
