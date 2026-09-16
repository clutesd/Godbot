import type { PressureObservation } from './types';

export const finite = (n: number, fallback = 0): number => Number.isFinite(n) ? n : fallback;
export const unit = (n: number): number => Math.max(0, Math.min(1, finite(n)));
export const positive = (n: number): number => Math.max(0, finite(n));

/** Pure, bounded and local: observation does not prescribe a response. Repeated reads are idempotent. */
export function observePressure(previous: PressureObservation | undefined,
  input: Pick<PressureObservation, 'kind' | 'affectedPopulation' | 'location' | 'observedMonth' | 'causes' | 'consequences' | 'responses' | 'evidence'>
    & { intensity: number; confidence: number; expectedSeverity?: number }): PressureObservation {
  const intensity = unit(input.intensity);
  const elapsed = previous ? Math.max(0, finite(input.observedMonth - previous.observedMonth)) : 1;
  const confidence = unit(input.confidence);
  const priorPerceived = unit(previous?.perceived ?? intensity);
  const revision = previous ? intensity - unit(previous.intensity) : 0;
  // An end-of-month harvest correction revises the same observation without aging it twice.
  const perceived = elapsed === 0 ? unit(priorPerceived + revision * (0.35 + confidence * 0.65))
    : unit(priorPerceived + (intensity - priorPerceived) * (0.35 + confidence * 0.65));
  const trend = Math.max(-1, Math.min(1, elapsed > 0 && previous ? revision / elapsed : finite(previous?.trend ?? 0) + revision));
  return { ...input, intensity, perceived, confidence, affectedPopulation: positive(input.affectedPopulation),
    location: { x: finite(input.location.x), z: finite(input.location.z) },
    evidence: Object.fromEntries(Object.entries(input.evidence).map(([key, value]) => [key, finite(value)])),
    duration: intensity >= 0.3 ? Math.min(1200, positive(previous?.duration ?? 0) + (elapsed || (unit(previous?.intensity ?? 0) < 0.3 ? 1 : 0))) : 0,
    trend, urgency: unit(perceived + Math.max(0, trend) * 2),
    expectedSeverity: unit(input.expectedSeverity ?? intensity + Math.max(0, trend) * 3),
    eventId: intensity >= 0.3 ? previous?.eventId : undefined };
}
