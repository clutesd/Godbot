import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { configWith } from '../src/config';
import { ResourceSiteRenderer } from '../src/render/resources/ResourceSiteRenderer';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { Simulation } from '../src/sim/Simulation';
import { recordResourceWorkAssignment, resourceWorkAssignments } from '../src/sim/resources/ResourceWorkAssignments';
import { WeatherSystem } from '../src/sim/weather/WeatherSystem';
import { generateWorld } from '../src/sim/world';

describe('ResourceSiteRenderer invalidation', () => {
  it('does not rebuild movement geometry merely because the month changes', () => {
    const config = configWith({ seed: 'resource-render-month-rollover', world: { size: 24 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const surface = new TerrainSurface(world);

    const pair = world.cells.find((cell) => {
      const neighbour = world.cells[cell.z * world.size + cell.x + 1];
      return cell.x < world.size - 1 && !cell.water && cell.slope <= 0.54
        && Boolean(neighbour && !neighbour.water && neighbour.slope <= 0.54);
    });
    expect(pair).toBeDefined();
    const neighbour = world.cells[pair!.z * world.size + pair!.x + 1]!;
    pair!.modifications = { footpath: { intensity: 0.03, firstMonth: 0, lastMonth: 0, ownerId: 'test' } };
    neighbour.modifications = { footpath: { intensity: 0.03, firstMonth: 0, lastMonth: 0, ownerId: 'test' } };

    const renderer = new ResourceSiteRenderer(world, surface);
    renderer.update();
    const paths = renderer.group.getObjectByName('Movement-worn desire paths') as THREE.Mesh<THREE.BufferGeometry>;
    const initialPosition = paths.geometry.getAttribute('position');
    expect(initialPosition.count).toBeGreaterThan(0);

    weather.state.month += 1;
    renderer.update();
    expect(paths.geometry.getAttribute('position')).toBe(initialPosition);

    pair!.modifications.footpath!.intensity += 0.0001;
    pair!.modifications.footpath!.lastMonth = weather.state.month;
    renderer.update();
    expect(paths.geometry.getAttribute('position')).toBe(initialPosition);

    pair!.modifications.footpath!.intensity = 0.09;
    neighbour.modifications.footpath!.intensity = 0.09;
    renderer.update();
    expect(paths.geometry.getAttribute('position')).not.toBe(initialPosition);
    expect((paths.userData['pathStageCounts'] as Record<string, number>).footpath).toBeGreaterThan(0);
  });

  it('keeps access-trail buffers stable until the actual trail topology changes', () => {
    const config = configWith({ seed: 'resource-render-access-trails', world: { size: 24 } });
    const world = generateWorld(config);
    const weather = new WeatherSystem(world, config);
    const deposit = world.resourceDeposits[0];
    expect(deposit).toBeDefined();
    deposit!.establishedMonth = 0;
    deposit!.extracted = 8;
    deposit!.accessTrails = [[
      { x: deposit!.worldX, z: deposit!.worldZ },
      { x: deposit!.worldX + 1, z: deposit!.worldZ + 0.5 },
    ]];

    const renderer = new ResourceSiteRenderer(world, new TerrainSurface(world));
    renderer.update();
    const trails = renderer.group.getObjectByName('Resource access trails') as THREE.LineSegments<THREE.BufferGeometry>;
    const initialPosition = trails.geometry.getAttribute('position');
    expect(initialPosition.count).toBeGreaterThan(0);

    weather.state.month += 1;
    renderer.update();
    expect(trails.geometry.getAttribute('position')).toBe(initialPosition);

    deposit!.accessTrails![0]![1]!.x += 0.5;
    renderer.update();
    expect(trails.geometry.getAttribute('position')).not.toBe(initialPosition);
  });

  it('renders current authoritative work as bounded instanced site grammar and clears it next month', () => {
    const sim = new Simulation({ seed: 'resource-active-work-visual', startingPopulation: 120, settlementCount: [2, 2] });
    const settlement = sim.state.settlements[0];
    expect(settlement).toBeDefined();
    const cell = sim.state.world.cells[settlement!.cellIndex];
    expect(cell).toBeDefined();

    recordResourceWorkAssignment(sim.state, {
      month: sim.state.month,
      source: 'world-resource',
      settlementId: settlement!.id,
      siteId: `cell:${settlement!.cellIndex}:timber`,
      cellIndex: settlement!.cellIndex,
      resourceId: 'timber',
      worldPosition: { x: cell!.worldX, z: cell!.worldZ },
      gatherOccupations: ['forager', 'builder'],
      labourByOccupation: { forager: 2, builder: 1 },
      amountExtracted: 9,
      labourUsed: 3,
    });

    const renderer = new ResourceSiteRenderer(sim.state.world, new TerrainSurface(sim.state.world));
    renderer.update();
    const active = renderer.group.getObjectByName('Active resource work sites') as THREE.Group;
    const logs = renderer.group.getObjectByName('Active resource logs') as THREE.InstancedMesh;
    const stumps = renderer.group.getObjectByName('Active resource stumps') as THREE.InstancedMesh;
    const heads = renderer.group.getObjectByName('Active resource tool heads') as THREE.InstancedMesh;
    expect(active).toBeDefined();
    expect(active.userData['activeSiteCount']).toBe(1);
    expect(active.userData['drawPoolCount']).toBe(8);
    expect(active.userData['instanceCount']).toBeGreaterThanOrEqual(5);
    expect(logs.count).toBeGreaterThanOrEqual(3);
    expect(stumps.count).toBe(1);
    expect(heads.count).toBe(1);

    sim.state.month += 1;
    expect(resourceWorkAssignments(sim.state)).toEqual([]);
    renderer.update();
    expect(active.userData['activeSiteCount']).toBe(0);
    expect(logs.count).toBe(0);
    expect(stumps.count).toBe(0);
    expect(heads.count).toBe(0);
  });
});