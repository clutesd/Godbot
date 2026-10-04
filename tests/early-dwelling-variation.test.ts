import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { resolveBuildingSpec, validateBuildingSpec } from '../src/render/architecture/BuildingSpec';
import { applySpecToGrammar } from '../src/render/architecture/SpecGrammarBridge';
import { resolveBuildingGrammar } from '../src/render/assets/BuildingGrammar';
import { BUILD_STAGE, composeBuilding } from '../src/render/assets/BuildingComposer';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import type { CultureStyle } from '../src/sim/types';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import type { AssemblyPiece } from '../src/render/assets/GeometryBuilder';

const culture: CultureStyle = { primary: '#c36557', secondary: '#313550', accent: '#d9a748',
  symbol: 'sun-step', pattern: 'chevron', nameSyllables: ['go', 'do'] };
const profile = CultureStyleProfileFactory.createFromCulture('variation', culture);
function specFor(seed: string, long: boolean) {
  return resolveBuildingSpec({ archetype: 'house', role: 'house', era: long ? 'village' : 'primitive', seed,
    culture: { materialBias: profile.materialBias, roofLanguage: profile.roofLanguage, trimDensity: 0.3 },
    climate: { temperature: 0.5, moisture: 0.5 } });
}
function build(spec: ReturnType<typeof specFor>, stage = BUILD_STAGE.FINISH as number) {
  const grammar = resolveBuildingGrammar(profile, spec.era, 'house', spec.seed);
  applySpecToGrammar(grammar, spec);
  return composeBuilding(grammar, new MaterialPalette({ culture, era: spec.era }), spec.seed, stage as never).group;
}
function representatives(long: boolean) {
  const variants = new Map<number, ReturnType<typeof specFor>>();
  for (let i = 0; i < 100 && variants.size < 5; i++) {
    const spec = specFor(`dwelling-${i}`, long);
    variants.set(spec.dwellingVariant!.silhouette, spec);
  }
  return [...variants.values()];
}

describe('Early dwelling silhouettes', () => {
  it.each([false, true])('resolves five stable, valid silhouettes (longhouse=%s)', long => {
    const specs = representatives(long);
    expect(specs).toHaveLength(5);
    for (const spec of specs) {
      expect(specFor(spec.seed, long)).toEqual(spec);
      expect(validateBuildingSpec(spec)).toEqual([]);
      const group = build(spec);
      expect(new THREE.Box3().setFromObject(group).isEmpty()).toBe(false);
      expect(group.children.length).toBeLessThan(24);
    }
    const proportions = specs.map(s => long ? s.width / s.depth : s.storeyHeight / s.width);
    expect(Math.max(...proportions) / Math.min(...proportions)).toBeGreaterThan(1.45);
  });

  it('keeps roofs and completed additions out of the frame stage', () => {
    for (const spec of [...representatives(false), ...representatives(true)]) {
      const frame = build(spec, BUILD_STAGE.FRAME);
      const full = build(spec);
      expect(new THREE.Box3().setFromObject(frame).max.y).toBeLessThan(new THREE.Box3().setFromObject(full).max.y);
    }
  });

  it('cuts a real smoke opening through the hall roof', () => {
    const spec = representatives(true).find(s => s.dwellingVariant!.smokeOpening)!;
    const roofOnly = build(spec, BUILD_STAGE.ROOF);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
    roofOnly.updateMatrixWorld(true);
    const hits = ray.intersectObject(roofOnly, true);
    // Ridge aperture has no covering; any hit must be below the roof.
    const ridge = spec.plinthHeight + spec.storeyHeight + spec.depth * spec.roof.pitch / 2;
    expect(hits.every(hit => hit.point.y < ridge - 0.03)).toBe(true);
    const sealed = { ...spec, dwellingVariant: { ...spec.dwellingVariant!, smokeOpening: false } };
    const closed = build(sealed, BUILD_STAGE.ROOF);
    closed.updateMatrixWorld(true);
    expect(ray.intersectObject(closed, true)[0]!.point.y).toBeGreaterThan(ridge - 0.03);
  });

  it('preserves roof height and additions in simplified distance models', () => {
    const builder = new AssetBuilder('dwelling-lods');
    for (const spec of [...representatives(false), ...representatives(true)]) {
      const asset = builder.getAsset('building', { seed: spec.seed, culture, era: spec.era, variant: 'house' });
      expect(asset.lods).toHaveLength(2);
      const full = (asset.mesh as THREE.LOD).levels[0]!.object;
      const bounds = new THREE.Box3();
      full.updateMatrixWorld(true);
      full.traverse(object => {
        if (object instanceof THREE.Mesh) {
          for (const piece of object.geometry.userData['assemblyPieces'] as AssemblyPiece[]) {
            if (piece.stage > BUILD_STAGE.ROOF) continue;
            bounds.union(new THREE.Box3(new THREE.Vector3(piece.min.x, piece.min.y, piece.min.z),
              new THREE.Vector3(piece.max.x, piece.max.y, piece.max.z)).applyMatrix4(object.matrixWorld));
          }
        }
      });
      for (const lod of asset.lods) {
        const simplified = new THREE.Box3().setFromObject(lod);
        // Removed ridge trim and fewer cone facets move extrema slightly.
        expect(Math.abs(simplified.max.y - bounds.max.y)).toBeLessThan(0.025);
        expect(Math.abs(simplified.max.z - bounds.max.z)).toBeLessThan(0.025);
        expect(Math.abs(simplified.min.z - bounds.min.z)).toBeLessThan(0.025);
      }
    }
  });
});
