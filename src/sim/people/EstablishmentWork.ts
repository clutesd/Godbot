import type { Person, SimulationState } from '../types';
import { resourceWorkAssignmentForPerson } from './ResourceWorkRouting';
import { usableStructure, SHELTER_USABLE_PROGRESS } from '../development/Shelter';

const snapshots = new WeakMap<SimulationState, { month: number; workers: Set<string>; fireTenders: Set<string> }>();
const restSnapshots = new WeakMap<SimulationState, { month: number; count: number; places: Map<string, { x: number; z: number }> }>();

/** Finite resting places use the same fabric as Survival; overflow households remain outdoors. */
export function physicalRestSite(state: SimulationState, person: Person): { x: number; z: number } | undefined {
  let snapshot = restSnapshots.get(state);
  if (!snapshot || snapshot.month !== state.month || snapshot.count !== state.people.length) {
    const places = new Map<string, { x: number; z: number }>();
    const residents = new Map<string, Person[]>();
    for (const p of state.people) if (p.alive) { const group = residents.get(p.homeId) ?? []; group.push(p); residents.set(p.homeId, group); }
    for (const s of state.settlements) {
      const local = residents.get(s.id) ?? [];
      let cursor = 0;
      const assign = (capacity: number, point: { x: number; z: number }) => {
        for (let i = 0; i < Math.floor(capacity) && cursor < local.length; i++) places.set(local[cursor++]!.id, point);
      };
      for (const p of s.structurePlots ?? []) if (usableStructure(p)) {
        const project = s.development?.project?.plotId === p.id ? s.development.project : undefined;
        const response = p.development?.status === 'active' ? p.development : project && project.progress >= SHELTER_USABLE_PROGRESS ? project.response : undefined;
        if (response) assign((response.services.housing ?? 0) * 17 * p.condition * (p.development ? 1 : project!.progress), { x: p.worldX, z: p.worldZ });
      }
      const pod = state.arrival?.pods.find(p => p.id === s.foundingPodId && p.landed);
      if (pod) assign((pod.shelterCapacity ?? 4) * pod.condition, pod.position);
    }
    snapshot = { month: state.month, count: state.people.length, places }; restSnapshots.set(state, snapshot);
  }
  return snapshot.places.get(person.id);
}
/** Bounded documentary cast, selected from the actual contributing occupation buckets. */
export function isEstablishmentBuilder(state: SimulationState, person: Person): boolean {
  let snapshot = snapshots.get(state);
  if (!snapshot || snapshot.month !== state.month) {
    const workers = new Set<string>(), fireTenders = new Set<string>();
    const homes = new Map(state.settlements.map(s => [s.id, s]));
    const remaining = new Map<string, Partial<Record<Person['occupation'], number>>>();
    for (const s of state.settlements) if (s.development?.project?.response.adaptation && s.development.project.lastWorkMonth === state.month) {
      remaining.set(s.id, Object.fromEntries(Object.entries(s.survival?.establishment?.constructionByOccupation ?? {})
        .map(([o, amount]) => [o, Math.ceil(amount)])));
    }
    for (const p of state.people) {
      const budget = remaining.get(p.homeId);
      if (!budget || !homes.get(p.homeId)?.alive || !p.alive || p.health < 0.25 || p.occupation === 'child'
        || p.displacedSinceMonth !== undefined || p.activity === 'migrate' || ['soldier', 'guard'].includes(p.role ?? '')
        || (budget[p.occupation] ?? 0) <= 0 || resourceWorkAssignmentForPerson(state, p, state.seed)) continue;
      workers.add(p.id); budget[p.occupation] = (budget[p.occupation] ?? 0) - 1;
    }
    const warmed = new Set<string>();
    for (const p of state.people) {
      const s = homes.get(p.homeId);
      if (!s?.alive || warmed.has(s.id) || (s.survival?.cold.fuelUsed ?? 0) <= 0 || (s.survival?.establishment?.heatingLabour ?? 0) <= 0
        || (s.survival?.establishment?.heatingByOccupation[p.occupation] ?? 0) <= 0
        || !p.alive || p.health < 0.25 || !['keeper', 'carrier', 'forager', 'farmer'].includes(p.occupation)
        || p.activity === 'migrate' || workers.has(p.id) || resourceWorkAssignmentForPerson(state, p, state.seed)) continue;
      fireTenders.add(p.id); warmed.add(s.id);
    }
    snapshot = { month: state.month, workers, fireTenders }; snapshots.set(state, snapshot);
  }
  return snapshot.workers.has(person.id);
}

export function isEstablishmentFireTender(state: SimulationState, person: Person): boolean {
  isEstablishmentBuilder(state, person);
  return snapshots.get(state)!.fireTenders.has(person.id);
}
