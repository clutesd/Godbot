import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vegetationFixture } from './fixtures/vegetation';
import { createResourceCargo } from '../src/render/resources/ResourceCargo';
import { ResourceFlowRenderer } from '../src/render/resources/ResourceFlowRenderer';
import { ResourceSiteRenderer } from '../src/render/resources/ResourceSiteRenderer';
import { ResourceWorkScene } from '../src/render/resources/ResourceWorkScene';
import { mineralAerialSignature, mineralVisualProfile } from '../src/render/resources/MineralPresentation';
import type { FreightTrip } from '../src/sim/transport/types';

describe('mined material visual polish', () => {
  it('gives major extracted materials distinct silhouette and material identities', () => {
    const ids = ['stone', 'clay', 'coal', 'copper-ore', 'tin-ore', 'iron-ore', 'uranium-ore'];
    const profiles = ids.map(mineralVisualProfile);
    expect(new Set(profiles.map(profile => profile.baseColour)).size).toBe(ids.length);
    expect(new Set(profiles.map(profile => profile.kind)).size).toBe(ids.length);
    expect(new Set(profiles.map(profile => profile.geometry)).size).toBeGreaterThanOrEqual(4);
    expect(profiles.find(profile => profile.kind === 'uranium')!.accentStrength).toBeGreaterThan(
      profiles.find(profile => profile.kind === 'iron')!.accentStrength);
    expect(profiles.find(profile => profile.kind === 'stone')!.shard).toBe(false);
    expect(profiles.find(profile => profile.kind === 'coal')!.shard).toBe(true);
  });

  it('gives every major mined material an aerial signature and keeps copper, iron and tin macros distinct', () => {
    const ids = ['stone', 'clay', 'coal', 'copper-ore', 'tin-ore', 'iron-ore', 'uranium-ore'];
    const signatures = ids.map(mineralAerialSignature);
    expect(new Set(signatures.map(signature => signature.pattern)).size).toBe(ids.length);
    expect(signatures.every(signature => signature.footprint[0] >= 1 && signature.footprint[1] >= 0.85)).toBe(true);
    expect(mineralAerialSignature('copper-ore').pattern).toBe('copper-bands');
    expect(mineralAerialSignature('iron-ore').pattern).toBe('iron-fines');
    expect(mineralAerialSignature('tin-ore').pattern).toBe('tin-strips');
  });

  it('wires copper, iron and tin macro signatures into persistent extraction sites without mutating deposits', () => {
    const fixture = vegetationFixture('mined-aerial-site-signatures');
    const cellIndex = fixture.world.cells.findIndex(cell => !cell.water && cell.slope <= 0.54);
    expect(cellIndex).toBeGreaterThanOrEqual(0);
    const cell = fixture.world.cells[cellIndex]!;
    const template = fixture.world.resourceDeposits[0]!;
    expect(template).toBeDefined();
    const ids = ['copper-ore', 'iron-ore', 'tin-ore'] as const;
    const deposits = ids.map((resourceId, index) => ({
      ...template,
      id: `aerial-${resourceId}`,
      resourceId,
      cellIndex,
      worldX: cell.worldX + (index - 1) * 0.22,
      worldZ: cell.worldZ,
      establishedMonth: 0,
      abandonedMonth: undefined,
      depleted: false,
      abundance: 100,
      extracted: 64,
      discoveredBy: {},
    }));
    fixture.world.resourceDeposits.splice(0, fixture.world.resourceDeposits.length, ...deposits);
    const before = JSON.stringify(fixture.world.resourceDeposits);
    const renderer = new ResourceSiteRenderer(fixture.world, fixture.surface);
    renderer.update();
    const pads = renderer.group.getObjectByName('Aerial mineral site footprints') as THREE.InstancedMesh;
    const ore = renderer.group.getObjectByName('Persistent metallic ore piles') as THREE.InstancedMesh;
    const marks = renderer.group.getObjectByName('Aerial mineral sorting marks') as THREE.InstancedMesh;
    expect(pads.count).toBe(3);
    expect(ore.count).toBeGreaterThanOrEqual(9);
    expect(marks.count).toBeGreaterThanOrEqual(9);
    expect(JSON.stringify(fixture.world.resourceDeposits)).toBe(before);
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

    const rocks = renderer.group.getObjectByName('Stored stone rubble') as THREE.InstancedMesh;
    const clods = renderer.group.getObjectByName('Stored clay clods') as THREE.InstancedMesh;
    const coal = renderer.group.getObjectByName('Stored coal fragments') as THREE.InstancedMesh;
    const shards = renderer.group.getObjectByName('Stored ore shards') as THREE.InstancedMesh;
    const crystals = renderer.group.getObjectByName('Stored crystal ore') as THREE.InstancedMesh;
    const accents = renderer.group.getObjectByName('Stored ore mineral accents') as THREE.InstancedMesh;
    const pads = renderer.group.getObjectByName('Stored mineral sorting footprints') as THREE.InstancedMesh;
    const marks = renderer.group.getObjectByName('Stored mineral aerial marks') as THREE.InstancedMesh;
    expect(rocks.count).toBeGreaterThan(0);
    expect(clods.count).toBeGreaterThan(0);
    expect(coal.count).toBeGreaterThan(0);
    expect(shards.count).toBeGreaterThan(0);
    expect(crystals.count).toBeGreaterThan(0);
    expect(accents.count).toBeGreaterThan(0);
    expect(pads.count).toBeGreaterThanOrEqual(6);
    expect(marks.count).toBeGreaterThanOrEqual(2);
    expect(accents.count).toBeLessThanOrEqual(shards.count + crystals.count);
    expect(JSON.stringify(settlement.localMaterials)).toBe(before);
  });
});
