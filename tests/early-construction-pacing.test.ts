import { describe, expect, it } from 'vitest';
import { advanceSettlementDevelopment, constructionProgressAllowance, initializeSettlementDevelopment } from '../src/sim/development/SettlementDevelopmentSystem';
import type { DevelopmentProject } from '../src/sim/development/types';
import { residents, societyFixture, sponsor } from './fixtures/settlementDevelopment';
import { ensureMaterialInventory } from '../src/sim/resources/MaterialEconomy';
import { publishBulkStocks } from '../src/sim/resources/Inventory';

function project(level = 1, adaptation?: DevelopmentProject['response']['adaptation']): DevelopmentProject {
  return { startedMonth: 1, progress: 0, response: { level, form: 'dwelling', adaptation } } as DevelopmentProject;
}

describe('Visible early construction pacing', () => {
  it('keeps a well-funded ordinary project visible until several paid monthly work stages complete', () => {
    const { state, settlements: [s] } = societyFixture();
    const camp = s!;
    sponsor(state, camp, 'temple');
    camp.localMaterials = { timber: 600, stone: 600, 'plant-fiber': 100, lumber: 100, brick: 100 };
    camp.materials = undefined;
    publishBulkStocks(camp);
    const advance = () => {
      state.month++;
      // Isolate construction from recipe production; these are already delivered stocks.
      ensureMaterialInventory(camp).lastProcessedMonth = state.month;
      return advanceSettlementDevelopment(state, camp, residents(state, camp), 100);
    };
    const started = advance();
    const p = camp.development!.project!;
    expect(p).toBeDefined();
    expect(p.progress).toBe(0);
    expect(started.some(e => e.type === 'response-attempted')).toBe(true);
    const initialBuildings = camp.buildings;
    const events = [];
    while (camp.development!.project && state.month < p.startedMonth + 10) {
      const before = p.progress;
      events.push(...advance());
      expect(p.progress - before).toBeLessThanOrEqual(0.45);
      const paid = structuredClone(p.spent);
      advanceSettlementDevelopment(state, camp, residents(state, camp), 100);
      expect(p.spent).toEqual(paid);
      if (camp.development!.project) expect(camp.buildings).toBe(initialBuildings);
    }
    expect(camp.development!.project).toBeUndefined();
    expect(camp.buildings).toBe(initialBuildings + 1);
    expect(events.filter(e => e.type === 'infrastructure-built')).toHaveLength(1);
    expect(p.spent).toEqual(p.response.cost);
  });

  it('reserves a site before fabric appears and cannot repeat paid work in a month', () => {
    const p = project();
    expect(constructionProgressAllowance(p, 1)).toBe(0);
    expect(constructionProgressAllowance(p, 2)).toBe(0.25);
    p.lastWorkMonth = 2;
    expect(constructionProgressAllowance(p, 2)).toBe(0);
  });

  it('does not bank construction during a shortage, and scales larger buildings over more stages', () => {
    expect(constructionProgressAllowance(project(), 120)).toBe(0.25);
    expect(constructionProgressAllowance(project(3), 120)).toBe(0.125);
    expect(constructionProgressAllowance(project(1, 'lean-to'), 2)).toBe(0.45);
    expect(constructionProgressAllowance(project(1, 'hut'), 2)).toBe(0.2);
  });

  it('gives founding camps reproducible independent planning seasons without granting buildings', () => {
    const { state, settlements } = societyFixture();
    const seasons = settlements.map(s => {
      s.foundingPodId = `pod:${s.id}`;
      s.development = undefined;
      s.structurePlots = [];
      initializeSettlementDevelopment(state, s, []);
      const season = s.development!.nextAttemptMonth;
      expect(season).toBeGreaterThan(state.month);
      expect(season).toBeLessThanOrEqual(state.month + 3);
      expect(s.buildings).toBe(0);
      s.development = undefined;
      initializeSettlementDevelopment(state, s, []);
      expect(s.development!.nextAttemptMonth).toBe(season);
      return season;
    });
    expect(new Set(seasons).size).toBeGreaterThan(1);
  });
});
