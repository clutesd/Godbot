import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { resolveHarbourFootprint, transportPresentationWidth } from '../src/render/transport/TransportPresentation';
import type { TransportSegment } from '../src/sim/transport/types';

function segment(overrides: Partial<TransportSegment> = {}): TransportSegment {
  return {
    id: 'segment',
    from: 'a',
    to: 'b',
    mode: 'road',
    kind: 'surface',
    status: 'complete',
    points: [{ x: 0, y: 0.2, z: 0 }, { x: 5, y: 0.2, z: 0 }],
    length: 5,
    cost: 1,
    work: 1,
    ...overrides,
  };
}

describe('transport presentation scale', () => {
  it('keeps a distant navigation anchor from stretching the visible harbour', () => {
    const bank = new THREE.Vector3(0, 0.5, 0);
    const navigationWater = new THREE.Vector3(0, 0.25, 12);
    const footprint = resolveHarbourFootprint(bank, navigationWater, 2);

    expect(footprint.logicalLength).toBeCloseTo(12);
    expect(footprint.visibleLength).toBeCloseTo(2.2);
    expect(footprint.capped).toBe(true);
    expect(footprint.visibleWater.z).toBeCloseTo(2.2);
    expect(footprint.visibleWater.y).toBe(navigationWater.y);
  });

  it('does not move a navigation anchor that is already close to shore', () => {
    const bank = new THREE.Vector3(1, 0.5, 1);
    const navigationWater = new THREE.Vector3(1, 0.3, 2.4);
    const footprint = resolveHarbourFootprint(bank, navigationWater, 4);

    expect(footprint.capped).toBe(false);
    expect(footprint.visibleWater.x).toBeCloseTo(navigationWater.x);
    expect(footprint.visibleWater.z).toBeCloseTo(navigationWater.z);
  });

  it('renders transport routes narrower than the old slab-scale widths', () => {
    expect(transportPresentationWidth(segment())).toBe(0.34);
    expect(transportPresentationWidth(segment({ kind: 'bridge' }))).toBe(0.46);
    expect(transportPresentationWidth(segment({ mode: 'rail' }))).toBe(0.46);
    expect(transportPresentationWidth(segment({ mode: 'rail', kind: 'bridge' }))).toBe(0.58);
  });
});
