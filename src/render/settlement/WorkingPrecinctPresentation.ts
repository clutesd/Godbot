import * as THREE from 'three';
import type { Settlement, SimulationState, StructurePlot } from '../../sim/types';
import type { SettlementNeed, StructureDevelopment, StructureMaterial } from '../../sim/development/types';
import { movementPathStage } from '../../sim/environment/PathEvolution';
import { cellAt } from '../../sim/world';
import {
  STOCKPILE_HOST_ID, arrivalSignFor, dominantArrival, frontStagedFamilies, planSettlementStorage, planYardBays, storageArrivals,
  type SettlementStoragePlan, type StorageArrivals, type YardFrame, type YardPrimitive,
} from './StorageYardPresentation';

export type PrecinctCue =
  | 'working-ground'
  | 'gathering-space'
  | 'loading-apron'
  | 'work-surface'
  | 'storage-surface'
  | 'domestic-yard'
  | 'entrance-wear'
  | 'mud'
  | 'ash-refuse'
  | 'drainage-cut'
  | 'garden-edge'
  | 'timber-working'
  | 'livestock-wear'
  | 'fence'
  | 'sacred-marker'
  | 'water-handling'
  | 'stock:food'
  | 'stock:goods'
  /** Storage-yard cues (`stock:timber`, `work:chopping`, `storage-shed`, ...) from StorageYardPresentation. */
  | (string & {});

type PrecinctPrimitiveKind = 'ground' | 'solid' | 'pile' | 'log' | 'drum' | 'clod';
/**
 * Bulk aggregates that are not aliases of `localMaterials`. `resources.wood`/`minerals` are published
 * from `localMaterials.timber`/`stone`, so they appear only through the storage-yard grammar.
 */
type BulkStock = 'food' | 'goods';

export interface PrecinctPlacement {
  key: string;
  worldX: number;
  worldZ: number;
  width: number;
  depth: number;
  rotationY: number;
}

export interface PrecinctPrimitive {
  kind: PrecinctPrimitiveKind;
  cue: PrecinctCue;
  x: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  yaw: number;
  colour: string;
  /** Solid work props keep off cells already carrying authoritative movement wear. */
  keepPathClear: boolean;
  /** Base above local ground for stacked courses. */
  y?: number;
  pitch?: number;
  /** Stack members are validated together: one culled member culls the stack, so nothing floats. */
  group?: string;
  /** Visible stock units represented (storage-yard primitives only). */
  stock?: number;
}

export interface WorkingPrecinctPlan {
  plotId: string;
  need: SettlementNeed;
  form: StructureDevelopment['form'];
  primitives: PrecinctPrimitive[];
}

const MATERIAL_COLOURS: Record<StructureMaterial, string> = {
  earth: '#705d48',
  timber: '#6a5139',
  masonry: '#777168',
  ceramic: '#8a5f4b',
  metal: '#555b60',
};

const NEED_GROUND: Record<SettlementNeed, string> = {
  food: '#776844',
  housing: '#78624d',
  trade: '#75654f',
  government: '#77705f',
  security: '#665d50',
  religion: '#756d5b',
  knowledge: '#716b59',
  healthcare: '#746e62',
  manufacturing: '#665647',
  transport: '#6c604e',
  energy: '#5f5548',
  water: '#6f746c',
  memory: '#706958',
};

const STOCK_COLOURS: Record<BulkStock, string> = {
  food: '#8a7442',
  goods: '#7b6955',
};

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

function activeDevelopment(plot: StructurePlot): StructureDevelopment | undefined {
  const development = plot.development;
  if (!development || development.status !== 'active' || plot.condition <= 0.08 || development.memorial) return undefined;
  return development;
}

function resourceEligible(development: StructureDevelopment, stock: BulkStock): boolean {
  if (stock === 'food') return development.need === 'food' || development.form === 'store' && (development.services.food ?? 0) > 0;
  return ['trade', 'transport', 'manufacturing'].includes(development.need) || development.form === 'store';
}

/**
 * A settlement stock is shown at one deterministic precinct at most. This prevents a renderer-only
 * projection from visually multiplying authoritative inventory across every workshop or store.
 */
export function precinctStockOwner(settlement: Settlement, stock: BulkStock): string | undefined {
  return (settlement.structurePlots ?? [])
    .filter(plot => {
      const development = activeDevelopment(plot);
      return development ? resourceEligible(development, stock) : false;
    })
    // Match the renderer's stable "oldest specialist first" bias so the authoritative stock owner
    // stays inside the bounded establishing-shot sample whenever an eligible site is visible.
    .sort((a, b) => a.foundedMonth - b.foundedMonth || a.id.localeCompare(b.id))[0]?.id;
}

function capability(development: StructureDevelopment, id: string): boolean {
  return development.capabilities.includes(id);
}

function chordWidth(radius: number, z: number, depth: number): number {
  const outerZ = Math.min(radius - 0.025, Math.abs(z) + depth / 2);
  return Math.max(0.12, Math.sqrt(Math.max(0.01, radius * radius - outerZ * outerZ)) * 2 * 0.88);
}

/**
 * Pure documentary projection from authoritative structure + settlement state.
 * It never mutates state, creates services, or synthesizes inventory/activity.
 */
export interface PrecinctStorageContext {
  /** Settlement-wide allocation of `localMaterials`; derived from the settlement alone when omitted. */
  plan?: SettlementStoragePlan;
  arrivals?: StorageArrivals;
  seed?: string;
}

export function planWorkingPrecinct(
  settlement: Settlement,
  plot: StructurePlot,
  placement: Pick<PrecinctPlacement, 'width' | 'depth'> & Partial<Pick<PrecinctPlacement, 'rotationY'>>,
  groundHistory?: { month: number; moisture: number },
  storage: PrecinctStorageContext = {},
): WorkingPrecinctPlan | undefined {
  const development = activeDevelopment(plot);
  if (!development) return undefined;

  const primitives: PrecinctPrimitive[] = [];
  const level = clamp(development.level, 1, 3);
  const condition = clamp(plot.condition, 0.2, 1);
  const fit = Math.min(1, 0.64 + level * 0.12);
  const bodyDepth = placement.depth * fit;
  const spareZ = Math.max(0.14, plot.radius - bodyDepth / 2 - 0.03);
  const stripDepth = clamp(spareZ * 0.74, 0.14, Math.max(0.18, plot.radius * 0.38));
  const frontZ = bodyDepth / 2 + stripDepth * 0.5;
  const rearZ = -frontZ;
  const frontWidth = Math.min(placement.width * 0.94, chordWidth(plot.radius, frontZ, stripDepth));
  const rearWidth = Math.min(placement.width * 0.94, chordWidth(plot.radius, rearZ, stripDepth));
  const surfaceColour = MATERIAL_COLOURS[development.material];
  const groundColour = NEED_GROUND[development.need];
  const propHeight = (0.12 + level * 0.025) * (0.62 + condition * 0.38);

  const add = (
    kind: PrecinctPrimitiveKind,
    cue: PrecinctCue,
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    colour: string,
    keepPathClear = kind !== 'ground',
    yaw = 0,
  ) => primitives.push({ kind, cue, x, z, width, height, depth, yaw, colour, keepPathClear });

  // Storage yards are laid out first: stock claims wall-side bays at the arrival end, and generic
  // tables yield those bays so material and its handling space read as one working area.
  const occupied: Record<'front' | 'rear', Set<1 | -1>> = { front: new Set(), rear: new Set() };
  const host = (storage.plan ?? planSettlementStorage(settlement, storage.arrivals)).hosts.get(plot.id);
  if (host) {
    const front = frontStagedFamilies(host.role, host.maturity);
    const arrivalSign = arrivalSignFor(dominantArrival(host, storage.arrivals ?? {}), placement.rotationY ?? 0,
      `${storage.seed ?? settlement.id}:${plot.id}`);
    for (const side of ['rear', 'front'] as const) {
      const allocations = host.allocations.filter(allocation => front.has(allocation.family) === (side === 'front'));
      if (!allocations.length) continue;
      const frame: YardFrame = {
        wallOffset: bodyDepth / 2,
        stripDepth: Math.max(0, plot.radius - bodyDepth / 2 - 0.06),
        stripWidth: side === 'front' ? frontWidth : rearWidth,
        side,
        arrivalSign,
      };
      const yard = planYardBays(host, allocations, frame, storage.seed ?? settlement.id);
      for (const primitive of yard.primitives) primitives.push(yardPrimitive(primitive));
      for (const sign of yard.occupiedSigns) occupied[side].add(sign);
    }
  }

  const pad = (cue: PrecinctCue, side: 'front' | 'rear', scale = 1) => {
    const z = side === 'front' ? frontZ : rearZ;
    const width = (side === 'front' ? frontWidth : rearWidth) * scale;
    add('ground', cue, 0, z, width, 0.018, stripDepth * 0.94, groundColour, false);
  };

  if (groundHistory) {
    const age = clamp((groundHistory.month - plot.foundedMonth) / 120, 0, 1);
    if (age > 0) {
      // Occupation wears entrances first, then spreads into yards. These patches
      // represent local use; connecting paths remain earned by actual foot traffic.
      add('ground', groundHistory.moisture > 0.6 ? 'mud' : 'entrance-wear',
        0, frontZ, frontWidth * (0.28 + age * 0.6), 0.028,
        stripDepth * (0.35 + age * 0.6), groundHistory.moisture > 0.6 ? '#554738' : '#88735a', false);
      if (age > 0.15 && ['housing', 'food', 'manufacturing', 'energy'].includes(development.need)) {
        add('ground', 'ash-refuse', rearWidth * 0.27, rearZ, rearWidth * 0.2,
          0.028, stripDepth * 0.48 * age, '#514b43', false, 0.17);
      }
      if (age > 0.3 && groundHistory.moisture > 0.6) {
        add('ground', 'drainage-cut', -frontWidth * 0.38, frontZ, 0.045,
          0.028, stripDepth * 0.85, '#494336', false, 0.12);
      }
      if (development.need === 'housing' && age > 0.25) {
        add('ground', 'garden-edge', -rearWidth * 0.25, rearZ, rearWidth * 0.27,
          0.028, stripDepth * 0.65, '#655e3c', false);
      }
      if (development.need === 'manufacturing' && development.material === 'timber') {
        add('ground', 'timber-working', -rearWidth * 0.25, rearZ, rearWidth * 0.3,
          0.028, stripDepth * 0.7 * age, '#96805b', false);
      }
      if (development.need === 'food' && capability(development, 'animal-husbandry')) {
        add('ground', 'livestock-wear', 0, rearZ, rearWidth * 0.55,
          0.028, stripDepth * 0.6 * age, '#6b5b3f', false);
      }
    }
  }

  const table = (cue: PrecinctCue, side: 'front' | 'rear', lateral = 1, scale = 1) => {
    const z = (side === 'front' ? frontZ : rearZ) + (side === 'front' ? -1 : 1) * stripDepth * 0.04;
    const available = side === 'front' ? frontWidth : rearWidth;
    const width = clamp(available * 0.25 * scale, 0.24, 0.62);
    if (occupied[side].has(lateral >= 0 ? 1 : -1)) return;
    const x = lateral * Math.max(width * 0.62, available * 0.27);
    add('solid', cue, x, z, width, propHeight, 0.16 + level * 0.02, surfaceColour);
  };

  const rearFence = (density = 1) => {
    const z = -Math.min(plot.radius * 0.76, bodyDepth / 2 + stripDepth * 0.88);
    const width = chordWidth(plot.radius, z, 0.06) * 0.88;
    const segments = density >= 1.5 ? 3 : 2;
    const gap = width * 0.16;
    const segmentWidth = Math.max(0.16, (width - gap) / segments);
    for (let index = 0; index < segments; index += 1) {
      const x = -width / 2 + segmentWidth / 2 + index * segmentWidth + (index >= Math.ceil(segments / 2) ? gap : 0);
      add('solid', 'fence', x, z, segmentWidth * 0.88, 0.12 + level * 0.025, 0.045, surfaceColour);
    }
  };

  const sideMarkers = (cue: PrecinctCue, front = true) => {
    const z = front ? frontZ : rearZ;
    const width = front ? frontWidth : rearWidth;
    for (const sign of [-1, 1]) add('solid', cue, sign * Math.max(0.16, width * 0.42), z, 0.055, 0.2 + level * 0.035, 0.055, surfaceColour);
  };

  const addStock = (stock: BulkStock, side: 'front' | 'rear' = 'rear') => {
    const amount = Math.max(0, settlement.resources[stock]);
    if (amount <= 0.25 || precinctStockOwner(settlement, stock) !== plot.id) return;
    const count = Math.min(3, Math.max(1, Math.ceil(Math.log2(amount + 1) / 2)));
    const z = (side === 'front' ? frontZ : rearZ) + (side === 'front' ? 1 : -1) * stripDepth * 0.05;
    const width = side === 'front' ? frontWidth : rearWidth;
    for (let index = 0; index < count; index += 1) {
      const sign = index % 2 === 0 ? -1 : 1;
      const row = Math.floor(index / 2);
      const size = clamp(0.13 + Math.log2(amount + 1) * 0.018, 0.14, 0.25);
      add('pile', `stock:${stock}` as PrecinctCue, sign * Math.max(size, width * (0.28 + row * 0.08)), z + row * size * 0.7,
        size, size * 0.72, size, STOCK_COLOURS[stock]);
    }
  };

  const formalForecourt = development.form === 'gathering' || development.form === 'hall'
    || development.form === 'sanctuary' || development.need === 'government'
    || development.need === 'religion' || development.need === 'knowledge' || development.need === 'healthcare';

  if (development.need === 'housing' || development.form === 'dwelling') {
    pad('domestic-yard', 'rear', 0.9);
    rearFence(1);
    if ((development.services.housing ?? 0) > 0.5 && level >= 2) table('storage-surface', 'rear', 1, 0.75);
  }

  if (development.need === 'food') {
    // FarmFieldRenderer remains authoritative for cultivated acreage; this is only the working edge.
    pad(development.form === 'field' ? 'working-ground' : 'storage-surface', 'rear', development.form === 'field' ? 0.72 : 0.96);
    if (development.form !== 'field' || level >= 2) table('storage-surface', 'rear', -1, 0.9);
    if ((settlement.agriculture?.production ?? 0) > 0 || development.form !== 'field') addStock('food');
    if (settlement.specialization === 'agriculture' && (settlement.agriculture?.labour ?? 0) > 0) {
      table('work-surface', 'rear', 1, 0.82);
    }
  }

  if (development.need === 'trade' || development.need === 'transport') {
    pad('loading-apron', 'front', 1);
    table(development.need === 'trade' ? 'work-surface' : 'storage-surface', 'front', -1, 0.95);
    if (level >= 2 || capability(development, 'counting-measure')) table('work-surface', 'front', 1, 0.8);
    if (capability(development, 'improved-roads') || capability(development, 'wheel-axle')) pad('loading-apron', 'rear', 0.8);
    addStock('goods', 'rear');
  }

  if (development.need === 'manufacturing' || development.form === 'workshop') {
    pad('working-ground', 'rear', 1);
    table('work-surface', 'rear', -1, 1);
    if (level >= 2 || capability(development, 'precision-tools') || capability(development, 'mechanical-power')) {
      table('work-surface', 'rear', 1, 1.08);
    }
    if (settlement.specialization === 'craft') table('storage-surface', 'front', 1, 0.72);
    addStock('goods');
  }

  if (development.need === 'energy') {
    pad('working-ground', 'rear', 0.94);
    table('work-surface', 'rear', 1, 0.92);
  }

  if (development.need === 'water') {
    pad('gathering-space', 'front', 0.9);
    if ((development.services.water ?? 0) > 0) {
      const width = clamp(frontWidth * 0.34, 0.28, 0.62);
      add('solid', 'water-handling', -Math.max(0.18, frontWidth * 0.26), frontZ, width, 0.13, 0.18, '#64706b');
    }
  }

  if (development.need === 'security' || development.form === 'tower') {
    pad('working-ground', 'rear', 0.92);
    rearFence(1.7);
    sideMarkers('fence', false);
  }

  if (formalForecourt) {
    pad('gathering-space', 'front', development.form === 'sanctuary' ? 0.92 : 1);
    if (development.need === 'religion' || development.form === 'sanctuary') {
      sideMarkers('sacred-marker', true);
      if (level >= 2) add('solid', 'sacred-marker', 0, frontZ + stripDepth * 0.2, 0.075, 0.24 + level * 0.04, 0.075, surfaceColour);
    } else {
      table('work-surface', 'front', -1, 0.9);
      if (level >= 2 || capability(development, 'durable-records')) table('work-surface', 'front', 1, 0.82);
    }
  }

  // Form-level storage remains visible even when storage is serving another primary need.
  if (development.form === 'store' && !['food', 'trade', 'transport'].includes(development.need)) {
    pad('storage-surface', 'rear', 0.92);
    table('storage-surface', 'rear', -1, 0.85);
  }

  // Authoritative service combinations can add a small secondary cue without changing the site's identity.
  if ((development.services.trade ?? 0) > 0 && development.need !== 'trade' && frontWidth > 0.45) {
    table('work-surface', 'front', 1, 0.64);
  }
  if ((development.services.food ?? 0) > 0 && development.need !== 'food' && development.form === 'store') addStock('food');
  if ((development.services.water ?? 0) > 0 && development.need === 'healthcare') {
    add('solid', 'water-handling', Math.max(0.18, frontWidth * 0.3), frontZ, 0.28, 0.1, 0.16, '#68736e');
  }

  return { plotId: plot.id, need: development.need, form: development.form, primitives };
}

function terrainVariance(heightAt: (x: number, z: number) => number, worldX: number, worldZ: number, yaw: number, width: number, depth: number): number {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const hx = width * 0.5, hz = depth * 0.5;
  const samples = [
    heightAt(worldX, worldZ),
    heightAt(worldX + c * hx + s * hz, worldZ - s * hx + c * hz),
    heightAt(worldX - c * hx + s * hz, worldZ + s * hx + c * hz),
    heightAt(worldX + c * hx - s * hz, worldZ - s * hx - c * hz),
    heightAt(worldX - c * hx - s * hz, worldZ + s * hx - c * hz),
  ];
  return Math.max(...samples) - Math.min(...samples);
}

function wornPathAt(state: SimulationState, worldX: number, worldZ: number): boolean {
  const cell = cellAt(state.world, worldX, worldZ);
  return Boolean(cell && movementPathStage(cell) !== 'none');
}

function yardPrimitive(primitive: YardPrimitive): PrecinctPrimitive {
  return {
    kind: primitive.kind, cue: primitive.cue, x: primitive.x, z: primitive.z, width: primitive.width, height: primitive.height,
    depth: primitive.depth, yaw: primitive.yaw, colour: primitive.colour, keepPathClear: primitive.kind !== 'ground',
    y: primitive.y, pitch: primitive.pitch, group: primitive.group, stock: primitive.stock,
  };
}

interface InstanceRecord {
  primitive: PrecinctPrimitive;
  localX: number;
  localZ: number;
  yaw: number;
  y: number;
}

/** A host frame: a real structure plot, or the settlement's one common open-air stockpile. */
interface PrecinctFrame { worldX: number; worldZ: number; radius: number; rotationY: number }

function primitiveFitsPlot(plot: Pick<StructurePlot, 'radius'>, primitive: PrecinctPrimitive): boolean {
  const c = Math.cos(primitive.yaw), s = Math.sin(primitive.yaw);
  const halfWidth = primitive.width * 0.5, halfDepth = primitive.depth * 0.5;
  for (const [dx, dz] of [[-halfWidth, -halfDepth], [-halfWidth, halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth]] as const) {
    const x = primitive.x + dx * c + dz * s;
    const z = primitive.z - dx * s + dz * c;
    if (Math.hypot(x, z) > plot.radius + 0.025) return false;
  }
  return true;
}

/**
 * Builds three instanced draw pools for the whole settlement: low ground signatures, solid work
 * furniture/fences, and real-stock piles. It is intentionally cheap enough to survive wide shots.
 */
export function createWorkingPrecinctLayer(
  state: SimulationState,
  settlement: Settlement,
  placements: readonly PrecinctPlacement[],
  settlementY: number,
  heightAt: (x: number, z: number) => number,
  /** Renderer footprint query; the common stockpile must not sit on tents, stalls or other props. */
  isAreaClear: (worldX: number, worldZ: number, radius: number) => boolean = () => true,
  seed = settlement.id,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `working-precincts:${settlement.id}`;
  const placementById = new Map(placements.map(placement => [placement.key, placement]));
  const records: Record<PrecinctPrimitiveKind, InstanceRecord[]> = { ground: [], solid: [], pile: [], log: [], drum: [], clod: [] };
  const needCounts: Partial<Record<SettlementNeed, number>> = {};
  const arrivals = storageArrivals(state, settlement);
  const storagePlan = planSettlementStorage(settlement, arrivals);
  let stockUnits = 0;

  const place = (frame: PrecinctFrame, primitives: readonly PrecinctPrimitive[]) => {
    const c = Math.cos(frame.rotationY), s = Math.sin(frame.rotationY);
    const groups = new Map<string, PrecinctPrimitive[]>();
    primitives.forEach((primitive, index) => {
      const key = primitive.group ?? `single:${index}`;
      const members = groups.get(key) ?? [];
      members.push(primitive);
      groups.set(key, members);
    });
    for (const members of groups.values()) {
      const pending: Array<{ primitive: PrecinctPrimitive; worldX: number; worldZ: number; yaw: number; ground: number }> = [];
      let valid = true;
      for (const primitive of members) {
        // Hard stop at the real reserved plot. Ground and props never claim new settlement land.
        if (!primitiveFitsPlot(frame, primitive)) { valid = false; break; }
        const worldX = frame.worldX + primitive.x * c + primitive.z * s;
        const worldZ = frame.worldZ - primitive.x * s + primitive.z * c;
        if (primitive.keepPathClear && wornPathAt(state, worldX, worldZ)) { valid = false; break; }
        const yaw = frame.rotationY + primitive.yaw;
        const variance = terrainVariance(heightAt, worldX, worldZ, yaw, primitive.width, primitive.depth);
        // Large rigid presentation slabs should disappear rather than hover across steep ground.
        if (variance > (primitive.kind === 'ground' ? 0.2 : 0.28)) { valid = false; break; }
        pending.push({ primitive, worldX, worldZ, yaw, ground: heightAt(worldX, worldZ) });
      }
      if (!valid) continue;
      // A stack settles on its lowest support so upper courses never float over a dip.
      const stackGround = members.length > 1 ? Math.min(...pending.map(entry => entry.ground)) : pending[0]?.ground ?? 0;
      for (const entry of pending) {
        const { primitive } = entry;
        stockUnits += primitive.stock ?? 0;
        records[primitive.kind].push({
          primitive,
          localX: entry.worldX - settlement.position.x,
          localZ: entry.worldZ - settlement.position.z,
          yaw: entry.yaw,
          y: stackGround - settlementY + (primitive.y ?? 0) + primitive.height * 0.5 + (primitive.kind === 'ground' ? 0.006 : 0.012),
        });
      }
    }
  };

  for (const plot of [...(settlement.structurePlots ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    const placement = placementById.get(plot.id);
    if (!placement) continue;
    // Construction owns its worksite. Existing structures can remain authoritative providers while
    // an upgrade/repurpose is underway, but ordinary precinct props must not compete with scaffolds,
    // material staging or crew clearance on that same reserved plot.
    if (settlement.development?.project?.plotId === plot.id) continue;
    const plan = planWorkingPrecinct(settlement, plot, placement, {
      month: state.month, moisture: cellAt(state.world, plot.worldX, plot.worldZ)?.moisture ?? 0,
    }, { plan: storagePlan, arrivals, seed });
    if (!plan) continue;
    needCounts[plan.need] = (needCounts[plan.need] ?? 0) + 1;
    place({ worldX: plot.worldX, worldZ: plot.worldZ, radius: plot.radius, rotationY: placement.rotationY }, plan.primitives);
  }

  // Stock no real structure can hold (a founding camp, or a yard-less early village) is kept in one
  // shared open-air stockpile at the edge of the common ground, on the side its material arrives from.
  const commonHost = storagePlan.hosts.get(STOCKPILE_HOST_ID);
  if (commonHost) {
    const toward = dominantArrival(commonHost, arrivals);
    const base = toward ? Math.atan2(toward.z, toward.x) : (seed.length * 2.399) % (Math.PI * 2);
    const radius = 0.85;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const angle = base + (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * 0.42;
      const distance = 2.05 + Math.floor(attempt / 6) * 0.45;
      const dx = Math.cos(angle), dz = Math.sin(angle);
      const worldX = settlement.position.x + dx * distance;
      const worldZ = settlement.position.z + dz * distance;
      if ((settlement.structurePlots ?? []).some(plot => plot.condition > 0.08 && Math.hypot(worldX - plot.worldX, worldZ - plot.worldZ) < plot.radius + radius + 0.1)) continue;
      if (!isAreaClear(worldX, worldZ, radius) || wornPathAt(state, worldX, worldZ)) continue;
      // Local -z faces the settlement core: stock backs onto the outer edge, the handling floor faces home.
      const rotationY = Math.atan2(dx, dz);
      const frame: YardFrame = { wallOffset: -0.42, stripDepth: 0.76, stripWidth: 1.15, side: 'rear',
        arrivalSign: arrivalSignFor(toward, rotationY, `${seed}:stockpile`) };
      const yard = planYardBays(commonHost, commonHost.allocations, frame, seed);
      place({ worldX, worldZ, radius, rotationY }, yard.primitives.map(yardPrimitive));
      group.userData['commonStockpile'] = { worldX, worldZ };
      break;
    }
  }

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const pileGeometry = new THREE.DodecahedronGeometry(0.5, 0);
  const scratch = new THREE.Object3D();
  const colour = new THREE.Color();

  const make = (kind: PrecinctPrimitiveKind, geometry: THREE.BufferGeometry, castShadow: boolean) => {
    const entries = records[kind];
    if (!entries.length) return;
    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: kind === 'pile' ? 0.94 : 1,
      metalness: 0,
      polygonOffset: kind === 'ground',
      polygonOffsetFactor: kind === 'ground' ? -1 : 0,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
    mesh.name = `working-precinct-${kind}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      const primitive = entry.primitive;
      scratch.position.set(entry.localX, entry.y, entry.localZ);
      // Yaw outermost, then pitch (lean-to roofs, leaning sheaves), then roll for logs lying along local x.
      scratch.rotation.set(primitive.pitch ?? 0, entry.yaw, kind === 'log' ? Math.PI / 2 : 0, 'YXZ');
      if (kind === 'log') scratch.scale.set(primitive.height, primitive.width, primitive.depth);
      else scratch.scale.set(primitive.width, primitive.height, primitive.depth);
      scratch.updateMatrix();
      mesh.setMatrixAt(index, scratch.matrix);
      colour.set(primitive.colour);
      mesh.setColorAt(index, colour);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  };

  make('ground', boxGeometry, false);
  make('solid', boxGeometry, true);
  make('pile', pileGeometry, true);
  const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
  make('log', cylinderGeometry, true);
  make('drum', cylinderGeometry, true);
  make('clod', new THREE.IcosahedronGeometry(0.5, 0), true);
  group.userData['workingPrecinctCount'] = Object.values(needCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  group.userData['needCounts'] = { ...needCounts };
  group.userData['instanceCount'] = Object.values(records).reduce((sum, entries) => sum + entries.length, 0);
  group.userData['storageMaturity'] = storagePlan.maturity;
  group.userData['storageHosts'] = [...storagePlan.hosts.values()].map(host => ({ id: host.hostId, role: host.role, maturity: host.maturity,
    materials: host.allocations.map(allocation => allocation.materialId) }));
  /** Visible stock units actually placed; never above the logarithmic units of real inventory. */
  group.userData['visibleStockUnits'] = stockUnits;
  group.userData['authority'] = 'structurePlot.development + settlement.localMaterials allocation + services';
  return group;
}
