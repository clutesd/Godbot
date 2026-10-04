import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/Simulation';
import type { Settlement, StructurePlot } from '../src/sim/types';
import type { SettlementNeed, ServiceSupply, StructureDevelopment, StructureForm, StructureMaterial } from '../src/sim/development/types';
import {
  STOCKPILE_HOST_ID, planSettlementStorage, planYardBays, storageFamily, storageUnits,
  type StorageHostPlan, type StorageMaturity, type YardFrame,
} from '../src/render/settlement/StorageYardPresentation';
import { createWorkingPrecinctLayer, planWorkingPrecinct } from '../src/render/settlement/WorkingPrecinctPresentation';

function development(need: SettlementNeed, form: StructureForm, services: ServiceSupply, level = 2, material: StructureMaterial = 'timber'): StructureDevelopment {
  const style = { primary: '#765544', secondary: '#4a3e38', accent: '#c8a65a', symbol: 'sun-step' as const, pattern: 'chevron' as const, nameSyllables: ['ka'] };
  return {
    need, form, name: `${need} site`, level, material, cultureId: 'culture', style, services, reasons: ['test'], capabilities: [],
    cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 4, status: 'active',
    origin: { month: 0, action: 'founded', name: `${need} site`, need, cultureId: 'culture', reasons: ['test'], form, level, material },
    history: [], transitionCount: 0, lastUsedMonth: 0,
  };
}

function plot(id: string, value: StructureDevelopment, worldX = 0, worldZ = 0): StructurePlot {
  return { id, development: value, worldX, worldZ, radius: 1.65, width: 2.1, height: 1.2, depth: 1.72, condition: 1, foundedMonth: 0 };
}

function town(seed: string): { simulation: Simulation; settlement: Settlement } {
  const simulation = new Simulation({ seed, startingPopulation: 24, settlementCount: [1, 1], world: { size: 20 } });
  const settlement = simulation.state.settlements[0]!;
  settlement.resources = { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 };
  settlement.localMaterials = {};
  settlement.structurePlots = [];
  settlement.processing = undefined;
  return { simulation, settlement };
}

const frame: YardFrame = { wallOffset: 0.7, stripDepth: 0.8, stripWidth: 1.6, side: 'rear', arrivalSign: 1 };
const host = (role: StorageHostPlan['role'], maturity: StorageMaturity, ids: Record<string, number>): StorageHostPlan => ({
  hostId: `${role}-host`, role, maturity,
  allocations: Object.entries(ids).map(([materialId, units]) => ({ materialId, family: storageFamily(materialId), hostId: `${role}-host`, amount: units * 4, units })),
});

describe('storage yard allocation', () => {
  it('derives visible quantity logarithmically and caps it', () => {
    expect(storageUnits(0)).toBe(0);
    expect(storageUnits(-4)).toBe(0);
    expect(storageUnits(Infinity)).toBe(0);
    expect(storageUnits(1)).toBeGreaterThanOrEqual(1);
    expect(storageUnits(10)).toBeLessThan(storageUnits(100));
    // Ten times the stock is nowhere near ten times the props.
    expect(storageUnits(1000)).toBeLessThan(storageUnits(100) * 2);
    expect(storageUnits(1e9)).toBe(14);
  });

  it('splits each material exactly across real hosts without inventing or duplicating stock', () => {
    const { settlement } = town('yard-conservation');
    settlement.localMaterials = { timber: 900, stone: 70, 'copper-ore': 12, clay: 30, iron: 8, pottery: 5, 'plant-fiber': 3, empty: 0 };
    settlement.structurePlots = [
      plot('store', development('trade', 'store', { trade: 1 })),
      plot('workshop', development('manufacturing', 'workshop', { manufacturing: 1 }), 4, 0),
      plot('kiln', development('manufacturing', 'workshop', { manufacturing: 1 }, 2, 'ceramic'), 0, 4),
      plot('home-a', development('housing', 'dwelling', { housing: 1 }), -4, 0),
      plot('home-b', development('housing', 'dwelling', { housing: 1 }), 0, -4),
    ];
    const plan = planSettlementStorage(settlement);
    for (const [id, amount] of Object.entries(settlement.localMaterials)) {
      const shares = plan.allocations.filter(allocation => allocation.materialId === id);
      if (amount <= 0) { expect(shares).toHaveLength(0); continue; }
      expect(shares.reduce((sum, share) => sum + share.amount, 0)).toBeCloseTo(amount, 9);
      expect(shares.reduce((sum, share) => sum + share.units, 0)).toBe(storageUnits(amount));
      expect(new Set(shares.map(share => share.hostId)).size).toBe(shares.length);
    }
    const hostOf = (id: string) => plan.allocations.filter(a => a.materialId === id).sort((a, b) => b.units - a.units)[0]!.hostId;
    expect(['workshop', 'kiln']).toContain(hostOf('timber'));
    expect(hostOf('iron')).toBe('store');
    expect(hostOf('pottery')).toBe('store');
    expect(hostOf('clay')).toBe('kiln');
    // Large timber stock reaches household firewood caches, one load each.
    const caches = plan.allocations.filter(a => a.materialId === 'timber' && a.hostId.startsWith('home'));
    expect(caches.length).toBeGreaterThan(0);
    expect(caches.every(cache => cache.units === 1)).toBe(true);
  });

  it('keeps stock off facility plots, whose yards show their own inventory', () => {
    const { settlement } = town('yard-facility');
    settlement.localMaterials = { timber: 20 };
    settlement.structurePlots = [plot('works', development('manufacturing', 'works', { manufacturing: 1 })), plot('store', development('trade', 'store', { trade: 1 }), 5, 0)];
    settlement.processing = { governed: true, facilities: [{ plotId: 'works' } as never], foundingBlockers: {}, nextFacilityIndex: 1 };
    const plan = planSettlementStorage(settlement);
    expect(plan.allocations.every(allocation => allocation.hostId !== 'works')).toBe(true);
  });

  it('falls back to one common open-air stockpile when no structure can hold stock', () => {
    const { settlement } = town('yard-camp');
    settlement.localMaterials = { timber: 6, stone: 3 };
    settlement.urbanization = 0;
    settlement.infrastructure.roads = 0;
    settlement.structurePlots = [plot('shrine', development('religion', 'sanctuary', { religion: 1 }, 1))];
    const plan = planSettlementStorage(settlement);
    expect([...plan.hosts.keys()]).toEqual([STOCKPILE_HOST_ID]);
    expect(plan.hosts.get(STOCKPILE_HOST_ID)!.maturity).toBe(0);
  });
});

describe('storage yard layout grammar', () => {
  const stockOf = (primitives: { stock: number }[]) => primitives.reduce((sum, primitive) => sum + primitive.stock, 0);

  it('forms recognizable material working areas with handling space', () => {
    const timber = planYardBays(host('workshop', 1, { timber: 6, lumber: 2 }), host('workshop', 1, { timber: 6, lumber: 2 }).allocations, frame, 'seed').primitives;
    expect(timber.some(p => p.kind === 'log' && p.cue === 'stock:timber')).toBe(true);
    expect(timber.some(p => p.cue === 'work:chopping')).toBe(true);
    expect(timber.some(p => p.cue === 'work:sawhorse')).toBe(true);
    expect(timber.some(p => p.cue === 'lumber-rack')).toBe(true);

    const stone = planYardBays(host('store', 1, { stone: 5, 'dressed-stone': 3 }), host('store', 1, { stone: 5, 'dressed-stone': 3 }).allocations, frame, 'seed').primitives;
    expect(stone.some(p => p.kind === 'pile' && p.cue === 'stock:stone')).toBe(true);
    expect(stone.some(p => p.kind === 'solid' && p.cue === 'stock:stone')).toBe(true);
    expect(stone.some(p => p.cue === 'work:banker')).toBe(true);

    const ore = planYardBays(host('workshop', 1, { 'copper-ore': 4, 'tin-ore': 2 }), host('workshop', 1, { 'copper-ore': 4, 'tin-ore': 2 }).allocations, frame, 'seed').primitives;
    expect(ore.filter(p => p.cue === 'storage-bin').length).toBeGreaterThanOrEqual(6);
    const clay = planYardBays(host('workshop', 1, { clay: 4 }), host('workshop', 1, { clay: 4 }).allocations, frame, 'seed').primitives;
    expect(clay.some(p => p.kind === 'clod' && p.cue === 'stock:clay')).toBe(true);
    expect(clay.some(p => p.cue === 'work:wedging-bench')).toBe(true);
    const goods = planYardBays(host('store', 1, { iron: 3, pottery: 3 }), host('store', 1, { iron: 3, pottery: 3 }).allocations, frame, 'seed').primitives;
    expect(goods.some(p => p.cue === 'pallet')).toBe(true);
    expect(goods.some(p => p.cue === 'stock:metal')).toBe(true);
  });

  it('represents exactly the allocated units, with stock against the wall and work space beyond it', () => {
    const plan = host('workshop', 1, { timber: 7, stone: 4 });
    const { primitives } = planYardBays(plan, plan.allocations, frame, 'seed');
    expect(stockOf(primitives)).toBeCloseTo(11, 9);
    const wallZ = -(frame.wallOffset + 0.03);
    const stock = primitives.filter(p => p.stock > 0);
    const tools = primitives.filter(p => p.cue.startsWith('work:') && p.kind !== 'ground');
    const meanDistance = (items: typeof primitives) => items.reduce((sum, p) => sum + Math.abs(p.z - wallZ), 0) / items.length;
    expect(meanDistance(stock)).toBeLessThan(meanDistance(tools));
  });

  it('develops from messy open-air piles to fenced yards and sheds', () => {
    const early = host('workshop', 0, { timber: 6 });
    const mid = host('workshop', 1, { timber: 6 });
    const late = host('workshop', 2, { timber: 6 });
    const cues = (h: StorageHostPlan) => new Set(planYardBays(h, h.allocations, frame, 'seed').primitives.map(p => p.cue));
    expect(cues(early).has('yard-fence')).toBe(false);
    expect(cues(early).has('storage-shed')).toBe(false);
    expect(cues(mid).has('yard-fence')).toBe(true);
    expect(cues(late).has('storage-shed')).toBe(true);
  });

  it('is deterministic, and varies messy layouts by seed', () => {
    const plan = host('stockpile', 0, { timber: 6, stone: 4 });
    const a = planYardBays(plan, plan.allocations, frame, 'seed-a').primitives;
    expect(planYardBays(plan, plan.allocations, frame, 'seed-a').primitives).toEqual(a);
    expect(planYardBays(plan, plan.allocations, frame, 'seed-b').primitives).not.toEqual(a);
  });

  it('starts at the end facing arrivals and leaves the middle open', () => {
    const plan = host('workshop', 1, { timber: 6 });
    const left = planYardBays(plan, plan.allocations, { ...frame, arrivalSign: -1 }, 'seed');
    const right = planYardBays(plan, plan.allocations, { ...frame, arrivalSign: 1 }, 'seed');
    const meanX = (items: { x: number; stock: number }[]) => {
      const stock = items.filter(p => p.stock > 0);
      return stock.reduce((sum, p) => sum + p.x, 0) / stock.length;
    };
    expect(meanX(left.primitives)).toBeLessThan(0);
    expect(meanX(right.primitives)).toBeGreaterThan(0);
    expect([...right.occupiedSigns]).toEqual([1]);
  });
});

describe('storage yards in working precincts', () => {
  it('puts the yard on the real host plot and yields generic tables to it', () => {
    const { settlement } = town('yard-precinct');
    settlement.localMaterials = { timber: 40 };
    const site = plot('workshop', development('manufacturing', 'workshop', { manufacturing: 1 }));
    settlement.structurePlots = [site];
    const plan = planWorkingPrecinct(settlement, site, { width: site.width, depth: site.depth, rotationY: 0 })!;
    expect(plan.primitives.some(p => p.cue === 'stock:timber')).toBe(true);
    const rearTables = plan.primitives.filter(p => p.cue === 'work-surface' && p.z < 0);
    const stock = plan.primitives.filter(p => (p.stock ?? 0) > 0);
    const stockSide = Math.sign(stock.reduce((sum, p) => sum + p.x, 0));
    expect(rearTables.every(table => Math.sign(table.x) !== stockSide)).toBe(true);
  });

  it('never places more visible stock than the logarithmic units of real inventory', () => {
    const { simulation, settlement } = town('yard-layer');
    settlement.localMaterials = { timber: 300, stone: 50, clay: 9, iron: 4 };
    const store = plot('store', development('trade', 'store', { trade: 1 }), settlement.position.x + 3, settlement.position.z);
    const workshop = plot('workshop', development('manufacturing', 'workshop', { manufacturing: 1 }), settlement.position.x - 3, settlement.position.z);
    settlement.structurePlots = [store, workshop];
    const placements = settlement.structurePlots.map(p => ({ key: p.id, worldX: p.worldX, worldZ: p.worldZ, width: p.width, depth: p.depth, rotationY: 0 }));
    const layer = createWorkingPrecinctLayer(simulation.state, settlement, placements, 0, () => 0);
    const ceiling = Object.values(settlement.localMaterials).reduce((sum, amount) => sum + storageUnits(amount), 0);
    expect(layer.userData['visibleStockUnits']).toBeLessThanOrEqual(ceiling + 1e-9);
    expect(layer.userData['storageHosts'].map((h: { id: string }) => h.id).sort()).toEqual(['store', 'workshop']);
    const before = JSON.stringify(settlement.localMaterials);
    createWorkingPrecinctLayer(simulation.state, settlement, placements, 0, () => 0);
    expect(JSON.stringify(settlement.localMaterials)).toBe(before);
  });
});
