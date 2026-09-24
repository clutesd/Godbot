import type { Person, Settlement, StructurePlot, Vec2 } from '../sim/types';
import { resourceVisualUnit } from '../sim/resources/ResourceWorkPresentation';

export type FarmGeometryStatus = 'active' | 'abandoned' | 'ruin' | 'fallback';

export interface FarmGeometry {
  id: string;
  center: Vec2;
  width: number;
  depth: number;
  /** Presentation/navigation orientation shared by rows, workers and the field-side structure. */
  rotationY: number;
  source: 'plot' | 'fallback';
  status: FarmGeometryStatus;
  condition: number;
  workable: boolean;
  accessRestricted: boolean;
  burning: boolean;
}

/**
 * One deterministic orientation for the physical field and every presentation consumer.
 * Developed plots sit in semantic districts around a settlement, so rows run broadly tangent to
 * that district ring instead of every farm snapping to world X/Z. A small stable variation keeps
 * neighbouring fields from looking stamped from one template.
 */
export function farmPlotRotation(settlement: Settlement, plot: Pick<StructurePlot, 'id' | 'worldX' | 'worldZ'>): number {
  const dx = plot.worldX - settlement.position.x;
  const dz = plot.worldZ - settlement.position.z;
  const radial = Math.hypot(dx, dz) > 0.001 ? Math.atan2(-dx, -dz) : 0;
  const variation = (resourceVisualUnit(`${plot.id}:field-orientation`) - 0.5) * 0.24;
  return radial + Math.PI * 0.5 + variation;
}

function plotFarmGeometry(settlement: Settlement, plot: StructurePlot): FarmGeometry {
  const status = plot.development?.status ?? 'ruin';
  return {
    id: plot.id,
    center: { x: plot.worldX, z: plot.worldZ },
    // Leave a narrow service margin for the field-side store while using most of the real plot.
    width: Math.max(0.9, plot.width * 0.9),
    depth: Math.max(0.78, plot.depth * 0.84),
    rotationY: farmPlotRotation(settlement, plot),
    source: 'plot',
    status,
    condition: plot.condition,
    workable: settlement.alive && status === 'active' && !plot.accessRestricted && plot.condition >= 0.65 && !plot.fire,
    accessRestricted: Boolean(plot.accessRestricted),
    burning: Boolean(plot.fire),
  };
}

function fallbackFarmGeometry(settlement: Settlement): FarmGeometry | undefined {
  if (!settlement.alive || !(settlement.agriculture && settlement.agriculture.labour > 0)) return undefined;
  const angle = resourceVisualUnit(`${settlement.id}:cultivated-field`) * Math.PI * 2;
  return {
    id: `${settlement.id}:field`,
    center: {
      x: settlement.position.x + Math.cos(angle) * 4,
      z: settlement.position.z + Math.sin(angle) * 4,
    },
    width: 2.05,
    depth: 1.5,
    rotationY: angle + Math.PI * 0.5,
    source: 'fallback',
    status: 'fallback',
    condition: 1,
    workable: true,
    accessRestricted: false,
    burning: false,
  };
}

/**
 * Every physical agricultural plot that should remain legible in the world. Active fields sort
 * first so the bounded render budget always preserves working agriculture before old fallow sites.
 * Fallback agriculture exists only when the simulation has labour but no physical field history.
 */
export function farmGeometries(settlement: Settlement): FarmGeometry[] {
  const plots = (settlement.structurePlots ?? [])
    .filter(plot => plot.development?.form === 'field' && plot.condition > 0.04)
    .map(plot => plotFarmGeometry(settlement, plot))
    .sort((a, b) =>
      Number(b.status === 'active') - Number(a.status === 'active')
      || Number(b.workable) - Number(a.workable)
      || b.condition - a.condition
      || a.id.localeCompare(b.id));

  if (plots.length > 0) return plots;
  const fallback = fallbackFarmGeometry(settlement);
  return fallback ? [fallback] : [];
}

/**
 * The one field a farmer is assigned to for navigation and physical work. Rendering uses
 * farmGeometries() so every physical field remains visible; navigation deliberately chooses one
 * safe deterministic work site and does not multiply farmer destinations.
 */
export function farmGeometry(settlement: Settlement): FarmGeometry | undefined {
  if (!settlement.alive) return undefined;
  return farmGeometries(settlement).find(field => field.workable);
}

/** Convert field-local coordinates to world coordinates using the shared deterministic orientation. */
export function farmPoint(field: FarmGeometry, localX: number, localZ: number): Vec2 {
  const cosine = Math.cos(field.rotationY);
  const sine = Math.sin(field.rotationY);
  return {
    x: field.center.x + localX * cosine + localZ * sine,
    z: field.center.z - localX * sine + localZ * cosine,
  };
}

export function farmAnchor(field: FarmGeometry, personId: string, step = 0): { anchor: Vec2; target: Vec2 } {
  const row = Math.floor(resourceVisualUnit(`${personId}:row`) * 4);
  const column = (Math.floor(resourceVisualUnit(`${personId}:column`) * 6) + step) % 6;
  const localX = (column / 5 - 0.5) * field.width * 0.8;
  const localZ = (row - 1.5) * field.depth / 4;
  return {
    anchor: farmPoint(field, localX, localZ - 0.13),
    target: farmPoint(field, localX, localZ),
  };
}

export function farmDestinationMatches(person: Person, field: FarmGeometry): boolean {
  return person.navigation?.destinationKind === 'field'
    && (person.navigation.destinationId === field.id || person.navigation.destinationId === `${person.homeId}:field`);
}
