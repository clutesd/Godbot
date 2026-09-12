import { describe, expect, it } from 'vitest';
import {
  boundedStreetRoute,
  densifyStreetRoute,
  pointAlongStreet,
  settlementStreetWidth,
  type GroundRoutingLike,
} from '../src/render/settlement/SettlementPathGeometry';
import type { Vec2 } from '../src/sim/types';

function directRouting(routeOverride?: Vec2[]): GroundRoutingLike {
  return {
    nearestWalkable: (point) => ({ ...point }),
    route: (_start, end) => routeOverride ?? [{ ...end }],
    routeIsValid: () => true,
  };
}

describe('settlement street presentation geometry', () => {
  it('keeps ordinary district streets compact and walkable', () => {
    const route = boundedStreetRoute(
      directRouting(),
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      {
        identity: 'compact-street',
        endpointSearchRadius: 2,
        maxEndpointDrift: 1,
        maxDetourFactor: 1.75,
        maxLength: 8,
      },
    );

    expect(route).toEqual([{ x: 0, z: 0 }, { x: 4, z: 0 }]);
  });

  it('rejects the kind of absurd detour that would become a giant visual spoke', () => {
    const route = boundedStreetRoute(
      directRouting([{ x: 0, z: 8 }, { x: 4, z: 8 }, { x: 4, z: 0 }]),
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      {
        identity: 'runway-regression',
        endpointSearchRadius: 2,
        maxEndpointDrift: 1,
        maxDetourFactor: 1.75,
        maxLength: 12,
      },
    );

    expect(route).toEqual([]);
  });

  it('breaks long coarse route legs into short terrain-following samples', () => {
    const samples = densifyStreetRoute([{ x: 0, z: 0 }, { x: 3, z: 0 }], 0.5);
    expect(samples.length).toBe(7);
    for (let index = 1; index < samples.length; index += 1) {
      expect(Math.hypot(samples[index]!.x - samples[index - 1]!.x, samples[index]!.z - samples[index - 1]!.z)).toBeLessThanOrEqual(0.500001);
    }
  });

  it('uses restrained documentary-scale width hierarchy', () => {
    expect(settlementStreetWidth(4, 'primary')).toBe(0.28);
    expect(settlementStreetWidth(4, 'secondary')).toBeCloseTo(0.2128);
    expect(settlementStreetWidth(4, 'service')).toBeCloseTo(0.1736);
    expect(settlementStreetWidth(4, 'ceremonial')).toBeLessThanOrEqual(0.34);
  });

  it('samples a routed street for decorations without assuming a straight line', () => {
    const sample = pointAlongStreet([
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 2 },
    ], 0.75);
    expect(sample?.point.x).toBeCloseTo(2);
    expect(sample?.point.z).toBeCloseTo(1);
    expect(sample?.tangent).toEqual({ x: 0, z: 2 });
  });
});
