import { describe, expect, it } from 'vitest';
import { configWith } from '../src/config';
import { AdvancedCivilizationSystem } from '../src/sim/advanced/AdvancedCivilizationSystem';
import { Simulation } from '../src/sim/Simulation';
import { SeededRandom } from '../src/sim/prng';
import type { KnowledgeRecord, Settlement, SimulationState } from '../src/sim/types';

function record(id: string, settlement: Settlement, mastery = 0.95): KnowledgeRecord {
  return {
    id, theory: mastery, practice: mastery, discoveredMonth: 0, lastUsedMonth: 0,
    originSettlementId: settlement.id, lineageId: `advanced-test:${settlement.id}:${id}`,
    parentLineages: [], source: 'discovery', dormant: false, adoptedMonth: 0, transformedMonth: 0,
  };
}

function harness(seed: string, riskRate = 0): { state: SimulationState; system: AdvancedCivilizationSystem } {
  const overrides = { seed, startingPopulation: 240, settlementCount: [4, 4] as const, advanced: { riskRate } };
  const simulation = new Simulation(overrides);
  const system = new AdvancedCivilizationSystem(configWith(overrides), new SeededRandom(`${seed}:advanced-test`));
  return { state: simulation.state, system };
}

function grant(state: SimulationState, ids: string[]): void {
  for (const settlement of state.settlements) {
    for (const id of ids) settlement.knowledge.records[id] = record(id, settlement);
    settlement.knowledge.literacy = 0.95;
    settlement.industry.active = true;
    settlement.industry.intensity = 0.82;
    settlement.industry.stage = 'industrial-transformation';
    settlement.infrastructure.power = 0.82;
  }
}

describe('Technological adolescence', () => {
  it('records practical fission as a singular atomic threshold with dual-use applications', () => {
    const { state, system } = harness('atomic-threshold');
    grant(state, ['scientific-method', 'nuclear-fission', 'nuclear-energy', 'nuclear-medicine']);

    const first = system.advanceYear(state);
    const second = system.advanceYear(state);

    expect(first.filter((event) => event.type === 'atomic-threshold')).toHaveLength(1);
    expect(second.some((event) => event.type === 'atomic-threshold')).toBe(false);
    expect(state.advanced.atomic.thresholdMonth).toBe(state.month);
    expect(state.advanced.atomic.applications.energy).toBeGreaterThan(0);
    expect(state.advanced.atomic.applications.medicine).toBeGreaterThan(0);
  });

  it('allows sustained rivalry to produce arsenals and an interpretable strategic risk state', () => {
    const { state, system } = harness('strategic-risk', 1);
    grant(state, ['scientific-method', 'computation', 'nuclear-fission']);
    state.advanced.atomic.thresholdMonth = 0;
    for (const culture of state.cultures) {
      culture.dimensions.militarism = 0.98;
      culture.dimensions.hierarchy = 0.9;
      culture.dimensions.longTermOrientation = 0.05;
      culture.dimensions.institutionalTrust = 0.08;
    }
    for (const relation of state.relations) {
      relation.contact = true;
      relation.hostility = 0.96;
      relation.grievances = 0.92;
      relation.territorialTension = 0.94;
      relation.trust = 0.04;
    }
    for (let year = 0; year < 90 && state.stats.nuclearWeaponsStates < 2; year += 1) {
      state.month += 12;
      system.advanceYear(state);
    }

    const armed = state.advanced.atomic.postures.filter((posture) => posture.weaponizedMonth !== undefined);
    expect(armed.length).toBeGreaterThanOrEqual(2);
    expect(['arms-competition', 'crisis', 'stable-deterrence', 'negotiated-restraint']).toContain(state.advanced.strategic.phase);
    expect(state.advanced.risks['nuclear-conflict'].hazard).toBeGreaterThan(0);
    expect(state.advanced.risks['nuclear-conflict'].vulnerability).toBeGreaterThan(0);
  });

  it('does not make nuclear weapons inevitable in a peaceful, regulated atomic society', () => {
    const { state, system } = harness('peaceful-atomic');
    grant(state, ['scientific-method', 'computation', 'nuclear-fission', 'nuclear-energy', 'nuclear-medicine']);
    state.advanced.governance.coordination = 0.95;
    state.advanced.governance.institutionalCapacity = 0.95;
    for (const culture of state.cultures) {
      culture.dimensions.militarism = 0.04;
      culture.dimensions.longTermOrientation = 0.96;
      culture.dimensions.institutionalTrust = 0.96;
    }
    for (const relation of state.relations) {
      relation.contact = true;
      relation.hostility = 0;
      relation.grievances = 0;
      relation.territorialTension = 0;
      relation.trust = 1;
    }
    for (let year = 0; year < 150; year += 1) {
      state.month += 12;
      system.advanceYear(state);
    }

    expect(state.advanced.atomic.applications.energy).toBeGreaterThan(0.5);
    expect(state.advanced.atomic.applications.medicine).toBeGreaterThan(0.5);
    expect(state.stats.nuclearWeaponsStates).toBe(0);
  });

  it('derives existential risk from capability, vulnerability, and mitigation', () => {
    const low = harness('risk-low').state;
    const highHarness = harness('risk-high');
    const high = highHarness.state;
    low.advanced.sectors.health = 0.05;
    high.advanced.sectors.health = 0.95;
    high.advanced.governance.coordination = 0.9;
    high.advanced.space.selfSustainingBodies = 2;

    new AdvancedCivilizationSystem(configWith({ seed: 'risk-low', advanced: { riskRate: 0 } }), new SeededRandom('risk-low-system')).advanceYear(low);
    highHarness.system.advanceYear(high);

    expect(high.advanced.risks.pandemic.mitigation).toBeGreaterThan(low.advanced.risks.pandemic.mitigation);
    expect(high.advanced.risks['asteroid-impact'].mitigation).toBeGreaterThan(low.advanced.risks['asteroid-impact'].mitigation);
    expect(high.advanced.risks.pandemic.annualProbability).toBeLessThanOrEqual(low.advanced.risks.pandemic.annualProbability);
  });

  it('makes a self-sustaining off-world population reduce single-planet vulnerability', () => {
    const isolated = harness('single-planet').state;
    const protectedHarness = harness('multiple-worlds');
    protectedHarness.state.advanced.space.selfSustainingBodies = 2;

    new AdvancedCivilizationSystem(configWith({ seed: 'single-planet', advanced: { riskRate: 1 } }), new SeededRandom('single-planet-system')).advanceYear(isolated);
    protectedHarness.system.advanceYear(protectedHarness.state);

    expect(protectedHarness.state.advanced.risks['asteroid-impact'].mitigation - isolated.advanced.risks['asteroid-impact'].mitigation).toBeGreaterThan(0.3);
    expect(protectedHarness.state.advanced.risks.supervolcanism.mitigation - isolated.advanced.risks.supervolcanism.mitigation).toBeGreaterThan(0.35);
  });

  it('derives advanced priorities from persistent cultural dimensions', () => {
    const outward = harness('priority-outward');
    const inward = harness('priority-inward');
    for (const culture of outward.state.cultures) {
      culture.dimensions.longTermOrientation = 0.95;
      culture.dimensions.outsiderOpenness = 0.95;
      culture.dimensions.tradeOrientation = 0.9;
      culture.dimensions.militarism = 0.05;
      culture.dimensions.hierarchy = 0.1;
    }
    for (const culture of inward.state.cultures) {
      culture.dimensions.longTermOrientation = 0.05;
      culture.dimensions.outsiderOpenness = 0.05;
      culture.dimensions.tradeOrientation = 0.1;
      culture.dimensions.militarism = 0.95;
      culture.dimensions.hierarchy = 0.9;
    }
    outward.system.advanceYear(outward.state);
    inward.system.advanceYear(inward.state);
    expect(outward.state.advanced.developmentPriorities.space).toBeGreaterThan(inward.state.advanced.developmentPriorities.space);
    expect(inward.state.advanced.developmentPriorities.defense).toBeGreaterThan(outward.state.advanced.developmentPriorities.defense);
  });

  it('keeps off-world growth within a resource-dependent carrying capacity', () => {
    const { state, system } = harness('offworld-capacity');
    grant(state, ['scientific-method', 'computation', 'rocketry', 'satellite-systems', 'orbital-capability', 'interplanetary-capability']);
    state.advanced.scale = 'modern-statistical';
    state.advanced.representedPopulation = 1_000_000;
    state.advanced.peakRepresentedPopulation = 1_000_000;
    state.advanced.space.offworldSettlements = 1;
    state.advanced.space.interplanetaryPopulation = 1_000;
    for (let year = 0; year < 300; year += 1) {
      state.month += 12;
      system.advanceYear(state);
    }
    expect(state.advanced.space.interplanetaryPopulation).toBeLessThanOrEqual(state.advanced.peakRepresentedPopulation * 0.33);
    expect(Number.isFinite(state.advanced.space.interplanetaryPopulation)).toBe(true);
  });

  it('classifies interplanetary, stable, collapsed, and condition-driven ambiguous outcomes', () => {
    const interplanetary = harness('outcome-space');
    interplanetary.state.advanced.space.selfSustainingBodies = 2;
    expect(interplanetary.system.classificationAtHorizon(interplanetary.state)).toBe('INTERPLANETARY');

    const stable = harness('outcome-stable');
    stable.state.month = 400 * 12;
    stable.state.advanced.atomic.thresholdMonth = 0;
    stable.state.advanced.governance.institutionalCapacity = 0.8;
    expect(stable.system.classificationAtHorizon(stable.state)).toBe('PLANETARY STABLE');

    const collapsed = harness('outcome-collapse');
    collapsed.state.advanced.technologicalPeak = 0.9;
    collapsed.state.advanced.peakRepresentedPopulation = 2_400;
    collapsed.state.advanced.representedPopulation = 200;
    collapsed.state.advanced.collapseDurationMonths = configWith().advanced.collapseSustainYears * 12 - 12;
    collapsed.system.advanceYear(collapsed.state);
    expect(collapsed.state.advanced.outcome.classification).toBe('COLLAPSED');

    const unknown = harness('outcome-unknown');
    grant(unknown.state, ['machine-intelligence', 'general-machine-systems', 'computation', 'automation']);
    unknown.state.advanced.machine.capability = 0.88;
    unknown.state.advanced.machine.observability = 0.1;
    unknown.state.advanced.cohorts.biologicalShare = 0.8;
    unknown.system.advanceYear(unknown.state);
    expect(unknown.state.advanced.outcome.classification).toBe('UNKNOWN');
  });
});
