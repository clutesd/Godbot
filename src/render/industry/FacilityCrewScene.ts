import { facilityIdFromDestinationId, facilityWorkDutyFromDestinationId, isFacilityWorkDestinationId } from '../../sim/people/FacilityWorkRouting';
import type { Person, SimulationState, Vec2 } from '../../sim/types';
import { facilityVisual, type FacilityVisual } from './FacilityPresentation';
import { facilityStations, stationForDuty, type FacilityStation } from './FacilityWorkstations';

/**
 * Binds the real people the simulation routed to a works onto the machines that works is drawing.
 *
 * This replaces the renderer's former invented facility crew. A station is occupied only by a
 * represented resident whose authoritative destination is this facility, so an empty works on
 * screen means the authority spent no labour there this month.
 */
export interface FacilityCrewBinding {
  station: FacilityStation;
  visual: FacilityVisual;
}

export class FacilityCrewScene {
  private readonly stationsByFacility = new Map<string, readonly FacilityStation[]>();
  private readonly visualsByFacility = new Map<string, FacilityVisual>();
  private readonly bindings = new Map<string, FacilityCrewBinding>();
  revision = 0;
  private signature = '';

  constructor(
    private readonly standable: (point: Vec2) => boolean = () => true,
    private readonly safeSegment: (a: Vec2, b: Vec2) => boolean = () => true,
  ) {}

  /** Rebuilds the station plan from state; cheap and deterministic, so it may run every frame. */
  update(state: SimulationState): void {
    this.stationsByFacility.clear();
    this.visualsByFacility.clear();
    const parts: string[] = [];
    for (const settlement of state.settlements) {
      if (!settlement.alive) continue;
      for (const facility of settlement.processing?.facilities ?? []) {
        const visual = facilityVisual(state, settlement, facility);
        if (!visual) continue;
        const stations = facilityStations(visual, this.standable);
        if (stations.length === 0) continue;
        this.visualsByFacility.set(visual.id, visual);
        this.stationsByFacility.set(visual.id, stations);
        parts.push(`${visual.id}:${visual.tier}:${stations.map(entry => entry.kind).join(',')}`);
      }
    }
    const signature = parts.join('|');
    if (signature !== this.signature) { this.signature = signature; this.revision++; }
    for (const [id, binding] of this.bindings) {
      if (this.stationsByFacility.get(binding.station.facilityId) === undefined) this.bindings.delete(id);
    }
  }

  /** Only already-routed residents may take a station, and only one each. */
  bindWorkers(people: readonly Person[]): void {
    const previous = new Map(this.bindings);
    this.bindings.clear();
    const taken = new Map<string, Set<string>>();
    for (const person of [...people].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!person.alive) continue;
      const destinationId = person.navigation?.destinationId;
      if (!isFacilityWorkDestinationId(destinationId)) continue;
      const facilityId = facilityIdFromDestinationId(destinationId);
      const stations = facilityId ? this.stationsByFacility.get(facilityId) : undefined;
      const visual = facilityId ? this.visualsByFacility.get(facilityId) : undefined;
      if (!stations || !visual) continue;
      const claimed = taken.get(visual.id) ?? new Set<string>();
      const duty = facilityWorkDutyFromDestinationId(destinationId) ?? 'process';
      const old = previous.get(person.id);
      // Hold a station already being worked rather than reshuffling the crew every frame.
      const held = old && old.station.facilityId === visual.id && !claimed.has(old.station.key)
        ? stations.find(candidate => candidate.key === old.station.key)
        : undefined;
      const station = held ?? stationForDuty(stations, duty, claimed);
      if (!station || !this.safeSegment(person.position, station.anchor)) continue;
      claimed.add(station.key);
      taken.set(visual.id, claimed);
      this.bindings.set(person.id, { station, visual });
    }
  }

  get(personId: string): FacilityCrewBinding | undefined { return this.bindings.get(personId); }
  get size(): number { return this.bindings.size; }
  /** People bound to one works; the industry renderer uses the count, never the identities. */
  occupancy(facilityId: string): number {
    let count = 0;
    for (const binding of this.bindings.values()) if (binding.station.facilityId === facilityId) count++;
    return count;
  }
  clear(): void { this.bindings.clear(); this.stationsByFacility.clear(); this.visualsByFacility.clear(); }
}
