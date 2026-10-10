import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { productionBuildingShell, productionConstructionTarget } from '../src/render/assets/ProductionBuildingShell';
import { constructionAssemblyPlan, ConstructionAssembly } from '../src/render/construction/ConstructionAssembly';
import { IndustryRenderer } from '../src/render/industry/IndustryRenderer';
import { processingWorld, placeFacility } from './fixtures/processingFacilities';

const culture = { primary: '#72503b', secondary: '#35405c', accent: '#d8ad4f', symbol: 'sun-step' as const, pattern: 'chevron' as const, nameSyllables: ['ka'] };

describe('subsystem buildings share production architecture', () => {
  it('bakes canonical member placement and keeps every finished detail triangle in construction', () => {
    const builder = new AssetBuilder('subsystem-target');
    const source = new THREE.Group();
    const shell = productionBuildingShell(builder, { seed: 'subsystem-target', culture, era: 'industrial', archetype: 'warehouse' }, 1.3, 0.8, 'Carrier shell');
    shell.position.set(1.2, 0, -0.4); shell.rotation.y = 0.6; source.add(shell);
    const target = productionConstructionTarget(source);
    const plan = constructionAssemblyPlan(target, 1, 'subsystem-target', 'timber');
    let indices = 0;
    target.traverse(node => { if (node instanceof THREE.Mesh) indices += node.geometry.index!.count; });
    expect(plan.pieces.reduce((sum, piece) => sum + piece.count, 0)).toBe(indices);
    expect(plan.pieces.length).toBeGreaterThan(0);
    const assembly = new ConstructionAssembly(target, 1, 'subsystem-target', 'timber'); assembly.update(1);
    expect(new THREE.Box3().setFromObject(assembly.group).min.x).toBeCloseTo(new THREE.Box3().setFromObject(target).min.x);
    expect(new THREE.Box3().setFromObject(assembly.group).max.z).toBeCloseTo(new THREE.Box3().setFromObject(target).max.z);
    builder.dispose();
  });

  it('renders processing storage shells from a spec and uses their future members while building', () => {
    const { state, s } = processingWorld('canonical-industry');
    const facility = placeFacility(state, s, 'wood', 3);
    const renderer = new IndustryRenderer(); renderer.update(state, 0, () => 0);
    expect(renderer.group.getObjectByName('Lumber storage shell')?.userData['buildingSpec']).toBeTruthy();
    facility.progress = 0.5; facility.status = 'under-construction'; renderer.update(state, 0, () => 0);
    expect(renderer.group.getObjectByName('Physical building assembly')).toBeTruthy();
    expect(renderer.group.getObjectByName('Works under construction')).toBeUndefined();
    renderer.dispose();
  });

  it('draws a real kiln for every ceramics tier, not the generic reserved-family box', () => {
    for (const [tier, kilnName] of [[1, 'Clamp kiln'], [2, 'Bottle kiln'], [3, 'Tunnel kiln']] as const) {
      const { state, s } = processingWorld(`ceramics-tier-${tier}`);
      placeFacility(state, s, 'ceramics', tier);
      const renderer = new IndustryRenderer(); renderer.update(state, 0, () => 0);
      expect(renderer.group.getObjectByName(kilnName)).toBeTruthy();
      expect(renderer.group.getObjectByName('Process equipment')).toBeUndefined();
      renderer.dispose();
    }
  });
});
