import { describe, expect, it } from 'vitest';
import type { WorldCell, WorldState } from '../src/sim/types';
import { WalkabilityLayer } from '../src/sim/people/WalkabilityLayer';
import { fineSegmentDry, surveyEdge, waterAt } from '../src/sim/transport/TerrainTraversal';
import { PlacementContract } from '../src/shared/placement/PlacementContract';

function narrowRiverWorld(): WorldState {
  const size = 3;
  const cellSize = 3;
  const cells: WorldCell[] = [];
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const riverDescriptor = x === 1;
      cells.push({
        x, z,
        worldX: (x - size / 2) * cellSize,
        worldZ: (z - size / 2) * cellSize,
        elevation: 0.45,
        moisture: 0.6,
        temperature: 0.55,
        fertility: riverDescriptor ? 0 : 0.7,
        wood: riverDescriptor ? 0 : 0.7,
        minerals: riverDescriptor ? 0 : 0.4,
        habitability: riverDescriptor ? 0 : 0.7,
        movementCost: 1,
        water: riverDescriptor,
        coast: false,
        river: riverDescriptor,
        lake: false,
        slope: 0,
        relief: 0,
        flow: riverDescriptor ? 0.6 : 0,
        rockiness: 0,
        landform: 'lowland',
        biome: riverDescriptor ? 'water' : 'grassland',
      });
    }
  }

  const resolution = 7;
  const count = resolution ** 2;
  const height = new Float32Array(count).fill(0.45);
  const waterLevel = new Float32Array(count).fill(-1);
  const river = new Uint8Array(count);
  const lake = new Uint8Array(count);
  const flow = new Float32Array(count);
  for (let z = 0; z < resolution; z++) {
    const index = z * resolution + 3;
    height[index] = 0.415;
    waterLevel[index] = 0.425;
    river[index] = 1;
    flow[index] = 0.6;
  }

  return {
    size,
    cellSize,
    cells,
    seaLevel: 0.2,
    mountainLevel: 0.72,
    landmarks: [],
    resourceDeposits: [],
    environmentRevision: 0,
    terrain: {
      resolution,
      step: 1,
      originX: -4.5,
      originZ: -4.5,
      height,
      waterLevel,
      flow,
      rock: new Float32Array(count),
      lake,
      river,
      fall: new Float32Array(count),
    },
  };
}

describe('fine hydrology authority', () => {
  it('keeps dry banks usable even when the containing coarse cell is described as river water', () => {
    const world = narrowRiverWorld();
    const dryBank = { x: -0.5, z: -1.5 };
    const channel = { x: -1.5, z: -1.5 };
    const walking = new WalkabilityLayer(world);

    expect(world.cells[4]!.water).toBe(true);
    expect(world.cells[4]!.river).toBe(true);
    expect(waterAt(world, dryBank)).toBe(false);
    expect(walking.isWalkable(dryBank)).toBe(true);
    expect(waterAt(world, channel)).toBe(true);
    expect(walking.isWalkable(channel)).toBe(false);
  });

  it('uses the same fine footprint for placement and bank-to-bank infrastructure', () => {
    const world = narrowRiverWorld();
    const bankA = { x: -2.5, z: -1.5 };
    const bankB = { x: -0.5, z: -1.5 };
    const contract = new PlacementContract(world);

    expect(contract.validate({ type: 'small-building', worldX: bankB.x, worldZ: bankB.z, footprintRadius: 0.2 }).valid).toBe(true);
    const wetPlacement = contract.validate({ type: 'small-building', worldX: -1.5, worldZ: -1.5, footprintRadius: 0.05 });
    expect(wetPlacement.valid).toBe(false);
    expect(wetPlacement.reason).toContain('water');

    expect(fineSegmentDry(world, bankA, bankB)).toBe(false);
    expect(surveyEdge(world, bankA, bankB, 'road')).toBeUndefined();
    const bridge = surveyEdge(world, bankA, bankB, 'road', true);
    expect(bridge?.kind).toBe('bridge');
  });
});
