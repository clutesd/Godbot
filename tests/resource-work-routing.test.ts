import { describe, expect, it } from 'vitest';
import { resourceWorkPreferredWaypoints } from '../src/sim/people/ResourceWorkRouting';
import type { ResourceWorkAssignment } from '../src/sim/resources/ResourceWorkAssignments';

function assignment(overrides: Partial<ResourceWorkAssignment> = {}): ResourceWorkAssignment {
  return {
    month: 1,
    source: 'deposit-system',
    settlementId: 'settlement-1',
    siteId: 'site-1',
    resourceId: 'timber',
    worldPosition: { x: 12, z: 8 },
    gatherOccupations: ['forager'],
    amountExtracted: 4,
    labourUsed: 2,
    ...overrides,
  };
}

describe('resource worker pedestrian routing', () => {
  it('reuses one contiguous surveyed walking leg', () => {
    const leg = [{ x: 0, z: 0 }, { x: 2, z: 1 }, { x: 4, z: 2 }];
    expect(resourceWorkPreferredWaypoints(assignment({ accessPath: leg, accessPaths: [leg] }))).toEqual(leg);
  });

  it('never flattens disconnected multimodal access legs into a fake walking route', () => {
    const prefix = [{ x: 0, z: 0 }, { x: 2, z: 0 }];
    const suffix = [{ x: 10, z: 8 }, { x: 12, z: 8 }];
    const networkPath = [...prefix, { x: 5, z: 4 }, ...suffix];
    expect(resourceWorkPreferredWaypoints(assignment({ accessPath: networkPath, accessPaths: [prefix, suffix] }))).toEqual([]);
  });

  it('deduplicates repeated surveyed points', () => {
    const leg = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 3, z: 1 }];
    expect(resourceWorkPreferredWaypoints(assignment({ accessPaths: [leg] }))).toEqual([
      { x: 0, z: 0 },
      { x: 3, z: 1 },
    ]);
  });
});
