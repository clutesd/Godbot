import { describe, expect, it } from 'vitest';
import {
  combustionFuelAvailable,
  combustionFromFuel,
  combustionUsefulPerFuel,
  planCombustion,
  preferredCombustionFuel,
} from '../src/sim/energy/Combustion';
import { eligibleGenerator, generatorDefinition } from '../src/sim/energy/Generation';
import { MATERIAL_BY_ID } from '../src/sim/resources/catalog';
import { learn, societyFixture } from './fixtures/settlementDevelopment';

describe('combustion and steam energy chain', () => {
  it('models distinct canonical heat density for biomass, coal and gas fuels', () => {
    expect(MATERIAL_BY_ID.get('timber')?.fuelHeat).toBeCloseTo(0.35);
    expect(MATERIAL_BY_ID.get('charcoal')?.fuelHeat).toBeCloseTo(0.8);
    expect(MATERIAL_BY_ID.get('coal')?.fuelHeat).toBeCloseTo(1.05);
    expect(MATERIAL_BY_ID.get('natural-gas')?.fuelHeat).toBeCloseTo(1.2);

    expect(combustionUsefulPerFuel('steam', 'coal')).toBeGreaterThan(combustionUsefulPerFuel('steam', 'charcoal'));
    expect(combustionUsefulPerFuel('steam', 'charcoal')).toBeGreaterThan(combustionUsefulPerFuel('steam', 'timber'));
  });

  it('lets early steam adapt among real fuels while protecting survival timber reserves', () => {
    const { settlements } = societyFixture();
    const settlement = settlements[0]!;
    settlement.localMaterials.coal = 0;
    settlement.localMaterials.charcoal = 0;
    settlement.localMaterials.timber = 12;
    settlement.survival ??= {
      cold: { fuelNeed: 10, fuelUsed: 0, warmth: 1, exposure: 0, coldMonths: 0 },
      water: { need: 0, supplied: 0, quality: 1, shortageMonths: 0 },
      establishment: { strength: 0, constructionLabour: 0, materialDemand: {} },
    };

    expect(combustionFuelAvailable(settlement, 'timber')).toBeCloseTo(2);
    expect(preferredCombustionFuel(settlement, 'steam')).toBe('timber');

    settlement.localMaterials.charcoal = 4;
    expect(preferredCombustionFuel(settlement, 'steam')).toBe('charcoal');

    settlement.localMaterials.coal = 4;
    expect(preferredCombustionFuel(settlement, 'steam')).toBe('coal');

    const plan = planCombustion(settlement, 'steam', 8);
    expect(plan.fuel).toBe('coal');
    expect(plan.fuelUsed).toBeGreaterThan(0);
    expect(plan.heatInput).toBeGreaterThan(plan.usefulHeat);
    expect(plan.conversionLoss).toBeGreaterThan(0);
    expect(plan.output).toBeGreaterThan(0);
  });

  it('keeps purpose-built coal and gas generation locked to their real fuels', () => {
    const { settlements } = societyFixture();
    const settlement = settlements[0]!;
    settlement.localMaterials.timber = 100;
    settlement.localMaterials.charcoal = 100;
    settlement.localMaterials.coal = 0;
    settlement.localMaterials['natural-gas'] = 0;

    const coal = planCombustion(settlement, 'coal', 20);
    expect(coal.fuel).toBe('coal');
    expect(coal.fuelUsed).toBe(0);
    expect(coal.fuelRequired).toBeGreaterThan(0);
    expect(coal.output).toBe(0);

    const gas = planCombustion(settlement, 'gas', 20);
    expect(gas.fuel).toBe('natural-gas');
    expect(gas.fuelUsed).toBe(0);
    expect(gas.fuelRequired).toBeGreaterThan(0);
    expect(gas.output).toBe(0);

    const coalBurn = combustionFromFuel('coal', 'coal', 2);
    const gasBurn = combustionFromFuel('gas', 'natural-gas', 2);
    expect(coalBurn.output).toBeGreaterThan(0);
    expect(gasBurn.output).toBeGreaterThan(coalBurn.output);
    expect(gasBurn.pollution).toBeLessThan(coalBurn.pollution);
  });

  it('allows managed settlement water to support boilers away from a river or lake', () => {
    const { state, settlements } = societyFixture();
    const settlement = settlements[0]!;
    const cell = state.world.cells[settlement.cellIndex]!;
    Object.assign(cell, { river: false, lake: false, flow: 0 });
    learn(settlement, 'mechanical-power', 'iron-working');

    settlement.development = {
      pressures: {}, unmet: {}, informal: {}, providers: {},
      evaluatedMonth: state.month, nextAttemptMonth: state.month, revision: 0,
      water: {
        evaluatedMonth: state.month,
        availability: 0.5,
        reliability: 0.8,
        quality: 0.8,
        irrigation: 0,
        sanitation: 0.4,
        droughtStress: 0,
        floodContamination: 0,
        surfaceAccess: 0,
        builtService: 0.7,
        droughtMonths: 0,
      },
    };

    expect(eligibleGenerator(state, settlement, generatorDefinition('steam'))).toBe(true);
    settlement.development.water!.availability = 0.01;
    expect(eligibleGenerator(state, settlement, generatorDefinition('steam'))).toBe(false);
  });
});
