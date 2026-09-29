import { describe, expect, it } from 'vitest';
import { EnergyRenderer } from '../src/render/energy/EnergyRenderer';
import { constructGrid, deliver, dispatchInputCapacity, powerPath } from '../src/sim/energy/Transmission';
import { GridRouting, gridCorridors } from '../src/sim/energy/GridRouting';
import { storageNodeId, switchyardId } from '../src/sim/energy/GridTopology';
import { gridComponent } from '../src/sim/energy/AdvancedEnergy';
import { advanceEnergy } from '../src/sim/energy/EnergySystem';
import { energyAt, type EnergyState } from '../src/sim/energy/types';
import { infrastructureLabourBudget } from '../src/sim/people/HumanCapital';
import { publishBulkStocks } from '../src/sim/resources/Inventory';
import { waterAt } from '../src/sim/transport/TerrainTraversal';
import { learn } from './fixtures/settlementDevelopment';
import { electricalFixture as fixture } from './fixtures/electricalInfrastructure';

function commission(world: EnergyState) {
  for (const element of [...world.nodes!, ...world.lines]) { element.progress = 1; element.condition = 1; element.flow = 0; }
}

describe('persistent electrical infrastructure', () => {
  it('connects plants through yards, substations, feeders and transformers to physical services', () => {
    const { world } = fixture();
    commission(world);
    const path = powerPath(world.lines, 'generator', 'home', world.nodes)!;
    expect(path).toBeDefined();
    const ids = new Set(path.flatMap(l => [l.from, l.to]));
    const kinds = world.nodes!.filter(n => ids.has(n.id)).map(n => n.kind);
    expect(kinds).toEqual(expect.arrayContaining(['plant-bus', 'switchyard', 'substation', 'junction', 'transformer', 'service']));
    expect(deliver(world.lines, 'generator', 'home', 10, 2, world.nodes).received).toBeCloseTo(2);
    expect(world.lines.some(l => l.from === 'generator' && l.to === 'home')).toBe(false);
  });

  it('uses road verges for primary distribution and preserves surveyed positions', () => {
    const { state, s, world } = fixture();
    const corridors = gridCorridors(state, s);
    const junctions = world.nodes!.filter(n => n.kind === 'junction');
    expect(junctions.length).toBeGreaterThan(0);
    expect(junctions.some(n => corridors.some(c => {
      const length = Math.hypot(c.b.x - c.a.x, c.b.z - c.a.z);
      return Math.abs(Math.hypot(n.position.x - c.a.x, n.position.z - c.a.z)
        + Math.hypot(n.position.x - c.b.x, n.position.z - c.b.z) - length) < 0.001;
    }))).toBe(true);
    const before = world.nodes!.map(n => [n.id, { ...n.position }]);
    s.buildings += 12;
    constructGrid(state);
    expect(world.nodes!.slice(0, before.length).map(n => [n.id, n.position])).toEqual(before);
  });

  it('connects regional lines to switchyards and retains the regional dispatch island', () => {
    const { state, settlements, s, world } = fixture(true);
    commission(world);
    const line = world.lines.find(l => l.class === 'transmission')!;
    expect(line).toBeDefined();
    expect([line.from, line.to]).toEqual([switchyardId(s), switchyardId(settlements[1]!)]);
    expect(line.capacity).toBeGreaterThan(Math.max(...world.lines.filter(l => l.class === 'distribution').map(l => l.capacity)));
    expect(gridComponent(state, s).map(s => s.id)).toContain(settlements[1]!.id);
    expect(powerPath(world.lines, 'generator', settlements[1]!.id, world.nodes)).toBeDefined();
    line.condition = 0.2;
    expect(gridComponent(state, s)).toHaveLength(1);
  });

  it('uses commissioned bridge spans without placing towers in water or bridging gaps in road projects', () => {
    const { state, world } = fixture(true);
    world.lines = world.lines.filter(l => l.class !== 'transmission');
    const route = state.tradeRoutes[0]!;
    const template = state.transportation.segments[route.transport!.path!.segmentIds[0]!]!;
    const endpoints = [[-18, -3], [-3, 3], [3, 18]];
    for (const [i, xs] of endpoints.entries()) state.transportation.segments[`crossing-${i}`] = {
      ...template, id: `crossing-${i}`, kind: i === 1 ? 'bridge' : 'surface',
      points: xs.map(x => ({ x, z: -18, y: 1 })), length: xs[1]! - xs[0]!,
    };
    route.transport!.path!.segmentIds = endpoints.map((_, i) => `crossing-${i}`);
    const terrain = state.world.terrain;
    for (let z = 0; z < terrain.resolution; z++) for (let x = 0; x < terrain.resolution; x++) {
      if (Math.abs(terrain.originX + x * terrain.step) < 1) terrain.waterLevel[z * terrain.resolution + x] = 1;
    }
    const bridge = state.transportation.segments['crossing-1']!;
    bridge.status = 'planned';
    constructGrid(state);
    expect(world.lines.some(l => l.class === 'transmission')).toBe(false);
    bridge.status = 'complete';
    constructGrid(state);
    const line = world.lines.find(l => l.class === 'transmission')!;
    expect(line).toBeDefined();
    expect(line.points.every(p => !waterAt(state.world, p))).toBe(true);
    world.lines = world.lines.filter(l => l.class !== 'transmission');
    state.transportation.segments['crossing-2']!.points[0]!.x = 7;
    constructGrid(state);
    expect(world.lines.some(l => l.class === 'transmission')).toBe(false);
  });

  it('upgrades improvised equipment in place with paid materials after grid knowledge arrives', () => {
    const { state, s, world } = fixture(false, false);
    commission(world);
    const substation = world.nodes!.find(n => n.kind === 'substation')!;
    const before = { ...substation.position }, copper = s.localMaterials.copper!;
    expect(substation.capacity).toBe(32);
    learn(s, 'electric-grid');
    for (let i = 0; i < 12; i++) {
      state.month++; infrastructureLabourBudget(state, s).remaining = 20; constructGrid(state);
    }
    expect(substation.capacity).toBeGreaterThanOrEqual(100);
    expect(substation.position).toEqual(before);
    expect(s.localMaterials.copper).toBeLessThan(copper);
  });

  it('makes upstream equipment completion, damage and capacity causal, including storage', () => {
    const { s, world } = fixture();
    commission(world);
    const hub = world.nodes!.find(n => n.kind === 'substation')!;
    hub.progress = 0.9;
    expect(deliver(world.lines, 'generator', 'home', 20, 10, world.nodes).received).toBe(0);
    hub.progress = 1; hub.condition = 0.2;
    expect(deliver(world.lines, 'generator', 'home', 20, 10, world.nodes).received).toBe(0);
    hub.condition = 0.5; hub.capacity = 2;
    expect(deliver(world.lines, 'generator', 'home', 20, 10, world.nodes).received).toBeLessThanOrEqual(1);
    commission(world);
    const batteryConnection = world.lines.find(l => l.from === storageNodeId(s) || l.to === storageNodeId(s))!;
    batteryConnection.progress = 0.9;
    expect(deliver(world.lines, storageNodeId(s), 'home', 20, 10, world.nodes).received).toBe(0);
    expect(deliver(world.lines, 'generator', storageNodeId(s), 20, 10, world.nodes).received).toBe(0);
    commission(world);
    const lead = world.lines.find(l => l.from === 'generator' || l.to === 'generator')!;
    lead.capacity = 1; lead.condition = 0.4;
    const before = JSON.stringify(world);
    expect(dispatchInputCapacity(world.lines, world.nodes, 'generator', 20, [{ node: 'home', demand: 10 }])).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(JSON.stringify(world)).toBe(before);
    expect(deliver(world.lines, 'generator', 'home', 20, 10, world.nodes).received).toBeLessThanOrEqual(0.4);
  });

  it('pays deterministic canonical materials and shared labour, and stops when copper runs out', () => {
    const a = fixture(), b = fixture();
    expect(a.world).toEqual(b.world);
    expect(a.s.localMaterials).toEqual(b.s.localMaterials);
    expect(a.s.localMaterials.copper).toBeLessThan(1000);
    expect(infrastructureLabourBudget(a.state, a.s).remaining).toBeLessThan(1000);
    a.s.localMaterials.copper = 0;
    const before = [...a.world.nodes!, ...a.world.lines].map(n => n.progress);
    constructGrid(a.state);
    expect([...a.world.nodes!, ...a.world.lines].map(n => n.progress)).toEqual(before);
  });

  it('commissions through paid work, serves critical demand first and survives a save reload', () => {
    const { state, s, world } = fixture();
    learn(s, 'mechanical-power');
    s.localMaterials.charcoal = 1000;
    state.world.cells[s.cellIndex]!.river = true;
    state.world.cells[s.cellIndex]!.flow = 1;
    const pump = structuredClone(s.structurePlots![1]!);
    pump.id = 'pump'; pump.worldX = -15; pump.worldZ = -11;
    pump.development!.need = 'water';
    s.structurePlots!.push(pump);
    energyAt(s).plants.push({ ...energyAt(s).plants[0]!, id: 'generator-backup', plotId: 'home' });
    for (let i = 0; i < 60; i++) {
      state.month++;
      infrastructureLabourBudget(state, s).remaining = 20;
      constructGrid(state);
    }
    expect(world.nodes!.every(n => n.progress === 1)).toBe(true);
    expect(world.lines.every(l => l.progress === 1)).toBe(true);
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    const receiver = restored.settlements.find(member => member.id === s.id)!;
    const hub = restored.energy!.nodes!.find(n => n.kind === 'substation')!;
    hub.capacity = 1;
    receiver.localMaterials.copper = 0;
    restored.month++;
    advanceEnergy(restored);
    expect(energyAt(receiver).ledgers.electric.generated).toBeGreaterThan(0);
    expect(energyAt(receiver).service.supplied.critical).toBeGreaterThan(0);
    expect(energyAt(receiver).service.supplied.essential).toBeCloseTo(0, 10);
    hub.capacity = 180;
    const firstLead = restored.energy!.lines.find(l => l.from === 'generator' || l.to === 'generator')!;
    firstLead.capacity = 0.1;
    restored.month++;
    advanceEnergy(restored);
    expect(energyAt(receiver).plants.find(p => p.id === 'generator-backup')!.output).toBeGreaterThan(0.1);
    expect(energyAt(receiver).ledgers.electric.supplied).toBeGreaterThan(0.1);
    hub.condition = 0;
    restored.month++;
    advanceEnergy(restored);
    expect(energyAt(receiver).ledgers.electric.supplied).toBe(0);
    expect(energyAt(receiver).plants[0]!.fuelUsed).toBe(0);
  });

  it('has grounded, obstruction-free edges, exact endpoints and no orphan equipment', () => {
    const { state, world } = fixture(true);
    const routing = new GridRouting(state);
    for (const node of world.nodes!) {
      expect(routing.site(node.position, node.radius)).toBe(true);
      expect(world.lines.some(l => l.from === node.id || l.to === node.id)).toBe(true);
      for (const other of world.nodes!.filter(n => n.id !== node.id)) {
        expect(Math.hypot(node.position.x - other.position.x, node.position.z - other.position.z)).toBeGreaterThanOrEqual(node.radius + other.radius);
      }
      for (let i = 1; i < (node.attachment?.length ?? 0); i++) expect(routing.clear(node.attachment![i - 1]!, node.attachment![i]!)).toBe(true);
    }
    for (const line of world.lines) {
      expect(line.points[0]).toEqual(world.nodes!.find(n => n.id === line.from)!.position);
      expect(line.points.at(-1)).toEqual(world.nodes!.find(n => n.id === line.to)!.position);
      for (let i = 1; i < line.points.length; i++) expect(routing.clear(line.points[i - 1]!, line.points[i]!)).toBe(true);
    }
    state.world.terrain.waterLevel.fill(100);
    expect(routing.route({ x: -20, z: -20 }, { x: -10, z: -10 })).toBeUndefined();
  });

  it('renders persistent equipment identity, hierarchy and damage without mutating simulation state', () => {
    const { state, world } = fixture(true);
    commission(world);
    const before = JSON.stringify(state);
    const renderer = new EnergyRenderer();
    renderer.update(state, 0, () => 3);
    expect(JSON.stringify(state)).toBe(before);
    const names: string[] = [];
    renderer.group.traverse(o => names.push(o.name));
    for (const name of ['Grid transformer tank', 'Local transformer', 'Grid buswork', 'Grid porcelain insulator', 'Grid precinct fence', 'Service cutout']) expect(names).toContain(name);
    expect(names.some(n => n.startsWith('Transmission tower:'))).toBe(true);
    expect(names.some(n => n.startsWith('Distribution pole:'))).toBe(true);
    const hub = world.nodes!.find(n => n.kind === 'substation')!;
    const object = renderer.group.getObjectByName(`Grid substation:${hub.id}`)!;
    expect(object.position.y).toBe(3);
    hub.condition = 0.2;
    renderer.update(state, 1, () => 3);
    expect(renderer.group.getObjectByName('Damaged grid equipment')).toBeDefined();
    renderer.dispose();
  });

  it('retires legacy bypass wires on upgrade without losing generation or stored energy', () => {
    const { state, s, world } = fixture();
    world.topologyVersion = undefined;
    world.lines.push({ id: 'old', from: 'generator', to: s.id, capacity: 80, condition: 0.8, progress: 1, loss: 0, flow: 0, points: [] });
    s.localMaterials = {};
    publishBulkStocks(s);
    energyAt(s).storage = 7;
    constructGrid(state);
    expect(world.lines.find(l => l.id === 'old')!.retired).toBe(true);
    expect(energyAt(s).storage).toBe(7);
    expect(energyAt(s).plants[0]!.id).toBe('generator');
    expect(s.localMaterials.copper).toBeCloseTo(0.2);
    expect(s.localMaterials.timber).toBeCloseTo(0.4);
    constructGrid(state);
    expect(s.localMaterials.copper).toBeCloseTo(0.2);
  });
});
