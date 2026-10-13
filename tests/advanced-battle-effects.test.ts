import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AdvancedBattleEffects, droneFlight, missileFlight } from '../src/render/war/AdvancedBattleEffects';
import { applyWarPreviewMethod, warPreviewMethod } from '../src/dev/warPreviewModel';
import { militaryProfileForWar } from '../src/sim/war/MilitaryCapability';
import { militaryVisualStyle } from '../src/render/war/MilitaryVisualLanguage';
import { assessMilitaryCombat, militaryLogisticsBurden, militaryRange, militarySupplyCosts } from '../src/sim/war/MilitaryCombat';
import { warFixture } from './fixtures/war';

function fixture(method = 'advanced') {
  const f = warFixture('advanced-effects');
  const war = f.declare();
  applyWarPreviewMethod(war, warPreviewMethod(method));
  const profiles = [militaryProfileForWar(war, 'attacker')!, militaryProfileForWar(war, 'defender')!] as const;
  const styles = [militaryVisualStyle(profiles[0]), militaryVisualStyle(profiles[1])] as const;
  return { ...f, war, profiles, styles };
}

const mesh = (effects: AdvancedBattleEffects, name: string) => effects.group.getObjectByName(name) as THREE.InstancedMesh;

describe('advanced battlefield presentation', () => {
  it('takes missiles from their launcher to the exact terrain-relative impact point', () => {
    const start = { x: -3, y: 1.25, z: 4 }, target = { x: 3, y: 2.015, z: 6 };
    expect(missileFlight(start, target, 0).toArray()).toEqual([start.x, start.y, start.z]);
    expect(missileFlight(start, target, 1).distanceTo(new THREE.Vector3(target.x, target.y, target.z))).toBeLessThan(1e-10);
    expect(missileFlight(start, target, 0.5).y).toBeGreaterThan(target.y + 1);
    const effects = new AdvancedBattleEffects((x, z) => x * 0.03 + z * 0.02);
    const { styles } = fixture('missile');
    effects.update({ x: 8, z: 4 }, Math.PI / 2, 3.2, styles, 1.6, true, 1, false);
    const missile = effects.group.getObjectByName('missile-0-0')!;
    expect(missile.visible).toBe(true);
    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(missile.quaternion);
    const launcher = effects.group.getObjectByName('missile-launcher-0-0')!;
    const position = missile.position.clone();
    effects.update({ x: 8, z: 4 }, Math.PI / 2, 3.2, styles, 1.601, true, 1, false);
    expect(direction.dot(missile.position.clone().sub(position).normalize())).toBeGreaterThan(0.999);
    expect(launcher.position.y).toBeCloseTo(launcher.position.x * 0.03 + launcher.position.z * 0.02);
    expect(mesh(effects, 'Missile exhaust trails').count).toBeGreaterThan(0);
    effects.update({ x: 8, z: 4 }, Math.PI / 2, 3.2, styles, 4.6, true, 1, false);
    expect(missile.visible).toBe(false);
    expect(mesh(effects, 'Strike ground dust').count).toBeGreaterThan(0);
    expect(mesh(effects, 'Strike smoke plumes').count).toBeGreaterThan(0);
    expect(mesh(effects, 'Missile exhaust trails').count).toBeGreaterThan(0);
    effects.dispose();
  });

  it('loiters, approaches and dives drones with a continuous flight path and bounded attack waves', () => {
    const home = { x: -2, y: 1.3, z: 0 }, target = { x: 2, y: 0.025, z: 0.1 };
    for (const boundary of [3, 6, 7.6]) {
      expect(droneFlight(home, target, boundary - 0.0001, 0).position.distanceTo(
        droneFlight(home, target, boundary + 0.0001, 0).position)).toBeLessThan(0.001);
    }
    const { styles } = fixture('drone');
    const effects = new AdvancedBattleEffects(() => 2);
    effects.update({ x: 4, z: 7 }, 0.3, 3.2, styles, 0, true, 1, false);
    expect(mesh(effects, 'Advanced swarm drones').count).toBe(16);
    expect(mesh(effects, 'Drone rotor blur').count).toBe(64);
    expect(mesh(effects, 'Strike ground dust').count).toBe(0);
    effects.update({ x: 4, z: 7 }, 0.3, 3.2, styles, 6, true, 1, false);
    expect(mesh(effects, 'Advanced swarm drones').count).toBeLessThan(16);
    expect(mesh(effects, 'Strike ground dust').count).toBeGreaterThan(0);
    effects.update({ x: 4, z: 7 }, 0.3, 3.2, styles, 12, true, 1, false);
    expect(mesh(effects, 'Advanced swarm drones').count).toBe(4);
    expect(mesh(effects, 'Drone rotor blur').count).toBe(16);
    effects.dispose();
  });

  it('samples the same effects after skipped frames and never changes the simulation', () => {
    const { styles, state } = fixture();
    const before = JSON.stringify(state);
    const incremental = new AdvancedBattleEffects(() => 0), direct = new AdvancedBattleEffects(() => 0);
    for (let time = 0; time < 9; time += 0.13) incremental.update({ x: 3, z: 2 }, 0.7, 3.2, styles, time, true, 1, false);
    for (const effects of [incremental, direct]) effects.update({ x: 3, z: 2 }, 0.7, 3.2, styles, 9, true, 1, false);
    for (const name of ['Advanced swarm drones', 'Missile exhaust trails', 'Strike smoke plumes', 'Strike ground dust']) {
      const a = mesh(incremental, name), b = mesh(direct, name);
      expect(a.count).toBe(b.count);
      expect(Array.from(a.instanceMatrix.array.slice(0, a.count * 16))).toEqual(Array.from(b.instanceMatrix.array.slice(0, b.count * 16)));
    }
    for (let time = 0; time < 50; time += 0.4) {
      direct.update({ x: 3, z: 2 }, 0.7, 3.2, styles, time, true, 1, false);
      direct.group.traverse(object => {
        if (object instanceof THREE.InstancedMesh) expect(object.count).toBeLessThanOrEqual(object.instanceMatrix.count);
      });
    }
    expect(JSON.stringify(state)).toBe(before);
    incremental.dispose(); direct.dispose();
  });

  it('suppresses attacks outside active battles and keeps reduced-motion drones stationary', () => {
    const { styles } = fixture();
    const effects = new AdvancedBattleEffects(() => 0);
    effects.update({ x: 0, z: 0 }, 0, 3.2, styles, 5, true, 1, true);
    const initial = mesh(effects, 'Advanced swarm drones').instanceMatrix.array.slice();
    effects.update({ x: 0, z: 0 }, 0, 3.2, styles, 15, true, 1, true);
    expect(mesh(effects, 'Advanced swarm drones').instanceMatrix.array).toEqual(initial);
    for (const name of ['Missile exhaust trails', 'Strike ground dust', 'Strike ignition flashes']) expect(mesh(effects, name).count).toBe(0);
    effects.update({ x: 0, z: 0 }, 0, 3.2, styles, 5, false, 1, false);
    expect(effects.group.visible).toBe(false);
    const primitive = fixture('club').styles;
    effects.update({ x: 0, z: 0 }, 0, 3.2, primitive, 5, true, 1, false);
    expect(mesh(effects, 'Advanced swarm drones').count).toBe(0);
    expect(mesh(effects, 'Missile exhaust trails').count).toBe(0);
    expect(effects.group.getObjectByName('missile-0-0')!.visible).toBe(false);
    effects.dispose(); effects.dispose();
    expect(effects.group.children).toHaveLength(0);
  });

  it('carries drones into combat and logistics while reading legacy snapshots without NaNs', () => {
    const { profiles, b, war } = fixture('drone');
    const noDrones = { ...profiles[0] }; delete noDrones.dronePower;
    expect(militaryRange(profiles[0])).toBeGreaterThan(militaryRange(noDrones));
    expect(militaryLogisticsBurden(profiles[0])).toBeGreaterThan(militaryLogisticsBurden(noDrones));
    expect(militarySupplyCosts(profiles[0]).goods).toBeGreaterThan(militarySupplyCosts(noDrones).goods);
    expect(assessMilitaryCombat(profiles[0], profiles[1], b).engagementMode).toBe('combined-arms');
    expect(Number.isFinite(assessMilitaryCombat(noDrones, noDrones, b).effectivenessA)).toBe(true);
    applyWarPreviewMethod(war, warPreviewMethod('club'));
    expect(militaryVisualStyle(profiles[0]).drones).toBe(0);
    expect(profiles[0].dronePower).toBe(0);
  });
});
