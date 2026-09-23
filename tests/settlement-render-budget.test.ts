import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GodboxRenderer } from '../src/render/GodboxRenderer';
import '../src/render/GodboxRendererEnhanced';
import { Simulation } from '../src/sim/Simulation';
import type { Settlement } from '../src/sim/types';
import type { DevelopmentResponse } from '../src/sim/development/types';
import { RenderMaintenanceScheduler } from '../src/render/RenderMaintenanceScheduler';

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

function attachActiveProject(
  settlement: Settlement,
  state: Simulation['state'],
  progress: number,
): void {
  const culture = state.cultures[0]!;
  const response: DevelopmentResponse = {
    need: 'housing',
    form: 'dwelling',
    name: 'render budget house',
    level: 1,
    material: 'timber',
    cultureId: culture.id,
    style: culture.style,
    services: { housing: 1 },
    reasons: [],
    capabilities: [],
    cost: { food: 0, wood: 4, minerals: 0, goods: 0, wealth: 0 },
    labor: 4,
  };
  settlement.development = {
    pressures: {},
    unmet: {},
    informal: {},
    providers: {},
    evaluatedMonth: state.month,
    nextAttemptMonth: state.month + 12,
    revision: 1,
    project: {
      plotId: 'render-budget-project',
      response,
      action: 'founded',
      startedMonth: state.month,
      progress,
      spent: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 },
      blockedReasons: [],
    },
  };
  settlement.targetBuildings = settlement.buildings + 1;
}



describe('renderer maintenance scheduling', () => {
  it('dephases structural and vegetation maintenance so only one heavy job is released per frame', () => {
    const scheduler = new RenderMaintenanceScheduler();
    scheduler.advance(0.25, 4, 0.4);

    const released = [
      scheduler.next(),
      scheduler.next(),
      scheduler.next(),
      scheduler.next(),
      scheduler.next(),
    ];
    expect(released.slice(0, 4)).toEqual(['hydrology', 'settlements', 'routes', 'timeline']);
    expect(released[4]).toBeUndefined();

    scheduler.advance(0.15, 4, 0.4);
    expect(scheduler.next()).toBe('vegetation');
    expect(scheduler.next()).toBeUndefined();
  });

  it('deduplicates overdue work instead of building an unbounded maintenance backlog', () => {
    const scheduler = new RenderMaintenanceScheduler();
    scheduler.advance(2, 4, 0.4);
    expect(scheduler.pendingCount).toBe(5);

    const tasks = Array.from({ length: 5 }, () => scheduler.next());
    expect(new Set(tasks).size).toBe(5);
    expect(scheduler.pendingCount).toBe(0);
  });

  it('lets a newly authoritative month request visual reconciliation without batching it with other work', () => {
    const scheduler = new RenderMaintenanceScheduler();
    scheduler.advance(0.25, 4, 0.4);
    scheduler.request('seasonal', true);

    expect(scheduler.next()).toBe('seasonal');
    expect(scheduler.next()).toBe('hydrology');
    expect(scheduler.pendingCount).toBe(3);
  });

  it('spreads a post-Arrival catch-up cycle across frames', () => {
    const scheduler = new RenderMaintenanceScheduler();
    scheduler.requestCatchUp();
    expect(scheduler.pendingCount).toBe(5);

    expect(scheduler.next()).toBe('hydrology');
    expect(scheduler.pendingCount).toBe(4);
    expect(scheduler.next()).toBe('settlements');
    expect(scheduler.pendingCount).toBe(3);
  });
});

describe('construction site presentation state', () => {
  it('classifies active, finishing, material-blocked and work-blocked sites from live authority', async () => {
    const test = harness('construction-site-state');
    const settlement = test.state.settlements.find(candidate => candidate.alive)!;
    const { constructionSitePresentationState } = await import('../src/render/construction/ConstructionActionPresentation');
    attachActiveProject(settlement, test.state, 0.6);
    settlement.resources.wood = 10;

    expect(constructionSitePresentationState(settlement)).toBe('active');

    settlement.resources.wood = 0;
    expect(constructionSitePresentationState(settlement)).toBe('blocked-material');

    settlement.resources.wood = 10;
    settlement.development!.project!.blockedReasons = ['labour-unavailable'];
    expect(constructionSitePresentationState(settlement)).toBe('blocked-work');

    settlement.development!.project!.blockedReasons = [];
    settlement.development!.project!.progress = 0.96;
    expect(constructionSitePresentationState(settlement)).toBe('finishing');

    settlement.development!.project = undefined;
    expect(constructionSitePresentationState(settlement)).toBe('inactive');
  });
});

describe('construction presentation progress authority', () => {
  it('prefers an active project and falls back to the legacy mirror only without one', async () => {
    const test = harness('construction-progress-authority');
    const settlement = test.state.settlements.find(candidate => candidate.alive)!;
    const { constructionPresentationProgress } = await import('../src/render/construction/ConstructionVisualGrammar');

    settlement.constructionProgress = 0.77;
    expect(constructionPresentationProgress(settlement)).toBeCloseTo(0.77);

    attachActiveProject(settlement, test.state, 0.31);
    settlement.constructionProgress = 0.91;
    expect(constructionPresentationProgress(settlement)).toBeCloseTo(0.31);
  });
});

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

  it('rebuilds static worksite dressing when material availability changes at unchanged progress', () => {
    const test = harness('settlement-render-budget-blocked-material');
    const settlement = test.state.settlements.find(candidate => candidate.alive)!;
    attachActiveProject(settlement, test.state, 0.6);
    settlement.resources.wood = 10;
    sync(test.renderer, true);
    test.resetCreated();

    // Same project and same progress; only material availability changes.
    settlement.resources.wood = 0;
    sync(test.renderer);
    expect(test.created()).toBe(1);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).rebuilt).toBe(1);

    test.resetCreated();
    settlement.resources.wood = 10;
    sync(test.renderer);
    expect(test.created()).toBe(1);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).rebuilt).toBe(1);
    expect(settlement.development!.project!.progress).toBeCloseTo(0.6);
  });

  it('rebuilds when an explicit work blocker changes the site story without changing progress', () => {
    const test = harness('settlement-render-budget-blocked-work');
    const settlement = test.state.settlements.find(candidate => candidate.alive)!;
    attachActiveProject(settlement, test.state, 0.6);
    settlement.resources.wood = 10;
    sync(test.renderer, true);
    test.resetCreated();

    settlement.development!.project!.blockedReasons = ['labour-unavailable'];
    sync(test.renderer);
    expect(test.created()).toBe(1);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).rebuilt).toBe(1);
  });

  it('rebuilds through pre-completion DETAIL reveal slices before the project disappears', () => {
    const test = harness('settlement-render-budget-detail');
    const settlement = test.state.settlements.find(candidate => candidate.alive)!;
    attachActiveProject(settlement, test.state, 0.919);
    settlement.constructionProgress = 0.2;
    sync(test.renderer, true);
    test.resetCreated();

    settlement.development!.project!.progress = 0.92;
    sync(test.renderer);
    expect(test.created()).toBe(1);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).rebuilt).toBe(1);

    test.resetCreated();
    settlement.development!.project!.progress = 0.94;
    sync(test.renderer);
    expect(test.created()).toBe(1);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).rebuilt).toBe(1);

    // The mirror stays stale throughout: DETAIL is driven entirely by the live project.
    expect(settlement.constructionProgress).toBe(0.2);
  });

  it('rebuilds from authoritative project progress when finishing begins even if the legacy mirror is stale', () => {
    const test = harness('settlement-render-budget-finishing');
    const settlement = test.state.settlements.find(candidate => candidate.alive)!;
    attachActiveProject(settlement, test.state, 0.945);
    settlement.constructionProgress = 0.12;
    sync(test.renderer, true);
    test.resetCreated();

    settlement.development!.project!.progress = 0.95;
    // Deliberately leave the compatibility mirror stale. Presentation must follow the project.
    expect(settlement.constructionProgress).toBe(0.12);
    sync(test.renderer);
    expect(test.created()).toBe(1);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).rebuilt).toBe(1);
  });

  it('uses project progress for visible construction buckets while ignoring a stale legacy mirror', () => {
    const test = harness('settlement-render-budget-progress');
    const settlement = test.state.settlements.find(candidate => candidate.alive)!;
    attachActiveProject(settlement, test.state, 0.12);
    settlement.constructionProgress = 0.88;
    sync(test.renderer, true);
    test.resetCreated();

    settlement.development!.project!.progress = 0.14;
    sync(test.renderer);
    expect(test.created()).toBe(0);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).pending).toBe(0);

    settlement.development!.project!.progress = 0.42;
    sync(test.renderer);
    expect(test.created()).toBe(1);
    expect((test.scene.userData['settlementRenderBudget'] as BudgetReport).rebuilt).toBe(1);
    expect(settlement.constructionProgress).toBe(0.88);
  });
});
