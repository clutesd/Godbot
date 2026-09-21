import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { ConstructionAssembly, constructionActiveWorkZone, constructionAssemblyPlan } from '../src/render/construction/ConstructionAssembly';
import { createConstructionScaffold, updateConstructionScaffold } from '../src/render/construction/ConstructionScaffold';
import { createConstructionWorksite, updateConstructionWorksite } from '../src/render/construction/ConstructionWorksite';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import { sampleConstructionAction } from '../src/render/construction/ConstructionActionPresentation';
import { createResourceWorkMotion } from '../src/render/animation/ResourceWorkMotion';
import type { CultureStyle, Person } from '../src/sim/types';
import type { DevelopmentResponse, StructureMaterial } from '../src/sim/development/types';
import type { AssemblyPiece } from '../src/render/assets/GeometryBuilder';

const style: CultureStyle = { primary: '#b15d45', secondary: '#35405c', accent: '#d8ad4f', symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['ka'] };
function response(material: StructureMaterial): DevelopmentResponse {
  return { need: 'housing', form: 'dwelling', name: 'assembly test', level: 2, material, cultureId: 'test', style,
    services: { housing: 2 }, reasons: [], capabilities: [], cost: { food: 0, wood: 4, minerals: 0, goods: 0, wealth: 0 }, labor: 4 };
}
function asset(material: StructureMaterial) {
  const builder = new AssetBuilder('assembly-test');
  const source = builder.getAsset('building', { seed: 'assembly-house', culture: style, era: 'village', variant: 'house#4', development: response(material) }).mesh;
  return { builder, source };
}
const materials = ['timber', 'masonry', 'ceramic', 'earth', 'metal'] as const;

describe('physical construction assembly', () => {
  it.each(materials)('%s preserves every target triangle and canonical stage in one deterministic sequence', material => {
    const { builder, source } = asset(material);
    const full = source instanceof THREE.LOD ? source.levels[0]!.object : source;
    full.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const pieces = object.geometry.userData['assemblyPieces'] as AssemblyPiece[];
      expect(pieces.reduce((n, p) => n + p.count, 0)).toBe(object.geometry.index!.count);
    });
    const plan = constructionAssemblyPlan(source, 0.5, 'plot-a', material);
    expect(plan).toEqual(constructionAssemblyPlan(source, 0.5, 'plot-a', material));
    let lastStage = 0, lastEnd = 0;
    for (const piece of plan.pieces) {
      expect(piece.stage).toBeGreaterThanOrEqual(lastStage);
      expect(piece.startProgress).toBeGreaterThanOrEqual(lastEnd - 1e-12);
      expect(piece.endProgress).toBeGreaterThan(piece.startProgress);
      lastStage = piece.stage; lastEnd = piece.endProgress;
    }
    expect(lastEnd).toBe(1);
    builder.dispose();
  });

  it.each(materials)('%s active zones select a real member surface and safe adjacent stand point', material => {
    const { builder, source } = asset(material);
    const plan = constructionAssemblyPlan(source, 0.5, 'plot-a', material);
    for (let progress = 0.01; progress < 1; progress += 0.007) {
      const zone = constructionActiveWorkZone(plan, progress), piece = plan.pieces[zone.piece]!;
      expect(zone.contact.x).toBeGreaterThanOrEqual(piece.min.x - 1e-6);
      expect(zone.contact.x).toBeLessThanOrEqual(piece.max.x + 1e-6);
      expect(zone.contact.z).toBeGreaterThanOrEqual(piece.min.z - 1e-6);
      expect(zone.contact.z).toBeLessThanOrEqual(piece.max.z + 1e-6);
      expect(Math.abs(zone.stand.x) >= plan.width / 2 || Math.abs(zone.stand.z) >= plan.depth / 2).toBe(true);
      expect(zone.platform).toBeGreaterThanOrEqual(0);
      expect(zone.platform).toBeLessThanOrEqual(zone.contact.y);
    }
    builder.dispose();
  });

  it('reveals opaque components between heavy cache buckets without touching shared source buffers or materials', () => {
    const { builder, source } = asset('timber');
    const assembly = new ConstructionAssembly(source, 0.5, 'plot-a', 'timber');
    const snapshot = source.toJSON();
    const visibleCount = () => assembly.group.children.reduce((sum, child) => sum + (child instanceof THREE.Mesh && child.visible ? child.geometry.drawRange.count : 0), 0);
    assembly.update(0.51); const before = visibleCount();
    assembly.update(0.52); expect(visibleCount()).toBeGreaterThan(before);
    assembly.group.traverse(object => {
      if (object instanceof THREE.Mesh && object.visible) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        expect(material.opacity).toBe(1);
      }
    });
    expect(source.toJSON()).toEqual(snapshot);
    assembly.update(0.99, 1 / 60);
    expect(assembly.plan.progress).toBeLessThan(0.99);
    expect(assembly.plan.progress).toBeGreaterThanOrEqual(0.91);
    assembly.update(1);
    expect(assembly.group.getObjectByName('Member being seated')!.visible).toBe(false);
    builder.dispose();
  });

  it('keeps access bays fixed, grows upward, strips during finishing and leaves no construction dressing at completion', () => {
    const { builder, source } = asset('masonry');
    const plan = constructionAssemblyPlan(source, 0.5, 'plot-a', 'masonry');
    const palette = new MaterialPalette({ culture: style, era: 'village' });
    const scaffold = createConstructionScaffold(plan, palette, 'timber');
    const matrices = scaffold.children.map(c => c.position.toArray());
    const visible = () => scaffold.children.filter(c => c.visible).length;
    updateConstructionScaffold(scaffold, plan, 0.1); expect(visible()).toBe(0);
    updateConstructionScaffold(scaffold, plan, 0.3); const early = visible();
    updateConstructionScaffold(scaffold, plan, 0.85); expect(visible()).toBeGreaterThanOrEqual(early); const roof = visible();
    updateConstructionScaffold(scaffold, plan, 0.98); expect(visible()).toBeLessThan(roof);
    expect(scaffold.children.map(c => c.position.toArray())).toEqual(matrices);
    updateConstructionScaffold(scaffold, plan, 1); expect(visible()).toBe(0);
    const site = createConstructionWorksite({ width: 2, depth: 1.5, progress: 0.3, seedKey: 'plot', response: response('masonry') }, palette);
    const initial = site.children.filter(c => c.visible).length;
    updateConstructionWorksite(site, 0.98, false); expect(site.children.filter(c => c.visible).length).toBeLessThan(initial);
    updateConstructionWorksite(site, 1, false); expect(site.visible).toBe(false);
    expect(createConstructionWorksite({ width: 2, depth: 1.5, progress: 1, seedKey: 'done' }, palette).children).toHaveLength(0);
    builder.dispose();
  });

  it('has exactly one visible load owner at handoff and suppresses productive effects while awaiting delivery', () => {
    const anchors = { pickup: { x: 1, z: 0 }, delivery: { x: 0, z: 1 }, handoff: { x: 0, z: 1.22 }, materialCenter: { x: 1.1, z: 0 }, siteCenter: { x: 0, z: 0 }, prep: { x: -1, z: 0 }, prepCenter: { x: -1, z: 0.2 } };
    const person = { id: 'test', activity: 'construct' } as Person;
    for (const material of materials) for (const p of [0.48, 0.519, 0.52, 0.7, 0.99]) {
      const hauler = sampleConstructionAction(person, 'plot', { phase: 'handoff', seconds: p * 0.9, carrying: p < 0.52 }, anchors, material, createResourceWorkMotion(), undefined, 'hauler', 2);
      const receiver = sampleConstructionAction(person, 'plot', { phase: 'assemble', seconds: 0, carrying: false }, anchors, material, createResourceWorkMotion(), undefined, 'assembler', 2, 0.5, { material, sourcePersonId: 'hauler', progress: p });
      expect([hauler, receiver].filter(a => a.carriedObject === material)).toHaveLength(1);
      expect(hauler.contactEffect).toBeUndefined(); expect(receiver.contactEffect).toBeUndefined();
    }
    const waiting = sampleConstructionAction(person, 'plot', { phase: 'assemble', seconds: 0.7, carrying: false }, anchors, 'metal', createResourceWorkMotion(), undefined, 'assembler', 2, 0.5, undefined, 'industrial', true);
    expect(waiting.contactStrength).toBe(0); expect(waiting.contactEffect).toBeUndefined(); expect(waiting.activeTool).toBe('none');
  });
});
