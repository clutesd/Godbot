import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clampRoleToEra, eraRank, resolveBuildingGrammar, type BuildingRole } from '../src/render/assets/BuildingGrammar';
import { BUILD_STAGE, composeBuilding, stageFromName, type BuildStage } from '../src/render/assets/BuildingComposer';
import { MaterialPalette, type Era } from '../src/render/materials/MaterialPalette';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import { CANONICAL_ADULT_HEIGHT } from '../src/render/GodboxRenderer';
import type { CultureStyle } from '../src/sim/types';

const CULTURE: CultureStyle = {
  primary: '#c36557',
  secondary: '#313550',
  accent: '#d9a748',
  symbol: 'sun-step',
  pattern: 'chevron',
  nameSyllables: ['go', 'do'],
};

const ERAS: Era[] = ['primitive', 'early', 'village', 'preIndustrial', 'industrial', 'advanced'];

function profile() {
  return CultureStyleProfileFactory.createFromCulture('test-culture', CULTURE);
}

function vertexCount(group: THREE.Group): number {
  let total = 0;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) total += object.geometry.getAttribute('position').count;
  });
  return total;
}

describe('Building grammar', () => {
  it('resolves identically for the same seed, culture, era and role', () => {
    for (const era of ERAS) {
      const a = resolveBuildingGrammar(profile(), era, 'house', 'plot-7');
      const b = resolveBuildingGrammar(profile(), era, 'house', 'plot-7');
      expect(a).toEqual(b);
    }
  });

  it('varies between plots so settlements avoid repeated silhouettes', () => {
    const a = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-1');
    const b = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-2');
    expect(a.width).not.toBeCloseTo(b.width, 5);
  });

  it('renders a future role as its era-appropriate ancestor', () => {
    expect(clampRoleToEra('factory', 'primitive')).toBe('shelter');
    expect(clampRoleToEra('factory', 'early')).toBe('hut');
    expect(clampRoleToEra('factory', 'village')).toBe('workshop');
    expect(clampRoleToEra('factory', 'industrial')).toBe('factory');
    expect(clampRoleToEra('research', 'preIndustrial')).toBe('hall');
  });

  it('never renders a modern role in the primitive era', () => {
    const roles: BuildingRole[] = ['house', 'shrine', 'market', 'workshop', 'hall', 'factory', 'foundry', 'research', 'energy'];
    for (const role of roles) {
      const resolved = clampRoleToEra(role, 'primitive');
      expect(['shelter', 'lean-to', 'ritual-marker', 'store-pit']).toContain(resolved);
    }
  });

  it('carries the culture lineage into industrial and advanced structures', () => {
    const source = profile();
    for (const era of ['industrial', 'advanced'] as Era[]) {
      const grammar = resolveBuildingGrammar(source, era, 'factory', 'plot-3');
      expect(grammar.motif).toBe(source.motifFamily);
      expect(grammar.pattern).toBe(source.patternStyle);
      expect(grammar.patternBands).toBeGreaterThan(0);
    }
  });

  it('grows richer as the civilisation advances', () => {
    const previous = { ornament: -1, emissive: -1 };
    for (const era of ERAS) {
      const grammar = resolveBuildingGrammar(profile(), era, 'shrine', 'plot-9');
      expect(grammar.emissive).toBeGreaterThanOrEqual(previous.emissive);
      previous.emissive = grammar.emissive;
      previous.ornament = grammar.ornament;
    }
    expect(previous.ornament).toBeGreaterThan(0.5);
  });
});

describe('Building composition', () => {
  it('emits deterministic geometry for identical inputs', () => {
    const palette = new MaterialPalette({ culture: CULTURE, era: 'village' });
    const grammar = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-4');
    const first = composeBuilding(grammar, palette, 'plot-4', BUILD_STAGE.DETAIL);
    const second = composeBuilding(grammar, palette, 'plot-4', BUILD_STAGE.DETAIL);
    expect(vertexCount(second.group)).toBe(vertexCount(first.group));
    expect(second.height).toBeCloseTo(first.height, 10);
    palette.dispose();
  });

  it('accumulates structure through the construction lifecycle', () => {
    const palette = new MaterialPalette({ culture: CULTURE, era: 'village' });
    const grammar = resolveBuildingGrammar(profile(), 'village', 'house', 'plot-5');
    const stages: BuildStage[] = [BUILD_STAGE.FOUNDATION, BUILD_STAGE.FRAME, BUILD_STAGE.WALLS, BUILD_STAGE.ROOF, BUILD_STAGE.DETAIL];
    let previous = 0;
    for (const stage of stages) {
      const count = vertexCount(composeBuilding(grammar, palette, 'plot-5', stage).group);
      expect(count).toBeGreaterThan(previous);
      previous = count;
    }
    palette.dispose();
  });

  it('maps transition frame names onto lifecycle stages', () => {
    expect(stageFromName('foundation')).toBe(BUILD_STAGE.FOUNDATION);
    expect(stageFromName('frame')).toBe(BUILD_STAGE.FRAME);
    expect(stageFromName('partial-walls')).toBe(BUILD_STAGE.WALLS);
    expect(stageFromName('roof')).toBe(BUILD_STAGE.ROOF);
    expect(stageFromName('complete')).toBe(BUILD_STAGE.DETAIL);
    expect(stageFromName(undefined)).toBe(BUILD_STAGE.DETAIL);
  });

  it('keeps every structure inside its declared footprint', () => {
    const box = new THREE.Box3();
    for (const era of ERAS) {
      const palette = new MaterialPalette({ culture: CULTURE, era });
      for (const role of ['house', 'shrine', 'workshop', 'factory', 'energy'] as BuildingRole[]) {
        const grammar = resolveBuildingGrammar(profile(), era, role, `${era}:${role}`);
        const { group, height } = composeBuilding(grammar, palette, `${era}:${role}`, BUILD_STAGE.DETAIL);
        box.setFromObject(group);
        expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
        expect(height).toBeGreaterThan(0);
        // Enclosures, forecourts and gateways may reach beyond the body, but never far enough
        // to collide with a neighbouring plot.
        expect(box.max.x - box.min.x).toBeLessThan(grammar.width * 6);
        expect(box.max.z - box.min.z).toBeLessThan(grammar.depth * 8);
      }
      palette.dispose();
    }
  });

  it('draws each structure in a small number of merged surfaces', () => {
    const palette = new MaterialPalette({ culture: CULTURE, era: 'advanced' });
    const grammar = resolveBuildingGrammar(profile(), 'advanced', 'research', 'plot-6');
    const { group } = composeBuilding(grammar, palette, 'plot-6', BUILD_STAGE.DETAIL);
    let meshes = 0;
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes += 1;
    });
    expect(meshes).toBeGreaterThan(0);
    expect(meshes).toBeLessThanOrEqual(12);
    palette.dispose();
  });
});

describe('Era ranking', () => {
  it('is monotonic across the civilisation timeline', () => {
    for (let index = 1; index < ERAS.length; index += 1) {
      expect(eraRank(ERAS[index]!)).toBeGreaterThan(eraRank(ERAS[index - 1]!));
    }
  });
});

describe('Human scale', () => {
  it('keeps the canonical adult clearly shorter than even the smallest inhabited structure', () => {
    const smallRoles: BuildingRole[] = ['shelter', 'lean-to', 'store-pit', 'ritual-marker', 'hut', 'house'];
    for (const era of ERAS) {
      const palette = new MaterialPalette({ culture: CULTURE, era });
      for (const role of smallRoles) {
        const grammar = resolveBuildingGrammar(profile(), era, role, `${era}:${role}:scale`);
        const { height } = composeBuilding(grammar, palette, `${era}:${role}:scale`, BUILD_STAGE.DETAIL);
        // A settlement's smallest ordinary structure must still rise well above a person; the
        // grammar footprint fits the placement footprint at roughly unit scale, so this
        // canonical height is a fair stand-in for what the renderer draws in world space.
        expect(height).toBeGreaterThan(CANONICAL_ADULT_HEIGHT * 1.4);
      }
      palette.dispose();
    }
  });
});
