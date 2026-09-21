import * as THREE from 'three';
import { GeometryBuilder } from '../assets/GeometryBuilder';
import type { MaterialPalette } from '../materials/MaterialPalette';
import { constructionActiveWorkZone, type ConstructionAssemblyPlan } from './ConstructionAssembly';
import { constructionStagePresentation } from './ConstructionVisualGrammar';

export const CONSTRUCTION_PLATFORM_STEP = 0.2;

/** Fixed access bays: levels build upward and strip top-down; no face relocation or generic cage. */
export function createConstructionScaffold(plan: ConstructionAssemblyPlan, palette: MaterialPalette, surface: 'timber' | 'metal'): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Functional construction access';
  group.userData['constructionCue'] = 'scaffold';
  const material = palette.getSurfaceMaterial(surface);
  const levels = Math.min(12, Math.max(1, Math.ceil(plan.height / CONSTRUCTION_PLATFORM_STEP)));
  const pole = surface === 'metal' ? 0.012 : 0.019;
  for (let face = 0; face < 4; face++) {
    const span = (face % 2 ? plan.width : plan.depth) + 0.12;
    const distance = (face % 2 ? plan.depth : plan.width) / 2 + 0.14;
    for (let level = 1; level <= levels; level++) {
      const y = level * CONSTRUCTION_PLATFORM_STEP;
      const builder = new GeometryBuilder();
      const bays = Math.max(1, Math.min(4, Math.ceil(span / 0.45)));
      // Leave the ground lane and frontage unobstructed; decks are just outside actual wall faces.
      builder.addBox(0, y, distance, span, 0.018, 0.2);
      builder.addBox(0, y + 0.13, distance + 0.11, span, pole, pole);
      for (let bay = 0; bay <= bays; bay++) {
        const x = -span / 2 + span * bay / bays;
        builder.addBox(x, y - 0.025, distance + 0.11, pole, CONSTRUCTION_PLATFORM_STEP + 0.15, pole);
        if (bay < bays) builder.addBeam({ x, y: y - CONSTRUCTION_PLATFORM_STEP, z: distance + 0.11 },
          { x: x + span / bays, y, z: distance + 0.11 }, pole * 0.6, pole * 0.6);
      }
      // A ladder at each bay makes nearby elevated working positions physically intelligible.
      for (let bay = 0; bay < 1; bay++) {
        const x = -span / 2 + span * (bay + 0.5) / bays;
        for (const side of [-1, 1]) builder.addBox(x + side * 0.045, y - 0.1, distance + 0.14, pole * 0.7, 0.2, pole * 0.7);
        for (let rung = 0; rung < 3; rung++) builder.addBox(x, y - 0.17 + rung * 0.065, distance + 0.14, 0.105, pole * 0.6, pole * 0.6);
      }
      const mesh = new THREE.Mesh(builder.build(), material);
      mesh.rotation.y = (1 - face) * Math.PI / 2;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData['constructionLevel'] = level;
      mesh.userData['constructionFace'] = face;
      group.add(mesh);
    }
  }
  return group;
}

export function updateConstructionScaffold(group: THREE.Group, plan: ConstructionAssemblyPlan, progress: number, delta?: number): void {
  const { stage } = constructionStagePresentation(progress);
  const zone = constructionActiveWorkZone(plan, progress);
  // Build access before the member that needs it, retaining existing bays across workface changes.
  const requiredHeight = stage === 0 ? 0 : Math.max(zone.platform, stage === 3 ? plan.height * 0.5 : 0);
  const cleanup = Math.max(0, Math.min(1, (progress - 0.95) / 0.05));
  for (const child of group.children) {
    const level = Number(child.userData['constructionLevel']);
    const face = Number(child.userData['constructionFace']);
    const top = level * CONSTRUCTION_PLATFORM_STEP;
    const stripAt = Math.max(0, 1 - top / Math.max(0.2, plan.height)) * 0.62 + face * 0.05;
    const remaining = Math.max(0, Math.min(1, 1 - (cleanup - stripAt) / 0.18));
    const needed = progress < 1 && stage > 0 && requiredHeight > 0 && top <= requiredHeight + 0.001
      && (face === zone.face || stage >= 2 && face === (zone.face + 1) % 4);
    const target = needed ? remaining : 0;
    const previous = Number(child.userData['accessAmount'] ?? target);
    const amount = delta === undefined ? target : previous + Math.max(-delta * 2, Math.min(delta * 2, target - previous));
    child.userData['accessAmount'] = amount;
    child.visible = progress < 1 && amount > 0.001;
    // Withdraw complete boards along their length, preserving the fixed bay location.
    child.scale.x = amount;
  }
}
