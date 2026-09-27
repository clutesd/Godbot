import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import {
  foundingCommunityChore,
  foundingCommunityDestination,
  foundingCommunityIsForming,
  foundingCommunitySupplyAnchor,
  isFoundingCommunityDestinationId,
} from '../src/sim/people/FoundingCommunityRoutine';
import { survivalState } from '../src/sim/pressures/Survival';

function foundingState(seed = 'founding-community-routine') {
  const simulation = new Simulation({ seed, startMode: 'arrival', world: { size: 64 } });
  simulation.advanceArrival(80);
  if (!simulation.beginHistory()) throw new Error('Expected founding history to begin');
  simulation.step(1);
  const settlement = simulation.state.settlements.find(candidate => candidate.alive && candidate.foundingPodId);
  if (!settlement) throw new Error('Expected a living founding settlement');
  return { simulation, settlement };
}

describe('founding community routine', () => {
  it('uses physical camp maturity rather than a month timer', () => {
    const { settlement } = foundingState();
    expect(foundingCommunityIsForming(settlement)).toBe(true);

    const originalPod = settlement.foundingPodId;
    settlement.foundingPodId = undefined;
    expect(foundingCommunityIsForming(settlement)).toBe(false);
    settlement.foundingPodId = originalPod;
  });

  it('spreads ordinary adults across camp work instead of imaginary town venues', () => {
    const { simulation, settlement } = foundingState('founding-community-spread');
    const adults = simulation.state.people
      .filter(person => person.alive && person.homeId === settlement.id && person.ageMonths >= 18 * 12)
      .slice(0, 12);
    expect(adults.length).toBeGreaterThan(5);

    const destinations = adults
      .map(person => foundingCommunityDestination(person, settlement, simulation.state, 11))
      .filter(destination => destination !== undefined);

    expect(destinations).toHaveLength(adults.length);
    expect(destinations.every(destination => isFoundingCommunityDestinationId(destination.destinationId))).toBe(true);
    expect(destinations.every(destination => !['market', 'shrine', 'civic-building', 'knowledge-institution'].includes(destination.kind))).toBe(true);
    expect(new Set(destinations.map(destination => destination.destinationId)).size).toBeGreaterThanOrEqual(2);

    const radii = destinations.map(destination => Math.hypot(
      destination.point.x - settlement.position.x,
      destination.point.z - settlement.position.z,
    ));
    expect(Math.max(...radii)).toBeGreaterThan(1.5);
    expect(radii.filter(radius => radius > 1).length).toBeGreaterThan(adults.length / 2);
  });

  it('gives different founding occupations grounded chores without inventing economic output', () => {
    const { simulation, settlement } = foundingState('founding-community-jobs');
    const person = simulation.state.people.find(candidate => candidate.alive && candidate.homeId === settlement.id && candidate.ageMonths >= 18 * 12);
    if (!person) throw new Error('Expected an adult founder');

    person.role = 'guard';
    expect(foundingCommunityChore(person, settlement, simulation.state)).toBe('camp-edge');
    const guard = foundingCommunityDestination(person, settlement, simulation.state, 11);
    expect(guard).toMatchObject({ kind: 'safe-area', activity: 'patrol' });

    person.role = 'craft-worker';
    person.occupation = 'artisan';
    const artisan = foundingCommunityDestination(person, settlement, simulation.state, 11);
    expect(artisan).toBeDefined();
    expect(['craft', 'assist']).toContain(artisan!.activity);
    expect(artisan!.reason).not.toContain('producing');

    person.role = 'builder';
    person.occupation = 'builder';
    const builderChore = foundingCommunityChore(person, settlement, simulation.state);
    expect(['shelter-support', 'supply-yard', 'camp-edge', 'household-prep']).toContain(builderChore);
  });

  it('uses the actual founding hearth for communal evening life once fire exists', () => {
    const { simulation, settlement } = foundingState('founding-community-hearth');
    const person = simulation.state.people.find(candidate => candidate.alive && candidate.homeId === settlement.id && candidate.ageMonths >= 18 * 12);
    if (!person) throw new Error('Expected an adult founder');

    survivalState(settlement).firstFire = {
      month: simulation.state.month,
      eventId: 'first-fire:community-test',
    };
    const meal = foundingCommunityDestination(person, settlement, simulation.state, 17);
    expect(meal).toMatchObject({
      kind: 'plaza',
      phase: 'meal',
      activity: 'socialize',
      destinationId: `${settlement.id}:founding-meal`,
    });
    expect(meal!.reason).toContain('hearth');
  });

  it('places the landed supply yard between the pod and the occupied camp without sitting on the vessel', () => {
    const { simulation, settlement } = foundingState('founding-community-supply-yard');
    const pod = simulation.state.arrival?.pods.find(candidate => candidate.id === settlement.foundingPodId);
    expect(pod).toBeDefined();

    const anchor = foundingCommunitySupplyAnchor(settlement, simulation.state);
    const podDistance = Math.hypot(anchor.x - pod!.position.x, anchor.z - pod!.position.z);
    expect(podDistance).toBeGreaterThan(1.3);
    expect(podDistance).toBeLessThan(2.5);
    expect(Number.isFinite(anchor.x)).toBe(true);
    expect(Number.isFinite(anchor.z)).toBe(true);
  });

  it('keeps children near camp life without turning them into establishment labour', () => {
    const { simulation, settlement } = foundingState('founding-community-children');
    const child = simulation.state.people.find(candidate => candidate.alive && candidate.homeId === settlement.id && candidate.occupation === 'child');
    if (!child) return;

    const destination = foundingCommunityDestination(child, settlement, simulation.state, 12);
    expect(destination).toMatchObject({ activity: 'socialize', kind: 'plaza' });
    expect(destination!.reason).toContain('adults establish');
  });
});
