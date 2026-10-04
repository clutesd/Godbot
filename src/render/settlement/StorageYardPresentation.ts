import type { Settlement, SimulationState, StructurePlot, Vec2 } from '../../sim/types';
import type { StructureDevelopment } from '../../sim/development/types';
import { resourceWorkAssignmentsForWorld } from '../../sim/resources/ResourceWorkAssignments';
import { storedMaterialColour } from '../resources/ResourceFlowPresentation';
import { isMinedMaterial, mineralVisualProfile } from '../resources/MineralPresentation';

/**
 * Storage-yard grammar for settlement stock.
 *
 * `Settlement.localMaterials` is the only authority. This module decides *where* that stock is
 * physically kept (store plots, workshop yards, energy/fuel sites, household caches, or one common
 * open-air stockpile) and how each material family is arranged there. It never mutates state and
 * never invents inventory: every material's amount is split exactly across its hosts, and the
 * visible quantity is a logarithmic unit count of the real total, divided by the real allocation.
 */

export type StorageFamily = 'timber' | 'stone' | 'ore' | 'clay' | 'metal' | 'goods' | 'plant';
export type StorageHostRole = 'store' | 'workshop' | 'energy' | 'trade' | 'healthcare' | 'household' | 'stockpile';
/** 0 open-air and messy, 1 fenced yards / racks / bins, 2 sheds, pallets and loading areas. */
export type StorageMaturity = 0 | 1 | 2;

export const STOCKPILE_HOST_ID = 'common-stockpile';
export const MAX_STOCK_UNITS = 14;

export interface StockAllocation {
  materialId: string;
  family: StorageFamily;
  hostId: string;
  /** Exact share of `localMaterials[materialId]`; shares for one material sum to the stored amount. */
  amount: number;
  /** Visible loads; shares of the material's logarithmic total, never re-derived per host. */
  units: number;
}

export interface StorageHostPlan {
  hostId: string;
  role: StorageHostRole;
  maturity: StorageMaturity;
  allocations: StockAllocation[];
}

export interface SettlementStoragePlan {
  maturity: StorageMaturity;
  hosts: Map<string, StorageHostPlan>;
  allocations: StockAllocation[];
}

/** World-space unit directions from the settlement toward where each family really comes from. */
export type StorageArrivals = Partial<Record<StorageFamily, Vec2>>;

export function storageFamily(id: string): StorageFamily {
  if (/timber|lumber|plank|wood/.test(id)) return 'timber';
  if (/clay|brick|ash/.test(id)) return 'clay';
  if (/ore|coal|charcoal|slag/.test(id)) return 'ore';
  if (/stone|masonry/.test(id)) return 'stone';
  if (/^(iron|copper|bronze|steel|tin|silicon)$/.test(id)) return 'metal';
  if (/fiber|flora|herb|reed/.test(id)) return 'plant';
  return 'goods';
}

/** Logarithmic visible quantity: one camp log pile at 1 unit, a full timber yard near the cap. */
export function storageUnits(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0.001) return 0;
  return Math.max(1, Math.min(MAX_STOCK_UNITS, Math.round(1.5 * Math.log2(1 + amount))));
}

function activeDevelopment(plot: StructurePlot, settlement: Settlement): StructureDevelopment | undefined {
  const development = plot.development;
  if (!development || development.status !== 'active' || development.memorial) return undefined;
  if (plot.condition <= 0.2 || plot.accessRestricted) return undefined;
  if (settlement.development?.project?.plotId === plot.id) return undefined;
  return development;
}

function hostRole(development: StructureDevelopment): StorageHostRole | undefined {
  if (development.form === 'store') return 'store';
  if (development.form === 'workshop' || development.form === 'works' || development.need === 'manufacturing') return 'workshop';
  if (development.need === 'energy') return 'energy';
  if (development.need === 'trade' || development.need === 'transport') return 'trade';
  if (development.need === 'healthcare') return 'healthcare';
  if (development.need === 'housing' || development.form === 'dwelling') return 'household';
  return undefined;
}

const AFFINITY: Record<StorageFamily, Partial<Record<StorageHostRole, number>>> = {
  timber: { workshop: 3, energy: 3, store: 2, trade: 1 },
  stone: { workshop: 2.4, store: 2.2, trade: 1 },
  ore: { workshop: 3, energy: 1.6, store: 1.4 },
  clay: { workshop: 2.6, store: 1.4 },
  metal: { store: 3, trade: 2.6, workshop: 2 },
  goods: { store: 3, trade: 2.8, workshop: 1.4 },
  plant: { healthcare: 3, store: 2.2, workshop: 1.4, household: 0.8 },
};

export function settlementStorageMaturity(settlement: Settlement): StorageMaturity {
  const plots = (settlement.structurePlots ?? []).flatMap(plot => {
    const development = activeDevelopment(plot, settlement);
    return development ? [development] : [];
  });
  const storeLevel = Math.max(0, ...plots.filter(d => d.form === 'store').map(d => d.level));
  const capabilities = new Set(plots.flatMap(d => d.capabilities));
  const roads = settlement.infrastructure.roads;
  if (storeLevel >= 3 || settlement.infrastructure.factories >= 0.25
    || roads >= 0.5 && settlement.urbanization >= 0.4 || capabilities.has('wheel-axle') && storeLevel >= 2) return 2;
  if (storeLevel >= 1 || settlement.urbanization >= 0.2 || roads >= 0.3 || plots.some(d => d.level >= 2)) return 1;
  return 0;
}

/** Real sources: active extraction sites for raw families, trade partners for traded families. */
export function storageArrivals(state: SimulationState, settlement: Settlement): StorageArrivals {
  const sums: Partial<Record<StorageFamily, Vec2>> = {};
  const push = (family: StorageFamily, x: number, z: number, weight: number) => {
    const length = Math.hypot(x, z);
    if (length < 0.05 || weight <= 0) return;
    const sum = sums[family] ?? { x: 0, z: 0 };
    sum.x += x / length * weight; sum.z += z / length * weight;
    sums[family] = sum;
  };
  for (const assignment of resourceWorkAssignmentsForWorld(state.world)) {
    if (assignment.settlementId !== settlement.id || assignment.amountExtracted <= 0) continue;
    push(storageFamily(assignment.resourceId), assignment.worldPosition.x - settlement.position.x,
      assignment.worldPosition.z - settlement.position.z, assignment.amountExtracted);
  }
  for (const route of state.tradeRoutes) {
    const partnerId = route.a === settlement.id ? route.b : route.b === settlement.id ? route.a : undefined;
    const partner = partnerId ? state.settlements.find(s => s.id === partnerId) : undefined;
    if (!partner) continue;
    for (const family of ['metal', 'goods'] as const) {
      push(family, partner.position.x - settlement.position.x, partner.position.z - settlement.position.z, Math.max(0.1, route.volume));
    }
  }
  const out: StorageArrivals = {};
  for (const [family, sum] of Object.entries(sums) as Array<[StorageFamily, Vec2]>) {
    const length = Math.hypot(sum.x, sum.z);
    if (length > 1e-6) out[family] = { x: sum.x / length, z: sum.z / length };
  }
  return out;
}

interface Candidate { plot: StructurePlot; development: StructureDevelopment; role: StorageHostRole }

function affinity(settlement: Settlement, family: StorageFamily, candidate: Candidate): number {
  let score = AFFINITY[family][candidate.role] ?? 0;
  if (score <= 0) return 0;
  const { development } = candidate;
  if (candidate.role === 'workshop') {
    if (family === 'clay' && (development.material === 'ceramic' || settlement.knownRecipes.includes('pottery-vessels'))) score += 1;
    if (family === 'ore' && settlement.knownRecipes.some(id => /bronze|iron|smelt|charcoal/.test(id))) score += 0.8;
    if (family === 'timber' && settlement.specialization === 'forestry') score += 0.6;
    if (family === 'stone' && development.material === 'masonry') score += 0.6;
  }
  return score + Math.min(2, development.level) * 0.15;
}

/**
 * Pure allocation of authoritative stock to real storage locations. Facility plots are excluded:
 * the facility yard already renders the facility's own (separate) input/output inventory.
 */
export function planSettlementStorage(settlement: Settlement, arrivals: StorageArrivals = {}): SettlementStoragePlan {
  const maturity = settlementStorageMaturity(settlement);
  const facilityPlots = new Set((settlement.processing?.facilities ?? []).map(facility => facility.plotId));
  const candidates: Candidate[] = [];
  for (const plot of [...(settlement.structurePlots ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (facilityPlots.has(plot.id)) continue;
    const development = activeDevelopment(plot, settlement);
    const role = development ? hostRole(development) : undefined;
    if (development && role) candidates.push({ plot, development, role });
  }
  const households = candidates.filter(c => c.role === 'household');
  const hosts = new Map<string, StorageHostPlan>();
  const families = new Map<string, Set<StorageFamily>>();
  const allocations: StockAllocation[] = [];

  const hostMaturity = (role: StorageHostRole, level: number): StorageMaturity =>
    (role === 'stockpile' ? Math.min(1, maturity) : Math.min(maturity, Math.max(0, level - 1 + (role === 'store' ? 1 : 0)))) as StorageMaturity;
  const hostFor = (id: string, role: StorageHostRole, level: number): StorageHostPlan => {
    let host = hosts.get(id);
    if (!host) {
      host = { hostId: id, role, maturity: hostMaturity(role, level), allocations: [] };
      hosts.set(id, host);
    }
    return host;
  };
  /** Each wall side holds at most two family bays (one for a household), matching what is laid out. */
  const hasBay = (id: string, role: StorageHostRole, level: number, family: StorageFamily): boolean => {
    const held = families.get(id);
    if (!held || held.has(family)) return true;
    const front = frontStagedFamilies(role, hostMaturity(role, level));
    const sameSide = [...held].filter(f => front.has(f) === front.has(family)).length;
    return sameSide < (role === 'household' ? 1 : 2);
  };

  // Specialist material (clay at a kiln, ore at a smelting shop) claims its yard before generic bulk
  // can fill the wall; then larger stocks first, ids breaking ties so layouts are stable.
  const specialism = (id: string) => Math.max(0, ...candidates.map(c => affinity(settlement, storageFamily(id), c)));
  const stock = Object.entries(settlement.localMaterials)
    .filter(([, amount]) => Number.isFinite(amount) && amount > 0.001)
    .map(([id, amount]) => ({ id, amount, specialism: specialism(id) }))
    .sort((a, b) => b.specialism - a.specialism || b.amount - a.amount || a.id.localeCompare(b.id))
    .map(({ id, amount }) => [id, amount] as const);

  for (const [materialId, amount] of stock) {
    const family = storageFamily(materialId);
    const total = storageUnits(amount);
    const arrival = arrivals[family];
    const ranked = candidates
      .filter(c => c.role !== 'household' || family === 'plant')
      .map(c => {
        const base = affinity(settlement, family, c);
        if (base <= 0 || !hasBay(c.plot.id, c.role, c.development.level, family)) return { c, score: 0 };
        // A yard already holding other families has less wall to stack against.
        const crowding = [...(families.get(c.plot.id) ?? [])].filter(f => f !== family).length * 0.6;
        let toward = 0;
        if (arrival) {
          const dx = c.plot.worldX - settlement.position.x, dz = c.plot.worldZ - settlement.position.z;
          const length = Math.hypot(dx, dz);
          if (length > 0.05) toward = (dx * arrival.x + dz * arrival.z) / length * 0.45;
        }
        return { c, score: base - crowding + toward };
      })
      .filter(entry => entry.score > 0.2)
      .sort((a, b) => b.score - a.score || a.c.plot.id.localeCompare(b.c.plot.id));

    const shares: Array<{ id: string; role: StorageHostRole; level: number; units: number }> = [];
    if (!ranked.length) {
      shares.push({ id: STOCKPILE_HOST_ID, role: 'stockpile', level: 1, units: total });
    } else {
      let remaining = total;
      // Household firewood caches: raw timber only, and only when there is enough to be worth spreading.
      if (materialId === 'timber' && total >= 6) {
        for (const home of households.slice(0, Math.min(2, Math.floor(total / 6)))) {
          shares.push({ id: home.plot.id, role: 'household', level: home.development.level, units: 1 });
          remaining -= 1;
        }
      }
      // Only large stocks overflow, and only into yards nearly as suited as the main one, so each
      // material still reads as belonging to one place.
      const peers = ranked.filter(entry => entry.score >= ranked[0]!.score * 0.75).length;
      const split = peers >= 3 && remaining >= 12 ? [0.6, 0.25, 0.15] : peers >= 2 && remaining >= 9 ? [0.7, 0.3] : [1];
      const counts = split.map(fraction => Math.floor(remaining * fraction));
      counts[0]! += remaining - counts.reduce((sum, n) => sum + n, 0);
      counts.forEach((units, index) => {
        const c = ranked[index]!.c;
        if (units > 0) shares.push({ id: c.plot.id, role: c.role, level: c.development.level, units });
      });
    }
    const unitTotal = shares.reduce((sum, share) => sum + share.units, 0);
    let assigned = 0;
    shares.forEach((share, index) => {
      // The final share takes the remainder so floating point never creates or loses stock.
      const portion = index === shares.length - 1 ? amount - assigned : amount * share.units / unitTotal;
      assigned += portion;
      const allocation: StockAllocation = { materialId, family, hostId: share.id, amount: portion, units: share.units };
      allocations.push(allocation);
      hostFor(share.id, share.role, share.level).allocations.push(allocation);
      const set = families.get(share.id) ?? new Set();
      set.add(family);
      families.set(share.id, set);
    });
  }
  return { maturity, hosts, allocations };
}

// --------------------------------------------------------------------------------------------
// Yard composition

export type YardPrimitiveKind = 'ground' | 'solid' | 'pile' | 'log' | 'drum' | 'clod';

export interface YardPrimitive {
  kind: YardPrimitiveKind;
  cue: string;
  x: number;
  z: number;
  /** Base above local ground, so stacks rest on the course beneath. */
  y: number;
  width: number;
  height: number;
  depth: number;
  yaw: number;
  pitch: number;
  colour: string;
  /** Members of one stack/rack are kept or culled together so nothing floats. */
  group: string;
  /** Visible stock units this primitive represents (0 for fences, tools, roofs). */
  stock: number;
}

export interface YardFrame {
  /** Distance from host centre to the wall the yard is stacked against (0 for open ground). */
  wallOffset: number;
  /** Depth available outward from the wall, inside the host's reserved ground. */
  stripDepth: number;
  /** Lateral width available along the wall. */
  stripWidth: number;
  side: 'rear' | 'front';
  /** -1 or 1: the lateral end facing where materials arrive. Stock fills inward from there. */
  arrivalSign: 1 | -1;
}

const TIMBER_DARK = '#5e4630';
const TIMBER_LIGHT = '#9c7a52';
const ROOF = '#5d4a3a';
const POST = '#5a4535';

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function materialColour(id: string, secondary = false): string {
  if (isMinedMaterial(id)) {
    const profile = mineralVisualProfile(id);
    return secondary ? profile.secondaryColour : profile.baseColour;
  }
  return storedMaterialColour(id);
}

interface Bay { family: StorageFamily; allocations: StockAllocation[]; units: number }

function baysFor(allocations: readonly StockAllocation[]): Bay[] {
  const byFamily = new Map<StorageFamily, Bay>();
  for (const allocation of allocations) {
    const bay = byFamily.get(allocation.family) ?? { family: allocation.family, allocations: [], units: 0 };
    bay.allocations.push(allocation);
    bay.units += allocation.units;
    byFamily.set(allocation.family, bay);
  }
  return [...byFamily.values()].sort((a, b) => b.units - a.units || a.family.localeCompare(b.family));
}

/** Which families a host should stage on its front (access) side rather than in the back yard. */
export function frontStagedFamilies(role: StorageHostRole, maturity: StorageMaturity): ReadonlySet<StorageFamily> {
  return role === 'store' || role === 'trade' ? new Set<StorageFamily>(maturity >= 1 ? ['goods', 'metal'] : []) : new Set();
}

/**
 * Lay out one host's stock against a wall. Bays fill from the arrival end inward; each bay keeps
 * its stock hugging the wall and its work space (chopping block, sawhorse, sorting bench, banker)
 * on the open side, so the yard reads as a place where material is handled, not parked.
 */
export function planYardBays(
  host: StorageHostPlan,
  allocations: readonly StockAllocation[],
  frame: YardFrame,
  seed: string,
): { primitives: YardPrimitive[]; occupiedSigns: Set<1 | -1> } {
  const primitives: YardPrimitive[] = [];
  const occupiedSigns = new Set<1 | -1>();
  const bays = baysFor(allocations).slice(0, host.role === 'household' ? 1 : host.role === 'stockpile' ? 3 : 2);
  if (!bays.length || frame.stripDepth < 0.16 || frame.stripWidth < 0.3) return { primitives, occupiedSigns };
  const m = host.maturity;
  const out = frame.side === 'rear' ? -1 : 1;
  const wallZ = out * (frame.wallOffset + 0.03);
  const random = seeded(`${seed}:${host.hostId}:${frame.side}`);
  const messy = (scale: number) => (m === 0 ? (random() - 0.5) * 2 * scale : (random() - 0.5) * scale * 0.3);
  const bayWidth = Math.min(0.75, Math.max(0.3, frame.stripWidth * (bays.length > 2 ? 0.31 : bays.length > 1 ? 0.42 : 0.5)));
  const stockDepth = Math.min(0.42, Math.max(0.14, frame.stripDepth * 0.55));
  const half = frame.stripWidth / 2;
  // One worn yard floor under every bay and the handling space between them.
  const floorDepth = Math.min(frame.stripDepth * 0.95, stockDepth + 0.34);
  primitives.push({
    kind: 'ground', cue: 'storage-yard', x: 0, z: wallZ + out * floorDepth / 2, y: 0, width: frame.stripWidth * 0.9, height: 0.014,
    depth: floorDepth, yaw: 0, pitch: 0, colour: m === 0 ? '#6e5a44' : m === 1 ? '#76644c' : '#7a7062', group: `${host.hostId}:${frame.side}:floor`, stock: 0,
  });

  bays.forEach((bay, bayIndex) => {
    // First bay at the arrival end, second at the far end: the middle stays open as working floor.
    // Only a free-standing stockpile takes a third, central bay.
    const sign = (bayIndex === 1 ? -frame.arrivalSign : frame.arrivalSign) as 1 | -1;
    occupiedSigns.add(sign);
    const centreX = bayIndex === 2 ? 0 : sign * Math.max(0, half - bayWidth / 2 - 0.02);
    const inward = (bayIndex === 2 ? frame.arrivalSign : -sign) as 1 | -1;
    const groupBase = `${host.hostId}:${frame.side}:${bay.family}`;
    let piece = 0;
    const put = (
      kind: YardPrimitiveKind, cue: string, u: number, v: number, y: number,
      width: number, height: number, depth: number, colour: string,
      options: { group?: string; yaw?: number; pitch?: number; stock?: number } = {},
    ) => {
      primitives.push({
        kind, cue, x: centreX + u, z: wallZ + out * v, y, width, height, depth,
        yaw: options.yaw ?? 0, pitch: options.pitch ?? 0, colour,
        group: options.group ?? `${groupBase}:${piece++}`, stock: options.stock ?? 0,
      });
    };
    const stackGroup = `${groupBase}:stack`;
    const workU = bayIndex === 2 ? 0 : inward * (bayWidth / 2 + 0.1);
    const workV = bayIndex === 2 ? stockDepth + 0.14 : stockDepth * 0.6 + 0.08;
    const shed = (height: number) => {
      // Lean-to against the wall: high at the wall, falling toward the working floor. Household
      // caches stay open; sheds belong to yards that hold real working stock.
      if (host.role === 'household') return;
      const roofDepth = stockDepth + 0.08;
      const fall = Math.sin(0.22) * (roofDepth + 0.06) / 2;
      for (const end of [-1, 1]) put('solid', 'storage-shed', end * (bayWidth / 2 + 0.01), roofDepth, 0, 0.035, height - fall, 0.035, POST, { group: stackGroup });
      put('solid', 'storage-shed', 0, roofDepth / 2, height, bayWidth + 0.1, 0.025, roofDepth + 0.06, ROOF, { group: stackGroup, pitch: out * 0.22 });
    };
    const pallet = (u: number, v: number, width: number, depth: number) =>
      put('solid', 'pallet', u, v, 0, width, 0.022, depth, TIMBER_LIGHT, { group: stackGroup });
    const fenceEnd = () => {
      // Yard edge on the outer lateral end, open toward the working floor.
      if (host.role === 'household') return;
      const u = sign * (bayWidth / 2 + 0.03);
      for (const v of [0.02, stockDepth * 0.5, stockDepth + 0.02]) put('solid', 'yard-fence', u, v, 0, 0.03, 0.15, 0.03, POST, { group: stackGroup });
      put('solid', 'yard-fence', u, stockDepth * 0.5 + 0.01, 0.1, 0.022, 0.022, stockDepth + 0.04, POST, { group: stackGroup });
    };

    if (bay.family === 'timber') {
      const logsId = bay.allocations.find(a => !/lumber|frame|plank/.test(a.materialId));
      const boardsId = bay.allocations.find(a => /lumber|frame|plank/.test(a.materialId));
      const logUnits = logsId?.units ?? 0;
      const length = Math.min(bayWidth * 0.88, 0.6);
      const diameter = Math.min(0.095, 0.06 + logUnits * 0.0025);
      const perCourse = Math.max(2, Math.floor(stockDepth / diameter));
      // Four courses at most, so a stack stays under its lean-to and reads as stacked, not heaped.
      const courseCapacity = (course: number) => Math.max(1, perCourse - Math.floor(course / 2));
      const logs = Math.min(18, logUnits * 2, [0, 1, 2, 3].reduce((sum, course) => sum + courseCapacity(course), 0));
      if (logs > 0) {
        if (m >= 1) for (const end of [-1, 1]) put('log', 'log-bearer', end * length * 0.32, stockDepth / 2, 0, stockDepth + 0.02, 0.03, 0.03, TIMBER_DARK, { group: stackGroup, yaw: Math.PI / 2 });
        const base = m >= 1 ? 0.028 : 0;
        let placed = 0;
        for (let course = 0; placed < logs; course += 1) {
          const inCourse = courseCapacity(course);
          for (let n = 0; n < inCourse && placed < logs; n += 1, placed += 1) {
            const v = (n + 0.5 + (perCourse - inCourse) * 0.5) * diameter;
            put('log', 'stock:timber', messy(0.03), v, base + course * diameter * 0.87, length * (1 + messy(0.08)), diameter, diameter,
              placed % 3 === 0 ? TIMBER_LIGHT : '#7a5a3c', { group: stackGroup, yaw: messy(0.14), stock: logUnits / logs });
          }
        }
        if (m >= 1) for (const end of [-1, 1]) put('solid', 'stack-post', end * (length / 2 + 0.025), stockDepth / 2, 0, 0.03, 0.06 + Math.min(4, Math.ceil(logs / perCourse)) * diameter * 0.87, 0.03, POST, { group: stackGroup });
      }
      if (boardsId) {
        // Cut lumber on a rack: boards flat on stickers, kept off the ground.
        const boards = Math.min(10, boardsId.units * 2);
        const rackV = logs > 0 ? stockDepth + 0.08 : stockDepth * 0.5;
        const rackGroup = `${groupBase}:rack`;
        const lift = m >= 1 ? 0.08 : 0.02;
        if (m >= 1) for (const end of [-1, 1]) put('solid', 'lumber-rack', end * length * 0.4, rackV, 0, 0.03, lift, 0.12, POST, { group: rackGroup });
        for (let n = 0; n < boards; n += 1) {
          put('solid', 'stock:timber', messy(0.02), rackV, lift + n * 0.018, length * 0.95, 0.014, 0.1, n % 2 ? TIMBER_LIGHT : '#a88458',
            { group: rackGroup, yaw: messy(0.06), stock: boardsId.units / boards });
        }
      }
      // Work space: chopping block with chips, or a sawhorse holding a log.
      const tools = `${groupBase}:work`;
      put('drum', 'work:chopping', workU, workV, 0, 0.09, 0.08, 0.09, TIMBER_DARK, { group: tools });
      put('ground', 'work:chips', workU, workV, 0, 0.22, 0.008, 0.18, '#9a8063', { group: tools });
      if (m >= 1) {
        const sawU = workU + inward * 0.18;
        for (const end of [-1, 1]) put('solid', 'work:sawhorse', sawU, workV + end * 0.05, 0, 0.16, 0.1, 0.022, POST, { group: `${tools}:saw` });
        put('log', 'work:sawhorse', sawU, workV, 0.1, 0.3, 0.045, 0.045, '#7a5a3c', { group: `${tools}:saw` });
      }
      if (m >= 2) shed(0.5);
      else if (m >= 1) fenceEnd();
    } else if (bay.family === 'stone') {
      bay.allocations.forEach((allocation, index) => {
        const dressed = /dressed|masonry|block/.test(allocation.materialId);
        const group = `${stackGroup}:${index}`;
        const offset = (index === 0 ? 0 : inward * bayWidth * 0.32);
        if (dressed) {
          if (m >= 1) pallet(offset, stockDepth / 2, bayWidth * 0.55, stockDepth * 0.8);
          const blocks = Math.min(12, allocation.units * 2);
          const base = m >= 1 ? 0.022 : 0;
          for (let n = 0; n < blocks; n += 1) {
            const course = Math.floor(n / 4), slot = n % 4;
            put('solid', 'stock:stone', offset + ((slot % 2) - 0.5) * 0.12 + messy(0.02), stockDepth * (0.3 + Math.floor(slot / 2) * 0.4),
              base + course * 0.07, 0.11, 0.065, 0.09, n % 3 ? '#8e8878' : '#a29c8c', { group, stock: allocation.units / blocks, yaw: messy(0.1) });
          }
        } else {
          // Rubble heap: wide base, mounded crown, against the wall.
          const pieces = Math.min(12, 2 + allocation.units);
          for (let n = 0; n < pieces; n += 1) {
            const ring = n < 6 ? 0 : n < 10 ? 1 : 2;
            const angle = n * 2.399 + random() * 0.4;
            const spread = (0.2 - ring * 0.065) * Math.min(1.3, 0.7 + allocation.units * 0.06);
            const size = 0.12 - ring * 0.016 + random() * 0.025;
            put('pile', 'stock:stone', offset + Math.cos(angle) * spread, stockDepth * 0.5 + Math.sin(angle) * spread * 0.6, ring * 0.045,
              size, size * 0.75, size, materialColour(allocation.materialId, n % 2 === 1), { group, stock: allocation.units / pieces, yaw: angle });
          }
        }
      });
      if (m >= 1) fenceEnd();
      put('solid', 'work:banker', workU, workV, 0, 0.14, 0.09, 0.12, '#7d776b', { group: `${groupBase}:work` });
      put('ground', 'work:chips', workU, workV, 0, 0.24, 0.008, 0.2, '#99928a', { group: `${groupBase}:work` });
    } else if (bay.family === 'ore' || bay.family === 'clay') {
      // Sorted heaps: one bin per material, side by side along the wall.
      const count = Math.min(3, bay.allocations.length);
      const binWidth = Math.min(0.3, bayWidth / count);
      bay.allocations.slice(0, count).forEach((allocation, index) => {
        const u = (index - (count - 1) / 2) * binWidth;
        const group = `${stackGroup}:${index}`;
        const wet = bay.family === 'clay' && !/ash|brick/.test(allocation.materialId);
        if (m >= 1) {
          for (const end of [-1, 1]) put('solid', 'storage-bin', u + end * binWidth * 0.46, stockDepth * 0.45, 0, 0.025, 0.1, stockDepth * 0.85, POST, { group });
          put('solid', 'storage-bin', u, 0.02, 0, binWidth * 0.94, 0.1, 0.025, POST, { group });
        } else {
          put('ground', 'sorting-pad', u, stockDepth * 0.45, 0, binWidth * 0.95, 0.01, stockDepth * 0.85, wet ? '#6a5040' : '#6c6253', { group });
        }
        if (/brick/.test(allocation.materialId)) {
          const bricks = Math.min(10, allocation.units * 2);
          for (let n = 0; n < bricks; n += 1) {
            put('solid', `stock:${bay.family}`, u + ((n % 2) - 0.5) * binWidth * 0.4, stockDepth * 0.45, Math.floor(n / 2) * 0.03,
              binWidth * 0.36, 0.028, 0.07, materialColour(allocation.materialId), { group, stock: allocation.units / bricks });
          }
          return;
        }
        const pieces = Math.min(9, 1 + allocation.units);
        for (let n = 0; n < pieces; n += 1) {
          const ring = n < 5 ? 0 : 1;
          const angle = n * 2.399 + random() * 0.5;
          const spread = binWidth * (ring ? 0.12 : 0.24);
          const size = (wet ? 0.11 : 0.085) + random() * 0.02;
          put(wet ? 'clod' : 'pile', `stock:${bay.family}`, u + Math.cos(angle) * spread, stockDepth * 0.45 + Math.sin(angle) * spread,
            ring * 0.03, size, size * (wet ? 0.5 : 0.7), size, materialColour(allocation.materialId, n % 2 === 1),
            { group, stock: allocation.units / pieces, yaw: angle });
        }
      });
      const work = `${groupBase}:work`;
      if (bay.family === 'clay') {
        put('solid', 'work:wedging-bench', workU, workV, 0, 0.16, 0.09, 0.1, TIMBER_LIGHT, { group: work });
        if (m >= 1) put('solid', 'work:water-trough', workU + inward * 0.16, workV, 0, 0.1, 0.05, 0.08, '#5f6c69', { group: work });
      } else {
        put(m >= 1 ? 'solid' : 'pile', 'work:sorting', workU, workV, 0, m >= 1 ? 0.15 : 0.08, m >= 1 ? 0.085 : 0.05, m >= 1 ? 0.1 : 0.08,
          m >= 1 ? TIMBER_LIGHT : '#6f675c', { group: work });
      }
      if (m >= 2) shed(0.3);
    } else if (bay.family === 'plant') {
      if (m >= 1) {
        for (const end of [-1, 1]) put('solid', 'drying-rack', end * bayWidth * 0.36, stockDepth * 0.5, 0, 0.025, 0.24, 0.025, POST, { group: stackGroup });
        put('solid', 'drying-rack', 0, stockDepth * 0.5, 0.22, bayWidth * 0.76, 0.018, 0.018, POST, { group: stackGroup });
      }
      bay.allocations.forEach(allocation => {
        const bundles = Math.min(8, 1 + allocation.units);
        for (let n = 0; n < bundles; n += 1) {
          const u = (n / Math.max(1, bundles - 1) - 0.5) * bayWidth * 0.66;
          if (m >= 1) put('clod', 'stock:plant', u, stockDepth * 0.5, 0.1, 0.04, 0.12, 0.04, materialColour(allocation.materialId), { group: stackGroup, stock: allocation.units / bundles });
          else put('clod', 'stock:plant', u + messy(0.03), stockDepth * 0.35 + messy(0.04), 0, 0.05, 0.13, 0.05, materialColour(allocation.materialId), { group: stackGroup, pitch: out * 0.3, stock: allocation.units / bundles });
        }
      });
    } else {
      // Metals and finished goods: protected, counted storage — ingots on pallets, crates, casks.
      let slot = 0;
      bay.allocations.slice(0, 3).forEach(allocation => {
        const u = (slot++ - 1) * bayWidth * 0.32;
        const group = `${stackGroup}:${allocation.materialId}`;
        const colour = materialColour(allocation.materialId);
        if (m >= 1) pallet(u, stockDepth / 2, bayWidth * 0.28, stockDepth * 0.8);
        const base = m >= 1 ? 0.022 : 0;
        if (bay.family === 'metal') {
          const ingots = Math.min(12, allocation.units * 2);
          for (let n = 0; n < ingots; n += 1) {
            const course = Math.floor(n / 3);
            const across = course % 2 === 1;
            put('solid', 'stock:metal', u + (across ? 0 : (n % 3 - 1) * 0.045), stockDepth / 2 + (across ? (n % 3 - 1) * 0.045 : 0), base + course * 0.026,
              0.12, 0.024, 0.04, colour, { group, yaw: across ? Math.PI / 2 : 0, stock: allocation.units / ingots });
          }
        } else if (/nuclear|spent/.test(allocation.materialId)) {
          const casks = Math.min(4, allocation.units);
          for (let n = 0; n < casks; n += 1) put('drum', 'stock:goods', u + ((n % 2) - 0.5) * 0.08, stockDepth * (0.3 + Math.floor(n / 2) * 0.4), base, 0.07, 0.11, 0.07, '#8b9180', { group, stock: allocation.units / casks });
        } else {
          const crates = Math.min(8, allocation.units);
          for (let n = 0; n < crates; n += 1) {
            const course = Math.floor(n / 3);
            put('solid', 'stock:goods', u + ((n % 3) - 1) * 0.05 + messy(0.015), stockDepth * 0.5 + ((n % 2) - 0.5) * 0.08, base + course * 0.095,
              0.11, 0.09, 0.11, n % 2 ? '#8e6d48' : colour, { group, yaw: messy(0.2), stock: allocation.units / crates });
          }
        }
      });
      if (m >= 2) shed(0.32);
      else if (m >= 1) fenceEnd();
    }
  });
  return { primitives, occupiedSigns };
}

/** Local side (+1/-1 along the wall) whose end faces the real arrival direction for a host. */
export function arrivalSignFor(direction: Vec2 | undefined, rotationY: number, fallbackSeed: string): 1 | -1 {
  if (direction) {
    // Placement local x axis expressed in world space for rotation about Y.
    const lateral = Math.cos(rotationY) * direction.x - Math.sin(rotationY) * direction.z;
    if (Math.abs(lateral) > 0.08) return lateral >= 0 ? 1 : -1;
  }
  return seeded(fallbackSeed)() < 0.5 ? -1 : 1;
}

export function dominantArrival(host: StorageHostPlan, arrivals: StorageArrivals): Vec2 | undefined {
  const lead = [...host.allocations].sort((a, b) => b.units - a.units || a.materialId.localeCompare(b.materialId))[0];
  return lead ? arrivals[lead.family] : undefined;
}
