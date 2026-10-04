import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { foundingAsset } from './helpers/foundingAsset';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import {
  ConstructionAssembly,
  constructionActiveWorkZone,
} from '../src/render/construction/ConstructionAssembly';
import type { AssemblyPiece } from '../src/render/assets/GeometryBuilder';

function foundingProject() {
  const simulation = new Simulation({ seed: 'physical-founding-shelter', startMode: 'arrival', world: { size: 64 } });
  simulation.advanceArrival(80);
  if (!simulation.beginHistory()) throw new Error('Expected history to begin');
  for (let month = 0; month < 6; month += 1) {
    simulation.step(1);
    const project = simulation.state.settlements.find(settlement => settlement.development?.project?.response.adaptation)?.development?.project;
    if (project) return project.response;
  }
  throw new Error('Expected a founding shelter project');
}

describe('physical founding shelter assembly', () => {
  it('retains real posts, wall fabric and roof courses as addressable assembly members', () => {
    const response = foundingProject();
    const builder = new AssetBuilder('founding-assembly');
    const structure = foundingAsset(builder, response);

    const pieces: AssemblyPiece[] = [];
    structure.traverse(object => {
      if (object instanceof THREE.Mesh) pieces.push(...((object.geometry.userData['assemblyPieces'] ?? []) as AssemblyPiece[]));
    });

    expect(pieces.length).toBeGreaterThan(20);
    const stages = new Set(pieces.map(piece => piece.stage));
    for (const stage of [0, 1, 2, 3, 4]) expect(stages.has(stage)).toBe(true);
    expect([...stages].every(stage => stage >= 0 && stage <= 7)).toBe(true);
    expect(pieces.every(piece => piece.count > 0)).toBe(true);
    expect(Number(structure.userData['footprintWidth'])).toBeGreaterThan(0);
    expect(Number(structure.userData['footprintDepth'])).toBeGreaterThan(0);
    expect(Number(structure.userData['buildingHeight'])).toBeGreaterThan(0.3);
  });

  it('does not reveal an authorized shelter member until a founder makes an installation contact', () => {
    const response = foundingProject();
    const builder = new AssetBuilder('founding-assembly');
    const structure = foundingAsset(builder, response);
    const assembly = new ConstructionAssembly(structure, 1, 'founding-shelter:contact', response.material ?? 'timber');

    assembly.update(0);
    assembly.update(0.82, 0.1, false, 'contact-led');
    expect(assembly.plan.progress).toBe(0);
    expect(assembly.group.getObjectByName('Member being seated')?.visible).toBe(false);

    const first = assembly.plan.pieces[0]!;
    assembly.update(0.82, 0.1, true, 'contact-led');
    expect(assembly.plan.progress).toBeGreaterThan(first.startProgress);
    expect(assembly.plan.progress).toBeLessThan(first.endProgress);
    expect(assembly.group.getObjectByName('Member being seated')?.visible).toBe(true);

    for (let frame = 0; frame < 8; frame += 1) assembly.update(0.82, 0.1, false, 'contact-led');
    expect(assembly.plan.progress).toBeCloseTo(first.endProgress, 6);

    // Paid progress may be far ahead, but the next member remains absent until another contact.
    for (let frame = 0; frame < 20; frame += 1) assembly.update(0.82, 0.1, false, 'contact-led');
    expect(assembly.plan.progress).toBeCloseTo(first.endProgress, 6);

    const zone = constructionActiveWorkZone(assembly.plan, assembly.plan.progress ?? 0);
    expect(zone.piece).toBe(1);
    expect(Math.abs(zone.stand.x)).toBeLessThanOrEqual(assembly.plan.width);
    expect(Math.abs(zone.stand.z)).toBeLessThanOrEqual(assembly.plan.depth);
  });

  it('seats successive members one contact at a time instead of jumping to the monthly progress snapshot', () => {
    const response = foundingProject();
    const builder = new AssetBuilder('founding-assembly');
    const structure = foundingAsset(builder, { ...response, adaptation: 'lean-to' });
    const assembly = new ConstructionAssembly(structure, 1, 'founding-shelter:sequence', response.material ?? 'timber');
    assembly.update(0);

    const authoritative = 1;
    for (let member = 0; member < 5; member += 1) {
      const before = assembly.plan.progress ?? 0;
      const active = assembly.plan.pieces[member]!;
      assembly.update(authoritative, 0.1, true, 'contact-led');
      for (let frame = 0; frame < 8; frame += 1) assembly.update(authoritative, 0.1, false, 'contact-led');
      const after = assembly.plan.progress ?? 0;
      expect(after).toBeGreaterThan(before);
      expect(after).toBeCloseTo(active.endProgress, 6);
      expect(after).toBeLessThan(0.5);
    }
  });
});
