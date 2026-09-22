import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { resourceWorkProfile, resourceWorkStations, resourceWorkerVariation, RESOURCE_WORKER_SPACING } from '../src/sim/resources/ResourceWorkPresentation';
import { beginResourceWorkMonth, recordResourceWorkAssignment, type ResourceWorkAssignment } from '../src/sim/resources/ResourceWorkAssignments';
import { resourceWorkDestinationId } from '../src/sim/people/ResourceWorkRouting';
import { ResourceWorkScene, resourceWorkerCanPresent, MAX_ACTIVE_WORK_SITES } from '../src/render/resources/ResourceWorkScene';
import { ResourceSiteRenderer } from '../src/render/resources/ResourceSiteRenderer';
import { ResourceWorkerRenderer } from '../src/render/resources/ResourceWorkerRenderer';
import { createResourceWorkMotion, resourceWorkAlternateAnchor, sampleResourceWorkMotion } from '../src/render/animation/ResourceWorkMotion';
import { travelAnimationFor } from '../src/render/people/PeoplePresentation';
import { vegetationFixture, instanceMeshes } from './fixtures/vegetation';
import type { Person } from '../src/sim/types';
import { VegetationRenderer } from '../src/render/vegetation/VegetationRenderer';
import { easedArrivalProgress } from '../src/render/people/PeopleVisualState';

function assignment(resourceId = 'timber', overrides: Partial<ResourceWorkAssignment> = {}): ResourceWorkAssignment {
  return { month: 1, source: 'world-resource', settlementId: 'home', siteId: 'site', resourceId,
    worldPosition: { x: 0, z: 0 }, gatherOccupations: ['forager', 'artisan'],
    labourByOccupation: { forager: 9, artisan: 0 }, amountExtracted: 9, labourUsed: 9, ...overrides };
}

describe('shared resource visual language', () => {
  it('decelerates continuously into work and finishes at the exact visual anchor', () => {
    expect(easedArrivalProgress(0)).toBe(0);
    expect(easedArrivalProgress(1)).toBeCloseTo(1);
    const early = easedArrivalProgress(0.6) - easedArrivalProgress(0.5);
    const late = easedArrivalProgress(1) - easedArrivalProgress(0.9);
    expect(late).toBeLessThan(early * 0.2);
  });
  it.each([['timber', 'timber', 'axe'], ['stone', 'mineral', 'pick'], ['copper-ore', 'mineral', 'pick'],
    ['iron-ore', 'mineral', 'pick'], ['coal', 'mineral', 'pick'], ['uranium-ore', 'mineral', 'pick'],
    ['medicinal-flora', 'plant', 'basket'], ['plant-fiber', 'plant', 'basket']])('%s resolves consistently', (id, kind, tool) => {
    const profile = resourceWorkProfile(assignment(id));
    expect(profile.kind).toBe(kind);
    expect(profile.tool).toBe(tool);
    expect(resourceWorkDestinationId(assignment(id))).toContain(`resource-work:${kind}:`);
  });

  it('uses exact positive occupation contributions and clamps arbitrarily large production', () => {
    const low = resourceWorkProfile(assignment('stone', { labourUsed: 1, labourByOccupation: { forager: 1 }, amountExtracted: 1 }));
    const high = resourceWorkProfile(assignment('stone', { labourUsed: 1e100, labourByOccupation: { forager: 1e100 }, amountExtracted: 1e100 }));
    expect(high.intensity).toBeGreaterThan(low.intensity);
    expect(high.intensity).toBeLessThanOrEqual(1);
    expect(high.pileCount).toBe(4);
    const unfunded = resourceWorkProfile(assignment('stone', { labourUsed: 1e100, labourByOccupation: { artisan: 0 } }));
    expect(unfunded.intensity).toBeLessThan(high.intensity);
  });

  it('gives every worker stable individual rhythms without consuming a random stream', () => {
    const variants = ['a', 'b', 'c', 'd'].map(id => resourceWorkerVariation('seed', id, 'site'));
    expect(new Set(variants.map(v => v.phaseOffset)).size).toBe(4);
    expect(resourceWorkerVariation('seed', 'a', 'site')).toEqual(variants[0]);
    expect(resourceWorkerVariation('seed', 'a', 'other')).not.toEqual(variants[0]);
    const motion = createResourceWorkMotion();
    const samples = variants.map(v => ({ ...sampleResourceWorkMotion(resourceWorkProfile(assignment()), v, 12.5, motion) }));
    expect(new Set(samples.map(s => s.handY)).size).toBe(4);
  });

  it('lays out spaced contact targets deterministically and rejects dangerous stations', () => {
    const profile = resourceWorkProfile(assignment());
    const build = () => resourceWorkStations({ x: 0, z: 0 }, profile, 'seed', 'site', () => true);
    const stations = build();
    expect(stations).toEqual(build());
    expect(stations).toHaveLength(4);
    for (let i = 0; i < stations.length; i++) {
      const a = stations[i]!;
      expect(Math.hypot(a.target.x - a.anchor.x, a.target.z - a.anchor.z)).toBeCloseTo(0.13);
      for (const b of stations.slice(i + 1)) expect(Math.hypot(a.anchor.x - b.anchor.x, a.anchor.z - b.anchor.z)).toBeGreaterThanOrEqual(RESOURCE_WORKER_SPACING);
    }
    expect(resourceWorkStations({ x: 0, z: 0 }, profile, 'seed', 'site', () => false)).toEqual([]);
  });

  it('has anticipation, contact, recovery, inspection and standing portions, with plant repositioning', () => {
    const variation = { phaseOffset: 0, cycleSpeed: 1, strikeStrength: 1, recovery: 1 };
    for (const id of ['timber', 'stone', 'plant-fiber']) {
      const profile = resourceWorkProfile(assignment(id));
      const samples = Array.from({ length: 240 }, (_, i) => ({ ...sampleResourceWorkMotion(profile, variation, i / 12, createResourceWorkMotion()) }));
      expect(Math.max(...samples.map(s => s.handY)) - Math.min(...samples.map(s => s.handY))).toBeGreaterThan(0.3);
      expect(samples.some(s => s.impact > 0)).toBe(true);
      expect(samples.every(s => Object.values(s).every(v => typeof v === 'boolean' || Number.isFinite(v)))).toBe(true);
      // Production capsule: half its straight section (0.17) plus cap radius (0.12).
      expect(samples.every(s => 0.47 - s.crouch - (0.17 * Math.abs(Math.cos(s.lean)) + 0.12) >= 0)).toBe(true);
      if (id === 'plant-fiber') {
        expect(samples.some(s => s.crouch < 0.01)).toBe(true);
        expect(samples.some(s => s.basket > 0.8)).toBe(true);
        expect(new Set(Array.from({ length: 30 }, (_, t) => resourceWorkAlternateAnchor(profile, variation, t))).size).toBe(2);
      }
    }
  });
});

describe('resource scene lifecycle and physical worker contract', () => {
  let fixture: ReturnType<typeof vegetationFixture>;
  beforeAll(() => {
    fixture = vegetationFixture('resource-work-contract');
    for (const cell of fixture.world.cells) { cell.landform = 'lowland'; cell.movementCost = 1; }
  });

  function start(resourceId = 'timber', count = 1) {
    const { simulation, world, surface } = fixture;
    simulation.state.month++;
    beginResourceWorkMonth(simulation.state);
    for (let i = 0; i < count; i++) recordResourceWorkAssignment(simulation.state, assignment(resourceId, { month: simulation.state.month, siteId: `site-${i}` }));
    const scene = new ResourceWorkScene(world, 'seed');
    const renderer = new ResourceSiteRenderer(world, surface, scene);
    renderer.update();
    return { simulation, scene, renderer };
  }

  it('binds only current, real contributing workers and preserves gather / travel / safety priority', () => {
    const { scene } = start();
    const site = [...scene.sites.values()][0]!;
    const base = fixture.simulation.state.people[0]!;
    const worker = { ...base, homeId: site.assignment.settlementId, id: 'worker', alive: true, activity: 'gather', occupation: 'forager', health: 1,
      role: 'gatherer', displacedSinceMonth: undefined, position: { ...site.origin },
      navigation: { ...base.navigation, destinationId: resourceWorkDestinationId(site.assignment), traveling: false, schedulePhase: 'work' } } as Person;
    scene.bindWorkers([worker]);
    expect(scene.workers.size).toBe(1);
    expect(scene.workers.get(worker.id)!.site.profile).toBe(site.profile);
    expect(worker.activity).toBe('gather');
    const before = JSON.stringify(worker);
    const binding = scene.workers.get(worker.id)!;
    expect(scene.safeSegment(worker.position, binding.station.anchor)).toBe(true);
    const rig = new ResourceWorkerRenderer();
    for (let frame = 0; frame < 120; frame++) {
      rig.beginFrame(); rig.sample(binding, frame / 30, 1 / 30, true);
      rig.draw(binding, binding.station.anchor.x, 0, binding.station.anchor.z, 0.28, binding.station.facing, new THREE.Color('#866745'));
      rig.endFrame();
    }
    expect(JSON.stringify(worker)).toBe(before);
    expect(instanceMeshes(rig.group).every(mesh => mesh.count <= mesh.instanceMatrix.count)).toBe(true);
    worker.navigation!.traveling = true;
    expect(travelAnimationFor(0, worker)).toBe('idle');
    expect(travelAnimationFor(0.4, worker)).toBe('walk');
    expect(resourceWorkerCanPresent(worker, site.assignment)).toBe(false);
    worker.navigation!.traveling = false;
    worker.occupation = 'artisan';
    scene.bindWorkers([worker]); expect(scene.workers.size).toBe(0);
    worker.occupation = 'forager'; worker.navigation!.schedulePhase = 'emergency';
    scene.bindWorkers([worker]); expect(scene.workers.size).toBe(0);
    worker.navigation!.schedulePhase = 'work'; worker.homeId = 'unrelated-settlement';
    scene.bindWorkers([worker]); expect(scene.workers.size).toBe(0);
    worker.activity = 'flee'; expect(travelAnimationFor(0.4, worker)).toBe('run');
  });

  it('moves interactive props and stations together to safe quarry edges without changing coordinates', () => {
    const { world } = fixture;
    const cell = world.cells.find(c => c.worldX === 0 && c.worldZ === 0)!;
    cell.slope = 0.8;
    world.environmentRevision = (world.environmentRevision ?? 0) + 1;
    const { scene } = start('stone');
    const site = [...scene.sites.values()][0]!;
    expect(site.assignment.worldPosition).toEqual({ x: 0, z: 0 });
    expect(site.origin).not.toEqual(site.assignment.worldPosition);
    expect(scene.walking.isWalkable(site.origin)).toBe(true);
    for (const station of site.stations) {
      expect(scene.safeSegment(site.origin, station.anchor)).toBe(true);
      expect(scene.safeSegment(station.anchor, station.alternate)).toBe(true);
    }
    cell.slope = 0;
    world.environmentRevision++;
  });

  it('reuses geometry, materials and uploads across identical months, then clears only temporary work', () => {
    const { simulation, renderer, scene } = start();
    const cell = fixture.world.cells.find(c => c.worldX === 0 && c.worldZ === 0)!;
    cell.modifications = { logging: { firstMonth: 0, lastMonth: 1, intensity: 0.6 } };
    renderer.update();
    const persistent = JSON.stringify(cell.modifications);
    const active = renderer.group.getObjectByName('Active resource work sites')!;
    const meshes = instanceMeshes(active as THREE.Group);
    const identities = meshes.map(m => [m.geometry, m.material, m.instanceMatrix.version]);
    const rebuilds = active.userData['rebuildCount'];
    const site = [...scene.sites.values()][0]!;
    for (let month = 0; month < 24; month++) {
      simulation.state.month++;
      beginResourceWorkMonth(simulation.state);
      recordResourceWorkAssignment(simulation.state, { ...site.assignment, month: simulation.state.month });
      renderer.update();
    }
    expect(active.userData['rebuildCount']).toBe(rebuilds);
    meshes.forEach((m, i) => { expect(m.geometry).toBe(identities[i]![0]); expect(m.material).toBe(identities[i]![1]); expect(m.instanceMatrix.version).toBe(identities[i]![2]); });
    simulation.state.month++; beginResourceWorkMonth(simulation.state); renderer.update();
    expect(scene.sites.size).toBe(0); expect(scene.workers.size).toBe(0);
    expect(active.visible).toBe(false);
    expect(meshes.every(m => m.count === 0)).toBe(true);
    expect(JSON.stringify(cell.modifications)).toBe(persistent);
  });

  it.each(['timber', 'stone', 'plant-fiber'])('bounds %s instance pools despite hundreds of active assignments', id => {
    const { renderer, scene } = start(id, 180);
    expect(scene.sites.size).toBe(MAX_ACTIVE_WORK_SITES);
    const active = renderer.group.getObjectByName('Active resource work sites') as THREE.Group;
    expect(instanceMeshes(active).every(m => m.count <= m.instanceMatrix.count)).toBe(true);
    expect(active.children).toHaveLength(10);
    expect(active.userData['instanceCount']).toBeLessThan(MAX_ACTIVE_WORK_SITES * 32);
  });

  it('rebuilds changing monthly work using the same fixed geometries and materials', () => {
    const { renderer, simulation } = start();
    const active = renderer.group.getObjectByName('Active resource work sites') as THREE.Group;
    const meshes = instanceMeshes(active);
    const geometry = meshes.map(m => m.geometry), material = meshes.map(m => m.material);
    const baseline = active.userData['rebuildCount'] as number;
    for (let month = 0; month < 24; month++) {
      simulation.state.month++; beginResourceWorkMonth(simulation.state);
      recordResourceWorkAssignment(simulation.state, assignment(['stone', 'timber', 'plant-fiber'][month % 3], {
        month: simulation.state.month, amountExtracted: month * 100 + 1,
      }));
      renderer.update();
      meshes.forEach((mesh, i) => {
        expect(mesh.geometry).toBe(geometry[i]); expect(mesh.material).toBe(material[i]);
        expect(mesh.count).toBeLessThanOrEqual(mesh.instanceMatrix.count);
      });
    }
    expect(active.userData['rebuildCount']).toBe(baseline + 24);
    expect(active.children).toHaveLength(meshes.length);
  });

  it('responds on an existing tree instance and leaves tree removal to environmental authority', () => {
    const { world, surface, camera } = fixture;
    const forest = new VegetationRenderer(world, surface, 'resource-tree-contract', 800);
    forest.updateLod(camera);
    const cell = world.cells.find(cell => forest.resourceWorkTree(assignment('timber', { worldPosition: { x: cell.worldX, z: cell.worldZ } })));
    expect(cell).toBeDefined();
    const work = assignment('timber', { worldPosition: { x: cell!.worldX, z: cell!.worldZ } });
    const tree = forest.resourceWorkTree(work)!;
    const before = JSON.stringify(cell);
    const counts = instanceMeshes(forest.group).map(mesh => mesh.count);
    forest.resourceImpact(tree.renderId, 0.8);
    const bark = instanceMeshes(forest.group).filter(mesh => mesh.name.startsWith('tree-bark:'));
    expect(bark.some(mesh => Array.from({ length: mesh.count }, (_, i) => mesh.geometry.getAttribute('treeState').getW(i)).some(w => w > 0))).toBe(true);
    forest.beginResourceImpacts();
    expect(bark.every(mesh => Array.from({ length: mesh.count }, (_, i) => mesh.geometry.getAttribute('treeState').getW(i)).every(w => w === 0))).toBe(true);
    expect(instanceMeshes(forest.group).map(mesh => mesh.count)).toEqual(counts);
    expect(JSON.stringify(cell)).toBe(before);
    cell!.wood = 0; cell!.lastLoggingMonth = 1;
    forest.updateLod(camera);
    expect(forest.resourceWorkTree(work)).toBeUndefined();
  });
});
