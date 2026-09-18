import { beforeAll, describe, expect, it } from 'vitest';
import { vegetationFixture } from './fixtures/vegetation';
import type { Person, Settlement, WeatherCellState } from '../src/sim/types';
import type { DevelopmentResponse } from '../src/sim/development/types';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { BUILD_STAGE } from '../src/render/assets/BuildingComposer';
import { developmentBuildingRole, developmentPresentationEra } from '../src/render/assets/BuildingGrammar';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import {
  constructionPresentationProgress,
  constructionStagePresentation,
} from '../src/render/construction/ConstructionVisualGrammar';
import {
  constructionPresentedMaterial,
  constructionSitePresentationState,
} from '../src/render/construction/ConstructionActionPresentation';
import { constructionChoreography } from '../src/render/construction/ConstructionChoreography';
import { constructionWorkfaceIndex } from '../src/render/construction/ConstructionCrewPresentation';
import { constructionWorkerLane } from '../src/render/construction/ConstructionWorkerMotion';
import {
  constructionWorksiteAnchors,
  createConstructionWorksite,
} from '../src/render/construction/ConstructionWorksite';
import { PhysicalWorkScene } from '../src/render/people/PhysicalWorkScene';

let fixture: ReturnType<typeof vegetationFixture>;

beforeAll(() => {
  fixture = vegetationFixture('construction-step1-step2-contract');
});

function setupContract(): {
  settlement: Settlement;
  people: Person[];
  weather: WeatherCellState;
  response: DevelopmentResponse;
  placement: {
    key: string;
    worldX: number;
    worldZ: number;
    width: number;
    depth: number;
    constructionWidth: number;
    constructionDepth: number;
    rotationY: number;
  };
  targetWidth: number;
  targetDepth: number;
  era: ReturnType<typeof developmentPresentationEra>;
  role: ReturnType<typeof developmentBuildingRole>;
} {
  const settlement = structuredClone(fixture.simulation.state.settlements[0]!);
  settlement.alive = true;
  settlement.resources = { food: 20, wood: 20, minerals: 20, goods: 20, wealth: 20 };
  settlement.localMaterials = {};
  settlement.structurePlots = [];

  const prototypePerson = fixture.simulation.state.people.find(person => person.homeId === settlement.id)
    ?? fixture.simulation.state.people[0]!;
  const response: DevelopmentResponse = {
    need: 'housing',
    form: 'dwelling',
    name: 'Contract house',
    level: 1,
    material: 'timber',
    cultureId: prototypePerson.cultureId,
    style: fixture.simulation.state.cultures[0]!.style,
    services: { housing: 1 },
    reasons: ['integration-contract'],
    capabilities: [],
    cost: { food: 0, wood: 4, minerals: 0, goods: 0, wealth: 0 },
    labor: 4,
  };
  settlement.development = {
    pressures: {},
    unmet: {},
    informal: {},
    providers: {},
    evaluatedMonth: 6,
    nextAttemptMonth: 12,
    revision: 1,
    project: {
      plotId: 'contract-plot',
      response,
      action: 'founded',
      startedMonth: 0,
      progress: 0.1,
      spent: { food: 0, wood: 0.4, minerals: 0, goods: 0, wealth: 0 },
      blockedReasons: [],
    },
  };
  // Deliberately stale: active construction presentation must remain project-authoritative.
  settlement.constructionProgress = 0.77;

  const people = ['contract-hauler', 'contract-assembler', 'contract-site-worker'].map((id, index) => ({
    ...structuredClone(prototypePerson),
    id,
    alive: true,
    health: 1,
    homeId: settlement.id,
    occupation: 'builder',
    activity: 'construct',
    role: 'builder',
    displacedSinceMonth: undefined,
    position: { x: 2.2 + index * 0.05, z: -0.4 },
    navigation: {
      destinationKind: 'construction-site',
      destinationId: 'contract-plot',
      traveling: false,
      schedulePhase: 'work',
      reason: 'integration-contract',
      waypoints: [],
      waypointIndex: 0,
    },
  } as Person));

  const weather = {
    ...fixture.simulation.state.weather.cells[settlement.cellIndex]!,
    snowpack: 0,
    wind: 0,
    blizzard: 0,
    floodDepth: 0,
    cropDamage: 0,
    kind: 'clear',
  } as WeatherCellState;

  const era = developmentPresentationEra(response);
  const role = developmentBuildingRole(response);
  const builder = new AssetBuilder('construction-step1-step2-contract');
  const detailAsset = builder.getAsset('building', {
    seed: 'construction-step1-step2-contract:target',
    culture: response.style,
    era,
    development: response,
    variant: `${role}#${BUILD_STAGE.DETAIL}`,
  });
  const targetWidth = Number(detailAsset.mesh.userData['footprintWidth'] ?? 2);
  const targetDepth = Number(detailAsset.mesh.userData['footprintDepth'] ?? 1.5);

  return {
    settlement,
    people,
    weather,
    response,
    placement: {
      key: 'contract-plot',
      worldX: 0,
      worldZ: 0,
      width: 2,
      depth: 1.5,
      constructionWidth: targetWidth,
      constructionDepth: targetDepth,
      rotationY: 0,
    },
    targetWidth,
    targetDepth,
    era,
    role,
  };
}

describe('Step 1 + Step 2 construction presentation contract', () => {
  it('keeps building stage, target footprint, choreography, workers and site lifecycle synchronized', () => {
    const { settlement, people, weather, response, placement, targetWidth, targetDepth, era, role } = setupContract();
    const project = settlement.development!.project!;
    const builder = new AssetBuilder('construction-step1-step2-stages');
    const palette = new MaterialPalette({ culture: response.style, era });
    const scene = new PhysicalWorkScene();
    scene.refreshConstructionCrewAuthority(people, [settlement]);

    const assembler = people.find(person =>
      scene.constructionCrewAssignment(settlement.id, person.id)?.role === 'assembler')!;
    expect(assembler).toBeDefined();
    const assemblerAssignment = scene.constructionCrewAssignment(settlement.id, assembler.id)!;

    const checkpoints = [
      { progress: 0.10, stage: BUILD_STAGE.FOUNDATION, phase: 0.50, finishing: false },
      { progress: 0.30, stage: BUILD_STAGE.FRAME, phase: 0.40, finishing: false },
      { progress: 0.60, stage: BUILD_STAGE.WALLS, phase: (0.60 - 0.45) / (0.78 - 0.45), finishing: false },
      { progress: 0.85, stage: BUILD_STAGE.ROOF, phase: 0.50, finishing: false },
      { progress: 0.96, stage: BUILD_STAGE.DETAIL, phase: 0.50, finishing: true },
    ] as const;

    const deliveryTargets: string[] = [];
    let stablePlayback: object | undefined;

    for (const checkpoint of checkpoints) {
      project.progress = checkpoint.progress;
      scene.beginFrame();

      const stagePresentation = constructionStagePresentation(checkpoint.progress);
      expect(constructionPresentationProgress(settlement)).toBeCloseTo(checkpoint.progress);
      expect(stagePresentation.stage).toBe(checkpoint.stage);
      expect(stagePresentation.phase).toBeCloseTo(checkpoint.phase);
      expect(stagePresentation.finishing).toBe(checkpoint.finishing);

      const stageAsset = builder.getAsset('building', {
        seed: 'construction-step1-step2-contract:target',
        culture: response.style,
        era,
        development: response,
        variant: `${role}#${stagePresentation.stage}`,
      });
      expect(stageAsset.mesh.userData['grammarRole']).toBe(role);

      const choreography = constructionChoreography('timber', checkpoint.progress);
      expect(choreography.stage).toBe(stagePresentation.stage);
      expect(choreography.finishing).toBe(stagePresentation.finishing);

      const localAnchors = constructionWorksiteAnchors(
        targetWidth,
        targetDepth,
        project.plotId,
        constructionWorkerLane(assembler.id),
        constructionWorkfaceIndex(project.plotId, assembler.id),
        checkpoint.progress,
      );
      const worker = scene.plan(assembler, settlement, placement, undefined, weather, () => true)!;
      expect(worker).toBeDefined();
      expect(worker.crewRole).toBe('assembler');
      expect(worker.crewRank).toBe(assemblerAssignment.rank);
      expect(worker.crewSize).toBe(people.length);
      expect(worker.anchors!.delivery.x).toBeCloseTo(localAnchors.delivery.x);
      expect(worker.anchors!.delivery.z).toBeCloseTo(localAnchors.delivery.z);
      expect(worker.action.locomotionTarget.x).toBeCloseTo(localAnchors.delivery.x);
      expect(worker.action.locomotionTarget.z).toBeCloseTo(localAnchors.delivery.z);
      expect(worker.action.actionKind).toBe(checkpoint.finishing ? 'construction-finish' : 'construction-assemble');

      if (stablePlayback === undefined) stablePlayback = worker.playback;
      else expect(worker.playback).toBe(stablePlayback);

      deliveryTargets.push(`${worker.anchors!.delivery.x.toFixed(4)}:${worker.anchors!.delivery.z.toFixed(4)}`);

      const siteState = constructionSitePresentationState(settlement);
      expect(siteState).toBe(checkpoint.finishing ? 'finishing' : 'active');
      const worksite = createConstructionWorksite({
        width: targetWidth,
        depth: targetDepth,
        progress: checkpoint.progress,
        response: { ...response, material: constructionPresentedMaterial(settlement) },
        seedKey: project.plotId,
        materialsAvailable: siteState === 'active' || siteState === 'finishing',
      }, palette);
      expect(worksite.userData['finishing']).toBe(stagePresentation.finishing);
      expect(worksite.userData['blocked']).toBe(false);
    }

    // Canonical Step 1 stage migration must be visible in Step 2 workface geometry.
    expect(new Set(deliveryTargets).size).toBe(checkpoints.length);

    // Blocking the same live WALLS-stage project must stall Step 2 without rewriting Step 1.
    project.progress = 0.60;
    settlement.resources.wood = 0;
    scene.beginFrame();
    const blockedStage = constructionStagePresentation(project.progress);
    const blockedWorker = scene.plan(assembler, settlement, placement, undefined, weather, () => true)!;
    const blockedState = constructionSitePresentationState(settlement);
    const blockedWorksite = createConstructionWorksite({
      width: targetWidth,
      depth: targetDepth,
      progress: project.progress,
      response: { ...response, material: constructionPresentedMaterial(settlement) },
      seedKey: project.plotId,
      materialsAvailable: blockedState === 'active' || blockedState === 'finishing',
    }, palette);

    expect(blockedStage.stage).toBe(BUILD_STAGE.WALLS);
    expect(constructionPresentationProgress(settlement)).toBeCloseTo(0.60);
    expect(blockedState).toBe('blocked-material');
    expect(blockedWorker.action.actionKind).toBe('construction-blocked');
    expect(blockedWorker.action.activeTool).toBe('none');
    expect(blockedWorker.action.contactStrength).toBe(0);
    expect(blockedWorksite.userData['blocked']).toBe(true);

    let stagedMaterials = 0;
    blockedWorksite.traverse(object => {
      if (object.userData['constructionCue'] === 'staged-material') stagedMaterials += 1;
    });
    expect(stagedMaterials).toBe(0);
    expect(project.progress).toBeCloseTo(0.60);
  });
});
