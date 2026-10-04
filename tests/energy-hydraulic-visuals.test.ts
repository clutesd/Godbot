import { describe, expect, it } from 'vitest';
import { EnergyRenderer } from '../src/render/energy/EnergyRenderer';
import { planHydraulicVisualSite } from '../src/render/energy/HydraulicPresentation';
import { energyAt, type EnergyPlant } from '../src/sim/energy/types';
import { nearestIndex } from '../src/sim/terrain/TerrainField';
import { surfaceHeightAt } from '../src/sim/terrain/SurfaceGeometry';
import type { Settlement, SimulationState } from '../src/sim/types';
import { societyFixture } from './fixtures/settlementDevelopment';

function activePlot(settlement: Settlement) {
  const plot = settlement.structurePlots?.find(p => p.development?.status === 'active');
  if (!plot) throw new Error(`Fixture settlement ${settlement.id} has no active plot`);
  return plot;
}

function carveFixtureRiver(state: SimulationState, x: number, z: number): void {
  const field = state.world.terrain;
  const center = nearestIndex(field, x, z);
  const cx = center % field.resolution;
  const cz = Math.floor(center / field.resolution);
  for (let dz = -4; dz <= 4; dz += 1) {
    const gz = cz + dz;
    if (gz < 1 || gz >= field.resolution - 1 || cx < 1 || cx >= field.resolution - 1) continue;
    const index = gz * field.resolution + cx;
    field.river[index] = 1;
    field.flow[index] = 0.55 + (dz + 4) * 0.035;
    field.waterLevel[index] = state.world.seaLevel + 0.08 - dz * 0.001;
    field.height[index] = state.world.seaLevel + 0.055 - dz * 0.001;
    if (field.drainage) {
      const nextZ = Math.min(field.resolution - 1, gz + 1);
      field.drainage.downstream[index] = nextZ * field.resolution + cx;
    }
  }
}

function installPlant(settlement: Settlement, kind: EnergyPlant['kind'], id: string): EnergyPlant {
  const plot = activePlot(settlement);
  const plant: EnergyPlant = {
    id, plotId: plot.id, kind, progress: 1, condition: 1,
    output: kind === 'animal' ? 1 : kind === 'waterwheel' ? 5 : 40,
    fuelUsed: kind === 'animal' ? 0.2 : 0,
    status: 'running',
  };
  energyAt(settlement).plants = [plant];
  return plant;
}

describe('primitive and hydraulic energy presentation', () => {
  it('selects a canonical river sample and bank from the fine hydrology field', () => {
    const { state, settlements } = societyFixture();
    const plot = activePlot(settlements[0]!);
    carveFixtureRiver(state, plot.worldX + state.world.terrain.step * 2, plot.worldZ);

    const site = planHydraulicVisualSite(state.world, { x: plot.worldX, z: plot.worldZ }, 8);
    expect(site).toBeDefined();
    expect(state.world.terrain.river[site!.index]).toBe(1);
    expect(state.world.terrain.waterLevel[site!.index]).toBeGreaterThanOrEqual(0);
    expect(site!.flow).toBeGreaterThan(0);
    expect(Math.hypot(site!.flowX, site!.flowZ)).toBeCloseTo(1, 5);

    const bankDistance = Math.hypot(site!.bankX - plot.worldX, site!.bankZ - plot.worldZ);
    const oppositeX = site!.riverX - (site!.bankX - site!.riverX);
    const oppositeZ = site!.riverZ - (site!.bankZ - site!.riverZ);
    const oppositeDistance = Math.hypot(oppositeX - plot.worldX, oppositeZ - plot.worldZ);
    expect(bankDistance).toBeLessThanOrEqual(oppositeDistance + 1e-6);
  });

  it('makes animal power visibly read as a horizontal capstan system', () => {
    const { state, settlements } = societyFixture();
    installPlant(settlements[0]!, 'animal', 'animal-visual');

    const renderer = new EnergyRenderer();
    renderer.update(state, 2, () => 0);

    expect(renderer.group.getObjectByName('Animal power works')).toBeDefined();
    expect(renderer.group.getObjectByName('Animal capstan post')).toBeDefined();
    expect(renderer.group.getObjectByName('Animal capstan sweep')).toBeDefined();
    expect(renderer.group.getObjectByName('Draft animal A')).toBeDefined();
    expect(renderer.group.getObjectByName('Draft animal B')).toBeDefined();
    expect(renderer.group.getObjectByName('Animal drive pulley')).toBeDefined();

    renderer.dispose();
  });

  it('anchors a watermill to the real riverbank and gives it millrace machinery', () => {
    const { state, settlements } = societyFixture();
    const settlement = settlements[0]!;
    const plot = activePlot(settlement);
    carveFixtureRiver(state, plot.worldX + state.world.terrain.step * 2, plot.worldZ);
    installPlant(settlement, 'waterwheel', 'wheel-visual');

    const expected = planHydraulicVisualSite(state.world, { x: plot.worldX, z: plot.worldZ })!;
    const renderer = new EnergyRenderer();
    renderer.update(state, 1, (x, z) => surfaceHeightAt(state.world, x, z));

    const root = renderer.group.getObjectByName('Energy plant waterwheel:wheel-visual')!;
    expect(root.position.x).toBeCloseTo(expected.bankX, 5);
    expect(root.position.z).toBeCloseTo(expected.bankZ, 5);
    expect(renderer.group.getObjectByName('Riverside watermill')).toBeDefined();
    const mill = renderer.group.getObjectByName('Riverside watermill')!;
    expect(mill.userData['buildingSpec'].archetype).toBe('mill');
    expect(mill.userData['buildingSpec'].equipment).toContain('waterwheel');
    const drives: string[] = [];
    mill.traverse(object => { if (object.userData['millRotor']) drives.push(object.userData['millRotor'].drive); });
    expect(drives).toContain('water-wheel');
    expect(drives).not.toContain('engine');

    renderer.dispose();
  });

  it('centres hydro on the canonical river and exposes dam, intake, spillway and powerhouse cues', () => {
    const { state, settlements } = societyFixture();
    const settlement = settlements[0]!;
    const plot = activePlot(settlement);
    carveFixtureRiver(state, plot.worldX + state.world.terrain.step * 2, plot.worldZ);
    installPlant(settlement, 'hydro', 'hydro-visual');

    const expected = planHydraulicVisualSite(state.world, { x: plot.worldX, z: plot.worldZ })!;
    const renderer = new EnergyRenderer();
    renderer.update(state, 1, (x, z) => surfaceHeightAt(state.world, x, z));

    const root = renderer.group.getObjectByName('Energy plant hydro:hydro-visual')!;
    expect(root.position.x).toBeCloseTo(expected.riverX, 5);
    expect(root.position.z).toBeCloseTo(expected.riverZ, 5);
    expect(root.position.y).toBeCloseTo(surfaceHeightAt(state.world, expected.riverX, expected.riverZ), 5);
    expect(renderer.group.getObjectByName('Hydroelectric dam complex')).toBeDefined();
    expect(renderer.group.getObjectByName('Hydro dam wall')).toBeDefined();
    expect(renderer.group.getObjectByName('Hydro spillway')).toBeDefined();
    expect(renderer.group.getObjectByName('Hydro intake')).toBeDefined();
    expect(renderer.group.getObjectByName('Hydroelectric powerhouse')).toBeDefined();
    expect(renderer.group.getObjectByName('Hydro penstocks')).toBeDefined();
    expect(renderer.group.getObjectByName('Hydro tailrace')).toBeDefined();

    renderer.dispose();
  });

  it('keeps the hydraulic visual pass read-only with respect to energy state', () => {
    const { state, settlements } = societyFixture();
    const settlement = settlements[0]!;
    const plot = activePlot(settlement);
    carveFixtureRiver(state, plot.worldX + state.world.terrain.step * 2, plot.worldZ);
    installPlant(settlement, 'waterwheel', 'readonly-wheel');
    const before = JSON.stringify(energyAt(settlement).plants);

    const renderer = new EnergyRenderer();
    renderer.update(state, 1, () => 0);
    renderer.update(state, 4, () => 0);

    expect(JSON.stringify(energyAt(settlement).plants)).toBe(before);
    renderer.dispose();
  });
});
