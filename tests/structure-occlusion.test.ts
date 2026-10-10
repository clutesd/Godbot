import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { OcclusionField, type OccluderBox } from '../src/render/assets/OcclusionField';
import { GeometryBuilder } from '../src/render/assets/GeometryBuilder';
import { BUILD_STAGE, composeBuilding } from '../src/render/assets/BuildingComposer';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { resolveBuildingGrammar } from '../src/render/assets/BuildingGrammar';
import { MaterialPalette, type Era } from '../src/render/materials/MaterialPalette';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import {
  injectOcclusionFragmentStage,
  injectOcclusionVertexStage,
  injectSurfaceFragmentStage,
  injectSurfaceVertexStage,
} from '../src/render/materials/SurfaceDetail';
import { proceduralProgramFor } from '../src/render/architecture/SurfaceProgramLibrary';
import type { CultureStyle } from '../src/sim/types';

const CULTURE: CultureStyle = {
  primary: '#c36557',
  secondary: '#313550',
  accent: '#d9a748',
  symbol: 'sun-step',
  pattern: 'chevron',
  nameSyllables: ['go', 'do'],
};

/** A canonical building is about one unit across; everything here is sized from that. */
const SPAN = 1.2;

function box(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): OccluderBox {
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/** A free-standing wall slab, 0.05 thick, centred on x = 0. */
const WALL = box(-0.025, 0, -0.5, 0.025, 0.7, 0.5);

function field(boxes: OccluderBox[]): OcclusionField {
  const built = OcclusionField.build(boxes, SPAN);
  expect(built).toBeDefined();
  return built!;
}

describe('Structural occlusion measurement', () => {
  it('leaves an exposed wall face unoccluded', () => {
    const measured = field([WALL]);
    // Mid-height, mid-length, facing out into open air.
    expect(measured.occlusionAt(0.025, 0.4, 0, 1, 0, 0)).toBeLessThan(0.05);
    expect(measured.occlusionAt(-0.025, 0.4, 0, -1, 0, 0)).toBeLessThan(0.05);
  });

  it('leaves a surface facing open sky unoccluded', () => {
    const measured = field([WALL]);
    expect(measured.occlusionAt(0, 0.7, 0, 0, 1, 0)).toBeLessThan(0.05);
  });

  it('darkens the junction where two walls meet', () => {
    const cross = box(-0.5, 0, -0.025, 0.5, 0.7, 0.025);
    const measured = field([WALL, cross]);
    const corner = measured.occlusionAt(0.025, 0.4, 0.06, 1, 0, 0);
    const open = measured.occlusionAt(0.025, 0.4, 0.4, 1, 0, 0);
    expect(corner).toBeGreaterThan(open + 0.15);
    // A right-angle junction blocks part of the hemisphere, not most of it.
    expect(corner).toBeLessThan(0.7);
  });

  it('darkens a wall where it meets the ground it stands on', () => {
    const measured = field([WALL]);
    const base = measured.occlusionAt(0.025, 0.012, 0, 1, 0, 0);
    const middle = measured.occlusionAt(0.025, 0.4, 0, 1, 0, 0);
    expect(base).toBeGreaterThan(middle + 0.15);
  });

  it('drives a narrow gap between two walls darker than either open face', () => {
    const near = box(0.06, 0, -0.5, 0.11, 0.7, 0.5);
    const measured = field([WALL, near]);
    const slot = measured.occlusionAt(0.025, 0.4, 0, 1, 0, 0);
    expect(slot).toBeGreaterThan(0.45);
    // The outward face of the same pair is still open sky.
    expect(measured.occlusionAt(-0.025, 0.4, 0, -1, 0, 0)).toBeLessThan(0.06);
  });

  it('shades the head of a wall where an eave overhangs it', () => {
    const eave = box(-0.4, 0.7, -0.5, 0.4, 0.74, 0.5);
    const measured = field([WALL, eave]);
    // Just below the eave, on the wall face it shelters.
    const sheltered = measured.occlusionAt(0.025, 0.64, 0, 1, 0, 0);
    const open = measured.occlusionAt(0.025, 0.4, 0, 1, 0, 0);
    expect(sheltered).toBeGreaterThan(open + 0.15);
  });

  it('thickens surfaces thinner than a cell so a roof shell still shades what is under it', () => {
    // A lofted roof panel is recorded as a flat triangle bound with no volume at all.
    const sheet = box(-0.5, 0.7, -0.5, 0.5, 0.7, 0.5);
    const measured = field([WALL, sheet]);
    // A surface looking up at that panel from under it must see it.
    expect(measured.occlusionAt(0.2, 0.6, 0.2, 0, 1, 0)).toBeGreaterThan(0.3);
  });

  it('cannot see an occluder nearer than the bias it starts beyond', () => {
    // The documented limitation of starting rays clear of their own surface: two surfaces facing
    // each other closer than the bias — stacked roof courses, a board just under a shelf — do not
    // shade one another. Asserted so the bias and the bake's reach stay honest about each other.
    const sheet = box(-0.5, 0.7, -0.5, 0.5, 0.7, 0.5);
    const measured = field([WALL, sheet]);
    expect(measured.occlusionAt(0.2, 0.68, 0.2, 0, 1, 0)).toBeLessThan(0.1);
  });

  it('coarsens rather than allocating an unbounded grid for a sprawling site', () => {
    // A watermill's site — pond, races, yard — is several times the span of its mill house.
    const sprawling = field([box(-3, 0, -3, 3, 1.2, 3), WALL]);
    expect(sprawling.stats.cells).toBeLessThanOrEqual(220_000);
    expect(sprawling.stats.cell).toBeGreaterThan(SPAN / 44);
  });

  it('returns no field when there is nothing to measure', () => {
    expect(OcclusionField.build([], SPAN)).toBeUndefined();
  });
});

describe('Baked occlusion on built geometry', () => {
  it('writes occlusion into the spare detail channel, and nothing else', () => {
    const builder = new GeometryBuilder();
    builder.setSectioning(SPAN);
    builder.addBox(0, 0.35, 0, 0.05, 0.7, 1);
    builder.bakeOcclusion(field([WALL]));
    const geometry = builder.build();
    const detail = geometry.getAttribute('aSurfaceDetail');
    expect(detail).toBeDefined();
    let occluded = 0;
    for (let index = 0; index < detail.count; index += 1) {
      expect(detail.getX(index)).toBe(0);
      expect(detail.getY(index)).toBe(0);
      if (detail.getW(index) > 0.3) occluded += 1;
    }
    // The bottom faces sit on the ground and the end faces are buried in the slab's own volume.
    expect(occluded).toBeGreaterThan(0);
    expect(occluded).toBeLessThan(detail.count);
  });

  it('leaves geometry that never measured occlusion fully lit', () => {
    const builder = new GeometryBuilder();
    builder.addBox(0, 0.35, 0, 0.05, 0.7, 1);
    const detail = builder.build().getAttribute('aSurfaceDetail');
    // Zero is unoccluded, which is what the shader has to see on anything that skipped the bake:
    // the mid-distance LODs, plaza paving, scaffolds, every other renderer's geometry.
    for (let index = 0; index < detail.count; index += 1) expect(detail.getW(index)).toBe(0);
  });

  it('shades what can be seen without painting it dark', () => {
    // Most of a structure's triangles face into its own fabric — the hidden side of a wall
    // course, where one box section meets the next — and those are legitimately fully occluded.
    // Judging the bake on all of them would say nothing about how the building looks, so this
    // measures only the vertices that can actually be seen from outside.
    for (const era of ['primitive', 'early', 'village', 'industrial'] as Era[]) {
      const palette = new MaterialPalette({ culture: CULTURE, era });
      const profile = CultureStyleProfileFactory.createFromCulture('test-culture', CULTURE);
      const grammar = resolveBuildingGrammar(profile, era, 'house', `occlusion:${era}`);
      const composed = composeBuilding(grammar, palette, `occlusion:${era}`, BUILD_STAGE.FINISH);

      const meshes: THREE.Mesh[] = [];
      composed.group.traverse(object => {
        if (object instanceof THREE.Mesh && object.userData['surface'] !== 'shadow') meshes.push(object);
      });
      const corners: number[] = [];
      for (const mesh of meshes) {
        const position = mesh.geometry.getAttribute('position');
        const index = mesh.geometry.index!;
        for (let at = 0; at < index.count; at += 1) {
          const vertex = index.getX(at);
          corners.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
        }
      }

      const ray = new THREE.Ray();
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      const hit = new THREE.Vector3();
      let visible = 0, shade = 0, open = 0, shaded = 0;
      for (const mesh of meshes) {
        const detail = mesh.geometry.getAttribute('aSurfaceDetail');
        expect(detail, `${era} ${mesh.name} carries no detail channel`).toBeDefined();
        const position = mesh.geometry.getAttribute('position');
        const normal = mesh.geometry.getAttribute('normal');
        // Sparsely: a brute-force visibility test is vertices times triangles.
        for (let index = 0; index < detail.count; index += 23) {
          ray.direction.set(normal.getX(index), normal.getY(index), normal.getZ(index));
          ray.origin.set(position.getX(index), position.getY(index), position.getZ(index))
            .addScaledVector(ray.direction, 0.003);
          let blocked = false;
          for (let at = 0; at < corners.length && !blocked; at += 9) {
            a.set(corners[at]!, corners[at + 1]!, corners[at + 2]!);
            b.set(corners[at + 3]!, corners[at + 4]!, corners[at + 5]!);
            c.set(corners[at + 6]!, corners[at + 7]!, corners[at + 8]!);
            blocked = ray.intersectTriangle(a, b, c, false, hit) !== null;
          }
          if (blocked) continue;
          const occlusion = Math.max(0, detail.getW(index));
          visible += 1;
          shade += occlusion;
          if (occlusion < 0.08) open += 1;
          if (occlusion > 0.4) shaded += 1;
        }
      }

      expect(visible, `${era} sampled nothing visible`).toBeGreaterThan(40);
      // Both ends of the range have to be present. A structure with no shaded vertices gained
      // nothing from the bake; one with no open vertices has been painted dark rather than shaded.
      expect(shade / visible, `${era} mean visible occlusion`).toBeLessThan(0.7);
      expect(open / visible, `${era} open share`).toBeGreaterThan(0.15);
      expect(shaded / visible, `${era} shaded share`).toBeGreaterThan(0.15);
      palette.dispose();
    }
  });

  it('never shades the surfaces that light themselves', () => {
    const palette = new MaterialPalette({ culture: CULTURE, era: 'industrial' });
    const profile = CultureStyleProfileFactory.createFromCulture('test-culture', CULTURE);
    const grammar = resolveBuildingGrammar(profile, 'industrial', 'factory', 'glow');
    const composed = composeBuilding(grammar, palette, 'glow', BUILD_STAGE.FINISH);
    composed.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const surface = object.userData['surface'] as string;
      if (surface !== 'glow' && surface !== 'forge' && surface !== 'shadow') return;
      const detail = object.geometry.getAttribute('aSurfaceDetail');
      if (!detail) return;
      for (let index = 0; index < detail.count; index += 1) {
        expect(detail.getW(index), `${surface} was shaded`).toBe(0);
      }
    });
    palette.dispose();
  });

  it('is deterministic for one seed', () => {
    const palette = new MaterialPalette({ culture: CULTURE, era: 'village' });
    const profile = CultureStyleProfileFactory.createFromCulture('test-culture', CULTURE);
    const read = (): number[] => {
      const grammar = resolveBuildingGrammar(profile, 'village', 'hall', 'repeat');
      const composed = composeBuilding(grammar, palette, 'repeat', BUILD_STAGE.FINISH);
      const values: number[] = [];
      composed.group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const detail = object.geometry.getAttribute('aSurfaceDetail');
        if (!detail) return;
        for (let index = 0; index < detail.count; index += 1) values.push(detail.getW(index));
      });
      return values;
    };
    expect(read()).toEqual(read());
    palette.dispose();
  });
});

describe('Massing LODs', () => {
  it('shade their massing so a building does not flash lighter at the LOD boundary', () => {
    const builder = new AssetBuilder();
    for (const era of ['village', 'industrial'] as Era[]) {
      const asset = builder.getAsset('building', {
        era, culture: CULTURE, seed: `lod:${era}`, variant: 'house',
      });
      const lod = asset.mesh;
      expect(lod, `${era} produced no asset`).toBeDefined();
      const tiers = lod.children.filter(child => child.name !== 'building-full-detail');
      expect(tiers.length, `${era} built no massing tiers`).toBeGreaterThan(0);
      for (const tier of tiers) {
        let shaded = 0, vertices = 0, grounded = 0;
        tier.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          const detail = object.geometry.getAttribute('aSurfaceDetail');
          expect(detail, `${era} ${tier.name} carries no detail channel`).toBeDefined();
          const position = object.geometry.getAttribute('position');
          for (let index = 0; index < detail.count; index += 1) {
            vertices += 1;
            const occlusion = Math.max(0, detail.getW(index));
            // Every massing vertex stands in for crevices the box does not have.
            if (occlusion > 0.2) shaded += 1;
            // …and the ones at the ground line carry the contact darkening as well.
            if (position.getY(index) <= 0.001 && occlusion > 0.6) grounded += 1;
          }
        });
        expect(shaded, `${era} ${tier.name} unshaded`).toBe(vertices);
        expect(grounded, `${era} ${tier.name} has no contact shading`).toBeGreaterThan(0);
      }
    }
    builder.dispose();
  });
});

describe('Occlusion in the shared surface shader', () => {
  it('carries the channel from the vertex stage and spends it on indirect light', () => {
    const vertexShader = injectOcclusionVertexStage(THREE.ShaderLib.standard.vertexShader);
    const fragmentShader = injectOcclusionFragmentStage(THREE.ShaderLib.standard.fragmentShader);
    expect(vertexShader).toContain('vGbOcclusion = aSurfaceDetail.w;');
    expect(fragmentShader).toContain('reflectedLight.indirectDiffuse *= gbAmbientAccess;');
    expect(fragmentShader).not.toContain('${');
  });

  it('declares every shared identifier exactly once when a pattern is also installed', () => {
    const program = proceduralProgramFor('ashlar', 0.5);
    const vertexShader = injectSurfaceVertexStage(THREE.ShaderLib.standard.vertexShader);
    const fragmentShader = injectSurfaceFragmentStage(program, THREE.ShaderLib.standard.fragmentShader);
    const occurrences = (source: string, needle: string): number => source.split(needle).length - 1;
    expect(occurrences(vertexShader, 'attribute vec4 aSurfaceDetail;')).toBe(1);
    expect(occurrences(vertexShader, 'varying float vGbOcclusion;')).toBe(1);
    expect(occurrences(fragmentShader, 'varying float vGbOcclusion;')).toBe(1);
    expect(occurrences(fragmentShader, 'float gbOcclude =')).toBe(1);
    // The occlusion block has to come before the light modulation that reads it.
    expect(fragmentShader.indexOf('float gbAmbientAccess'))
      .toBeLessThan(fragmentShader.indexOf('reflectedLight.indirectDiffuse *= gbAmbientAccess;'));
  });
});
