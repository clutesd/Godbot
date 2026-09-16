import { describe, expect, it } from 'vitest';
import { advanceSettlementDevelopment } from '../src/sim/development/SettlementDevelopmentSystem';
import { addMaterial } from '../src/sim/resources/Inventory';
import { residents, societyFixture } from './fixtures/settlementDevelopment';

function attemptOnce(setup?: (fixture: ReturnType<typeof societyFixture>) => void) {
  const fixture = societyFixture();
  setup?.(fixture);
  const settlement = fixture.settlements[0]!;
  fixture.state.month += 1;
  advanceSettlementDevelopment(fixture.state, settlement, residents(fixture.state, settlement), 0);
  return { ...fixture, settlement, attempt: settlement.development!.lastAttempt! };
}

describe('Step 2A development decision diagnostics', () => {
  it('records concrete budget and labour blockers instead of silently skipping a high-pressure need', () => {
    const { settlement, attempt } = attemptOnce(({ state, settlements: [s] }) => {
      s!.conflictPressure = 1;
      s!.resources = { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 };
      residents(state, s!).forEach((person) => { person.occupation = 'forager'; });
    });

    expect(settlement.development?.project).toBeUndefined();
    expect(attempt.outcome).toBe('blocked');
    const security = attempt.candidates.find(candidate => candidate.need === 'security');
    expect(security).toBeDefined();
    const codes = security!.blockers.map(blocker => blocker.code);
    expect(codes).toContain('no-builders');
    expect(codes).toContain('insufficient-wood');
    expect(codes).toContain('insufficient-minerals');
    const wood = security!.blockers.find(blocker => blocker.code === 'insufficient-wood');
    expect(wood?.available).toBe(0);
    expect(wood?.required).toBeGreaterThan(0);
  });

  it('identifies canonical structural-material scarcity separately from generic budgets', () => {
    const { attempt } = attemptOnce(({ settlements: [s] }) => {
      s!.conflictPressure = 1;
      // Use a physically possible Step-1C state: ample timber and a finished frame satisfy the
      // bulk/component gates, while missing textile/plant-fiber blocks the timber structure fabric.
      s!.localMaterials = {};
      s!.knownRecipes = [...new Set([...s!.knownRecipes, 'timber-framing'])];
      addMaterial(s!, 'timber', 20);
      addMaterial(s!, 'timber-frame', 2);
    });

    expect(attempt.outcome).toBe('blocked');
    const security = attempt.candidates.find(candidate => candidate.need === 'security');
    const fabric = security?.blockers.find(blocker => blocker.code === 'insufficient-structural-material');
    expect(fabric).toBeDefined();
    expect(fabric?.material).toBe('binding');
    expect(fabric?.available).toBe(0);
    expect(fabric?.required).toBeGreaterThan(0);
    expect(fabric?.detail).toBe('textile|plant-fiber');
    expect(security?.blockers.some(blocker => blocker.code === 'insufficient-wood')).toBe(false);
    expect(security?.blockers.some(blocker => blocker.code === 'insufficient-processed-material')).toBe(false);
  });

  it('distinguishes placement failure from resource or labour failure', () => {
    const { attempt } = attemptOnce(({ state, settlements: [s] }) => {
      s!.conflictPressure = 1;
      state.world.terrain.waterLevel.fill(2);
    });

    expect(attempt.outcome).toBe('blocked');
    const security = attempt.candidates.find(candidate => candidate.need === 'security');
    expect(security?.blockers.map(blocker => blocker.code)).toContain('no-valid-plot');
    expect(security?.blockers.some(blocker => blocker.code === 'no-builders')).toBe(false);
  });

  it('records the exact candidate that starts without changing the project decision', () => {
    const { settlement, attempt } = attemptOnce(({ settlements: [s] }) => {
      s!.conflictPressure = 1;
    });

    const project = settlement.development?.project;
    expect(project).toBeDefined();
    expect(attempt.outcome).toBe('started');
    expect(attempt.selectedNeed).toBe(project!.response.need);
    expect(attempt.plotId).toBe(project!.plotId);
    const selected = attempt.candidates.find(candidate => candidate.plotId === project!.plotId && candidate.need === project!.response.need);
    expect(selected).toBeDefined();
    expect(selected?.responseName).toBe(project!.response.name);
    expect(selected?.responseLevel).toBe(project!.response.level);
    expect(selected?.action).toBe(project!.action);
    expect(selected?.blockers).toEqual([]);
  });
});
