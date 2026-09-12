import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  collectTransportDebugRecords,
  createPortalDebugOverlay,
  setTransportDebugVisibility,
  transportDebugKindForSegment,
} from '../src/render/transport/TransportDebug';
import type { TransportSegment } from '../src/sim/transport/types';

function segment(overrides: Partial<TransportSegment> = {}): TransportSegment {
  return {
    id: 'segment-1',
    from: 'a',
    to: 'b',
    mode: 'road',
    kind: 'surface',
    status: 'complete',
    points: [{ x: 0, y: 0.2, z: 0 }, { x: 2, y: 0.2, z: 0 }],
    length: 2,
    cost: 1,
    work: 1,
    ...overrides,
  };
}

describe('transport debug truth mode', () => {
  it('records dock bank and water anchors and can toggle overlays without touching real geometry', () => {
    const root = new THREE.Group();
    const overlay = createPortalDebugOverlay({
      kind: 'dock',
      id: 'dock:settlement-a',
      settlementId: 'settlement-a',
      routeId: 'route-7',
      from: new THREE.Vector3(1, 0.4, 2),
      to: new THREE.Vector3(1, 0.25, 5),
    });
    const ordinary = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    root.add(overlay, ordinary);

    expect(overlay.visible).toBe(false);
    const records = collectTransportDebugRecords(root);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'dock', id: 'dock:settlement-a', settlementId: 'settlement-a', routeId: 'route-7' });
    expect(records[0]!.length).toBeCloseTo(Math.hypot(0.15, 3));

    setTransportDebugVisibility(root, true);
    expect(overlay.visible).toBe(true);
    expect(ordinary.visible).toBe(true);
    setTransportDebugVisibility(root, false);
    expect(overlay.visible).toBe(false);
    expect(ordinary.visible).toBe(true);
  });

  it('classifies the authoritative segment before any visual interpretation', () => {
    expect(transportDebugKindForSegment(segment())).toBe('road');
    expect(transportDebugKindForSegment(segment({ mode: 'rail' }))).toBe('rail');
    expect(transportDebugKindForSegment(segment({ kind: 'bridge' }))).toBe('bridge');
    expect(transportDebugKindForSegment(segment({ status: 'under-construction' }))).toBe('construction');
    expect(transportDebugKindForSegment(segment({ status: 'planned' }))).toBe('planned');
  });
});
