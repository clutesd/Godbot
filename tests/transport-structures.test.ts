import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBridgeStructure, createDockStructure } from '../src/render/transport/TransportStructures';
import type { TransportSegment } from '../src/sim/transport/types';

const material = () => new THREE.MeshStandardMaterial();

describe('transport structure presentation', () => {
  it('builds a supported working pier instead of a single floating beam', () => {
    const dock = createDockStructure({
      bank: new THREE.Vector3(0, 0.55, 0),
      water: new THREE.Vector3(0, 0.32, 3),
      eraRank: 2,
      materials: { timber: material(), stone: material(), metal: material() },
      groundAt: (_x, z) => 0.12 - z * 0.03,
    });

    expect(dock.name).toBe('harbour-structure');
    expect(dock.userData['portalKind']).toBe('dock');
    expect(dock.userData['harbourStyle']).toBe('working-pier');
    expect(dock.children.length).toBeGreaterThan(10);
    expect(dock.children.some(child => child instanceof THREE.Mesh && child.geometry instanceof THREE.CylinderGeometry)).toBe(true);
  });

  it('derives bridge grammar from the materials actually spent', () => {
    const segment: TransportSegment = {
      id: 'steel-span', from: 'a', to: 'b', mode: 'road', kind: 'bridge', status: 'complete',
      points: [
        { x: 0, y: 1.1, z: 0 },
        { x: 2, y: 1.1, z: 0 },
        { x: 4, y: 1.1, z: 0 },
        { x: 6, y: 1.1, z: 0 },
      ],
      length: 6, cost: 5, work: 5, materialSpent: { steel: 2.5, stone: 0.8 },
    };

    const bridge = createBridgeStructure({
      segment,
      width: 0.7,
      groundAt: () => 0.2,
      timber: material(), stone: material(), metal: material(),
    });

    expect(bridge.name).toBe('bridge-structure');
    expect(bridge.userData['bridgeStyle']).toBe('metal');
    expect(bridge.userData['segmentId']).toBe(segment.id);
    expect(bridge.children.length).toBeGreaterThan(12);
  });
});
