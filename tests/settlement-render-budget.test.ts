import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GodboxRenderer } from '../src/render/GodboxRenderer';
import '../src/render/GodboxRendererEnhanced';
import { Simulation } from '../src/sim/Simulation';

interface SettlementVisualState {
  group: THREE.Group;
  buildingCount: number;
  institutionCount: number;
  routeCount: number;
  politySize: number;
  developmentSignature: string;
  constructionSignature: string;
  powerLevel: number;
  bannerSignature: string;
  lights: unknown[];
  smokeSources: unknown[];
}

interface BudgetReport {
  pending: number;
  rebuilt: number;
  month: number;
}

interface FakeRendererHarness {
  renderer: GodboxRenderer;
  state: Simulation['state'];
  scene: THREE.Scene;
  created: () => number;
  resetCreated: () => void;
}

function harness(seed: string): FakeRendererHarness {
  const simulation = new Simulation({ seed, startingPopulation: 36, world: { size: 20 }, settlementCount: [2, 2] });
  let created = 0;
  const scene = new THREE.Scene();
  const visuals = new Map<string, SettlementVisualState>();
  const fake = {
    state: simulation.state,
    scene,
    settlementVisuals: visuals,
    lastSettlementSignature: '',
    visualStateResolver: { trackEntity: () => undefined },
    transitionTimeline: { createBuildingUpgrade: () => undefined },
    bannerSignatureForSettlement: (settlement: Simulation['state']['settlements'][number]) => `banner:${settlement.id}`,
    constructionSignature: () => '',
    eraForSettlement: () => 'village' as const,
    createSettlementVisual: (settlement: Simulation['state']['settlements'][number]): SettlementVisualState => {
      created += 1;
      const group = new THREE.Group();
      group.userData['settlementId'] = settlement.id;
      return {
        group,
        buildingCount: settlement.buildings,
        institutionCount: settlement.institutionIds.length,
        routeCount: 0,
        politySize: 1,
        developmentSignature: '',
        constructionSignature: '',
        powerLevel: settlement.infrastructure.power,
        bannerSignature: `banner:${settlement.id}`,
        lights: [],
        smokeSources: [],
      };
    },
    disposeGroup: () => undefined,
    refreshSmokeSources: () => undefined,
    weatherRenderer: { bindScene: () => undefined },
  };
  return {
    renderer: fake as unknown as GodboxRenderer,
    state: simulation.state,
    scene,
    created: () => created,
    resetCreated: () => { created = 0; },
  };
}

function sync(renderer: GodboxRenderer, force = false): void {
  const method = (GodboxRenderer.prototype as unknown as { syncSettlements: (force?: boolean) => void }).syncSettlements;
  method.call(renderer, force);
}

describe('settlement render budgeting', () => {
  it('spreads simultaneous heavy settlement changes across structural passes', () => {
    const test = harness('settlement-render-budget-queue');
    sync(test.renderer, true);
    test.resetCreated();
    const active = test.state.settlements.filter(settlement => settlement.alive).slice(0, 2);
    expect(active).toHaveLength(2);
    active[0]!.buildings += 1;
    active[1]!.buildings += 1;

    sync(test.renderer);
    expect(test.created()).toBe(1);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).pending).toBe(1);

    sync(test.renderer);
    expect(test.created()).toBe(2);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).pending).toBe(0);
  });

  it('rebuilds when a project enters finishing so scaffold stripping is reachable', () => {
    const test = harness('settlement-render-budget-finishing');
    const settlement = test.state.settlements.find(candidate => candidate.alive)!;
    settlement.constructionProgress = 0.945;
    sync(test.renderer, true);
    test.resetCreated();

    settlement.constructionProgress = 0.95;
    sync(test.renderer);
    expect(test.created()).toBe(1);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).rebuilt).toBe(1);
  });

  it('ignores microscopic construction progress until its visible presentation stage changes', () => {
    const test = harness('settlement-render-budget-progress');
    const settlement = test.state.settlements.find(candidate => candidate.alive)!;
    settlement.constructionProgress = 0.12;
    sync(test.renderer, true);
    test.resetCreated();

    settlement.constructionProgress = 0.14;
    sync(test.renderer);
    expect(test.created()).toBe(0);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).pending).toBe(0);

    settlement.constructionProgress = 0.42;
    sync(test.renderer);
    expect(test.created()).toBe(1);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).rebuilt).toBe(1);
  });
});
