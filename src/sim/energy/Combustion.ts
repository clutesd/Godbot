import type { Settlement } from '../types';
import { MATERIAL_BY_ID } from '../resources/catalog';
import type { GeneratorKind } from './types';

export type CombustionKind = 'steam' | 'generator' | 'coal' | 'gas';
export type CombustionFuel = 'timber' | 'charcoal' | 'coal' | 'natural-gas';

interface FuelProfile {
  pollutionPerUnit: number;
}

interface MachineProfile {
  fuels: readonly CombustionFuel[];
  conversion: Readonly<Partial<Record<CombustionFuel, number>>>;
}

export interface CombustionPlan {
  fuel: CombustionFuel;
  requestedOutput: number;
  fuelRequired: number;
  fuelAvailable: number;
  fuelUsed: number;
  heatInput: number;
  usefulHeat: number;
  conversionLoss: number;
  output: number;
  pollution: number;
}

const OUTPUT_PER_USEFUL_HEAT = 12;

const FUEL_PROFILE: Readonly<Record<CombustionFuel, FuelProfile>> = {
  timber: { pollutionPerUnit: 0.00018 },
  charcoal: { pollutionPerUnit: 0.00015 },
  coal: { pollutionPerUnit: 0.00032 },
  'natural-gas': { pollutionPerUnit: 0.00011 },
};

const MACHINE_PROFILE: Readonly<Record<CombustionKind, MachineProfile>> = {
  // Early steam can bootstrap from biomass, but dense fuels progressively improve performance.
  steam: {
    fuels: ['coal', 'charcoal', 'timber'],
    conversion: { coal: 0.32, charcoal: 0.30, timber: 0.24 },
  },
  // The first electrical generators are steam/boiler driven; charcoal remains viable before coal is abundant.
  generator: {
    fuels: ['coal', 'charcoal', 'timber'],
    conversion: { coal: 0.25, charcoal: 0.23, timber: 0.18 },
  },
  // A purpose-built coal station cannot silently become a biomass plant.
  coal: {
    fuels: ['coal'],
    conversion: { coal: 0.40 },
  },
  gas: {
    fuels: ['natural-gas'],
    conversion: { 'natural-gas': 0.56 },
  },
};

export function isCombustionKind(kind: GeneratorKind): kind is CombustionKind {
  return kind === 'steam' || kind === 'generator' || kind === 'coal' || kind === 'gas';
}

export function fuelHeat(fuel: CombustionFuel): number {
  return MATERIAL_BY_ID.get(fuel)?.fuelHeat ?? 0;
}

export function combustionUsefulPerFuel(kind: CombustionKind, fuel: CombustionFuel): number {
  const conversion = MACHINE_PROFILE[kind].conversion[fuel] ?? 0;
  return fuelHeat(fuel) * conversion * OUTPUT_PER_USEFUL_HEAT;
}

export function combustionFuelAvailable(settlement: Settlement, fuel: CombustionFuel): number {
  const stock = Math.max(0, settlement.localMaterials[fuel] ?? 0);
  if (fuel !== 'timber') return stock;
  const heatingReserve = Math.max(0, settlement.survival?.cold.fuelNeed ?? 0);
  return Math.max(0, stock - heatingReserve);
}

export function preferredCombustionFuel(settlement: Settlement, kind: CombustionKind): CombustionFuel {
  const profile = MACHINE_PROFILE[kind];
  return profile.fuels.find(fuel => combustionFuelAvailable(settlement, fuel) > 1e-9) ?? profile.fuels[0]!;
}

export function combustionFuelPotential(settlement: Settlement, kind: CombustionKind): number {
  let potential = 0;
  for (const fuel of MACHINE_PROFILE[kind].fuels) {
    potential = Math.max(potential, combustionFuelAvailable(settlement, fuel) * combustionUsefulPerFuel(kind, fuel));
  }
  return potential;
}

export function combustionFromFuel(kind: CombustionKind, fuel: CombustionFuel, fuelUsed: number): Omit<CombustionPlan, 'requestedOutput' | 'fuelRequired' | 'fuelAvailable'> {
  const units = Math.max(0, fuelUsed);
  const heatInput = units * fuelHeat(fuel);
  const conversion = MACHINE_PROFILE[kind].conversion[fuel] ?? 0;
  const usefulHeat = heatInput * conversion;
  return {
    fuel,
    fuelUsed: units,
    heatInput,
    usefulHeat,
    conversionLoss: Math.max(0, heatInput - usefulHeat),
    output: usefulHeat * OUTPUT_PER_USEFUL_HEAT,
    pollution: units * FUEL_PROFILE[fuel].pollutionPerUnit,
  };
}

export function planCombustion(settlement: Settlement, kind: CombustionKind, requestedOutput: number): CombustionPlan {
  const fuel = preferredCombustionFuel(settlement, kind);
  const usefulPerFuel = combustionUsefulPerFuel(kind, fuel);
  const target = Math.max(0, requestedOutput);
  const fuelRequired = usefulPerFuel > 0 ? target / usefulPerFuel : 0;
  const fuelAvailable = combustionFuelAvailable(settlement, fuel);
  const fuelUsed = Math.min(fuelRequired, fuelAvailable);
  return {
    requestedOutput: target,
    fuelRequired,
    fuelAvailable,
    ...combustionFromFuel(kind, fuel, fuelUsed),
  };
}
