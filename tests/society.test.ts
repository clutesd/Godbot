import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import type { CultureDimensions } from '../src/sim/types';

const society = new Simulation({ seed: 'delta-two', startingPopulation: 360, society: { conflictRate: 2 } });
society.step(200 * 12);

describe('Emergent society', () => {
  it('forms causal institutions and gives political power persistent human actors', () => {
    expect(society.state.institutions.length).toBeGreaterThan(0);
    expect(society.state.institutions.every((institution) => institution.members >= 2 && institution.interests.length > 0)).toBe(true);
    expect(society.state.polities.some((polity) => polity.leadingPersonId)).toBe(true);
    const institutionEvents = society.state.history.filter((event) => event.type === 'institution-formed');
    expect(institutionEvents.length).toBeGreaterThan(0);
    expect(institutionEvents.every((event) => event.causes.length > 0 && event.actors.length >= 3)).toBe(true);
  });

  it('grounds persistent trade in surveyed connections and reserves shipping for real ports', () => {
    // A route can later close through flooding or abandonment. Keep its construction and delivery evidence.
    const surveyedRoutes = society.state.tradeRoutes;
    const activeRoutes = society.state.tradeRoutes.filter((route) => route.active);
    expect(surveyedRoutes.some((route) => route.mode === 'land')).toBe(true);
    expect(surveyedRoutes.every((route) => route.transport && route.transport.projectIds.length > 0)).toBe(true);
    for (const route of activeRoutes.filter(route => route.mode === 'water' && !route.weatherBlocked)) {
      expect(route.transport?.path?.mode).toBe('water');
      expect(society.state.transportation.stops[`${route.a}:water`]?.status).toBe('complete');
      expect(society.state.transportation.stops[`${route.b}:water`]?.status).toBe('complete');
    }
    expect(surveyedRoutes.some((route) => route.cumulativeKnowledge > 0)).toBe(true);
    expect(society.state.stats.knowledgeExchanges).toBeGreaterThan(0);
    expect(society.state.history.some((event) => event.type === 'knowledge-exchange' && event.causes.includes('persistent-trade'))).toBe(true);
    expect(society.state.settlements.some((settlement) => settlement.alive && Object.keys(settlement.cultureShares).length > 1)).toBe(true);
  });

  it('keeps cultures distinct while allowing experience-driven drift', () => {
    const keys = Object.keys(society.state.cultures[0]?.dimensions ?? {}) as Array<keyof CultureDimensions>;
    const distances: number[] = [];
    for (let first = 0; first < society.state.cultures.length; first += 1) {
      for (let second = first + 1; second < society.state.cultures.length; second += 1) {
        const a = society.state.cultures[first];
        const b = society.state.cultures[second];
        if (a && b) distances.push(keys.reduce((sum, key) => sum + Math.abs(a.dimensions[key] - b.dimensions[key]), 0) / keys.length);
      }
    }
    expect(Math.max(...distances)).toBeGreaterThan(0.08);
    expect(society.state.history.some((event) => event.type === 'cultural-shift')).toBe(true);
  });

  it('models inspectable wars without turning history into constant warfare', () => {
    expect(society.state.stats.wars).toBeGreaterThan(0);
    // Geographic isolation removes the old guaranteed trade pacification. Conflicts still
    // need causal declarations, and most simulated months must remain battle-free.
    const battleMonths = new Set(society.state.history.filter(event => event.type === 'battle').map(event => event.month));
    expect(battleMonths.size).toBeLessThan(society.state.month / 2);
    expect(society.state.wars.every((war) => [war.moraleA, war.moraleB, war.organizationA, war.organizationB, war.leadershipA, war.leadershipB, war.technologyA, war.technologyB].every(Number.isFinite))).toBe(true);
    const declaration = society.state.history.find((event) => event.type === 'war-declared');
    const battle = society.state.history.find((event) => event.type === 'battle');
    expect(declaration?.causes.length).toBeGreaterThan(0);
    expect(declaration?.context).toHaveProperty('organizationA');
    expect(battle?.context).toHaveProperty('terrain');
    expect(society.state.history.some((event) => event.type === 'war-ended')).toBe(true);
    expect(society.state.history.some((event) => event.type === 'major-migration' && event.causes.includes('conflict'))).toBe(true);
  });

  it('stores history as structured evidence rather than flavor text alone', () => {
    const consequential = society.state.history.filter((event) => event.significance >= 0.5);
    expect(consequential.length).toBeGreaterThan(10);
    expect(consequential.every((event) => event.month >= 0 && event.actors.length > 0 && event.causes.length > 0 && event.outcome.length > 0 && event.tags.length > 0 && Number.isFinite(event.magnitude))).toBe(true);
  });
});
