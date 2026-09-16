import type { Settlement, SimulationState, StructurePlot } from '../types';
import type { DevelopmentResponse } from './types';

export const SHELTER_USABLE_PROGRESS = 0.75;
export function usableStructure(plot: StructurePlot): boolean {
  return plot.condition >= 0.3 && !plot.accessRestricted && !plot.fire && (plot.floodDepth ?? 0) <= 0.06;
}

/** One physical capacity contract; semantic household destinations supply no protection. */
export function shelterCapacity(s: Settlement, state?: SimulationState, population = Infinity): { capacity: number; protection: number; permanent: number; pod: number } {
  let capacity = 0, protection = 0, permanent = 0;
  const places: { capacity: number; insulation: number }[] = [];
  const add = (response: DevelopmentResponse, condition: number) => {
    const capacityHere = Math.max(0, response.services.housing ?? 0) * 17 * condition;
    capacity += capacityHere;
    // Assign occupants below; spare roofs do not insulate the same person twice.
    addPlaces(capacityHere, response.insulation ?? 0.75);
    if (!response.temporary) permanent += capacityHere;
  };
  const addPlaces = (capacity: number, insulation: number) => places.push({ capacity, insulation });
  for (const p of s.structurePlots ?? []) {
    if (!usableStructure(p)) continue;
    if (p.development?.status === 'active') add(p.development, p.condition);
    else if (s.development?.project?.plotId === p.id && s.development.project.progress >= SHELTER_USABLE_PROGRESS) {
      add(s.development.project.response, p.condition * s.development.project.progress);
    }
  }
  const vessel = state?.arrival?.pods.find(p => p.id === s.foundingPodId && p.landed);
  const pod = vessel ? (vessel.shelterCapacity ?? 4) * Math.max(0, vessel.condition) : 0;
  addPlaces(pod, 0.45);
  let remaining = population;
  for (const place of places.sort((a, b) => b.insulation - a.insulation)) {
    const occupied = Math.min(remaining, place.capacity);
    protection += occupied * place.insulation; remaining -= occupied;
  }
  return { capacity: capacity + pod, protection, permanent, pod };
}
