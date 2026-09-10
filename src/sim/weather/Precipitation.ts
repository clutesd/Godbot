import type { WeatherKind, WeatherPrecipitation } from '../types';

/** World temperatures are normalized climate values, not Celsius. */
export const FREEZING = 0.38;
export const MIXED_COLD = 0.35;
export const MIXED_WARM = 0.41;
export function hasPrecipitation(kind: WeatherKind): boolean {
  return ['rain', 'heavy-rain', 'snow', 'heavy-snow', 'thunderstorm', 'hurricane', 'tornado'].includes(kind);
}
export function precipitationPhase(temperature: number): { precipitation: WeatherPrecipitation; snowFraction: number } {
  const t = Math.max(0, Math.min(1, (temperature - MIXED_COLD) / (MIXED_WARM - MIXED_COLD)));
  const snowFraction = 1 - t * t * (3 - 2 * t);
  return { precipitation: t === 0 ? 'snow' : t === 1 ? 'rain' : 'mixed', snowFraction };
}
