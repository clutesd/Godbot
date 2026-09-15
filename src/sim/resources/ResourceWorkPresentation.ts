import { RESOURCE_BY_ID } from './catalog';
import type { ResourceWorkAssignment } from './ResourceWorkAssignments';
import type { Vec2 } from '../types';

export type ResourceWorkVisualKind = 'timber' | 'mineral' | 'plant' | 'generic';

export interface ResourceWorkProfile {
  readonly kind: ResourceWorkVisualKind;
  readonly tool: 'axe' | 'pick' | 'basket' | 'none';
  readonly stance: 'chop' | 'strike' | 'pluck' | 'sort';
  readonly response: 'wood-chips' | 'stone-chips' | 'leaves' | 'none';
  readonly materialColour: string;
  readonly intensity: number;
  readonly pileCount: number;
  readonly workRadius: number;
  readonly cycleSeconds: number;
}

const MINERAL_COLOURS: Readonly<Record<string, string>> = {
  stone: '#918b7d', 'copper-ore': '#a67550', 'iron-ore': '#78564a',
  coal: '#373633', clay: '#a67b60', 'uranium-ore': '#737a60',
};

/** Documentary scale only. No amount here is stock, cargo, or future production. */
export function resourceWorkProfile(assignment: ResourceWorkAssignment): ResourceWorkProfile {
  const kind = resourceWorkVisualKind(assignment);
  const contributed = Object.values(assignment.labourByOccupation).reduce((sum, n) => sum + positive(n ?? 0), 0);
  const labour = Math.min(positive(assignment.labourUsed), contributed);
  const intensity = Math.min(1, Math.log1p(labour) / 4 * 0.65 + Math.log1p(positive(assignment.amountExtracted)) / 6 * 0.35);
  return {
    kind,
    tool: kind === 'timber' ? 'axe' : kind === 'mineral' ? 'pick' : kind === 'plant' ? 'basket' : 'none',
    stance: kind === 'timber' ? 'chop' : kind === 'mineral' ? 'strike' : kind === 'plant' ? 'pluck' : 'sort',
    response: kind === 'timber' ? 'wood-chips' : kind === 'mineral' ? 'stone-chips' : kind === 'plant' ? 'leaves' : 'none',
    materialColour: kind === 'timber' ? '#98683e' : kind === 'plant'
      ? assignment.resourceId === 'medicinal-flora' ? '#79865e' : '#a49b60'
      : MINERAL_COLOURS[assignment.resourceId] ?? '#847767',
    intensity,
    pileCount: Math.min(4, Math.max(1, Math.ceil(Math.sqrt(positive(assignment.amountExtracted))))),
    workRadius: kind === 'plant' ? 0.44 : 0.36,
    cycleSeconds: kind === 'plant' ? 6.8 : kind === 'timber' ? 2.6 : 2.9,
  };
}

export interface ResourceWorkerVariation {
  phaseOffset: number;
  cycleSpeed: number;
  strikeStrength: number;
  recovery: number;
}

export function resourceWorkerVariation(seed: string, personId: string, siteId: string): ResourceWorkerVariation {
  const key = `${seed}:${personId}:${siteId}`;
  return {
    phaseOffset: resourceVisualUnit(`${key}:phase`),
    cycleSpeed: 0.87 + resourceVisualUnit(`${key}:speed`) * 0.26,
    strikeStrength: 0.86 + resourceVisualUnit(`${key}:strength`) * 0.24,
    recovery: 0.8 + resourceVisualUnit(`${key}:recovery`) * 0.4,
  };
}

export interface ResourceWorkStation {
  anchor: Vec2;
  alternate: Vec2;
  target: Vec2;
  facing: number;
}

export const RESOURCE_WORKER_SPACING = 0.24;

/** Fixed four-slot layout; reject unsafe slots instead of collapsing people onto one fallback. */
export function resourceWorkStations(
  origin: Vec2, profile: ResourceWorkProfile, seed: string, siteId: string,
  safeSegment: (from: Vec2, to: Vec2) => boolean,
): ResourceWorkStation[] {
  const stations: ResourceWorkStation[] = [];
  const phase = resourceVisualUnit(`${seed}:${siteId}:layout`) * Math.PI * 2;
  for (let slot = 0; slot < 4; slot++) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = phase + slot * Math.PI / 2 + attempt * Math.PI / 16;
      const anchor = { x: origin.x + Math.cos(angle) * profile.workRadius, z: origin.z + Math.sin(angle) * profile.workRadius };
      if (!safeSegment(origin, anchor) || stations.some(s => Math.hypot(s.anchor.x - anchor.x, s.anchor.z - anchor.z) < RESOURCE_WORKER_SPACING)) continue;
      const target = { x: anchor.x - Math.cos(angle) * 0.13, z: anchor.z - Math.sin(angle) * 0.13 };
      const candidate = { x: anchor.x - Math.sin(angle) * 0.045, z: anchor.z + Math.cos(angle) * 0.045 };
      stations.push({ anchor, target, alternate: safeSegment(anchor, candidate) ? candidate : anchor, facing: Math.atan2(target.x - anchor.x, target.z - anchor.z) });
      break;
    }
  }
  return stations;
}

export function resourceVisualUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) / 0x100000000;
}

function positive(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0; }

/**
 * One presentation classification for workers and work sites. It is derived only from the
 * authoritative resource id; it never changes extraction, labour, routing, or inventory state.
 */
export function resourceWorkVisualKind(
  assignment: Pick<ResourceWorkAssignment, 'resourceId'>,
): ResourceWorkVisualKind {
  const definition = RESOURCE_BY_ID.get(assignment.resourceId);
  if (definition?.category === 'timber' || assignment.resourceId === 'timber') return 'timber';
  if (definition?.category === 'plant'
    || assignment.resourceId === 'medicinal-flora'
    || assignment.resourceId === 'plant-fiber') return 'plant';
  if (definition?.category === 'mineral'
    || assignment.resourceId.includes('ore')
    || ['stone', 'clay', 'coal'].includes(assignment.resourceId)) return 'mineral';
  return 'generic';
}
