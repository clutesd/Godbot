import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBridgeStructure, createDockStructure } from '../src/render/transport/TransportStructures';
import type { TransportSegment } from '../src/sim/transport/types';

const material = () => new THREE.MeshStandardMaterial();
const dockMaterials = () => ({
  timber: material(),
  stone: material(),
  metal: material(),
  accent: material(),
  glow: material(),
  cloth: material(),
  shadow: material(),
});

describe('transport structure presentation', () => {
  it('builds a supported working pier with berth, rail, freight and water access', () => {
    const dock = createDockStructure({
      bank: new THREE.Vector3(0, 0.55, 0),
      water: new THREE.Vector3(0, 0.32, 3),
      eraRank: 2,
      identity: 'test-harbour',
      activity: 0.8,
      materials: dockMaterials(),
      groundAt: (_x, z) => 0.12 - z * 0.03,
    });

    expect(dock.name).toBe('harbour-structure');
    expect(dock.userData['portalKind']).toBe('dock');
    expect(dock.userData['harbourStyle']).toBe('working-pier');
    expect(dock.children.some(child => child.name === 'harbour-main-deck')).toBe(true);
    expect(dock.children.some(child => child.name === 'harbour-rail')).toBe(true);
    expect(dock.children.some(child => child.name === 'harbour-freight')).toBe(true);
    expect(dock.children.some(child => child.name === 'harbour-ladder')).toBe(true);
    expect(dock.children.some(child => child.name === 'harbour-fenders')).toBe(true);
  });

  it('adds shelter, culture lighting and handling gear to an industrial harbour', () => {
    const dock = createDockStructure({
      bank: new THREE.Vector3(0, 0.5, 0),
      water: new THREE.Vector3(0, 0.28, 3.4),
      eraRank: 4,
      identity: 'industrial-harbour',
      activity: 1,
      materials: dockMaterials(),
      groundAt: () => 0.05,
    });

    expect(dock.userData['harbourStyle']).toBe('industrial-pier');
    expect(dock.children.some(child => child.name === 'harbour-shelter')).toBe(true);
    expect(dock.children.some(child => child.name === 'harbour-lantern')).toBe(true);
    expect(dock.children.some(child => child.name === 'harbour-crane')).toBe(true);
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
      // Mirrors the bridge capital recipe: masonry foundations can outweigh the steel span.
      length: 6, cost: 5, work: 5, materialSpent: { steel: 0.18, stone: 0.34 },
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
    expect(bridge.children.some(child => child.name === 'bridge-abutments')).toBe(true);
    expect(bridge.children.some(child => child.name === 'bridge-supports')).toBe(true);
    expect(bridge.children.some(child => child.name === 'bridge-metal-truss')).toBe(true);
    expect(bridge.children.some(child => child.name === 'bridge-thresholds')).toBe(true);
  });

  it('gives railway bridges visible sleepers as well as rails', () => {
    const segment: TransportSegment = {
      id: 'rail-span', from: 'a', to: 'b', mode: 'rail', kind: 'bridge', status: 'complete',
      points: [
        { x: 0, y: 1.2, z: 0 },
        { x: 0, y: 1.2, z: 2 },
        { x: 0, y: 1.2, z: 4 },
      ],
      length: 4, cost: 6, work: 6, materialSpent: { steel: 0.4, timber: 0.08, stone: 0.2 },
    };
    const bridge = createBridgeStructure({
      segment,
      width: 0.85,
      groundAt: () => 0.1,
      timber: material(), stone: material(), metal: material(),
    });

    const sleepers = bridge.children.find(child => child.name === 'bridge-rail-sleepers');
    expect(sleepers).toBeInstanceOf(THREE.Group);
    expect(sleepers?.children.length).toBeGreaterThan(4);
  });
});
