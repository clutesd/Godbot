import { describe, expect, it } from 'vitest';
import { morphologyFixture as fixture } from './fixtures/settlementMorphology';
import { reserveStructurePlot } from '../src/shared/StructurePlots';
import { closestFrontagePoint, movementGatheringPoint, settlementMovementFrontage } from '../src/shared/MovementFrontage';
import { createSettlementLayoutPlan } from '../src/shared/SettlementLayoutPlan';
import type { SimulationState } from '../src/sim/types';
import * as THREE from 'three';
import { GodboxRenderer } from '../src/render/GodboxRenderer';
import '../src/render/settlement/SettlementStreetPresentation';


function grow(state: SimulationState, count = 12) {
  const town = state.settlements[0]!;
  for (let i = 0; i < count; i++) {
    const plot = reserveStructurePlot(state, town, i % 4 === 0 ? 'market' : 'residential');
    expect(plot, `plot ${i}`).toBeDefined();
    state.month += 12;
  }
  return town.structurePlots!;
}

describe('historical settlement morphology', () => {
  it('does not render synthetic district streets or ceremonial axes at advanced technology', () => {
    const methods = GodboxRenderer.prototype as unknown as {
      addGroundCraft(group: THREE.Group, era: 'industrial'): void;
      addCeremonialAxis(group: THREE.Group): void;
    };
    const group = new THREE.Group();
    methods.addGroundCraft.call({} as GodboxRenderer, group, 'industrial');
    methods.addCeremonialAxis.call({} as GodboxRenderer, group);
    expect(group.children).toEqual([]);
  });
  it('replays deterministic frontage growth without stamping or upgrading roads', () => {
    const a = fixture(), b = fixture();
    const history = structuredClone(a.state.world.cells.map(cell => cell.modifications));
    expect(grow(a.state)).toEqual(grow(b.state));
    expect(a.state.world.cells.map(cell => cell.modifications)).toEqual(history);
  });

  it('leaves path corridors open and gives established plots close frontage', () => {
    const { state, town } = fixture();
    const edges = settlementMovementFrontage(state.world, town);
    const plots = grow(state);
    for (const plot of plots) {
      const gaps = edges.map(edge => {
        const point = closestFrontagePoint(edge, { x: plot.worldX, z: plot.worldZ });
        return Math.hypot(point.x - plot.worldX, point.z - plot.worldZ) - plot.radius - edge.halfWidth;
      });
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.2 - 1e-8);
      expect(Math.min(...gaps)).toBeLessThan(5);
    }
  });

  it('changes urban form with movement history at identical technology and seed', () => {
    const east = fixture('east'), bend = fixture('bend');
    const first = grow(east.state), second = grow(bend.state);
    const spread = (plots: typeof first, axis: 'worldX' | 'worldZ') =>
      Math.max(...plots.map(plot => plot[axis])) - Math.min(...plots.map(plot => plot[axis]));
    expect(spread(first, 'worldX')).toBeGreaterThan(spread(first, 'worldZ') * 1.2);
    expect(spread(second, 'worldZ')).toBeGreaterThan(spread(first, 'worldZ') * 1.2);
    expect(second).not.toEqual(first);
  });

  it('uses heavily travelled junctions as gathering destinations without granting paving', () => {
    const { state, town } = fixture('bend');
    const gathering = movementGatheringPoint(settlementMovementFrontage(state.world, town))!;
    const layout = createSettlementLayoutPlan({ settlement: town, settlements: [town], routes: [],
      world: state.world, eraRank: 5, seed: state.seed });
    expect({ x: layout.anchors.market.worldX, z: layout.anchors.market.worldZ }).toEqual(gathering);
    expect(layout.anchors.civic.worldX).toBe(gathering.x);
    expect(layout.streets).toEqual([]);
    expect(Object.values(state.transportation.projects)).toEqual([]);
  });

  it('preserves organic founding growth before any circulation has been earned', () => {
    const { state, town } = fixture('none');
    expect(settlementMovementFrontage(state.world, town)).toEqual([]);
    expect(grow(state, 4)).toHaveLength(4);
    expect(state.world.cells.some(cell => cell.modifications)).toBe(false);
  });

  it('grows along dry shores rather than repeating the inland form', () => {
    const inland = fixture(), shore = fixture();
    const field = shore.state.world.terrain;
    const bank = shore.state.world.cellSize * 0.65;
    for (let z = 0; z < field.resolution; z++) {
      if (field.originZ + z * field.step < bank) continue;
      for (let x = 0; x < field.resolution; x++) field.waterLevel[z * field.resolution + x] = shore.state.world.seaLevel + 0.25;
    }
    const first = grow(inland.state, 8), second = grow(shore.state, 8);
    expect(second).not.toEqual(first);
    for (const plot of second) expect(plot.worldZ + plot.radius).toBeLessThan(bank + field.step);
    const averageZ = (plots: typeof first) => plots.reduce((sum, plot) => sum + plot.worldZ, 0) / plots.length;
    expect(averageZ(second)).toBeLessThan(averageZ(first));
  });

  it('pulls markets toward actual commissioned trade access without creating a portal spoke', () => {
    const market = (direction: number) => {
      const { state, town } = fixture();
      const partner = structuredClone(town);
      partner.id = 'partner'; partner.position = { x: direction * 40, z: 0 }; partner.structurePlots = [];
      state.settlements.push(partner);
      const endpoint = { x: direction * state.world.cellSize * 2, z: 0 };
      state.transportation.stops[`${town.id}:road`] = { id: 'market-stop', settlementId: town.id,
        kind: 'market', node: 'market-stop', position: endpoint, access: [endpoint], status: 'complete' };
      state.tradeRoutes.push({ id: 'trade', a: town.id, b: partner.id, mode: 'land', volume: 1,
        ageMonths: 120, caravanProgress: 0, caravanDirection: 1, knowledgeFlow: 0, cumulativeKnowledge: 0,
        active: true, transport: { projectIds: [], nextDispatchMonth: 0, path: { mode: 'road',
          segmentIds: [], length: 40, points: [{ ...endpoint, y: 1 }, { ...partner.position, y: 1 }] } } });
      const plot = reserveStructurePlot(state, town, 'market')!;
      expect(plot).toBeDefined();
      expect(state.world.cells.some(cell => cell.modifications?.road)).toBe(false);
      return plot;
    };
    expect(market(1).worldX).toBeGreaterThan(market(-1).worldX);
  });

  it('does not treat flooded paths as usable frontage or reserve flooded ground', () => {
    const { state, town } = fixture();
    for (const cell of state.weather.cells) cell.floodDepth = 0.3;
    expect(settlementMovementFrontage(state.world, town)).toEqual([]);
    expect(reserveStructurePlot(state, town, 'residential')).toBeUndefined();
  });
});
