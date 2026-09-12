import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { configWith } from '../src/config';
import { generateWorld } from '../src/sim/world';
import { Simulation } from '../src/sim/Simulation';
import { SeededRandom } from '../src/sim/prng';
import type { ResourceDeposit } from '../src/sim/types';
import { advanceDeposits, meetsSite } from '../src/sim/resources/WorldResourceSystem';
import { RESOURCE_BY_ID } from '../src/sim/resources/catalog';
import { ExtractionAccessibility, transportFriction } from '../src/sim/resources/ExtractionAccessibility';
import { discoveryReadiness, discoverProvince, resourceKnowledge } from '../src/sim/resources/ResourceDiscoverySystem';
import { advanceEnvironment, forestRecoveryTarget, logProvince, modifyLand } from '../src/sim/environment/EnvironmentalModificationSystem';
import { ResourceSystem, extractableQuantity } from '../src/sim/resources/ResourceSystem';
import { settlementResources, environmentalSuitability } from '../src/sim/resources/SettlementEnvironment';
import { addMaterial, materialEconomy, publishBulkStocks } from '../src/sim/resources/Inventory';
import { TerrainSurface } from '../src/render/terrain/TerrainSurface';
import { ResourceSiteRenderer } from '../src/render/resources/ResourceSiteRenderer';
import { configurationFingerprint } from '../src/historian/RunArchive';
import { learn, societyFixture } from './fixtures/settlementDevelopment';
import { pointKey } from '../src/sim/transport/TerrainTraversal';

const generate = (seed = 'environment-provinces') => generateWorld(configWith({ seed, world: { size: 28 } }));
function fixture() {
  const { state, settlements: [s, other] } = societyFixture();
  state.world.resourceDeposits = [];
  for (const town of state.settlements) { town.localMaterials = {}; town.materialEconomy = undefined; town.discoveredDeposits = []; town.workedDeposits = []; town.alive = town === s; publishBulkStocks(town); }
  for (const c of state.world.cells) { c.wood = 0.8; c.forestCapacity = 0.8; c.temperature = 0.5;
    c.ecology = { ageYears: 120, disturbance: 0, lastDisturbanceMonth: -1, family: 'broadleaf' }; }
  for (const w of state.weather.cells) { w.snowpack = 0; w.blizzard = 0; w.cropDamage = 0; }
  const deposit: ResourceDeposit = { id: 'test-province', resourceId: 'stone', cellIndex: s!.cellIndex,
    worldX: s!.position.x, worldZ: s!.position.z, capacity: 100, quality: 0.8, abundance: 1,
    renewable: false, depleted: false, overharvested: false, surfaceShare: 1, discoveredBy: {} };
  state.world.resourceDeposits.push(deposit);
  return { state, s: s!, other: other!, deposit, system: new ResourceSystem(new SeededRandom('environment-extraction')) };
}

describe('Environmental generation', () => {
  it('reproduces geology, soil, communities and provinces exactly from a seed', () => {
    const a = generate(), b = generate();
    expect(b).toEqual(a);
    expect(generate('another-environment').resourceDeposits).not.toEqual(a.resourceDeposits);
  });
  it('constrains every province cell by parent rock and ecological requirements', () => {
    const world = generate();
    expect(world.resourceDeposits.some(d => !d.renewable)).toBe(true);
    for (const d of world.resourceDeposits) for (const local of d.cells!) {
      expect(meetsSite(world.cells[local.cellIndex]!, RESOURCE_BY_ID.get(d.resourceId)!)).toBe(true);
    }
    const cell = world.cells.find(c => !c.water)!;
    Object.assign(cell, { biome: 'mountain', minerals: 1, rockiness: 1 });
    cell.geology!.family = 'limestone'; cell.geology!.potential['tin-ore'] = 1;
    expect(meetsSite(cell, RESOURCE_BY_ID.get('tin-ore')!)).toBe(false);
  });
  it('builds connected, non-overlapping footprints whose quantities and grades aggregate exactly', () => {
    const world = generate();
    const occupied = new Set<string>();
    expect(world.resourceDeposits.some(d => d.cells!.length > 5)).toBe(true);
    for (const d of world.resourceDeposits) {
      expect(d.capacity).toBe(d.cells!.reduce((sum, c) => sum + c.capacity, 0));
      expect(d.quality).toBeCloseTo(d.cells!.reduce((sum, c) => sum + c.capacity * c.quality, 0) / d.capacity);
      const footprint = new Set(d.cells!.map(c => c.cellIndex));
      const seen = new Set([d.cells![0]!.cellIndex]);
      for (const i of seen) for (const j of footprint) {
        const a = world.cells[i]!, b = world.cells[j]!;
        if (Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1) seen.add(j);
      }
      expect(seen.size).toBe(footprint.size);
      for (const i of footprint) { const key = `${d.resourceId}:${i}`; expect(occupied.has(key)).toBe(false); occupied.add(key); }
    }
  });
  it('produces differing environmental opportunities and accessible surface grades', () => {
    const world = generate();
    const minerals = world.resourceDeposits.filter(d => !d.renewable);
    expect(new Set(minerals.map(d => d.quality.toFixed(2))).size).toBeGreaterThan(2);
    expect(new Set(minerals.map(d => d.depth!.toFixed(2))).size).toBeGreaterThan(2);
    const land = world.cells.filter(c => !c.water);
    expect(Math.max(...land.map(c => c.soil!.depth)) - Math.min(...land.map(c => c.soil!.depth))).toBeGreaterThan(0.2);
    expect(new Set(land.map(c => c.ecology!.family)).size).toBeGreaterThan(1);
    expect(land.some(c => c.soil!.waterAccess >= 0.5)).toBe(true);
    expect(land.every(c => c.soil!.catchment >= 0)).toBe(true);
  });
});

describe('Knowledge and economic access', () => {
  it('separates buried existence, exposure, discovery, usefulness and extraction practice', () => {
    const { s, other, deposit } = fixture();
    Object.assign(deposit, { resourceId: 'iron-ore', depth: 0.8, exposure: 0.01, surfaceShare: 0.08 });
    expect(discoveryReadiness(s, deposit)).toBe(0);
    expect(extractableQuantity(s, deposit)).toBe(0);
    learn(s, 'material-testing');
    expect(discoveryReadiness(s, deposit)).toBeGreaterThan(0);
    expect(discoverProvince(s, deposit, 12)).toBe(true);
    expect(discoverProvince(s, deposit, 13)).toBe(false);
    expect(resourceKnowledge(s, deposit)).toMatchObject({ visible: false, discovered: true, understood: true, deepExtraction: false });
    expect(resourceKnowledge(other, deposit).discovered).toBe(false);
    const early = extractableQuantity(s, deposit);
    learn(s, 'iron-working'); s.infrastructure.workshops = 0.5;
    expect(extractableQuantity(s, deposit)).toBeGreaterThan(early * 4);
  });
  it('does not reveal hidden provinces through settlement queries or site rendering', () => {
    const { state, s, deposit } = fixture();
    expect(settlementResources(state, s).provinces).toHaveLength(0);
    const renderer = new ResourceSiteRenderer(state.world, new TerrainSurface(state.world)); renderer.update();
    expect((renderer.group.children[0] as THREE.InstancedMesh).count).toBe(0);
    discoverProvince(s, deposit, 1);
    expect(settlementResources(state, s).provinces).toHaveLength(1);
  });
  it('charges mountain barriers along the whole route and rewards real transport modes', () => {
    const { state, s, other } = fixture();
    const path = [s.position, other.position];
    const flat = transportFriction(state.world, path);
    for (const c of state.world.cells) if (c.worldX > -6 && c.worldX < 6) { c.slope = 0.5; c.movementCost = 5; }
    const mountain = transportFriction(state.world, path);
    expect(mountain).toBeGreaterThan(flat * 1.4);
    expect(transportFriction(state.world, path, 'road')).toBeLessThan(mountain);
    expect(transportFriction(state.world, path, 'rail')).toBeLessThan(transportFriction(state.world, path, 'road'));
    expect(transportFriction(state.world, [s.position, { x: s.position.x + 3, z: s.position.z }])).toBeLessThan(flat);
  });
  it('uses completed networks and rejects interrupted transport without delivering cargo', () => {
    const { state, s, other, deposit, system } = fixture();
    Object.assign(deposit, { worldX: other.position.x, worldZ: other.position.z, cellIndex: other.cellIndex });
    s.infrastructure.roads = 1;
    const points = [s.position, other.position].map(p => ({ ...p, y: 3 }));
    state.transportation.segments.test = { id: 'test', from: pointKey(points[0]!), to: pointKey(points[1]!), points,
      mode: 'road', kind: 'surface', status: 'complete', length: 36, work: 1, cost: 1 };
    state.transportation.revision++;
    const routing = new ExtractionAccessibility(state);
    const route = routing.resolve(s, deposit)!;
    expect(route.networkPath?.segmentIds).toEqual(['test']);
    materialEconomy(s).inTransit.push({ depositId: deposit.id, resourceId: 'stone', quantity: 5, quality: 1, path: route.path,
      accessPaths: route.accessPaths, networkPath: route.networkPath, remainingMonths: 1 });
    state.transportation.segments.test.status = 'planned'; state.transportation.revision++;
    state.month = 1; system.advanceMonth(state);
    expect(s.localMaterials.stone ?? 0).toBe(0);
    expect(materialEconomy(s).inTransit[0]!.quantity).toBe(5);
  });
  it('reports shortages and exhausted districts without forcing settlement outcomes', () => {
    const { state, s, deposit } = fixture();
    deposit.depleted = true; deposit.abundance = 0; discoverProvince(s, deposit, 0);
    materialEconomy(s).demand.stone = 10;
    const signals = settlementResources(state, s);
    expect(signals.shortages).toContain('stone'); expect(signals.exhausted).toContain(deposit.id);
    const cell = state.world.cells[s.cellIndex]!;
    const score = environmentalSuitability(cell); cell.wood = 0; cell.fertility = 0.1;
    expect(environmentalSuitability(cell)).toBeLessThan(score);
    expect(s.alive).toBe(true);
  });
});

describe('Extraction and inherited landscapes', () => {
  it('conserves timber across multi-cell provinces and concentrates the first clearings near work', () => {
    const { state, s, deposit } = fixture();
    const i = s.cellIndex, j = i + 1;
    Object.assign(deposit, { resourceId: 'timber', renewable: true, capacity: 200,
      cells: [{ cellIndex: i, capacity: 100, quality: 0.8 }, { cellIndex: j, capacity: 100, quality: 0.8 }] });
    logProvince(state.world, deposit, 80, 1, s.id); advanceDeposits(state.world, 1);
    expect(deposit.capacity * deposit.abundance).toBeCloseTo(120);
    expect(state.world.cells[i]!.wood).toBeCloseTo(0.16);
    expect(state.world.cells[j]!.wood).toBe(0.8);
    expect(state.world.cells[i]!.ecology!.ageYears).toBeLessThan(state.world.cells[j]!.ecology!.ageYears);
  });
  it('regenerates herbs seasonally, suppresses disturbed habitat and never regenerates mineral ore', () => {
    const { state, deposit } = fixture();
    deposit.abundance = 0.3;
    for (let m = 0; m < 120; m++) advanceDeposits(state.world, m);
    expect(deposit.abundance).toBe(0.3);
    Object.assign(deposit, { renewable: true, resourceId: 'wild-herbs' });
    advanceDeposits(state.world, 5); const growth = deposit.abundance - 0.3;
    expect(growth).toBeGreaterThan(0);
    deposit.abundance = 0.3; state.world.cells[deposit.cellIndex]!.ecology!.disturbance = 1;
    advanceDeposits(state.world, 5); expect(deposit.abundance).toBe(0.3);
  });
  it('charges fuel for deep ore and preserves inaccessible reserves when fuel is absent', () => {
    const { state, s, deposit, system } = fixture();
    Object.assign(deposit, { resourceId: 'copper-ore', depth: 0.5, surfaceShare: 0.1, abundance: 0.8 });
    learn(s, 'material-testing', 'metal-smelting'); s.infrastructure.workshops = 0.5; discoverProvince(s, deposit, 0);
    state.month = 1; system.advanceMonth(state); expect(deposit.abundance).toBe(0.8);
    addMaterial(s, 'charcoal', 10);
    state.month = 2; system.advanceMonth(state);
    expect(deposit.abundance).toBeLessThan(0.8); expect(s.localMaterials.charcoal).toBeLessThan(10);
    expect(materialEconomy(s).energySupplied).toBeGreaterThan(0);
  });
  it('leaves a depleted quarry and carrying route in simulation and rendering after abandonment', () => {
    const { state, s, deposit, system } = fixture();
    deposit.capacity = 0.02; discoverProvince(s, deposit, 0);
    state.month = 1; const events = system.advanceMonth(state);
    expect(deposit.depleted).toBe(true); expect(events.some(e => e.type === 'resource-depleted')).toBe(true);
    expect(state.world.cells[deposit.cellIndex]!.modifications?.quarry).toBeDefined();
    expect(deposit.accessTrails).toBeDefined();
    s.alive = false; state.month = 12; advanceEnvironment(state);
    const mark = state.world.cells[deposit.cellIndex]!.modifications!.quarry!;
    expect(mark.abandonedMonth).toBe(12);
    const renderer = new ResourceSiteRenderer(state.world, new TerrainSurface(state.world));
    const before = structuredClone(state.world); renderer.update();
    expect((renderer.group.children[0] as THREE.InstancedMesh).count).toBe(1);
    expect((renderer.group.children[1] as THREE.InstancedMesh).count).toBeGreaterThan(0);
    expect(state.world).toEqual(before);
  });
  it('keeps active farmland cleared and reclaims it slowly after its settlement dies', () => {
    const { state, s } = fixture();
    const cell = state.world.cells[s.cellIndex]!;
    modifyLand(cell, 'farmland', 0.8, 0, s.id);
    expect(forestRecoveryTarget(cell)).toBeCloseTo(0.16);
    s.alive = false; state.month = 12; advanceEnvironment(state);
    expect(cell.modifications!.farmland!.intensity).toBeGreaterThan(0.7);
    expect(forestRecoveryTarget(cell)).toBeGreaterThan(0.16);
    expect(cell.modifications!.ruin).toBeDefined();
  });
  it('serializes environmental changes and reproduces them on replay; older archives get a different engine identity', () => {
    const config = { seed: 'environment-replay', startingPopulation: 80, world: { size: 20 }, settlementCount: [3, 3] as const };
    const sim = new Simulation(config); sim.step(24);
    const saved = structuredClone(sim.state.world);
    const json = JSON.parse(JSON.stringify(saved));
    expect(json.cells).toEqual(saved.cells); expect(json.resourceDeposits).toEqual(saved.resourceDeposits);
    sim.restart(); sim.step(24); expect(sim.state.world).toEqual(saved);
    expect(configurationFingerprint(configWith(config))).not.toBe(configurationFingerprint(configWith({ ...config, engineVersion: 'godbox-sim-0.11.0' })));
  });
});
