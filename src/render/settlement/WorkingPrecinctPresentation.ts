import * as THREE from 'three';
import type { Settlement, SimulationState, StructurePlot } from '../../sim/types';
import type { SettlementNeed, StructureDevelopment, StructureMaterial } from '../../sim/development/types';
import { movementPathStage } from '../../sim/environment/PathEvolution';
import { cellAt } from '../../sim/world';

export type PrecinctCue =
  | 'working-ground'
  | 'gathering-space'
  | 'loading-apron'
  | 'work-surface'
  | 'storage-surface'
  | 'domestic-yard'
  | 'fence'
  | 'sacred-marker'
  | 'water-handling'
  | 'stock:food'
  | 'stock:wood'
  | 'stock:minerals'
  | 'stock:goods';

type PrecinctPrimitiveKind = 'ground' | 'solid' | 'pile';
type BulkStock = 'food' | 'wood' | 'minerals' | 'goods';

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
  wood: '#725236',
  minerals: '#66635d',
  goods: '#7b6955',
};

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

function activeDevelopment(plot: StructurePlot): StructureDevelopment | undefined {
  const development = plot.development;
  if (!development || development.status !== 'active' || plot.condition <= 0.08 || development.memorial) return undefined;
  return development;
}

function resourceEligible(settlement: Settlement, development: StructureDevelopment, stock: BulkStock): boolean {
  if (stock === 'food') return development.need === 'food' || development.form === 'store' && (development.services.food ?? 0) > 0;
  if (stock === 'wood') return ['manufacturing', 'energy', 'transport'].includes(development.need)
    || settlement.specialization === 'forestry' && ['trade', 'manufacturing'].includes(development.need);
  if (stock === 'minerals') return development.need === 'manufacturing'
    || settlement.specialization === 'mining' && ['trade', 'transport'].includes(development.need);
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
      return development ? resourceEligible(settlement, development, stock) : false;
    })
    .sort((a, b) => a.id.localeCompare(b.id))[0]?.id;
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
export function planWorkingPrecinct(
  settlement: Settlement,
  plot: StructurePlot,
  placement: Pick<PrecinctPlacement, 'width' | 'depth'>,
): WorkingPrecinctPlan | undefined {
  const development = activeDevelopment(plot);
  if (!development) return undefined;

  const primitives: PrecinctPrimitive[] = [];
  const level = clamp(development.level, 1, 3);
  const condition = clamp(plot.condition, 0.2, 1);
  const fit = Math.min(1, 0.64 + level * 0.12);
  const bodyWidth = placement.width * fit;
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

  const pad = (cue: PrecinctCue, side: 'front' | 'rear', scale = 1) => {
    const z = side === 'front' ? frontZ : rearZ;
    const width = (side === 'front' ? frontWidth : rearWidth) * scale;
    add('ground', cue, 0, z, width, 0.018, stripDepth * 0.94, groundColour, false);
  };

  const table = (cue: PrecinctCue, side: 'front' | 'rear', lateral = 1, scale = 1) => {
    const z = (side === 'front' ? frontZ : rearZ) + (side === 'front' ? -1 : 1) * stripDepth * 0.04;
    const available = side === 'front' ? frontWidth : rearWidth;
    const width = clamp(available * 0.25 * scale, 0.24, 0.62);
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
    addStock('wood');
    addStock('minerals');
    addStock('goods');
  }

  if (development.need === 'energy') {
    pad('working-ground', 'rear', 0.94);
    table('work-surface', 'rear', 1, 0.92);
    if (settlement.resources.wood > 0 && (development.services.energy ?? 0) > 0) addStock('wood');
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

interface InstanceRecord {
  primitive: PrecinctPrimitive;
  worldX: number;
  worldZ: number;
  localX: number;
  localZ: number;
  yaw: number;
  y: number;
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
): THREE.Group {
  const group = new THREE.Group();
  group.name = `working-precincts:${settlement.id}`;
  const placementById = new Map(placements.map(placement => [placement.key, placement]));
  const records: Record<PrecinctPrimitiveKind, InstanceRecord[]> = { ground: [], solid: [], pile: [] };
  const needCounts: Partial<Record<SettlementNeed, number>> = {};

  for (const plot of [...(settlement.structurePlots ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    const placement = placementById.get(plot.id);
    if (!placement) continue;
    const plan = planWorkingPrecinct(settlement, plot, placement);
    if (!plan) continue;
    needCounts[plan.need] = (needCounts[plan.need] ?? 0) + 1;
    const c = Math.cos(placement.rotationY), s = Math.sin(placement.rotationY);

    for (const primitive of plan.primitives) {
      // Hard stop at the real reserved plot. Ground and props never claim new settlement land.
      const reach = Math.hypot(primitive.x, primitive.z) + Math.hypot(primitive.width, primitive.depth) * 0.5;
      if (reach > plot.radius + 0.025) continue;
      const worldX = plot.worldX + primitive.x * c + primitive.z * s;
      const worldZ = plot.worldZ - primitive.x * s + primitive.z * c;
      if (primitive.keepPathClear && wornPathAt(state, worldX, worldZ)) continue;
      const yaw = placement.rotationY + primitive.yaw;
      const variance = terrainVariance(heightAt, worldX, worldZ, yaw, primitive.width, primitive.depth);
      // Large rigid presentation slabs should disappear rather than hover across steep ground.
      if (variance > (primitive.kind === 'ground' ? 0.2 : 0.28)) continue;
      const groundY = heightAt(worldX, worldZ) - settlementY;
      records[primitive.kind].push({
        primitive,
        worldX,
        worldZ,
        localX: worldX - settlement.position.x,
        localZ: worldZ - settlement.position.z,
        yaw,
        y: groundY + primitive.height * 0.5 + (primitive.kind === 'ground' ? 0.006 : 0.012),
      });
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
      scratch.rotation.set(0, entry.yaw, 0);
      scratch.scale.set(primitive.width, primitive.height, primitive.depth);
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
  group.userData['workingPrecinctCount'] = Object.values(needCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  group.userData['needCounts'] = { ...needCounts };
  group.userData['instanceCount'] = records.ground.length + records.solid.length + records.pile.length;
  group.userData['authority'] = 'structurePlot.development + settlement inventory/services';
  return group;
}
