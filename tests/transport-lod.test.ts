import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createBridgePresentationLod,
  createHarbourPresentationLod,
  TRANSPORT_LOD_DISTANCES,
} from '../src/render/transport/TransportLod';
import type { TransportSegment } from '../src/sim/transport/types';

const material = () => new THREE.MeshStandardMaterial();
const materials = () => ({ timber: material(), stone: material(), metal: material() });

describe('transport documentary-scale LODs', () => {
  it('keeps full harbour detail close and collapses to silhouettes at normal observation distance', () => {
    const detail = new THREE.Group();
    detail.name = 'harbour-structure';
    detail.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material()));

    const lod = createHarbourPresentationLod({
      detail,
      bank: new THREE.Vector3(0, 0.5, 0),
      water: new THREE.Vector3(0, 0.3, 2.2),
      eraRank: 2,
      materials: materials(),
    });

    expect(lod).toBeInstanceOf(THREE.LOD);
    expect(lod.levels).toHaveLength(3);
    expect(lod.levels[0]?.distance).toBe(0);
    expect(lod.levels[1]?.distance).toBe(TRANSPORT_LOD_DISTANCES.approach);
    expect(lod.levels[2]?.distance).toBe(TRANSPORT_LOD_DISTANCES.regional);
    expect(lod.levels[0]?.object.name).toBe('harbour-structure');
    expect(lod.levels[1]?.object.name).toBe('harbour-approach-silhouette');
    expect(lod.levels[2]?.object.name).toBe('harbour-regional-silhouette');
    expect(lod.levels[1]?.object.children.length).toBeLessThan(8);
    expect(lod.levels[2]?.object.children.length).toBeLessThanOrEqual(2);
  });

  it('drops bridge truss/bracing detail at approach and regional distances', () => {
    const detail = new THREE.Group();
    detail.name = 'bridge-structure';
    detail.userData['bridgeStyle'] = 'metal';
    const truss = new THREE.Group();
    truss.name = 'bridge-metal-truss';
    for (let index = 0; index < 20; index += 1) {
      truss.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 1), material()));
    }
    detail.add(truss);

    const segment: TransportSegment = {
      id: 'documentary-span',
      from: 'a',
      to: 'b',
      mode: 'road',
      kind: 'bridge',
      status: 'complete',
      points: [
        { x: 0, y: 1.1, z: 0 },
        { x: 2, y: 1.1, z: 0 },
        { x: 4, y: 1.1, z: 0 },
        { x: 6, y: 1.1, z: 0 },
      ],
      length: 6,
      cost: 5,
      work: 5,
      materialSpent: { steel: 0.2, stone: 0.3 },
    };

    const lod = createBridgePresentationLod({
      detail,
      segment,
      width: 0.46,
      groundAt: () => 0.1,
      materials: materials(),
    });

    expect(lod.levels).toHaveLength(3);
    expect(lod.levels[0]?.object.name).toBe('bridge-structure');
    expect(lod.levels[1]?.object.name).toBe('bridge-approach-silhouette');
    expect(lod.levels[2]?.object.name).toBe('bridge-regional-silhouette');
    expect(lod.levels[1]?.object.getObjectByName('bridge-metal-truss')).toBeUndefined();
    expect(lod.levels[2]?.object.getObjectByName('bridge-metal-truss')).toBeUndefined();
    expect(lod.levels[1]?.object.children.length).toBeLessThanOrEqual(5);
    expect(lod.levels[2]?.object.children.length).toBeLessThanOrEqual(2);
  });
});
