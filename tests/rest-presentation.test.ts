import { describe, expect, it } from 'vitest';
import { planRestSpot, restSpotCandidates, type RestSupportFootprint } from '../src/render/people/RestPresentation';

const structure: RestSupportFootprint = {
  key: 'home-1',
  worldX: 3,
  worldZ: -2,
  width: 1.2,
  depth: 0.8,
  rotationY: Math.PI / 4,
};

describe('physical rest presentation', () => {
  it('places supported rest slots outside rotated structure footprints and faces them outward', () => {
    const spots = restSpotCandidates({ x: 3, z: -1 }, structure);
    const supported = spots.filter(spot => spot.support === 'structure-edge');
    expect(supported).toHaveLength(12);

    const cos = Math.cos(structure.rotationY);
    const sin = Math.sin(structure.rotationY);
    for (const spot of supported) {
      const dx = spot.destination.x - structure.worldX;
      const dz = spot.destination.z - structure.worldZ;
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      expect(Math.abs(localX) > structure.width / 2 || Math.abs(localZ) > structure.depth / 2).toBe(true);

      const forwardX = Math.sin(spot.facing);
      const forwardZ = Math.cos(spot.facing);
      expect(forwardX * dx + forwardZ * dz).toBeGreaterThan(0);
      expect(spot.posture).toBe('supported-sit');
      expect(spot.supportKey).toBe(structure.key);
    }
  });

  it('gives visible resting household members stable, non-overlapping reservation keys', () => {
    const ids = ['person-d', 'person-a', 'person-c', 'person-b', 'person-e', 'person-f'];
    const plan = (personId: string, restingIds: readonly string[]) => planRestSpot({
      personId,
      base: { x: 3, z: -1 },
      from: { x: 3, z: -1 },
      structure,
      restingIds,
      safePoint: () => true,
      safeSegment: () => true,
    })!;

    const first = new Map(ids.map(id => [id, plan(id, ids)]));
    const replay = new Map([...ids].reverse().map(id => [id, plan(id, [...ids].reverse())]));
    expect(new Set([...first.values()].map(spot => spot.key)).size).toBe(ids.length);

    for (const id of ids) {
      expect(replay.get(id)?.key).toBe(first.get(id)?.key);
      expect(replay.get(id)?.destination).toEqual(first.get(id)?.destination);
    }
  });

  it('falls back to a safe ground-rest slot when structure-edge supports are inaccessible', () => {
    const spot = planRestSpot({
      personId: 'resting-person',
      base: { x: 3, z: -1 },
      from: { x: 3, z: -1 },
      structure,
      restingIds: ['resting-person'],
      safePoint: point => Math.hypot(point.x - structure.worldX, point.z - structure.worldZ) > 1,
      safeSegment: () => true,
    });
    expect(spot?.support).toBe('ground');
    expect(spot?.posture).toBe('ground-sit');
  });
});
