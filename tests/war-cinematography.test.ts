import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { warFixture } from './fixtures/war';
import { WarRenderer } from '../src/render/war/WarRenderer';
import { warCameraFrame } from '../src/render/war/WarCamera';
import { CinematicSequencePlanner } from '../src/render/CinematicSequencePlanner';
import { Historian } from '../src/historian/Historian';
import { cameraClearanceFor, cameraTargetFloorFor } from '../src/render/CameraDirector';
import { militaryProfileForWar } from '../src/sim/war/MilitaryCapability';
import { militaryVisualStyle } from '../src/render/war/MilitaryVisualLanguage';

function battle() {
  const f = warFixture('cinematography');
  const war = f.declare();
  for (let i = 0; i < 70 && war.campaign.battleCount < 1; i++) f.tick();
  return { ...f, war };
}

describe('battlefield cinematography and current anatomy', () => {
  it('photographs the recorded clash at several scales with axis continuity and a bounded dolly', () => {
    const { state, war } = battle();
    const event = state.history.find(e => e.type === 'battle' && e.actors.includes(war.id))!;
    const opening = warCameraFrame(state, war, 0.3, 0)!;
    const end = warCameraFrame(state, war, 0.3, 1)!;
    const detail = warCameraFrame(state, war, 0.3, 0.5, 16 / 9, true)!;
    expect(opening.focusX).toBeCloseTo(event.location!.x);
    expect(opening.focusZ).toBeCloseTo(event.location!.z);
    expect(opening.flank).toBe(end.flank);
    expect(Math.hypot(end.x - opening.x, end.z - opening.z)).toBeLessThan(0.6);
    expect(detail.height).toBeLessThan(opening.height);
    expect(Math.hypot(detail.x - detail.focusX, detail.z - detail.focusZ)).toBeLessThan(1.4);
    expect(cameraClearanceFor('battle-overview').lens).toBeLessThan(detail.height);
    expect(cameraTargetFloorFor('battle-overview')).toBeLessThan(detail.targetHeight);
    const mobile = warCameraFrame(state, war, 0.3, 0, 390 / 844)!;
    expect(Math.hypot(mobile.x - mobile.focusX, mobile.z - mobile.focusZ)).toBeGreaterThan(
      Math.hypot(opening.x - opening.focusX, opening.z - opening.focusZ));
  });

  it('edits a coherent battle sequence from one evidenced event and narrates it once', () => {
    const { sim, state, war } = battle();
    const event = state.history.find(e => e.type === 'battle' && e.actors.includes(war.id))!;
    const anchor = new Historian(sim.config).chooseScene(state, event.id);
    const planner = new CinematicSequencePlanner();
    const shots = [planner.plan(state, anchor, [anchor])];
    for (let i = 0; i < 3; i++) shots.push(planner.takePlannedShot()!);
    expect(shots.map(s => s.role)).toEqual(['establish', 'observe', 'detail', 'release']);
    expect(shots.filter(s => s.narrate)).toHaveLength(1);
    expect(shots.every(s => s.scene.statement === anchor.statement)).toBe(true);
    expect(new Set(shots.map(s => s.scene.id)).size).toBe(4);
  });

  it('uses sculpted segments, per-person surfaces and aligned joints instead of old box limbs', () => {
    const { state, war } = battle();
    const renderer = new WarRenderer(state, () => 0);
    renderer.update(0, 0, war.id);
    const body = renderer.group.getObjectByName('Campaign soldiers 0') as THREE.InstancedMesh;
    const upper = renderer.group.getObjectByName('Campaign upperArms 0') as THREE.InstancedMesh;
    const lower = renderer.group.getObjectByName('Campaign forearms 0') as THREE.InstancedMesh;
    expect(body.geometry.getAttribute('humanSurface')).toBeDefined();
    expect(upper.geometry.getAttribute('position').count).toBeGreaterThan(100);
    expect(lower.customDepthMaterial).toBeDefined();
    expect(upper.count).toBe(body.count * 2);
    const a = new THREE.Matrix4(), b = new THREE.Matrix4();
    for (let slot = 0; slot < upper.count; slot++) {
      upper.getMatrixAt(slot, a); lower.getMatrixAt(slot, b);
      const length = upper.geometry.getAttribute('humanShape').getX(slot);
      const elbow = new THREE.Vector3(0, -0.19 * length, 0).applyMatrix4(a);
      expect(elbow.distanceTo(new THREE.Vector3().setFromMatrixPosition(b))).toBeLessThan(0.00001);
    }
    renderer.dispose();
  });

  it('gives firearm units both hands for their weapons and reserves shields for melee', () => {
    const { war, state } = battle();
    const profile = militaryProfileForWar(war, 'attacker')!;
    expect(militaryVisualStyle({ ...profile, equipment: ['rifles', 'metal-armour', 'shields'] }).shields).toBe(false);
    expect(militaryVisualStyle({ ...profile, equipment: ['stone-spears', 'shields'] }).shields).toBe(true);
    profile.equipment = ['rifles'];
    militaryProfileForWar(war, 'defender')!.equipment = ['rifles'];
    const wide = warCameraFrame(state, war, 0, 0)!;
    const close = warCameraFrame(state, war, 0, 0, 16 / 9, true)!;
    expect(Math.hypot(wide.focusX - close.focusX, wide.focusZ - close.focusZ)).toBeGreaterThan(1);
  });
});
