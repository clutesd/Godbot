import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import {
  extractDeposit,
  harvestRenewable,
  regenerateRenewables,
  remainingDepositShare,
} from '../src/sim/resources/WorldResources';
import { generateWorld } from '../src/sim/world';

describe('authoritative world resources', () => {
  it('seeds deterministic resource stocks and deposits from terrain', () => {
    const config = configWith({ seed: 'resource-layer-determinism' });
    const a = generateWorld(config);
    const b = generateWorld(config);

    expect(a.cells.every((cell) => cell.naturalResources !== undefined)).toBe(true);
    const land = a.cells.filter((cell) => !cell.water);
    expect(land.some((cell) => (cell.naturalResources?.renewables.timber.stock ?? 0) > 0)).toBe(true);
    expect(land.some((cell) => (cell.naturalResources?.renewables['medicinal-flora'].stock ?? 0) > 0)).toBe(true);
    expect(land.some((cell) => (cell.naturalResources?.deposits.stone?.reserve ?? 0) > 0)).toBe(true);

    const snapshot = (world: typeof a) => world.cells.slice(0, 80).map((cell) => ({
      x: cell.x,
      z: cell.z,
      timber: cell.naturalResources?.renewables.timber.stock ?? 0,
      flora: cell.naturalResources?.renewables['medicinal-flora'].stock ?? 0,
      iron: cell.naturalResources?.deposits['iron-ore']?.reserve ?? 0,
      coal: cell.naturalResources?.deposits.coal?.reserve ?? 0,
      uranium: cell.naturalResources?.deposits['uranium-ore']?.reserve ?? 0,
    }));
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('depletes finite deposits while allowing renewables to recover', () => {
    const world = generateWorld(configWith({ seed: 'resource-layer-depletion' }));
    const cell = world.cells.find((candidate) => !candidate.water
      && (candidate.naturalResources?.renewables.timber.stock ?? 0) > 80
      && (candidate.naturalResources?.deposits.stone?.reserve ?? 0) > 80);
    expect(cell).toBeDefined();
    if (!cell?.naturalResources) return;

    const originalTimber = cell.naturalResources.renewables.timber.stock;
    const harvested = harvestRenewable(cell, 'timber', 25);
    expect(harvested).toBeGreaterThan(0);
    const depletedTimber = cell.naturalResources.renewables.timber.stock;
    expect(depletedTimber).toBeLessThan(originalTimber);

    regenerateRenewables(cell, 1);
    expect(cell.naturalResources.renewables.timber.stock).toBeGreaterThan(depletedTimber);
    expect(cell.naturalResources.renewables.timber.stock).toBeLessThanOrEqual(cell.naturalResources.renewables.timber.capacity);

    const originalStone = cell.naturalResources.deposits.stone?.reserve ?? 0;
    const extracted = extractDeposit(cell, 'stone', 30);
    expect(extracted).toBeGreaterThan(0);
    const depletedStone = cell.naturalResources.deposits.stone?.reserve ?? 0;
    expect(depletedStone).toBeLessThan(originalStone);
    expect(remainingDepositShare(cell, 'stone')).toBeLessThan(1);

    regenerateRenewables(cell, 20);
    expect(cell.naturalResources.deposits.stone?.reserve ?? 0).toBe(depletedStone);
    expect(cell.naturalResources.revision).toBeGreaterThan(0);
  });
});
