import { hasKnowledgeCapability as knows } from '../knowledge/CapabilityContract';
import type { Settlement, SimulationState } from '../types';
import type { EnergyCarrier, GeneratorKind } from './types';
export interface GeneratorDefinition { kind: GeneratorKind; carrier: EnergyCarrier; capacity: number; knowledge: string[]; cost: Record<string, number>; work: number; fuel?: string; efficiency?: number; cooling?: boolean; }
export const GENERATORS: readonly GeneratorDefinition[] = [
  { kind: 'animal', carrier: 'mechanical', capacity: 2, knowledge: ['wheel-axle', 'animal-husbandry'], cost: { timber: 3 }, work: 2, fuel: 'food', efficiency: 2 },
  { kind: 'waterwheel', carrier: 'mechanical', capacity: 8, knowledge: ['rotary-machinery'], cost: { timber: 6, stone: 2 }, work: 4, cooling: true },
  { kind: 'windmill', carrier: 'mechanical', capacity: 7, knowledge: ['rotary-machinery'], cost: { timber: 7, textile: 1 }, work: 4 },
  { kind: 'steam', carrier: 'mechanical', capacity: 16, knowledge: ['mechanical-power', 'iron-working'], cost: { iron: 5, stone: 3 }, work: 8, fuel: 'coal', efficiency: 4, cooling: true },
  { kind: 'generator', carrier: 'electric', capacity: 14, knowledge: ['electrical-generation', 'mechanical-power'], cost: { iron: 4, copper: 3 }, work: 8, fuel: 'coal', efficiency: 3, cooling: true },
  { kind: 'coal', carrier: 'electric', capacity: 55, knowledge: ['electric-grid', 'precision-manufacturing'], cost: { steel: 8, copper: 5, stone: 10 }, work: 18, fuel: 'coal', efficiency: 5, cooling: true },
  { kind: 'hydro', carrier: 'electric', capacity: 65, knowledge: ['electrical-generation', 'civic-administration'], cost: { steel: 5, copper: 4, stone: 20 }, work: 24, cooling: true },
  { kind: 'wind', carrier: 'electric', capacity: 28, knowledge: ['electric-grid', 'precision-manufacturing'], cost: { steel: 5, copper: 3 }, work: 12 },
  { kind: 'solar', carrier: 'electric', capacity: 24, knowledge: ['photovoltaics'], cost: { silicon: 4, copper: 3 }, work: 10 },
  { kind: 'gas', carrier: 'electric', capacity: 65, knowledge: ['internal-combustion', 'electric-grid'], cost: { steel: 8, copper: 4 }, work: 16, fuel: 'natural-gas', efficiency: 8 },
  { kind: 'nuclear', carrier: 'electric', capacity: 220, knowledge: ['nuclear-energy', 'industrial-chemistry', 'precision-manufacturing', 'grid-management'], cost: { steel: 25, copper: 12, stone: 30, 'nuclear-fuel': 2 }, work: 60, fuel: 'nuclear-fuel', efficiency: 120, cooling: true },
];
export const generatorDefinition = (kind: GeneratorKind): GeneratorDefinition => GENERATORS.find(g => g.kind === kind)!;
export function environmentFactor(state: SimulationState, s: Settlement, kind: GeneratorKind, daylight?: number): number {
  const cell = state.world.cells[s.cellIndex];
  if (!cell) return 0;
  const weather = state.weather.cells[s.cellIndex];
  if (kind === 'waterwheel' || kind === 'hydro') return cell.river ? Math.min(1, Math.max(0, cell.flow) * (0.5 + (weather?.runoff ?? 0)) * (1 - Math.min(1, weather?.snowpack ?? 0) * 0.7)) : 0;
  if (kind === 'wind' || kind === 'windmill') { const wind = weather?.wind ?? 0; return wind > 0.9 ? 0 : Math.min(1, Math.max(0, wind - 0.08) ** 3 * 8); }
  if (kind === 'solar') return Math.max(0, daylight ?? (0.5 + 0.18 * Math.sin((state.month % 12 - 2) / 12 * Math.PI * 2))) * (1 - (weather?.intensity ?? 0) * 0.7) * (1 - Math.min(1, weather?.snowpack ?? 0));
  return 1;
}
export function eligibleGenerator(state: SimulationState, s: Settlement, g: GeneratorDefinition): boolean {
  if (!g.knowledge.every(k => knows(s, k))) return false;
  const cell = state.world.cells[s.cellIndex];
  if (!cell) return false;
  if (g.cooling && !(cell.river && cell.flow > 0.04 || cell.lake)) return false;
  if (g.kind === 'hydro' || g.kind === 'waterwheel') return cell.river && cell.flow > 0.08;
  if (g.kind === 'nuclear') return s.industry.active && s.industry.intensity >= 0.32 && s.infrastructure.workshops >= 0.35 && s.infrastructure.factories >= 0.2 && s.knowledge.literacy >= 0.5 && (s.development?.water?.reliability ?? 0) >= 0.6;
  return true;
}
