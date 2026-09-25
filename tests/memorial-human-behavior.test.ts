import { describe, expect, it } from 'vitest';
import { responseForNeed, developmentContext } from '../src/sim/development/SettlementDevelopmentSystem';
import { rememberMortality } from '../src/sim/development/Remembrance';
import { memorialVisitPlan } from '../src/sim/people/MemorialBehavior';
import { PeopleSystem } from '../src/sim/people/PeopleSystem';
import type { MemoryPerson } from '../src/sim/people/PersonalMemorySystem';
import type { HistoricalEvent, Settlement, SimulationState, StructurePlot } from '../src/sim/types';
import type { StructureDevelopment } from '../src/sim/development/types';
import { structureDestination } from '../src/shared/StructureDestinations';
import { residents, societyFixture } from './fixtures/settlementDevelopment';

function installMemorial(state: SimulationState, settlement: Settlement): StructurePlot {
  rememberMortality(state, settlement, 48);
  const response = responseForNeed(developmentContext(state, settlement), 'memory')!;
  const plot = settlement.structurePlots![0]!;
  plot.condition = 1;
  plot.accessRestricted = false;
  plot.development = {
    ...response,
    status: 'active',
    origin: {
      month: state.month,
      action: 'founded',
      name: response.name,
      need: response.need,
      cultureId: response.cultureId,
      reasons: [...response.reasons],
      form: response.form,
      level: response.level,
      material: response.material,
    },
    history: [],
    transitionCount: 0,
    lastUsedMonth: state.month,
  } satisfies StructureDevelopment;
  return plot;
}

function loss(person: MemoryPerson, month: number, reason = 'family-loss', emotionalWeight = 0.9): void {
  person.personalMemories = [{
    id: `memory:loss:${person.id}`,
    kind: 'loss',
    month,
    eventId: `death:${person.id}`,
    subjectId: 'person-dead',
    settlementId: person.homeId,
    emotionalWeight,
    valence: -1,
    reason,
  }];
}

describe('memorial human behavior', () => {
  it('treats a non-sacred cemetery as a real memorial destination without turning it into a shrine', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const town = settlement!;
    const plot = installMemorial(state, town);

    expect(plot.development!.memorial!.sacred).toBe(false);
    expect(plot.development!.services.memory).toBeGreaterThan(0);
    expect(structureDestination(town, 'memorial-site')).toBe(plot);
  });

  it('sends close kin to the burial ground during the immediate mourning window', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const town = settlement!;
    const plot = installMemorial(state, town);
    const survivor = residents(state, town)[0]! as MemoryPerson;
    state.month = 120;
    loss(survivor, state.month);

    const plan = memorialVisitPlan(survivor, town, state, 12);

    expect(plan).toEqual({
      kind: 'memorial-site',
      phase: 'ritual',
      activity: 'mourn',
      reason: 'mourning a close family member at the burial ground',
      destinationId: plot.id,
    });
  });

  it('supports strong anniversary remembrance without making cemetery visits permanent', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const town = settlement!;
    installMemorial(state, town);
    const survivor = residents(state, town)[0]! as MemoryPerson;
    state.month = 120;
    survivor.traits.loyalty = 0.95;
    survivor.traits.empathy = 0.9;
    survivor.values = { care: 0.8, fairness: 0.6, groupLoyalty: 0.9, authority: 0.4, tradition: 0.95, autonomy: 0.4,
      violenceTolerance: 0.1, corruptionTolerance: 0.1, outsiderConcern: 0.5, stewardship: 0.6, futureGenerations: 0.8 };
    loss(survivor, 96, 'family-loss', 0.98);

    expect(memorialVisitPlan(survivor, town, state, 20)?.reason).toBe('marking an anniversary of a remembered life');
    state.month = 121;
    expect(memorialVisitPlan(survivor, town, state, 20)?.reason).not.toBe('marking an anniversary of a remembered life');
  });

  it('lets ritual specialists lead remembrance for a recent significant shared event', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const town = settlement!;
    const plot = installMemorial(state, town);
    const officiant = residents(state, town)[0]! as MemoryPerson;
    officiant.role = 'ritual-specialist';
    officiant.personalMemories = [];
    const event: HistoricalEvent = {
      id: 'battle-remembrance',
      month: state.month,
      type: 'battle',
      actors: [town.id],
      causes: ['war'],
      context: {},
      outcome: 'losses remembered',
      location: { ...town.position },
      locationId: town.id,
      affectedPopulation: 20,
      magnitude: 0.6,
      significance: 0.82,
      tags: ['war'],
      summary: 'A costly battle is remembered.',
    };
    state.history.push(event);

    const plan = memorialVisitPlan(officiant, town, state, 14);

    expect(plan?.destinationId).toBe(plot.id);
    expect(plan?.activity).toBe('mourn');
    expect(plan?.reason).toBe('leading communal remembrance after a shared loss');
  });

  it('integrates mourning into PeopleSystem destination authority rather than presentation-only state', () => {
    const { state, settlements: [settlement] } = societyFixture();
    const town = settlement!;
    const plot = installMemorial(state, town);
    const survivor = residents(state, town)[0]! as MemoryPerson;
    survivor.energy = 1;
    const people = new PeopleSystem(state.world, state.seed);

    let routed = false;
    for (let month = 120; month < 128; month++) {
      state.month = month;
      loss(survivor, month);
      people.advancePerson(survivor, town, state);
      if (survivor.navigation?.destinationKind === 'memorial-site') {
        routed = true;
        expect(survivor.navigation.destinationId).toBe(plot.id);
        expect(survivor.navigation.schedulePhase).toBe('ritual');
        expect(survivor.activity).toBe('mourn');
        break;
      }
    }

    expect(routed).toBe(true);
  });
});
