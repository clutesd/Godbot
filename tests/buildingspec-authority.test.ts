import { MATERIAL_LIBRARY } from '../src/render/architecture/MaterialLibrary';
import { DEVELOPMENT_PROGRAM_INPUTS } from '../src/render/architecture/ProductionBuildingInputs';
import { SETTLEMENT_NEEDS } from '../src/sim/development/types';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BUILDING_ROLES, routeArchetype } from '../src/render/architecture/ArchetypeRouting';
import { BUILDING_ARCHETYPES, ARCHETYPE_LIBRARY, type BuildingArchetype } from '../src/render/architecture/BuildingArchetype';
import { ConstructionAssembly } from '../src/render/construction/ConstructionAssembly';
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
  const hash = createHash('sha256');
  let vertices = 0;
  let meshes = 0;
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const attribute of Object.values(node.geometry.attributes) as THREE.BufferAttribute[]) {
      const array = attribute.array;
      hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    }
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
    vertices, hash.digest('hex'),
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
  it('keeps purpose visually legible through the spec independently of the compatibility label', () => {
    const builder = new AssetBuilder('purpose-authority');
    const government = { ...adaptation('hut'), adaptation: undefined, need: 'government' as const, form: 'hall' as const, level: 3 };
    const knowledge = { ...government, need: 'knowledge' as const };
    const config = { seed: 'same-purpose-seed', culture: CULTURE, era: 'industrial' as const, variant: 'hall#7' };
    const a = builder.getAsset('building', { ...config, development: government }).mesh;
    const b = builder.getAsset('building', { ...config, development: knowledge }).mesh;
    expect(a.userData['architectureArchetype']).toBe(b.userData['architectureArchetype']);
    expect(a.userData['grammarCrown']).not.toBe(b.userData['grammarCrown']);
    expect(signature(a)).not.toBe(signature(b));
    builder.dispose();
  });

  it('resolves every compatibility input and active archetype, and rejects unknown IDs', () => {
    const builder = new AssetBuilder('complete-production-inputs');
    for (const role of BUILDING_ROLES) expect(buildRole(builder, role).userData['architectureArchetype']).toBeTruthy();
    for (const archetype of BUILDING_ARCHETYPES.filter(id => ARCHETYPE_LIBRARY[id].status === 'active')) {
      const mesh = builder.getAsset('building', { seed: 'active-input', culture: CULTURE, era: 'primitive', archetype }).mesh;
      expect(mesh.userData['architectureArchetype']).toBe(archetype);
      expect(mesh.userData['structuralFamily']).toBeTruthy();
    }
    expect(new Set(DEVELOPMENT_PROGRAM_INPUTS.map(input => input.need))).toEqual(new Set(SETTLEMENT_NEEDS));
    for (const program of DEVELOPMENT_PROGRAM_INPUTS) {
      const mesh = builder.getAsset('building', { seed: 'program-input', culture: CULTURE, era: 'village',
        development: { ...adaptation('hut'), adaptation: undefined, ...program } }).mesh;
      expect(mesh.userData['architectureArchetype']).toBeTruthy();
      expect(mesh.userData['architecturePurpose']).toBe(program.need);
    }
    expect(() => buildRole(builder, 'unknown-structure' as BuildingRole)).toThrow(/Unknown/);
    expect(() => builder.getAsset('building', { seed: 'unknown', culture: CULTURE, era: 'early', archetype: 'unknown-structure' as BuildingArchetype })).toThrow(/Unknown building archetype/);
    builder.dispose();
  });

  it('constructs founding adaptations from their exact deterministic finished component target', () => {
    for (const name of ['lean-to', 'earth-shelter', 'hut', 'cache'] as const) {
      const builder = new AssetBuilder('future-target');
      const config = { seed: 'future-target', culture: CULTURE, era: 'primitive' as const, variant: 'house#7', development: adaptation(name) };
      const target = builder.getAsset('building', config).mesh;
      const assembly = new ConstructionAssembly(target, 1, name, config.development.material ?? 'timber');
      expect(assembly.plan.pieces.length).toBeGreaterThan(0);
      assembly.update(0);
      expect(assembly.plan.progress).toBe(0);
      expect(signature(builder.getAsset('building', config).mesh)).toBe(signature(target));
      builder.dispose();
    }
  });

  it('uses legitimate primitive lineages without lifting early civic, exchange or fuel shelters', () => {
    for (const program of DEVELOPMENT_PROGRAM_INPUTS.filter(p => ['government', 'trade', 'security', 'energy', 'transport'].includes(p.need) && p.form !== 'works')) {
      const decision = routeArchetype({ role: 'house', period: 'neolithic', level: 1, ...program });
      expect(decision.beforeLineage, `${program.need}/${program.form}`).toBe(false);
    }
  });

  it('does not reuse a target after its authoritative capability evidence changes', () => {
    const builder = new AssetBuilder('capability-cache');
    const fresh = new AssetBuilder('capability-cache');
    const base = { seed: 'capability-cache', culture: CULTURE, era: 'industrial' as const, variant: 'factory#7' };
    const response = { ...adaptation('hut'), adaptation: undefined, need: 'manufacturing' as const,
      form: 'works' as const, material: 'metal' as const, level: 3 };
    const limited = builder.getAsset('building', { ...base, development: response }).mesh;
    const capabilities = [...new Set(Object.values(MATERIAL_LIBRARY).flatMap(material => material.requiresCapabilities))];
    const earned = { ...response, capabilities };
    const actual = builder.getAsset('building', { ...base, development: earned }).mesh;
    const expected = fresh.getAsset('building', { ...base, development: earned }).mesh;
    expect(signature(actual)).toBe(signature(expected));
    expect(actual.userData['architectureMaterials']).toEqual(expected.userData['architectureMaterials']);
    expect(actual).not.toBe(limited);
    builder.dispose(); fresh.dispose();
  });

  it('guards live renderer and browser against a second founding architecture path', () => {
    const renderer = readFileSync(new URL('../src/render/GodboxRenderer.ts', import.meta.url), 'utf8');
    expect(renderer).not.toMatch(/createSurvivalStructure|createActiveSurvivalConstructionSite|shelterGroundAt/);
    expect(renderer).toContain('new ConstructionAssembly(targetAsset.mesh');
    for (const [start, end] of [['private addRoutePortals', 'private'], ['private addMarket', 'private']] as const) {
      const offset = renderer.indexOf(start);
      const body = renderer.slice(offset, renderer.indexOf(end, offset + start.length));
      expect(body).toContain("this.assetBuilder.getAsset('building'");
      expect(body).not.toMatch(/const (roof|canopy) = new THREE.Mesh/);
    }
    const browser = readFileSync(new URL('../src/dev/architectureBrowser.ts', import.meta.url), 'utf8');
    expect(browser).toContain('BUILDING_ROLES.map');
    const browserInputs = readFileSync(new URL('../src/dev/architectureBrowserModel.ts', import.meta.url), 'utf8');
    for (const name of ['lean-to', 'earth-shelter', 'hut', 'cache']) expect(browserInputs).toContain(`adaptation: '${name}'`);
    expect(browser).toContain("assetBuilder.getAsset('building'");
    expect(browser).toContain('Founding / early');
    expect(browser).toContain('programSelect');
    for (const path of ['GodboxRendererEnhanced.ts', 'energy/EnergyRenderer.ts', 'industry/IndustryRenderer.ts', 'transport/TransportStructures.ts']) {
      const source = readFileSync(new URL(`../src/render/${path}`, import.meta.url), 'utf8');
      expect(source).toContain('productionBuildingShell');
      expect(source).not.toMatch(/const (roof|canopy) = new THREE.Mesh/);
    }
  });

});
