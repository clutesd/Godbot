import type { Person, Settlement, SimulationState, Vec2 } from '../../sim/types';
import { PeopleSystem } from '../../sim/people/PeopleSystem';
import { physicalRestSite } from '../../sim/people/EstablishmentWork';
import { resourceVisualUnit as unit } from '../../sim/resources/ResourceWorkPresentation';
import type { PersonVisualState } from './PeopleVisualState';

/** Stable reservations shared by all destinations; never feeds positions into production. */
export class PersonalSpace {
  private points = new Map<string, Vec2>();
  private buckets = new Map<string, Set<string>>();
  private key(p: Vec2): string { return `${Math.floor(p.x / 0.5)}:${Math.floor(p.z / 0.5)}`; }
  release(id: string): void {
    const old = this.points.get(id);
    if (old) { const key = this.key(old), bucket = this.buckets.get(key); bucket?.delete(id); if (!bucket?.size) this.buckets.delete(key); }
    this.points.delete(id);
  }
  clear(): void { this.points.clear(); this.buckets.clear(); }
  available(id: string, p: Vec2, gap = 0.24): boolean {
    const x = Math.floor(p.x / 0.5), z = Math.floor(p.z / 0.5);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of this.buckets.get(`${x + dx}:${z + dz}`) ?? []) {
        const q = this.points.get(other)!;
        if (other !== id && Math.hypot(p.x - q.x, p.z - q.z) < gap) return false;
      }
    }
    return true;
  }
  put(id: string, p: Vec2): void {
    this.release(id); this.points.set(id, { x: p.x, z: p.z });
    const key = this.key(p), bucket = this.buckets.get(key) ?? new Set<string>();
    bucket.add(id); this.buckets.set(key, bucket);
  }
  reserve(id: string, center: Vec2, safe: (p: Vec2) => boolean): Vec2 | undefined {
    const old = this.points.get(id);
    if (old && Math.hypot(old.x - center.x, old.z - center.z) <= 1.5 && safe(old)) return old;
    this.release(id);
    const phase = unit(`${id}:slot`) * Math.PI * 2;
    for (let i = 0; i < 97; i++) {
      const radius = i === 0 ? 0 : 0.16 * Math.sqrt(i), angle = phase + i * 2.39996323;
      const point = { x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius };
      if (safe(point) && this.available(id, point)) { this.put(id, point); return point; }
    }
    return undefined;
  }
}

interface Routine { key: string; person: Person; sleeping: boolean; hidden: boolean; seen: number; retry: number; }

/** Daily presentation is a projection of PeopleSystem, not a second economic simulation.
 * The input date is the same fractional month used by the on-screen calendar. */
export class DailyLife {
  readonly planner: PeopleSystem;
  readonly slots = new PersonalSpace();
  private routines = new Map<string, Routine>();
  private frame = 0;
  constructor(state: SimulationState) { this.planner = new PeopleSystem(state.world, state.seed); }
  beginFrame(): void { this.frame++; }
  prune(): void {
    for (const [id, routine] of this.routines) if (routine.seen !== this.frame) { this.routines.delete(id); this.slots.release(id); }
  }
  clear(): void { this.routines.clear(); this.slots.clear(); }
  resolve(source: Person, settlement: Settlement, state: SimulationState, days: number, visual?: PersonVisualState): Routine {
    const hour = ((days % 1) + 1) % 1 * 24;
    const key = `${state.month}:${source.homeId}:${source.occupation}:${source.role}:${this.planner.walkability.structures.revision}:${this.planner.dailyKey(source, settlement, state, hour)}`;
    let routine = this.routines.get(source.id);
    if (!routine || routine.key !== key || days >= routine.retry) {
      const origin = visual ? { x: visual.x, z: visual.z } : source.position;
      const person = this.planner.dailyPlan({ ...source, position: origin }, settlement, state, hour);
      const nav = person.navigation!;
      const endpoint = nav.waypoints.at(-1) ?? origin;
      this.slots.release(source.id);
      const slot = this.slots.reserve(source.id, endpoint, p => this.planner.walkability.isWalkable(p));
      const route = slot ? this.planner.walkability.route(origin, slot) : [];
      person.position = slot ?? origin; person.target = { ...person.position };
      nav.waypoints = route; nav.waypointIndex = route.length;
      nav.traveling = false;
      const sleeping = nav.destinationKind === 'home';
      person.activity = sleeping ? 'rest' : nav.schedulePhase === 'meal' ? 'socialize'
        : source.activity === 'rest' || source.activity === 'travel' ? activityFor(person) : source.activity;
      // Failed journeys are explicit short waits and retry in simulation time.
      if (!route.length) { person.position = { ...origin }; person.activity = 'rest'; nav.reason = 'waiting for a clear route'; }
      routine = { key, person, sleeping, hidden: false, seen: this.frame, retry: route.length ? Infinity : days + 1 / 24 };
      this.routines.set(source.id, routine);
    }
    routine.seen = this.frame;
    const arrived = visual && !visual.traveling && Math.hypot(visual.x - routine.person.position.x, visual.z - routine.person.position.z) < 0.08;
    routine.hidden = Boolean(routine.sleeping && arrived && physicalRestSite(state, source));
    return routine;
  }
}

function activityFor(person: Person): Person['activity'] {
  const kind = person.navigation!.destinationKind;
  if (kind === 'construction-site') return 'construct';
  if (kind === 'field') return person.occupation === 'farmer' ? 'farm' : 'gather';
  if (kind === 'home') return 'rest';
  if (kind === 'market' || kind === 'plaza') return 'socialize';
  if (kind === 'shrine') return 'worship';
  return 'craft';
}
