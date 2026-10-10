import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { GeometryBuilder } from '../src/render/assets/GeometryBuilder';
import { ConstructionAssembly } from '../src/render/construction/ConstructionAssembly';
import { constructionFoundationEstablished, constructionGrounding } from '../src/render/construction/ConstructionGrounding';
import { groundStructure, surveyFootprintGround } from '../src/shared/StructureGrounding';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { TerrainDecor } from '../src/render/terrain/TerrainDecor';
import { GodboxRenderer } from '../src/render/GodboxRenderer';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import type { CultureStyle } from '../src/sim/types';

const style: CultureStyle = { primary: '#b15d45', secondary: '#35405c', accent: '#d8ad4f', symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['ka'] };
function member(stage: number, x: number, y: number, z: number, w: number, h: number, d: number) {
  const builder = new GeometryBuilder(); builder.addBox(x, y, z, w, h, d);
  const geometry = builder.build();
  for (const piece of geometry.userData['assemblyPieces']) piece.stage = stage;
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}
function visibleIndices(assembly: ConstructionAssembly): number {
  return assembly.group.children.reduce((sum, object) => sum + (object instanceof THREE.Mesh && object.visible ? object.geometry.drawRange.count : 0), 0);
}

describe('construction geometry regression', () => {
  it('removes the obsolete green cone ground-cover pass at its source', () => {
    const world = generateWorld(configWith({ seed: 'construction-decor', world: { size: 12 } }));
    const decor = new TerrainDecor(world, new TerrainSurface(world), 'construction-decor', 1);
    expect(decor.report.groundCover).toBe(0);
    decor.group.traverse(object => { if (object instanceof THREE.Mesh) expect(object.geometry).not.toBeInstanceOf(THREE.ConeGeometry); });
  });

  it('keeps foundation, frame and wall vertices above a rotated slope across the complete canonical footprint', () => {
    const builder = new AssetBuilder('construction-slope');
    const source = builder.getAsset('building', { seed: 'slope-house', culture: style, era: 'village', variant: 'house#7' }).mesh;
    const snapshot = source.toJSON();
    const a = new ConstructionAssembly(source, 2, 'slope-plot', 'timber');
    const b = new ConstructionAssembly(source, 2, 'slope-plot', 'timber');
    const x = 3, z = -2, rotation = 0.7;
    const height = (wx: number, wz: number) => 0.7 * wx + 0.35 * wz;
    const reserved = groundStructure(surveyFootprintGround(height, x, z, 1, 1, rotation));
    const grounding = constructionGrounding(a.plan, height, x, z, rotation, reserved);
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    for (const piece of a.plan.pieces.filter(piece => piece.stage >= 1 && piece.stage <= 3)) {
      for (const px of [piece.min.x, piece.max.x]) for (const pz of [piece.min.z, piece.max.z]) {
        const terrain = height(x + px * cos + pz * sin, z - px * sin + pz * cos);
        expect(grounding.baseY + piece.min.y).toBeGreaterThanOrEqual(terrain - 1e-6);
      }
    }
    for (const paid of [0, 0.12, 0.3, 0.49, 0.65, 0.8, 0.99, 1]) {
      a.update(paid); b.update(paid);
      expect(visibleIndices(a)).toBe(visibleIndices(b));
      expect(a.plan.progress).toBeLessThanOrEqual(paid);
      if (paid < 0.1) expect(constructionFoundationEstablished(a.plan)).toBe(false);
      if (paid > 0.2) expect(constructionFoundationEstablished(a.plan)).toBe(true);
    }
    const full = source instanceof THREE.LOD ? source.levels[0]!.object : source;
    let targetIndices = 0;
    full.traverse(object => { if (object instanceof THREE.Mesh) targetIndices += object.geometry.index!.count; });
    expect(visibleIndices(a)).toBe(targetIndices);
    expect(source.toJSON()).toEqual(snapshot);
    builder.dispose();
  });

  it('wires the full footprint base and foundation reveal into the production site renderer', () => {
    const builder = new AssetBuilder('production-slope');
    const source = builder.getAsset('building', { seed: `${style.primary}:house:v0`, culture: style,
      era: 'village', variant: 'house#7' }).mesh;
    const snapshot = source.toJSON();
    const height = (x: number, z: number) => x * 0.8 + z * 0.3;
    const placement = { key: 'sloped-production', role: 'house', builtEra: 'village', variation: 0,
      localX: 0, localZ: 0, worldX: 0, worldZ: 0, rotationY: 0.6, width: 3, depth: 2, height: 1,
      constructionPlan: undefined as ConstructionAssembly['plan'] | undefined };
    // A worksite starts from the ground under the plot centre, and the survey of the completed
    // target is what actually sets its base. Starting from the whole reserved plot instead took
    // the highest ground anywhere in the precinct, which is ground the building never stands on.
    const centre = { baseY: height(0, 0), relief: 0, skirt: false, skirtBottomY: height(0, 0) };
    const context = {
      assetBuilder: builder, constructionAssemblies: new Map(),
      state: { world: { terrain: { originX: 0, originZ: 0, step: 0.1 } } },
      elevationAt: height, terrainQueries: { queryTerrainAt: () => ({ water: false }) },
      groundPoint: () => centre, projectForPlot: () => undefined,
      getPalette: () => new MaterialPalette({ culture: style, era: 'village' }),
    };
    const create = (GodboxRenderer.prototype as unknown as {
      createActiveConstructionSite(input: typeof placement, style: CultureStyle, era: string, base: number, progress: number): THREE.Group;
    }).createActiveConstructionSite;
    const early = create.call(context as unknown as GodboxRenderer, placement, style, 'village', 0, 0);
    expect(early.getObjectByName('grounding-skirt')!.visible).toBe(false);
    const roofStage = create.call(context as unknown as GodboxRenderer, placement, style, 'village', 0, 0.8);
    expect(roofStage.getObjectByName('grounding-skirt')!.visible).toBe(true);
    expect(early.position.y).toBe(roofStage.position.y);
    expect(roofStage.position.y).toBeGreaterThanOrEqual(centre.baseY);
    // The base clears the ground under the structure's own footprint, which is the whole of what
    // it has to clear — and no more, or the building hovers over the ground it stands on.
    const built = placement.constructionPlan!.pieces;
    const span = (pick: (piece: typeof built[number]) => number) => Math.max(...built.map(piece => Math.abs(pick(piece)))) * 2;
    const footprint = groundStructure(surveyFootprintGround(height, 0, 0,
      span(piece => piece.max.x), span(piece => piece.max.z), placement.rotationY));
    expect(roofStage.position.y).toBeGreaterThanOrEqual(footprint.baseY - 1e-6);
    const cos = Math.cos(placement.rotationY), sin = Math.sin(placement.rotationY);
    for (const piece of placement.constructionPlan!.pieces.filter(piece => piece.stage >= 1 && piece.stage <= 3)) {
      for (const x of [piece.min.x, piece.max.x]) for (const z of [piece.min.z, piece.max.z]) {
        expect(roofStage.position.y + piece.min.y).toBeGreaterThanOrEqual(height(x * cos + z * sin, -x * sin + z * cos) - 1e-6);
      }
    }
    expect(source.toJSON()).toEqual(snapshot);
    builder.dispose();
  });

  it('surveys offset wings and terrain vertices between regular footprint samples', () => {
    const source = new THREE.Group();
    const wing = new THREE.Group(); wing.position.set(4, 0, 0); wing.add(member(1, 0, 0.1, 0, 2, 0.2, 2)); source.add(wing);
    const assembly = new ConstructionAssembly(source, 1, 'wing', 'timber');
    const spike = (x: number, z: number) => Math.max(0, 2 - Math.hypot(x - 4.37, z - 0.37) * 100);
    const reserved = groundStructure(surveyFootprintGround(spike, 0, 0, 1, 1));
    const grounding = constructionGrounding(assembly.plan, spike, 0, 0, 0, reserved, undefined, 0.1,
      { originX: 0.37, originZ: 0.37, step: 1 });
    expect(grounding.baseY).toBeCloseTo(2);
    expect(assembly.plan.pieces[0]!.min.x).toBe(3);
    const mesh = assembly.group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.x).toBeCloseTo(3);
  });

  it.each([false, true])('hides an isolated roof during paid construction (inherited=%s)', inherited => {
    const source = new THREE.Group(); source.add(member(4, 0, 2, 0, 2, 0.1, 2));
    if (inherited) source.userData['structureComponents'] = { components: [{ provenance: { phase: 'origin' }, bounds: { center: { x: 0, y: 2, z: 0 }, size: { x: 3, y: 1, z: 3 } } }] };
    const assembly = new ConstructionAssembly(source, 1, 'orphan', 'timber');
    for (const paid of [0, 0.3, 0.65, 0.8, 0.99]) { assembly.update(paid); expect(visibleIndices(assembly)).toBe(0); }
    assembly.update(1); expect(visibleIndices(assembly)).toBeGreaterThan(0);
  });

  it('never promotes inherited roof fabric ahead of its new supporting frame', () => {
    const source = new THREE.Group();
    source.add(member(2, 0, 1, 0, 2, 2, 2), member(4, 0, 2.1, 0, 2.2, 0.1, 2.2), member(4, 10, 2.1, 0, 1, 0.1, 1));
    source.userData['structureComponents'] = { components: [{ provenance: { phase: 'origin' }, bounds: { center: { x: 0, y: 2.1, z: 0 }, size: { x: 3, y: 0.2, z: 3 } } }] };
    const assembly = new ConstructionAssembly(source, 1, 'inherited-roof', 'timber');
    for (const paid of [0, 0.1, 0.25, 0.39, 0.6]) {
      assembly.update(paid);
      for (const roof of assembly.plan.pieces.filter(piece => piece.stage === 4)) expect(roof.startProgress).toBeGreaterThanOrEqual(0.6);
      expect(assembly.group.getObjectByName('Member being seated')!.visible && assembly.plan.pieces.some(piece => piece.stage === 4 && piece.startProgress < paid)).toBe(false);
    }
    expect(assembly.plan.pieces.filter(piece => piece.stage === 4 && piece.min.x > 5).every(piece => piece.startProgress === 1)).toBe(true);
  });
});
