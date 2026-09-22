import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vegetationFixture } from './fixtures/vegetation';
import { createResourceCargo } from '../src/render/resources/ResourceCargo';
import { ResourceFlowRenderer } from '../src/render/resources/ResourceFlowRenderer';
import { ResourceWorkScene } from '../src/render/resources/ResourceWorkScene';
import { mineralVisualProfile } from '../src/render/resources/MineralPresentation';
import type { FreightTrip } from '../src/sim/transport/types';

describe('mined material visual polish', () => {
  it('gives major extracted materials distinct silhouette and material identities', () => {
    const ids = ['stone', 'clay', 'coal', 'copper-ore', 'tin-ore', 'iron-ore', 'uranium-ore'];
    const profiles = ids.map(mineralVisualProfile);
    expect(new Set(profiles.map(profile => profile.baseColour)).size).toBe(ids.length);
    expect(new Set(profiles.map(profile => profile.kind)).size).toBe(ids.length);
    expect(profiles.find(profile => profile.kind === 'uranium')!.accentStrength).toBeGreaterThan(
      profiles.find(profile => profile.kind === 'iron')!.accentStrength);
    expect(profiles.find(profile => profile.kind === 'stone')!.shard).toBe(false);
    expect(profiles.find(profile => profile.kind === 'coal')!.shard).toBe(true);
  });

  it('uses material-specific freight geometry without changing the authoritative trip', () => {
    const make = (materialId: string) => {
      const trip = { materialId, quantity: 18, mode: 'road' } as FreightTrip;
      const before = JSON.stringify(trip);
      const mesh = createResourceCargo(trip)!;
      expect(JSON.stringify(trip)).toBe(before);
      return mesh;
    };
    const stone = make('stone');
    const clay = make('clay');
    const coal = make('coal');
    const copper = make('copper-ore');
    expect(stone.geometry.type).not.toBe(clay.geometry.type);
    expect(coal.geometry.type).not.toBe(stone.geometry.type);
    expect(copper.geometry.type).not.toBe(coal.geometry.type);
    expect((copper.material as THREE.MeshStandardMaterial).metalness).toBeGreaterThan(
      (stone.material as THREE.MeshStandardMaterial).metalness);
  });

  it('renders canonical mined stock as rubble/shards plus bounded ore accents without mutating stock', () => {
    const fixture = vegetationFixture('mined-material-storage-polish');
    for (const settlement of fixture.simulation.state.settlements) settlement.localMaterials = {};
    const settlement = fixture.simulation.state.settlements[0]!;
    settlement.localMaterials = {
      stone: 24, clay: 12, coal: 18, 'copper-ore': 10, 'iron-ore': 9, 'uranium-ore': 4,
    };
    settlement.structurePlots = [];
    const before = JSON.stringify(settlement.localMaterials);
    const scene = new ResourceWorkScene(fixture.world, 'mined-material-storage');
    const renderer = new ResourceFlowRenderer(fixture.simulation.state, fixture.surface, scene);
    renderer.update();

    const rocks = renderer.group.getObjectByName('Stored stone and clay') as THREE.InstancedMesh;
    const shards = renderer.group.getObjectByName('Stored ore and coal shards') as THREE.InstancedMesh;
    const accents = renderer.group.getObjectByName('Stored ore mineral accents') as THREE.InstancedMesh;
    expect(rocks.count).toBeGreaterThan(0);
    expect(shards.count).toBeGreaterThan(0);
    expect(accents.count).toBeGreaterThan(0);
    expect(accents.count).toBeLessThanOrEqual(shards.count);
    expect(JSON.stringify(settlement.localMaterials)).toBe(before);
  });
});
