import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import { LifeProjectDirector, eraForState, lifeProjectForPerson } from '../src/sim/people/LifeProjectSystem';

describe('Era-aware life projects', () => {
  it('derives eras from achieved capabilities rather than calendar year', () => {
    const simulation = new Simulation({ seed: 'life-project-era', startingPopulation: 180 });
    const settlement = simulation.state.settlements[0]!;
    expect(eraForState(simulation.state, settlement)).toBe('settlement');

    settlement.knowledge.records['durable-records'] = {
      id: 'durable-records', theory: 0.4, practice: 0.4, discoveredMonth: 0, lastUsedMonth: 0,
      originSettlementId: settlement.id, lineageId: 'test-records', parentLineages: [], source: 'discovery', dormant: false,
    };
    expect(eraForState(simulation.state, settlement)).toBe('recorded');

    settlement.industry.active = true;
    settlement.industry.intensity = 0.4;
    expect(eraForState(simulation.state, settlement)).toBe('industrial');
  });

  it('does not give an early-settlement scholar an anachronistic modern research project', () => {
    const simulation = new Simulation({ seed: 'life-project-early', startingPopulation: 180 });
    const person = simulation.state.people.find((candidate) => candidate.alive && candidate.ageMonths >= 20 * 12)!;
    person.role = 'scholar';
    person.traits.curiosity = 1;
    person.traits.conscientiousness = 1;
    person.traits.patience = 1;
    person.prestige = 0.9;
    person.socialPosition = { householdWealth: 0.7, resourceAccess: 0.8, occupationStatus: 0.8, educationAccess: 0.9, politicalInfluence: 0.3, institutionalPosition: 0.3 };
    person.influence = { office: 0, wealth: 0.2, military: 0, scholarship: 0.8, religion: 0, network: 0.6, reputation: 0.6, total: 0.6 };

    const director = new LifeProjectDirector(simulation.state);
    director.advance(simulation.state);
    const project = lifeProjectForPerson(person);
    if (project) {
      expect(['scientific-research', 'computation', 'spaceflight', 'machine-intelligence', 'electrical-systems']).not.toContain(project.kind);
    }
  });

  it('keeps projects outside authoritative simulation state', () => {
    const simulation = new Simulation({ seed: 'life-project-non-authoritative', startingPopulation: 180 });
    const before = JSON.stringify({ history: simulation.state.history, stats: simulation.state.stats, settlements: simulation.state.settlements });
    const director = new LifeProjectDirector(simulation.state);
    director.advance(simulation.state);
    const after = JSON.stringify({ history: simulation.state.history, stats: simulation.state.stats, settlements: simulation.state.settlements });
    expect(after).toBe(before);
  });
});
