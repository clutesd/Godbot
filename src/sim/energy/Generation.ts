import { hasKnowledgeCapability as knows } from '../knowledge/CapabilityContract';
import type { Settlement, SimulationState, WeatherKind } from '../types';
import { FREEZING } from '../weather/Precipitation';
import type { EnergyCarrier, GeneratorKind } from './types';

export interface GeneratorDefinition {
  kind: GeneratorKind;
  carrier: EnergyCarrier;
  capacity: number;
  knowledge: string[];
  cost: Record<string, number>;
  work: number;
  fuel?: string;
  efficiency?: number;
  cooling?: boolean;
}

export const GENERATORS: readonly GeneratorDefinition[] = [
  { kind: 'animal', carrier: 'mechanical', capacity: 2, knowledge: ['wheel-axle', 'animal-husbandry'], cost: { timber: 3 }, work: 2, fuel: 'food', efficiency: 2 },
  { kind: 'waterwheel', carrier: 'mechanical', capacity: 8, knowledge: ['rotary-machinery'], cost: { timber: 6, stone: 2 }, work: 4 },
  { kind: 'windmill', carrier: 'mechanical', capacity: 7, knowledge: ['rotary-machinery'], cost: { timber: 7, textile: 1 }, work: 4 },
  { kind: 'steam', carrier: 'mechanical', capacity: 16, knowledge: ['mechanical-power', 'iron-working'], cost: { iron: 5, stone: 3 }, work: 8, fuel: 'coal', efficiency: 4, cooling: true },
  { kind: 'generator', carrier: 'electric', capacity: 14, knowledge: ['electrical-generation', 'mechanical-power'], cost: { iron: 4, copper: 3 }, work: 8, fuel: 'coal', efficiency: 3, cooling: true },
  { kind: 'coal', carrier: 'electric', capacity: 55, knowledge: ['electric-grid', 'precision-manufacturing'], cost: { steel: 8, copper: 5, stone: 10 }, work: 18, fuel: 'coal', efficiency: 5, cooling: true },
  { kind: 'hydro', carrier: 'electric', capacity: 65, knowledge: ['electrical-generation', 'civic-administration'], cost: { steel: 5, copper: 4, stone: 20 }, work: 24 },
  { kind: 'wind', carrier: 'electric', capacity: 28, knowledge: ['electric-grid', 'precision-manufacturing'], cost: { steel: 5, copper: 3 }, work: 12 },
  { kind: 'solar', carrier: 'electric', capacity: 24, knowledge: ['photovoltaics'], cost: { silicon: 4, copper: 3 }, work: 10 },
  { kind: 'gas', carrier: 'electric', capacity: 65, knowledge: ['internal-combustion', 'electric-grid'], cost: { steel: 8, copper: 4 }, work: 16, fuel: 'natural-gas', efficiency: 8 },
  { kind: 'nuclear', carrier: 'electric', capacity: 220, knowledge: ['nuclear-energy', 'industrial-chemistry', 'precision-manufacturing', 'grid-management'], cost: { steel: 25, copper: 12, stone: 30, 'nuclear-fuel': 2 }, work: 60, fuel: 'nuclear-fuel', efficiency: 120, cooling: true },
];

export const generatorDefinition = (kind: GeneratorKind): GeneratorDefinition => GENERATORS.find(g => g.kind === kind)!;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smooth01 = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function hydroFactor(state: SimulationState, settlement: Settlement, kind: 'waterwheel' | 'hydro'): number {
  const cell = state.world.cells[settlement.cellIndex];
  if (!cell?.river) return 0;
  const weather = state.weather.cells[settlement.cellIndex];
  const runoff = clamp01((weather?.runoff ?? 0) * 3);
  const baseFlow = clamp01(cell.flow);
  const temperature = weather?.temperature ?? cell.temperature;
  const snowCover = clamp01((weather?.snowpack ?? 0) / 1.2);
  const freezeStress = clamp01((FREEZING - temperature) / 0.14) * snowCover;

  if (kind === 'waterwheel') {
    // Exposed wheels benefit strongly from fresh runoff but lose useful motion in icy conditions.
    const usableFlow = clamp01(baseFlow * 0.78 + runoff * 0.38);
    return clamp01(usableFlow * (1 - freezeStress * 0.72));
  }

  // Large hydro smooths short weather swings through controlled intake/storage and is less
  // vulnerable to surface ice, while still depending on actual river discharge.
  const usableFlow = clamp01(baseFlow * 0.96 + runoff * 0.22);
  return clamp01(usableFlow * (1 - freezeStress * 0.18));
}

function windFactor(kind: 'windmill' | 'wind', wind: number): number {
  const speed = clamp01(wind);
  const curve = kind === 'windmill'
    ? { cutIn: 0.1, rated: 0.5, stormDerate: 0.72, cutOut: 0.9 }
    : { cutIn: 0.08, rated: 0.58, stormDerate: 0.88, cutOut: 1 };

  if (speed <= curve.cutIn || speed >= curve.cutOut) return 0;
  if (speed < curve.rated) return smooth01((speed - curve.cutIn) / (curve.rated - curve.cutIn));
  if (speed <= curve.stormDerate) return 1;

  // Extreme wind forces feathering/braking instead of the old discontinuity where all strong wind
  // immediately produced zero. Primitive mills derate earlier than engineered turbines.
  return 1 - smooth01((speed - curve.stormDerate) / (curve.cutOut - curve.stormDerate));
}

function cloudObscuration(kind: WeatherKind, intensity: number): number {
  const base = kind === 'clear' ? 0.02
    : kind === 'windstorm' ? 0.16
      : kind === 'cloudy' ? 0.34
        : kind === 'rain' || kind === 'snow' ? 0.46
          : kind === 'heavy-rain' || kind === 'heavy-snow' ? 0.64
            : kind === 'thunderstorm' || kind === 'tornado' ? 0.76
              : kind === 'hurricane' ? 0.88
                : 0.3;
  return clamp01(base + clamp01(intensity) * (kind === 'clear' ? 0.08 : 0.16));
}

function seasonalDaylight(month: number): number {
  const monthOfYear = ((month % 12) + 12) % 12;
  return clamp01(0.5 + 0.18 * Math.sin((monthOfYear - 2) / 12 * Math.PI * 2));
}

function solarFactor(state: SimulationState, settlement: Settlement, daylight?: number): number {
  const weather = state.weather.cells[settlement.cellIndex];
  const sun = clamp01(daylight ?? seasonalDaylight(state.month));
  const obscuration = cloudObscuration(weather?.kind ?? 'clear', weather?.intensity ?? 0);
  const snowCover = clamp01((weather?.snowpack ?? 0) / 0.8);
  // Panels retain some production under patchy snow rather than switching off as one binary surface.
  const snowTransmission = 1 - snowCover * 0.78;
  return clamp01(sun * (1 - obscuration) * snowTransmission);
}

export function environmentFactor(
  state: SimulationState,
  settlement: Settlement,
  kind: GeneratorKind,
  daylight?: number,
): number {
  if (!state.world.cells[settlement.cellIndex]) return 0;
  if (kind === 'waterwheel' || kind === 'hydro') return hydroFactor(state, settlement, kind);
  if (kind === 'wind' || kind === 'windmill') return windFactor(kind, state.weather.cells[settlement.cellIndex]?.wind ?? 0);
  if (kind === 'solar') return solarFactor(state, settlement, daylight);
  return 1;
}

export function eligibleGenerator(state: SimulationState, s: Settlement, g: GeneratorDefinition): boolean {
  if (!g.knowledge.every(k => knows(s, k))) return false;
  const cell = state.world.cells[s.cellIndex];
  if (!cell) return false;
  if (g.cooling && !(cell.river && cell.flow > 0.04 || cell.lake)) return false;
  if (g.kind === 'hydro' || g.kind === 'waterwheel') return cell.river && cell.flow > 0.08;
  if (g.kind === 'nuclear') {
    return s.industry.active
      && s.industry.intensity >= 0.32
      && s.infrastructure.workshops >= 0.35
      && s.infrastructure.factories >= 0.2
      && s.knowledge.literacy >= 0.5
      && (s.development?.water?.reliability ?? 0) >= 0.6;
  }
  return true;
}
