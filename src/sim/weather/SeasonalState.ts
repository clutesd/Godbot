import type { WeatherCellState, WorldCell } from '../types';

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (start: number, end: number, value: number): number => {
  const fraction = clamp((value - start) / (end - start));
  return fraction * fraction * (3 - 2 * fraction);
};

export interface SeasonalFoliage {
  canopy: number;
  autumn: number;
  growth: number;
  leafFall: number;
}

export function seasonalFoliage(month: number, cell: Pick<WorldCell, 'temperature' | 'moisture'>,
  weather: Pick<WeatherCellState, 'temperature'>, evergreen: boolean, variation = 0.5): SeasonalFoliage {
  if (evergreen || cell.temperature > 0.64 || cell.moisture < 0.26) {
    return { canopy: 1, autumn: 0, growth: 0, leafFall: 0 };
  }
  const phase = ((month + (variation - 0.5) * 1.2 + (cell.temperature - 0.46) * 1.5) % 12 + 12) % 12;
  const spring = smooth(1, 3.8, phase);
  const loss = smooth(8, 10.8, phase);
  const warmth = smooth(0.2, 0.46, weather.temperature);
  const canopy = phase < 5 ? spring * warmth : (1 - loss) * (0.35 + warmth * 0.65);
  return {
    canopy,
    autumn: smooth(6.6, 9.2, phase) * (1 - smooth(10.5, 11.8, phase)),
    growth: phase < 5 ? spring * (1 - smooth(3, 5, phase)) : 0,
    leafFall: phase > 8 && phase < 10.8 ? Math.sin((phase - 8) / 2.8 * Math.PI) : 0,
  };
}