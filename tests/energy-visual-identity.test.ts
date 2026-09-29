import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { EnergyRenderer } from '../src/render/energy/EnergyRenderer';
import { energyAt, type EnergyPlant, type GeneratorKind } from '../src/sim/energy/types';
import { societyFixture } from './fixtures/settlementDevelopment';

const INDUSTRIAL_KINDS: readonly GeneratorKind[] = ['steam', 'generator', 'coal', 'gas'];

function installIndustrialPlants() {
  const { state, settlements } = societyFixture();
  INDUSTRIAL_KINDS.forEach((kind, index) => {
    const settlement = settlements[index]!;
    const plot = settlement.structurePlots?.find(p => p.development?.status === 'active');
    if (!plot) throw new Error(`Fixture settlement ${settlement.id} has no active plot`);
    const plant: EnergyPlant = {
      id: `visual-${kind}`,
      plotId: plot.id,
      kind,
      progress: 1,
      condition: 1,
      output: kind === 'steam' ? 8 : kind === 'generator' ? 7 : kind === 'coal' ? 30 : 35,
      fuelUsed: 1,
      fuelKind: kind === 'gas' ? 'natural-gas' : 'coal',
      status: 'running',
    };
    energyAt(settlement).plants = [plant];
  });
  return { state, settlements };
}

function requireObject(renderer: EnergyRenderer, name: string): THREE.Object3D {
  const object = renderer.group.getObjectByName(name);
  if (!object) throw new Error(`Missing energy presentation cue: ${name}`);
  return object;
}

describe('industrial energy visual identity', () => {
  it('gives steam, early electricity, coal and gas distinct readable machinery', () => {
    const { state } = installIndustrialPlants();
    const renderer = new EnergyRenderer();
    renderer.update(state, 1, () => 0);

    requireObject(renderer, 'Steam engine works');
    requireObject(renderer, 'Steam boiler');
    requireObject(renderer, 'Steam flywheel');
    requireObject(renderer, 'Steam piston rod');

    requireObject(renderer, 'Early generator station');
    requireObject(renderer, 'Early generator dynamo');
    requireObject(renderer, 'Generator copper coil');
    requireObject(renderer, 'Generator switchgear');

    requireObject(renderer, 'Coal power station');
    requireObject(renderer, 'Coal boiler house');
    requireObject(renderer, 'Coal yard');
    requireObject(renderer, 'Coal conveyor');
    requireObject(renderer, 'Coal stack A');
    requireObject(renderer, 'Coal stack B');

    requireObject(renderer, 'Gas turbine station');
    requireObject(renderer, 'Gas turbine train');
    requireObject(renderer, 'Gas pipe manifold');
    requireObject(renderer, 'Gas exhaust stack');

    renderer.dispose();
  });

  it('uses visibly different exhaust language for steam-era, coal and gas plants', () => {
    const { state } = installIndustrialPlants();
    const renderer = new EnergyRenderer();
    renderer.update(state, 2, () => 0);

    const steamVent = requireObject(renderer, 'Steam vent plume');
    const steamBoiler = requireObject(renderer, 'Steam boiler exhaust');
    const coalA = requireObject(renderer, 'Coal stack plume A');
    const coalB = requireObject(renderer, 'Coal stack plume B');
    const gas = requireObject(renderer, 'Gas clean exhaust');

    expect(steamVent.visible).toBe(true);
    expect(steamBoiler.visible).toBe(true);
    expect(coalA.visible).toBe(true);
    expect(coalB.visible).toBe(true);
    expect(gas.visible).toBe(true);

    const gasMaterial = (gas.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const coalMaterial = (coalA.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(gasMaterial.opacity).toBeLessThan(coalMaterial.opacity);

    renderer.dispose();
  });

  it('keeps presentation read-only while animating authoritative running state', () => {
    const { state, settlements } = installIndustrialPlants();
    const before = JSON.stringify(settlements.map(s => energyAt(s).plants));

    const renderer = new EnergyRenderer();
    renderer.update(state, 1, () => 0);
    renderer.update(state, 3, () => 0);

    expect(JSON.stringify(settlements.map(s => energyAt(s).plants))).toBe(before);
    renderer.dispose();
  });
});
