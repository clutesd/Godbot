import type { BodyRecord, Person, SimulationState } from '../types';
import { emitEvent } from '../History';

/** Durable physical evidence survives biography retirement and history retention. */
export function recordBody(state: SimulationState, person: Person, deathEventId: string, cause: string): void {
  const bodies = state.bodies ??= [];
  if (bodies.some(b => b.id === person.id)) return;
  const snapshot = structuredClone(person);
  snapshot.navigation = undefined;
  snapshot.foundingOrigin = undefined;
  snapshot.activity = 'patrol';
  snapshot.target = { ...snapshot.position };
  bodies.push({ id: person.id, person: snapshot, deathEventId, cause, month: state.month,
    yaw: Math.atan2(person.target.x - person.position.x, person.target.z - person.position.z) });
}

export function bodyWeathering(body: BodyRecord, month: number): number {
  return Math.max(0, Math.min(1, (month - body.month) / 24));
}

/** A memorial records memory, not proof of burial. Only this explicit world operation removes remains. */
export function removeBody(state: SimulationState, id: string, reason: NonNullable<BodyRecord['removed']>['reason']): boolean {
  const body = state.bodies?.find(b => b.id === id);
  if (!body || body.removed || state.month < body.month) return false;
  const event = emitEvent(state, { type: 'recovery', location: { ...body.person.position }, locationId: body.person.homeId,
    actors: body.recovery ? [id, body.recovery.helperId] : [id], causes: [body.deathEventId], context: { bodyId: id, reason },
    outcome: `Remains handled by ${reason}.`, summary: `${body.person.name}'s remains: ${reason}.`,
    affectedPopulation: 0, magnitude: 0.03, significance: 0.15, tags: ['remains', reason] });
  body.removed = { month: state.month, reason, eventId: event.id };
  return true;
}

/** Calendar-time decomposition is simulation authority, never a renderer TTL. */
export function advanceBodies(state: SimulationState): void {
  state.bodies = state.bodies?.filter(b => !b.removed || state.month - b.removed.month < 12);
  state.aftermathEvents = state.aftermathEvents?.filter(e => state.month - e.month < 36);
  for (const body of state.bodies ?? []) {
    if (body.removed) continue;
    if (body.recovery) {
      const helper = state.people.find(p => p.id === body.recovery!.helperId && p.alive);
      if (!helper) body.recovery = undefined;
      else if (state.month > body.recovery.month) removeBody(state, body.id, 'burial');
    }
    if (!body.removed && state.month - body.month >= 36) removeBody(state, body.id, 'decomposition');
  }
  const busy = new Set((state.bodies ?? []).filter(b => b.recovery && (!b.removed || b.removed.month === state.month)).map(b => b.recovery!.helperId));
  for (const body of state.bodies ?? []) {
    if (body.removed || body.recovery || state.month <= body.month) continue;
    const helper = state.people.filter(p => p.alive && p.ageMonths >= 192 && p.health > 0.4
      && p.homeId === body.person.homeId && !p.navigation?.traveling
      && ['rest', 'socialize', 'mourn', 'patrol', 'assist'].includes(p.activity) && !busy.has(p.id)
      && Math.hypot(p.position.x - body.person.position.x, p.position.z - body.person.position.z) < 2)
      .sort((a, b) => Math.hypot(a.position.x - body.person.position.x, a.position.z - body.person.position.z)
        - Math.hypot(b.position.x - body.person.position.x, b.position.z - body.person.position.z) || a.id.localeCompare(b.id))[0];
    if (helper) { body.recovery = { helperId: helper.id, month: state.month }; busy.add(helper.id); }
  }
}
