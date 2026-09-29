import type { Person, Vec2 } from '../../sim/types';
import type { ActivityStructure } from './LocalActivityPresentation';
import type { RestSpotPresentation } from './RestPresentation';
import { indoorSleepingSpots, sleepAreaLocal, type IndoorSleepingArea } from './IndoorSleepingArea';

/** Stable, full-body sleeping spaces, retained through monthly job/household position changes. */
export class SleepPresentation {
  private readonly spots = new Map<string, RestSpotPresentation>();
  private readonly residents = new Map<string, string[]>();
  private readonly access = new Map<string, IndoorSleepingArea>();

  beginFrame(people: readonly Person[]): void {
    this.residents.clear();
    const alive = new Set<string>();
    for (const person of people) {
      if (!person.alive) continue;
      alive.add(person.id);
      const ids = this.residents.get(person.homeId) ?? [];
      ids.push(person.id);
      this.residents.set(person.homeId, ids);
    }
    for (const ids of this.residents.values()) ids.sort();
    for (const id of this.spots.keys()) if (!alive.has(id)) this.spots.delete(id);
    for (const id of this.access.keys()) if (!alive.has(id)) this.access.delete(id);
  }

  resolve(person: Person, due: boolean, home: Vec2, structures: readonly ActivityStructure[],
    safePoint: (point: Vec2) => boolean, safeSegment: (a: Vec2, b: Vec2) => boolean,
    indoorSafe: (a: Vec2, b: Vec2, area: IndoorSleepingArea) => boolean = safeSegment): RestSpotPresentation | undefined {
    if (!due) { this.spots.delete(person.id); return; }
    const fits = (spot: RestSpotPresentation): boolean => {
      const dx = Math.sin(spot.facing) * 0.55, dz = Math.cos(spot.facing) * 0.55;
      const head = { x: spot.destination.x - dx, z: spot.destination.z - dz };
      const feet = { x: spot.destination.x + dx, z: spot.destination.z + dz };
      return safePoint(spot.destination) && safePoint(head) && safePoint(feet) && safeSegment(head, feet);
    };
    const rank = Math.max(0, this.residents.get(person.homeId)?.indexOf(person.id) ?? 0);
    const beds = structures.filter(s => s.sleepingArea).sort((a, b) => a.key.localeCompare(b.key))
      .flatMap(s => indoorSleepingSpots(s.sleepingArea!));
    const bed = beds[rank];
    if (bed?.indoor) {
      const dx = Math.sin(bed.facing) * 0.2, dz = Math.cos(bed.facing) * 0.2;
      const head = { x: bed.destination.x - dx, z: bed.destination.z - dz };
      const feet = { x: bed.destination.x + dx, z: bed.destination.z + dz };
      if (safePoint(head) && safePoint(feet) && indoorSafe(head, feet, bed.indoor)) {
        this.spots.set(person.id, bed); return bed;
      }
    }
    const previous = this.spots.get(person.id);
    if (previous && !previous.indoor && previous.key.startsWith(`${person.homeId}:`) && fits(previous)) return previous;
    this.spots.delete(person.id);
    const shelters = structures.filter(s => ['shelter', 'lean-to', 'hut', 'house', 'compound'].includes(s.role ?? ''));
    const shelter = shelters.length ? shelters[rank % shelters.length] : undefined;
    const center = shelter ? { x: shelter.worldX, z: shelter.worldZ } : home;
    const slot = shelter ? Math.floor(rank / shelters.length) : rank;
    for (let attempt = 0; attempt < 3; attempt++) {
      const angle = (slot % 8) / 8 * Math.PI * 2;
      const radius = (shelter ? Math.hypot(shelter.width, shelter.depth) / 2 : 0) + 1.25 + Math.floor(slot / 8) * 1.15 + attempt * 1.15;
      const destination = { x: center.x + Math.sin(angle) * radius, z: center.z + Math.cos(angle) * radius };
      const spot: RestSpotPresentation = { key: `${person.homeId}:sleep:${person.id}`, destination,
        facing: angle, posture: 'sleep', support: 'ground', supportKey: shelter?.key };
      // The normal people navigator owns the route and detours to this validated destination.
      const occupied = [...this.spots.entries()].some(([id, other]) => id !== person.id
        && Math.hypot(other.destination.x - destination.x, other.destination.z - destination.z) < 0.85);
      if (!occupied && fits(spot)) { this.spots.set(person.id, spot); return spot; }
    }
    return undefined;
  }

  /** Retain doorway access while waking and leaving; never eject a sleeper through a wall. */
  accessFor(personId: string, position: Vec2, spot: RestSpotPresentation | undefined, structures: readonly ActivityStructure[]): IndoorSleepingArea | undefined {
    if (spot?.indoor) this.access.set(personId, spot.indoor);
    const previous = this.access.get(personId);
    if (!previous) return;
    const area = structures.find(s => s.key === previous.key)?.sleepingArea;
    const local = area ? sleepAreaLocal(area, position) : undefined;
    if (!area || !local || !spot?.indoor && (Math.abs(local.x) > area.plotWidth / 2 + 0.3 || Math.abs(local.z) > area.plotDepth / 2 + 0.3)) {
      this.access.delete(personId); return;
    }
    return area;
  }
}

/** Noon is solar phase .25; midnight is .75, exactly matching the rendered sun. */
export function solarHour(elapsedSeconds: number): number {
  return (((elapsedSeconds / 58 + 0.16) * 24 + 6) % 24 + 24) % 24;
}
