import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { CultureStyle } from '../src/sim/types';
import type { DevelopmentResponse } from '../src/sim/development/types';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { BUILD_STAGE } from '../src/render/assets/BuildStages';
import type { BuildingRole } from '../src/render/assets/BuildingGrammar';

const CULTURE: CultureStyle = {
  primary: '#7b6a52', secondary: '#39423d', accent: '#d2b77b',
  symbol: 'river-eye', pattern: 'wave', nameSyllables: ['ar', 'ven'],
};

function signature(object: THREE.Object3D): string {
  let vertices = 0;
  let meshes = 0;
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    meshes += 1;
    vertices += node.geometry.getAttribute('position')?.count ?? 0;
  });
  return [
    object.userData['architectureArchetype'],
    object.userData['structuralFamily'],
    object.userData['grammarMassing'],
    object.userData['grammarRoofFamily'],
    Number(object.userData['footprintWidth'] ?? 0).toFixed(3),
    Number(object.userData['footprintDepth'] ?? 0).toFixed(3),
    meshes,
    vertices,
  ].join('|');
}

function buildRole(builder: AssetBuilder, role: BuildingRole): THREE.Object3D {
  return builder.getAsset('building', {
    seed: 'same-architectural-seed',
    culture: CULTURE,
    era: 'early',
    variant: `${role}#${BUILD_STAGE.DETAIL}`,
  }).mesh;
}

function adaptation(name: NonNullable<DevelopmentResponse['adaptation']>): DevelopmentResponse {
  const cache = name === 'cache';
  return {
    adaptation: name,
    temporary: name === 'lean-to',
    need: cache ? 'food' : 'housing',
    form: cache ? 'store' : 'dwelling',
    name,
    level: 1,
    material: name === 'earth-shelter' ? 'earth' : 'timber',
    cultureId: 'authority-test',
    style: CULTURE,
    services: cache ? { food: 0.1 } : { housing: 0.1 },
    reasons: [],
    capabilities: [],
    cost: { food: 0, wood: 2, minerals: 0, goods: 0, wealth: 0 },
    labor: 1,
  };
}

describe('BuildingSpec is production architectural authority', () => {
  it('keeps legacy house-like roles as compatibility labels without changing geometry', () => {
    const builder = new AssetBuilder('spec-authority-role');
    const roles: BuildingRole[] = ['shelter', 'lean-to', 'hut', 'house', 'compound'];
    const assets = roles.map(role => buildRole(builder, role));

    for (const asset of assets) {
      expect(asset.userData['architectureArchetype']).toBe('house');
      expect(asset.userData['structuralFamily']).toBeTruthy();
    }
    expect(new Set(assets.map(signature)).size).toBe(1);
    expect(new Set(assets.map(asset => asset.userData['grammarRole'])).size).toBe(roles.length);
    builder.dispose();
  });

  it('keeps old industrial and institutional aliases from changing architecture', () => {
    const builder = new AssetBuilder('spec-authority-alias');
    const pairs: [BuildingRole, BuildingRole, string][] = [
      ['factory', 'foundry', 'factory'],
      ['factory', 'energy', 'factory'],
      ['hall', 'research', 'civic-hall'],
    ];
    for (const [left, right, archetype] of pairs) {
      const a = buildRole(builder, left);
      const b = buildRole(builder, right);
      expect(a.userData['architectureArchetype']).toBe(archetype);
      expect(b.userData['architectureArchetype']).toBe(archetype);
      expect(signature(a)).toBe(signature(b));
    }
    builder.dispose();
  });

  it('renders every founding adaptation through BuildingSpec', () => {
    const builder = new AssetBuilder('spec-authority-adaptation');
    const names: NonNullable<DevelopmentResponse['adaptation']>[] = ['lean-to', 'earth-shelter', 'hut', 'cache'];
    const assets = names.map(name => builder.getAsset('building', {
      seed: `adaptation:${name}`,
      culture: CULTURE,
      era: 'primitive',
      variant: `${name === 'cache' ? 'store-pit' : name === 'lean-to' ? 'lean-to' : name === 'hut' ? 'hut' : 'shelter'}#${BUILD_STAGE.DETAIL}`,
      development: adaptation(name),
    }).mesh);

    names.forEach((name, index) => {
      const asset = assets[index]!;
      expect(asset.userData['architectureArchetype']).toBeTruthy();
      expect(asset.userData['architectureAdaptation']).toBe(name);
      expect(asset.userData['structuralFamily']).toBeTruthy();
      expect(asset.userData['architectureMaterials']).toBeTruthy();
    });
    expect(new Set(assets.map(signature)).size).toBe(names.length);
    builder.dispose();
  });
});
