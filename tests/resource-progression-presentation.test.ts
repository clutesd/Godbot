import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { vegetationFixture } from './fixtures/vegetation';
import { resourceWorkProfile } from '../src/sim/resources/ResourceWorkPresentation';
import { beginResourceWorkMonth, recordResourceProcessing, recordResourceWorkAssignment, type ResourceWorkAssignment } from '../src/sim/resources/ResourceWorkAssignments';
import { resourceProcessingPresentation, resourceStoragePresentation } from '../src/render/resources/ResourceFlowPresentation';
import { ResourceWorkScene } from '../src/render/resources/ResourceWorkScene';
import { ResourceSiteRenderer } from '../src/render/resources/ResourceSiteRenderer';
import { createResourceCargo } from '../src/render/resources/ResourceCargo';
import type { FreightTrip } from '../src/sim/transport/types';
import type { KnowledgeRecord } from '../src/sim/types';

function fixture() {
  const f = vegetationFixture('resource-progression');
  const s = f.simulation.state.settlements[0]!;
  const cell = f.world.cells[s.cellIndex]!;
  cell.water = false; cell.slope = 0; cell.landform = 'lowland'; cell.movementCost = 1;
  cell.modifications = {};
  s.knowledge.records = {};
  s.infrastructure.workshops = 0;
  const assignment: ResourceWorkAssignment = { month: f.simulation.state.month, source: 'world-resource',
    settlementId: s.id, siteId: 'progression', cellIndex: s.cellIndex, resourceId: 'stone',
    worldPosition: { x: cell.worldX, z: cell.worldZ }, gatherOccupations: ['forager'],
    labourByOccupation: { forager: 12 }, labourUsed: 12, amountExtracted: 12 };
  if (cell.naturalResources) cell.naturalResources.deposits.stone = { initialReserve: 100, reserve: 100, grade: 1, accessibility: 1 };
  const learn = (id: string, practice: number) => { s.knowledge.records[id] = { id, practice, theory: 1, dormant: false } as KnowledgeRecord; };
  return { ...f, s, cell, assignment, learn };
}

describe('resource progression authority', () => {
  it('requires exploitation, practical knowledge and workshops for successive infrastructure', () => {
    const { world, s, cell, assignment, learn } = fixture();
    const profile = () => resourceWorkProfile(assignment, world, s);
    expect(profile().stage).toBe(0);
    learn('leverage', 1); learn('wheel-axle', 1); s.infrastructure.workshops = 1;
    expect(profile().stage).toBe(0); // Knowledge alone does not create an extraction site.
    cell.naturalResources!.deposits.stone!.reserve = 80;
    s.infrastructure.workshops = 0;
    expect(profile().stage).toBe(1);
    s.infrastructure.workshops = 0.1;
    expect(profile().stage).toBe(2);
    s.infrastructure.workshops = 0.4;
    expect(profile().stage).toBe(3);
    s.knowledge.records['leverage']!.dormant = true;
    expect(profile().stage).toBe(1);
    expect(profile().excavation).toBeCloseTo(0.2);
  });

  it('reads persisted state deterministically without mutating inventories or knowledge', () => {
    const { world, s, assignment } = fixture();
    const before = JSON.stringify([world, s]);
    expect(resourceWorkProfile(assignment, world, s)).toEqual(resourceWorkProfile(assignment, JSON.parse(JSON.stringify(world)), JSON.parse(JSON.stringify(s))));
    resourceStoragePresentation(s); resourceProcessingPresentation(world, s, assignment.month);
    expect(JSON.stringify([world, s])).toBe(before);
  });

  it('uses practical metallurgy for tools and bounds milestone emphasis', () => {
    const { world, s, assignment, learn } = fixture();
    const stone = resourceWorkProfile(assignment, world, s).toolColour;
    learn('metal-smelting', 0.5);
    const copper = resourceWorkProfile(assignment, world, s).toolColour;
    learn('iron-working', 0.5);
    expect(new Set([stone, copper, resourceWorkProfile(assignment, world, s).toolColour]).size).toBe(3);
    learn('leverage', 0.5); s.knowledge.records['leverage']!.transformedMonth = assignment.month;
    expect(resourceWorkProfile(assignment, world, s).emphasis).toBe(1);
    expect(resourceWorkProfile({ ...assignment, month: assignment.month + 3 }, world, s).emphasis).toBe(0);
  });

  it('does not mistake a naturally sparse plant habitat for prior harvesting', () => {
    const { world, s, cell, assignment } = fixture();
    s.materials = undefined;
    cell.naturalResources!.renewables['plant-fiber'].stock = 0;
    expect(resourceWorkProfile({ ...assignment, resourceId: 'plant-fiber' }, world, s).stage).toBe(0);
  });

  it('takes depletion from the assignment authority when old cell reserves disagree', () => {
    const { world, s, cell, assignment } = fixture();
    cell.naturalResources!.deposits.stone!.reserve = 0;
    world.resourceDeposits = [{ id: 'real-deposit', resourceId: 'stone', cellIndex: s.cellIndex,
      worldX: s.position.x, worldZ: s.position.z, quality: 1, capacity: 100, abundance: 1,
      extracted: 0, renewable: false, depleted: false, overharvested: false, discoveredBy: {} }];
    const p = resourceWorkProfile({ ...assignment, source: 'deposit-system', depositId: 'real-deposit' }, world, s);
    expect(p.stage).toBe(0); expect(p.excavation).toBe(0);
  });

  it('shows only canonical stock with bounded quantity and distinct geometry', () => {
    const { s } = fixture();
    s.localMaterials = { timber: 1000, stone: 0, 'plant-fiber': 3, iron: -2, copper: Infinity };
    expect(resourceStoragePresentation(s)).toEqual([
      { id: 'plant-fiber', amount: 3, pieces: 2 }, { id: 'timber', amount: 1000, pieces: 6 },
    ]);
    s.localMaterials.timber = 0;
    expect(resourceStoragePresentation(s).map(p => p.id)).toEqual(['plant-fiber']);
  });

  it('requires current paid processing to light a furnace, retains learned idle architecture', () => {
    const { simulation, world, s } = fixture();
    s.knownRecipes = ['charcoal'];
    const before = JSON.stringify(s);
    expect(resourceProcessingPresentation(world, s, simulation.state.month)[0]?.active).toBe(false);
    recordResourceProcessing(simulation.state, s.id, 'charcoal');
    expect(resourceProcessingPresentation(world, s, simulation.state.month)[0]).toMatchObject({ active: true, hot: true });
    expect(JSON.stringify(s)).toBe(before);
    simulation.state.month++; beginResourceWorkMonth(simulation.state);
    expect(resourceProcessingPresentation(world, s, simulation.state.month)[0]?.active).toBe(false);
  });

  it('wires stock into the production site renderer and clears emptied inventory', () => {
    const { simulation, world, surface, s } = fixture();
    for (const settlement of simulation.state.settlements) settlement.localMaterials = {};
    s.localMaterials = { timber: 12 };
    s.structurePlots = [];
    const scene = new ResourceWorkScene(world, 'test', () => true, undefined, undefined, id => id === s.id ? s : undefined);
    const renderer = new ResourceSiteRenderer(world, surface, scene, simulation.state);
    renderer.update();
    const logs = renderer.group.getObjectByName('Stored timber') as THREE.InstancedMesh;
    expect(logs).toBeDefined();
    expect(logs.count).toBeGreaterThan(0);
    s.localMaterials = {};
    renderer.update(); expect(logs.count).toBe(0);
  });

  it('invalidates site geometry when knowledge changes with identical extraction', () => {
    const { simulation, world, s, cell, assignment, learn } = fixture();
    cell.naturalResources!.deposits.stone!.reserve = 70;
    recordResourceWorkAssignment(simulation.state, assignment);
    const scene = new ResourceWorkScene(world, 'test', () => true, undefined, undefined, () => s);
    scene.update(); const revision = scene.revision;
    learn('leverage', 0.6); s.infrastructure.workshops = 0.3;
    scene.update(); expect(scene.revision).toBeGreaterThan(revision);
    const updated = scene.revision; scene.update(); expect(scene.revision).toBe(updated);
  });

  it('does not reveal undiscovered ore and removes glints when depleted', () => {
    const { world, s, surface } = fixture();
    const d = { id: 'survey', resourceId: 'copper-ore', cellIndex: s.cellIndex, worldX: s.position.x, worldZ: s.position.z,
      quality: 1, capacity: 100, abundance: 1, renewable: false, depleted: false, overharvested: false, discoveredBy: {} as Record<string, number> };
    world.resourceDeposits = [d];
    const renderer = new ResourceSiteRenderer(world, surface, new ResourceWorkScene(world));
    renderer.update();
    const glints = renderer.group.getObjectByName('Surveyed ore glints') as THREE.InstancedMesh;
    expect(glints.count).toBe(0);
    d.discoveredBy[s.id] = 1; renderer.update(); expect(glints.count).toBe(1);
    d.depleted = true; renderer.update(); expect(glints.count).toBe(0);
  });

  it('retains extraction remnants without active assignments and recovers with persisted land state', () => {
    const { world, cell, surface } = fixture();
    cell.modifications = { logging: { intensity: 0.8, firstMonth: 0, lastMonth: 1, abandonedMonth: 2 } };
    const renderer = new ResourceSiteRenderer(world, surface, new ResourceWorkScene(world));
    renderer.update();
    const stumps = renderer.group.getObjectByName('Persistent logging stumps') as THREE.InstancedMesh;
    expect(stumps.count).toBeGreaterThan(0);
    cell.modifications.logging!.intensity = 0;
    renderer.update(); expect(stumps.count).toBe(0);
  });
});

describe('real freight material presentation', () => {
  it.each(['timber', 'plant-fiber', 'iron-ore', 'steel'])('attaches bounded %s cargo without changing its trip', materialId => {
    const trip = { materialId, quantity: 1e9, mode: 'walk' } as FreightTrip;
    const before = JSON.stringify(trip);
    const cargo = createResourceCargo(trip)!;
    expect(cargo.count).toBe(6); expect(cargo.userData['resourceId']).toBe(materialId);
    expect(JSON.stringify(trip)).toBe(before);
    expect(createResourceCargo({ ...trip, quantity: 0 })).toBeUndefined();
  });
});
